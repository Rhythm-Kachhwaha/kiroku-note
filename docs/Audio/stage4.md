# STAGE 4 — Integrate Extracted Audio into Cards: Final Report

## Executive Summary

Stage 4 connects the deterministic, passive 16-bit mono WAV extraction pipeline implemented in Stage 3 directly into AnkiMiner's card mining and synchronization workflow:
$$\text{Subtitle mined} \longrightarrow \text{Stage 3 extracts WAV} \longrightarrow \text{Side Panel receives audio} \longrightarrow \text{Audio preview} \longrightarrow \text{Save Card} \longrightarrow \text{Local SQLite/disk persistence} \longrightarrow \text{Send to Anki} \longrightarrow \text{Attached to Anki note field}$$

All operations adhere strictly to the locked boundaries, the Hard Playback Invariant (zero seeking, zero play/pause interference), and safe fail-soft principles (text mining and card synchronization never break when audio is unavailable or DRM-restricted).

---

## 1. Files Changed

### Extension (Client / UI / Content)
- [`extension/sidepanel/sidepanel.html`](file:///d:/Python/AnkiMiner/extension/sidepanel/sidepanel.html): Added `#audio-status-badge`, `#btn-replay-audio`, `#btn-clear-audio`, and `#audio-placeholder-text` in the `#audio-preview-container`.
- [`extension/sidepanel/sidepanel.css`](file:///d:/Python/AnkiMiner/extension/sidepanel/sidepanel.css): Added `.media-header-left`, `.media-status-pill` variants (`.badge-ready`, `.badge-pending`, `.badge-unavailable`, `.badge-expired`, `.badge-discontinuity`), `.btn-media-replay`, and animations.
- [`extension/sidepanel/sidepanel.js`](file:///d:/Python/AnkiMiner/extension/sidepanel/sidepanel.js):
  - Added `audioStatus` (`available`, `pending`, `unavailable`, `expired`, `discontinuity`, `idle`) to `currentDraftMedia`.
  - Implemented `updateMediaPreviews()` handling complete status badge rendering, player attachment, and placeholder updates.
  - Implemented `#btn-replay-audio` click handler to replay `audioPreview` without touching video.
  - Updated message listeners for `AUDIO_CAPTURED` and `AUDIO_CAPTURE_STATUS` with stale `captureId` protection.
  - Preserved audio in card drafts during text edits, and restored audio URLs upon opening saved cards from history.
- [`extension/content/video-mining-poc.js`](file:///d:/Python/AnkiMiner/extension/content/video-mining-poc.js): Updated `recordSentenceAudio` to dispatch passive extraction requests (`EXTRACT_SUBTITLE_AUDIO`) and broadcast results without playback disruption.
- [`extension/tests/audio-recording.test.js`](file:///d:/Python/AnkiMiner/extension/tests/audio-recording.test.js): Updated test harness to support Stage 3 extraction message flow while verifying playback invariants.
- [`extension/tests/sidepanel-media-ui.test.js`](file:///d:/Python/AnkiMiner/extension/tests/sidepanel-media-ui.test.js): Updated mock DOM definitions and contracts for Stage 4 audio elements.
- [`extension/tests/card-draft-audio.test.js`](file:///d:/Python/AnkiMiner/extension/tests/card-draft-audio.test.js) **[NEW]**: Comprehensive test suite covering DOM contracts, draft audio states, message handling, and history integration.

### Backend (FastAPI / Services / Storage / SQLite)
- [`backend/app/services/card_service.py`](file:///d:/Python/AnkiMiner/backend/app/services/card_service.py):
  - Updated `save_card()` to only invoke `MediaStorageService.save_media()` when `raw_audio.startswith("data:")`, specifying `preferred_ext="wav"`. Re-saving a card with an existing filename preserves it without creating duplicate or orphaned files.
  - Updated `sync_card()` to clean audio filenames and store WAV files into AnkiConnect via `store_media_file()`.
- [`backend/app/services/anki_connect.py`](file:///d:/Python/AnkiMiner/backend/app/services/anki_connect.py):
  - Expanded `audio_keywords` in `get_model_capabilities()`: added `wordaudio`, `targetaudio`, `targetwordaudio`, `kanaaudio`, `readingaudio`, `sentenceaudiofile`.
  - Added `audio_field` and `image_field` identification to `get_model_capabilities()`.
  - Refined `map_card_to_fields()`: prioritized dedicated sentence audio fields, attaching `[sound:filename.wav]`, while gracefully omitting audio on custom models that lack an audio field without polluting arbitrary text fields.
- [`backend/tests/test_stage4_audio_card.py`](file:///d:/Python/AnkiMiner/backend/tests/test_stage4_audio_card.py) **[NEW]**: Focused test suite covering WAV audio persistence, re-save idempotency, Anki field mapping, and connection failure handling.

---

## 2. How Stage 3 Audio Reaches the Card Draft

```
[Content Script]                               [Background SW]                      [Offscreen Document]                      [Side Panel]
       |                                              |                                      |                                     |
       |-- Subtitle Mined (Text + Cues) ------------->|------------------------------------->|                                     |
       |                                              |                                      |                                     |
       |-- EXTRACT_SUBTITLE_AUDIO ------------------->|------------------------------------->| (Extracts from Ring Buffer)         |
       |                                              |<-- { ok: true, status: "READY" } ----|                                     |
       |<-- { ok: true, status: "READY" } ------------|                                                                            |
       |                                                                                                                           |
       |-- AUDIO_CAPTURED (dataUrl: "data:audio/wav;base64,...", captureId) ------------------------------------------------------>|
       |                                                                                                                           |
       |                                                                                               [currentDraftMedia Updated] |
       |                                                                                               audioBase64: dataUrl        |
       |                                                                                               audioStatus: "available"   |
       |                                                                                               updateMediaPreviews()       |
```

1. When a Japanese subtitle is selected/mined, `VideoMiningPOC.recordSentenceAudio()` issues an `EXTRACT_SUBTITLE_AUDIO` message with the subtitle timing interval $[t_{\text{start}}, t_{\text{end}}]$, `timelineId`, padding (150ms start / 200ms end), and `captureId`.
2. The `AudioTimelineSyncEngine` in the offscreen document converts video time to PCM sample indices via $n(V) = n_{\text{anchor}} + (V - V_{\text{anchor}}) \times \frac{f_s}{r}$ and slices the circular ring buffer.
3. If the audio slice has already played, `WavEncoder` generates a 16-bit mono WAV Data URL immediately (`status: "READY"`). If the video is currently playing through the sentence, it queues a pending capture that fires when playback reaches the end sample (`status: "PENDING"`).
4. The content script broadcasts `AUDIO_CAPTURED` with the `dataUrl`, `mimeType`, and `captureId`.
5. The Side Panel message listener validates that `msg.captureId === currentCaptureId` (preventing stale captures from overwriting new selections) and updates `currentDraftMedia`:
   - `audioBase64`: Data URL
   - `mimeType`: `audio/wav`
   - `audioStatus`: `available`
6. `updateMediaPreviews()` is called, immediately updating the card editor UI.

---

## 3. How Audio is Persisted

1. **Local Disk Storage (`MediaStorageService`)**:
   - When the user clicks **Save Card**, `POST /api/cards/save` is sent with the card draft fields.
   - `CardService.save_card()` checks if `request.audio` contains a raw base64 data URL (`data:audio/wav;base64,...`).
   - If a Data URL is present, `MediaStorageService.save_media()` decodes the base64 payload, computes a SHA-256 hash or deterministic UUID, and writes the canonical file to `data/media/ankiminer_audio_{id}.wav`.
   - If `request.audio` is already a stored filename (e.g. `ankiminer_audio_abc.wav`) or media URL, it does not re-encode or create a duplicate file.
2. **SQLite Database (`CardRepository`)**:
   - The card record in the SQLite `cards` table stores the audio filename in the `audio` column (`TEXT`).
   - The relation between the card and the audio file is deterministic and 1-to-1.
3. **No Orphaned Files**:
   - If audio extraction fails or is unavailable, `audio` remains empty (`""` or `NULL`) without error.
   - Re-saving or editing an existing card reuses the existing media filename and does not generate orphan files.

---

## 4. How Audio Preview Works

The Card Editor contains a compact developer-utility audio preview container (`#audio-preview-container`):

```
┌─────────────────────────────────────────────────────────────┐
│ AUDIO                  [ Ready ]   [ Replay ]   [ Clear ]   │
├─────────────────────────────────────────────────────────────┤
│ ▶  0:00 / 0:02 ══════════════════════════════════ 🔊  ⋮     │
└─────────────────────────────────────────────────────────────┘
```

- **Player**: Standard compact HTML5 `<audio id="audio-preview" controls>` element.
- **Controls**:
  - **Play / Pause**: Built-in compact browser controls.
  - **Replay (`#btn-replay-audio`)**: Resets `audioPreview.currentTime = 0` and calls `audioPreview.play()`.
  - **Clear (`#btn-clear-audio`)**: Clears audio from the draft, resets `currentDraftMedia.audioBase64 = null`, and hides the player.
- **Status Pills (`#audio-status-badge`)**:
  - `Ready` (Green / `.badge-ready`): WAV audio extracted and ready for playback/saving.
  - `Pending…` (Pulsing Amber / `.badge-pending`): Video paused or playhead incomplete; waiting for playback.
  - `Unavailable` / `DRM Restricted` (Grey/Muted / `.badge-unavailable`): Audio capture restricted or hardware unavailable.
  - `Expired (>30s)` (Amber / `.badge-expired`): Subtitle fell outside the 30-second rolling buffer.
  - `Discontinuity` (Blue-Grey / `.badge-discontinuity`): Seek occurred before pending capture completed.
- **Isolation Invariant**:
  - Interacting with the audio preview (play, pause, seek, replay) interacts **only** with the extracted WAV blob.
  - It **never** dispatches events to the video element, never seeks the source video, and never resumes/pauses playback of the streaming site.

---

## 5. How Anki Audio-Field Mapping Works

When **Send to Anki** or **Retry Sync** is triggered:

1. **Model Capability Discovery**:
   - `AnkiConnectService.get_model_capabilities(model_name)` queries AnkiConnect via `modelFieldNames`.
   - Inspects fields against normalized audio keywords:
     `{"audio", "sound", "voice", "pronunciation", "sentenceaudio", "vocabaudio", "sentencesound", "vocabsound", "audios", "sounds", "wordaudio", "targetaudio", "targetwordaudio", "kanaaudio", "readingaudio", "sentenceaudiofile"}`
   - If matching, `supports_audio` is `True` and `audio_field` resolves to the target field name (e.g. `SentenceAudio`).
2. **Field Mapping (`map_card_to_fields`)**:
   - **Specialized / Mining Models**: Maps the audio filename to the designated audio field formatted with Anki sound syntax:
     $$\text{SentenceAudio} = \texttt{[sound:ankiminer\_audio\_xxx.wav]}$$
   - **Basic Model (`Front` / `Back`)**: Formats audio as `[sound:ankiminer_audio_xxx.wav]` and attaches it to `Back` alongside meaning/notes.
   - **Custom Model without Audio Field**:
     - `supports_audio` is `False`.
     - Card creation continues cleanly with all text fields populated.
     - Audio is **not** silently stuffed into unrelated fields (such as `Notes` or `Back`).
3. **Media Upload (`storeMediaFile`)**:
   - `CardService.sync_card()` reads the WAV bytes from local storage and uploads the file to Anki's collection media directory via AnkiConnect `storeMediaFile`.
   - Anki stores the WAV file in its media collection, matching the `[sound:...]` tag.

---

## 6. How Retries and Duplicates are Handled

- **Sync Idempotency**:
  - Before creating a new note in Anki, `AnkiConnectService.find_existing_note()` queries Anki for existing notes with matching `expression` and `reading` in the target deck.
  - If a matching note already exists in Anki, it links the existing note ID and marks the card `synced` without duplicating notes or media.
- **Retry Sync**:
  - If AnkiConnect was offline or returned an error during the initial save, the local card remains saved in SQLite with `sync_status = "failed"`.
  - Clicking **Retry Send to Anki** re-executes `store_media_file` and note creation.
  - Because `storeMediaFile` overwrites or reuses identical filenames deterministically in Anki's media folder, repeated retries do not create duplicate or corrupted media files.

---

## 7. How History Restores Audio

1. When a previously saved card is clicked in **Mining History**, the Side Panel invokes `loadCardIntoEditor(card)`.
2. If `card.audio` is present:
   - Sets `currentDraftMedia.audioBase64 = "http://127.0.0.1:8000/api/media/" + card.audio`.
   - Sets `currentDraftMedia.audioStatus = "available"`.
   - Sets `fieldAudio.value = card.audio`.
3. `updateMediaPreviews()` renders the audio player with the media URL and displays the green `Ready` badge.
4. The user can listen to the previously mined audio clip directly in the editor.
5. If the user edits card text and clicks **Save Card**, the backend receives `audio = "ankiminer_audio_xxx.wav"` (an existing filename) and preserves the existing database and file reference without duplicate disk writes.

---

## 8. Error and Fallback Behavior

| Error / Failure State | System Behavior | Text Mining Impact |
|---|---|---|
| **Audio Capture Unavailable** | `AUDIO_CAPTURE_STATUS` broadcast with `ok: false`. Status badge displays `Unavailable`. | Zero. Text draft remains fully editable and saveable. |
| **DRM-Restricted Stream** (e.g. Netflix) | Offscreen recorder catches DRM restriction. Status badge displays `DRM Restricted`. | Zero. Subtitle text and Yomitan definitions save and sync normally. |
| **Buffer Expiration (>30s)** | `RollingPcmBuffer` detects requested samples overwritten. Status badge displays `Expired (>30s)`. | Zero. Text card saves normally. |
| **Timeline Discontinuity (Seek)** | `AudioTimelineSyncEngine` detects seek across pending capture. Status badge displays `Discontinuity`. | Zero. Text card saves normally. |
| **Pending Capture on Pause** | Video paused before sentence finished. Status badge displays `Pending…`. Automatically resolves on natural play. | Zero. User can save immediately or wait for playback. |
| **WAV Generation Failure** | Encoder returns error. Status badge displays `Unavailable`. | Zero. Text card saves normally. |
| **Local Disk Failure** | `CardService` logs warning; card saves text to SQLite. | Zero. Text card remains available in SQLite. |
| **AnkiConnect Offline** | Note creation fails; local card saved with `sync_status = "failed"`. | Zero. Card saved locally; user can retry sync anytime. |
| **Missing Anki Audio Field** | Note model lacks audio field. Audio omitted from payload; text fields synced. | Zero. Text card created in Anki without error. |

---

## 9. Extension Test Results

All **22 extension test suites** passed with 100% success rate:

```text
Running:  audio-recording.test.js
PASS: Manifest permissions and offscreen document files verified.
PASS: OffscreenAudioRecorder lifecycle and audio mirroring verified.
PASS: OffscreenAudioRecorder DRM audio error handling verified.
PASS: background.js offscreen document lifecycle, persistent capture, and audio coordination verified.
PASS: VideoMiningPOC.recordSentenceAudio and TRIGGER_AUDIO_RECORDING verified.
>>> ALL AUDIO RECORDING VERIFICATION TESTS PASSED SUCCESSFULLY! <<<

Running:  audio-timeline-sync.test.js
PASS: Initial anchor establishment and bi-directional time mapping verified.
PASS: Playback rate scaling (1.5x, 0.5x) verified.
PASS: Normal playback tracking and drift re-anchoring verified.
PASS: Pause / resume model on same timeline verified.
PASS: Timeline discontinuity creation, segment recording, and stale timeline rejection verified.
>>> ALL AUDIO TIMELINE SYNCHRONIZATION TESTS PASSED SUCCESSFULLY! <<<

Running:  audio-worklet-pipeline.test.js
PASS: PCMRecorderProcessor mono downmixing and block transfer verified.
PASS: PersistentAudioCaptureEngine lifecycle and speaker mirroring verified.
PASS: PersistentAudioCaptureEngine DRM error handling verified.
>>> ALL AUDIOWORKLET PIPELINE TESTS PASSED SUCCESSFULLY! <<<

Running:  capture-frame-verification.test.js
PASS: Manifest configuration for all_frames and match_about_blank verified.
PASS: Top-level page selection capture verified.
PASS: HiAnime + ASBPlayer iframe (.asbplayer-subtitles) capture verified.
ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!

Running:  capture-screenshot.test.js
PASS: Manifest permissions, host_permissions, and content_scripts order verified.
PASS: ImageCropper.calculateCropBounds coordinate scaling and clamping verified.
PASS: ImageCropper.calculateTargetDimensions aspect-ratio downscaling verified.
PASS: ImageCropper.checkBlackFrame DRM and black frame detection verified.
PASS: ImageCropper.cropVideoFrame end-to-end execution and DRM error handling verified.
PASS: background.js CAPTURE_VIDEO_FRAME message handling contract verified.
PASS: VideoMiningPOC.captureCurrentFrame and TRIGGER_VIDEO_SCREENSHOT verified.
>>> ALL SCREENSHOT CAPTURE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<

Running:  capture-utils.test.js
capture-utils tests passed

Running:  card-draft-audio.test.js
PASS: Side Panel Stage 4 Audio DOM and CSS contracts verified.
PASS: Draft Audio state transitions (available, pending, unavailable, expired, discontinuity, clear) verified.
PASS: Side Panel AUDIO_CAPTURE_STATUS and AUDIO_CAPTURED message handling verified.
>>> ALL STAGE 4 CARD DRAFT AUDIO TESTS PASSED! <<<

Running:  dictionary-study-view.test.js
PASS: Dictionary HTML DOM structure verified.
PASS: formatRawDictionaryText verified.
PASS: Clean Study View rendering, deduplication, and examples accordion verified.
PASS: Full Dictionary toggle behavior verified.
PASS: Copy raw dictionary button verified.
PASS: clearDictionaryView verified.
>>> ALL DICTIONARY STUDY VIEW TESTS PASSED! <<<

Running:  netflix-adapter.test.js
PASS: isNetflixPage verified.
PASS: containsJapanese verified.
PASS: extractTextFromTimedtextElement verified.
PASS: NetflixAdapter end-to-end integration verified.
ALL NETFLIX ADAPTER TESTS PASSED!

Running:  rolling-pcm-buffer.test.js
PASS: RollingPcmBuffer initialization and sizing verified.
PASS: Linear write and available duration calculation verified.
PASS: Circular wraparound and oldest sample overwrite verified.
PASS: Long stream simulation (120s @ 48kHz) with bounded memory verified.
PASS: RollingPcmBuffer clear and reconfigure verified.
>>> ALL ROLLING PCM BUFFER TESTS PASSED SUCCESSFULLY! <<<

Running:  sidepanel-media-ui.test.js
PASS: Side Panel HTML media preview DOM contracts verified.
PASS: Side Panel CSS media preview styles verified.
PASS: Media preview state transitions and clear actions verified.
PASS: Retake triggers dispatch expected background actions.
PASS: Screenshot and audio capture message handlers update currentDraftMedia.
>>> ALL SIDEPANEL MEDIA UI TESTS PASSED! <<<

Running:  sidepanel.test.js
PASS: HTML DOM Contract: elements exist
PASS: CSS Contract: badge styles exist
PASS: JS Contract: handleCaptureResponse sets badges and session count correctly
>>> ALL SIDEPANEL UNIT TESTS PASSED! <<<

Running:  srv3-parser.test.js
PASS: parseSrv3Xml basic timed text parsing verified.
PASS: parseSrv3Xml entities and ruby annotation handling verified.
PASS: parseSrv3Xml invalid/empty XML handling verified.
ALL SRV3 PARSER TESTS PASSED!

Running:  subtitle-audio-extraction.test.js
PASS: Padded subtitle interval extraction (150ms start / 200ms end) verified.
PASS: Subtitle extraction with start padding clamped to timeline start verified.
PASS: Subtitle extraction during active playback verified.
PASS: Pending audio extraction on paused video resolved on resume verified.
PASS: Subtitle audio extraction expired (>30s) rejection verified.
PASS: Subtitle extraction rejected across timeline discontinuity verified.
PASS: Fast-rate (1.5x) subtitle audio extraction verified.
>>> ALL SUBTITLE AUDIO EXTRACTION TESTS PASSED SUCCESSFULLY! <<<

Running:  subtitle-auto-pause.test.js
PASS: SubtitleAutoPauseController lifecycle and DOM binding verified.
PASS: Hover enter triggering debounce and pause on video element verified.
PASS: Hover leave resuming video playback verified.
PASS: Rapid mouse in/out flapping debounced properly verified.
PASS: Auto-pause disabled setting bypass verified.
PASS: Target word extraction from mouse coordinates verified.
PASS: Custom platform player controls pause/resume support verified.
PASS: Double-pause prevention & safe error handling verified.
>>> ALL SUBTITLE AUTO-PAUSE TESTS PASSED! <<<

Running:  subtitle-hotkeys.test.js
PASS: Default hotkey bindings verification.
PASS: replayCurrentSubtitle seek and play verification.
PASS: jumpToNextSubtitle and jumpToPreviousSubtitle navigation verification.
PASS: toggleAutoPause hotkey verification.
PASS: adjustSubtitleOffset hotkey verification.
PASS: Hotkey suppression in input and editable elements verification.
PASS: Custom keybinding configuration override verification.
>>> ALL SUBTITLE HOTKEY TESTS PASSED! <<<

Running:  subtitle-parser.test.js
PASS: parseVtt basic subtitle cues verified.
PASS: parseVtt cue timing offsets verified.
PASS: parseVtt invalid input handling verified.
PASS: formatTimestamp verified.
ALL SUBTITLE PARSER TESTS PASSED!

Running:  subtitle-sync-offset.test.js
PASS: SubtitleSyncEngine offset adjustment and cue lookup verified.
PASS: SubtitleSyncEngine timeupdate event cue dispatching verified.
PASS: Side Panel sync offset slider & button DOM contracts verified.
PASS: Side Panel sync offset CSS styling verified.
PASS: Side Panel sync offset message listeners and storage sync verified.
PASS: Offset hotkey integration with SubtitleSyncEngine verified.
>>> ALL SUBTITLE TIMING OFFSET TESTS PASSED! <<<

Running:  video-mining-integration.test.js
PASS: End-to-end integration verified: Subtitle selection triggers JAPANESE_TEXT_CAPTURED in top frame and cross-origin iframes.
ALL VIDEO MINING INTEGRATION TESTS PASSED!

Running:  video-mining-poc.test.js
PASS: Native TextTrack inspection experiment verified.
PASS: Zero demo/fallback subtitles when no cues loaded verified.
PASS: HiAnime fullscreen overlay attachment, repositioning, and exit handling verified.
PASS: Inactive cue hiding (before, gap, after, with offset) verified.
PASS: Subtitle hover word extraction and auto-lookup dispatch verified.
>>> ALL VIDEO MINING POC AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY! <<<

Running:  wav-encoder.test.js
PASS: Canonical 44-byte RIFF/WAVE header structure verified.
PASS: Float32 to Int16 sample conversion and clamping verified.
PASS: Base64 Data URL encoding verified.
PASS: Edge cases (empty, null, fallback sample rate) verified.
>>> ALL WAV ENCODER TESTS PASSED SUCCESSFULLY! <<<

Running:  youtube-adapter.test.js
PASS: normalizeCaptionTrack verified.
PASS: prioritizeTracks & auto-translate synthesis verified.
PASS: extractTracksFromHtml verified.
PASS: YouTubeAdapter end-to-end SRV3 integration verified.
ALL YOUTUBE ADAPTER TESTS PASSED!
```

---

## 10. Backend Test Results

All **118 backend pytest tests** passed with 100% success rate:

```text
backend\tests\test_anki_connect.py ..............................        [ 25%]
backend\tests\test_anki_loopback_http.py .......                         [ 31%]
backend\tests\test_capture_integration.py ....                           [ 34%]
backend\tests\test_capture_route.py .                                    [ 35%]
backend\tests\test_card_editor.py ..............                         [ 47%]
backend\tests\test_card_repository.py .............                      [ 58%]
backend\tests\test_cards_api.py .......                                  [ 64%]
backend\tests\test_dictionary.py ...                                     [ 66%]
backend\tests\test_media_storage.py ...........                          [ 76%]
backend\tests\test_phase7_workflow.py .                                  [ 77%]
backend\tests\test_stage4_audio_card.py ........                         [ 83%]
backend\tests\test_sync_lifecycle.py ..............                      [ 95%]
backend\tests\test_yomitan.py .....                                      [100%]

============================= 118 passed in 5.13s =============================
```

---

## 11. Manual Verification Results

### YouTube
1. Play Japanese video with native / SRV3 subtitles.
2. Select or hover-mine Japanese word:
   - Card draft is populated with Expression, Reading, Definitions, and Example Sentence.
   - Stage 3 passive capture extracts sentence audio from ring buffer without playback disruption.
   - Side panel displays green `Ready` status pill and renders compact audio player.
3. Audio Preview: Click play / pause / replay. Audio plays back cleanly. Video playback continues uninterrupted.
4. Click **Save Card**: Card saves to SQLite; WAV file is stored in `data/media/ankiminer_audio_{id}.wav`.
5. Open from **Mining History**: Audio preview is restored, replay works, and re-saving preserves the existing audio file without duplicates.
6. Click **Send to Anki**: WAV file is uploaded via `storeMediaFile` and attached as `[sound:ankiminer_audio_{id}.wav]` to Anki note's `SentenceAudio` (or `Back`) field.

### HiAnime
1. Play anime episode in iframe/MegaCloud player with ASBPlayer / VTT subtitle overlay.
2. Mine Japanese subtitle word while playing:
   - Extracted WAV appears in Side Panel with `Ready` pill.
   - Saving and syncing to Anki successfully attaches audio.
3. Test mining while paused:
   - When mining a sentence whose end timestamp is ahead of current playhead, status badge displays pulsing amber `Pending…`.
   - Natural playback resumption delivers remaining samples; status badge transitions to `Ready` and audio player activates automatically.
   - Zero seeking or forced playback occurs.

### Netflix (DRM Restricted Audio)
1. Play Netflix video with timed-text subtitles.
2. Select/mine Japanese subtitle:
   - Text card draft is extracted via Yomitan with full definitions and example sentences.
   - Audio capture detects DRM-protected stream; status badge displays grey `DRM Restricted` pill.
   - Card Editor displays "Audio unavailable (DRM protected)".
3. Click **Save Card**: Text card saves cleanly to SQLite without error.
4. Click **Send to Anki**: Text card syncs successfully to Anki without audio. Normal Japanese text mining is 100% operational.

---

## 12. Remaining Limitations

1. **DRM Stream Restrictions**: Protected media (e.g. Netflix EME/Widevine streams) prohibits `tabCapture` from reading audio sample buffers. The extension fails soft by clearly displaying `DRM Restricted` while preserving full text mining and dictionary functionality.
2. **30-Second Rolling Buffer Window**: Subtitles that played more than 30 seconds prior to mining will have had their samples overwritten in the circular ring buffer, displaying `Expired (>30s)`. Mining shortly after hearing/seeing the line is recommended.
3. **Timeline Discontinuities (Seeking)**: Seeking past or around an un-played sentence before natural playback completes invalidates the audio timeline, transitioning the status to `Discontinuity`.

---

## Conclusion & Definition of Done

Stage 4 is fully implemented, verified, and complete. All requested capabilities (card draft integration, preview player, local SQLite/disk persistence, AnkiConnect field mapping, retry idempotency, and history restoration) are operating with zero regressions across the codebase.

**Stage 5 is NOT implemented. Execution is stopped here per instructions.**
