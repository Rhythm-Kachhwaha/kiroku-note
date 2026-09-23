# Stage 1 — Architecture Inspection & Capture Pipeline Report
## 1. Executive Summary
As requested, **Stage 1 (Inspection & Architecture Preparation)** has been completed. The existing audio capture codebase across the Chromium extension, offscreen document, content script, and backend was thoroughly inspected and cross-referenced with [`AudioFeatureReport.md`](file:///d:/Python/AnkiMiner/AudioFeatureReport.md).
No breaking changes were made. All **110 backend unit/integration tests** and **16 extension test suites** continue to pass.
---
## 2. Current Audio Architecture
Currently, audio capture follows an **on-demand, per-sentence lifecycle**:
```
Side Panel (identify) 
      │ (async fetch to backend /api/capture)
      ▼
Side Panel triggers retakeAudio()
      │
      ▼
Content Script (video-mining-poc.js: recordSentenceAudio)
      │
      ├── [Old logic: seeks video to start, calls play(), records, pauses, restores currentTime]
      │
      ▼
Background Service Worker (background.js)
      │
      ├── Requests chrome.tabCapture.getMediaStreamId({ targetTabId })
      ├── Spawns offscreen document via ensureOffscreenDocument()
      └── Sends START_RECORDING_OFFSCREEN
            │
            ▼
Offscreen Document (offscreen.js: OffscreenAudioRecorder)
      ├── Acquires getUserMedia(streamId)
      ├── Creates new AudioContext & connects stream -> destination (speaker mirroring)
      ├── Instantiates MediaRecorder (audio/webm;codecs=opus)
      ├── Waits for durationMs timer
      ├── Encodes recorded chunks to Base64 WebM Data URL
      └── Closes AudioContext, stops tracks, destroys recorder
            │
            ▼
Side Panel receives AUDIO_CAPTURED and sets currentDraftMedia.audioBase64
```

---

## 3. Problems in Current Implementation

1. **User Gesture Token Expiration:**
   `tabCapture.getMediaStreamId({ targetTabId })` requires an active extension user gesture. In the current flow, `identify()` awaits Yomitan backend processing (`POST /api/capture`) before triggering audio capture. The async microtask break causes Chromium to invalidate the user gesture token, triggering intermittent `Extension has not been invoked for the current page` errors.
2. **Hard Playback Invariant Violations (Historical seek-and-replay):**
   When paused, `recordSentenceAudio` attempted to rewind `video.currentTime = startTime`, trigger `video.play()`, record live, and seek back. This violates the zero playback disruption invariant and causes audio bursts during silent reading.
3. **Repeated Stream & AudioContext Instantiation / Teardown:**
   Creating and destroying `MediaStream`, `AudioContext`, and `MediaRecorder` on every sentence capture produces audible clicks/pops, delays capture by 150–300 ms, and prevents capturing audio that has already played.
4. **Zero History / No Continuous Rolling Buffer:**
   Because capture only starts *after* a mining event is triggered, past audio (speech already heard by the user) is lost unless the video was rewound or already playing.
5. **No Timeline / Clock Model:**
   There is currently no mapping between `video.currentTime` and captured audio samples.

---

## 4. Exact Files Inspected & Changed

### Files Inspected:
* [`extension/manifest.json`](file:///d:/Python/AnkiMiner/extension/manifest.json) — Verified permissions (`tabCapture`, `offscreen`, `activeTab`, `tabs`).
* [`extension/background.js`](file:///d:/Python/AnkiMiner/extension/background.js) — Inspected offscreen lifecycle management and message handlers.
* [`extension/offscreen/offscreen.html`](file:///d:/Python/AnkiMiner/extension/offscreen/offscreen.html) & [`extension/offscreen/offscreen.js`](file:///d:/Python/AnkiMiner/extension/offscreen/offscreen.js) — Inspected `OffscreenAudioRecorder`, Web Audio mirroring, and `MediaRecorder` lifecycle.
* [`extension/content/video-mining-poc.js`](file:///d:/Python/AnkiMiner/extension/content/video-mining-poc.js) — Inspected `VideoDetector`, `SubtitleSyncEngine`, `recordSentenceAudio()`, and `_captureStreamFallback()`.
* [`extension/content/content.js`](file:///d:/Python/AnkiMiner/extension/content/content.js) & [`extension/content/capture-utils.js`](file:///d:/Python/AnkiMiner/extension/content/capture-utils.js) — Inspected text selection and event dispatching.
* [`extension/sidepanel/sidepanel.js`](file:///d:/Python/AnkiMiner/extension/sidepanel/sidepanel.js) — Inspected `identify()`, media preview state, and `AUDIO_CAPTURED` listener.
* [`extension/tests/audio-recording.test.js`](file:///d:/Python/AnkiMiner/extension/tests/audio-recording.test.js) (and all 16 test files) — Inspected audio recording contract tests.
* [`backend/app/services/media_storage.py`](file:///d:/Python/AnkiMiner/backend/app/services/media_storage.py) & [`backend/app/services/card_service.py`](file:///d:/Python/AnkiMiner/backend/app/services/card_service.py) — Inspected backend audio file decoding and persistence.

### Files Changed:
* [`PROGRESS.md`](file:///d:/Python/AnkiMiner/PROGRESS.md) — Recorded Stage 1 architecture verification and test results.

---

## 5. Architectural Design for Next Stages

### A. Lifecycle & Stream Ownership
* **Single Capture Session:** When the user enables Mining Mode in the Side Panel (a valid user gesture), `getMediaStreamId` is acquired once.
* **Persistent Offscreen Capture Engine:** The Offscreen Document maintains the active `MediaStream`, persistent `AudioContext`, `AudioWorkletNode`, and the circular PCM buffer throughout the entire mining session.
* **Service Worker Resilience:** Direct messaging between content script/side panel and the offscreen document via `chrome.runtime.sendMessage` keeps operations responsive even if the service worker goes idle.

### B. Rolling PCM Ring Buffer
* **Format:** Mono 1-channel `Float32Array` at native tab sample rate (default 48,000 Hz).
* **Downmixing:** Stereo tab channels are averaged $(\frac{L + R}{2})$ inside the `AudioWorkletProcessor`.
* **Buffer Size:** 30 seconds ($30 \times 48,000 \times 4\text{ bytes} \approx 5.76\text{ MB}$).
* **Transport:** AudioWorklet transfers pre-allocated 2048-sample `ArrayBuffer` blocks via zero-copy `MessagePort.postMessage` (avoiding `SharedArrayBuffer` / COOP/COEP constraints).

### C. Timeline & Media Time Synchronization
* **Sync Heartbeats:** The content script periodically sends synchronization beats `(timelineId, videoTime, wallClockTime, playbackRate, paused)` every ~200 ms to the Offscreen Document.
* **Linear Model:** The offscreen document correlates incoming sample write indices with video time:
  $$\text{estimatedVideoTime}(n) = \text{anchorVideoTime} + \frac{n - n_{\text{anchor}}}{\text{sampleRate}} \times \text{playbackRate}$$
* **Calibration & Padding:** Audio extraction will apply initial configurable padding (**150 ms start / 200 ms end**) to absorb clock jitter and transport latency.
* **Extraction:** When a subtitle is mined, `[startTime, endTime]` is mapped to sample indices in the circular buffer, sliced without touching playback, encoded into a canonical 16-bit PCM WAV Data URL, and delivered to the Side Panel.

### D. Pause / Resume Model
* While paused, media playback stops and no new audio is decoded by the browser.
* If a mined subtitle's end extends beyond the current playback position (e.g. paused mid-sentence), the card draft is created immediately with screenshot & text. The audio slice finalizes once normal playback resumes and passes the sentence end.

### E. Seek & Timeline Discontinuities
* A monotonic `timelineId` increments upon seek events, video element replacement, source URL change, or navigation.
* The ring buffer tags sample blocks with `timelineId`. If a requested slice spans across different `timelineId` values, the extraction cleanly returns `AUDIO_DISCONTINUITY_ERROR` rather than corrupting audio across disjoint scenes.

### F. DRM / Protected Sources (Netflix)
* Hardware-protected streams (Widevine EME) yield empty/silent audio in `tabCapture`.
* Fail-soft handling: sets status to `DRM_AUDIO_RESTRICTED`, displays `[Text Only - DRM Protected]`, and preserves text mining, Yomitan definitions, and card creation.

---

## 6. Test Verification Results

* **Backend Test Suite:**
  `python -m pytest backend/tests`
  **Result:** `110 passed in 5.32s` (100% pass rate).

* **Extension Test Suites:**
  All 16 Node test suites executed:
  * `audio-recording.test.js` — **PASS**
  * `video-mining-poc.test.js` — **PASS**
  * `video-mining-integration.test.js` — **PASS**
  * `sidepanel-media-ui.test.js` — **PASS**
  * `capture-screenshot.test.js` — **PASS**
  * `subtitle-sync-offset.test.js` — **PASS**
  * `subtitle-auto-pause.test.js` — **PASS**
  * `subtitle-hotkeys.test.js` — **PASS**
  * `srv3-parser.test.js` — **PASS**
  * `youtube-adapter.test.js` — **PASS**
  * `netflix-adapter.test.js` — **PASS**
  * `capture-frame-verification.test.js` — **PASS**
  * `dictionary-study-view.test.js` — **PASS**
  * `sidepanel.test.js` — **PASS**
  * `subtitle-parser.test.js` — **PASS**
  * `capture-utils.test.js` — **PASS**
  **Result:** `16/16 test suites passed`.

---

## 7. Unresolved Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Tab sample rate mismatch (e.g., 44.1 kHz vs 48 kHz) | Query `audioContext.sampleRate` dynamically; compute buffer allocations and WAV header sample rates accordingly. |
| Background tab audio clock sleep/throttling | Web Audio runs on high-priority OS audio thread; audio capture is unthrottled in background tabs. |
| Tab navigation / closing | Listen to `chrome.tabs.onRemoved` / `onUpdated` in background to cleanly release captured stream and reset offscreen state. |

---

**STAGE 1 IS COMPLETE. Awaiting your review before proceeding to Stage 2.**