# Frame Capture — Stage 3: Combined Media Card Lifecycle Verification Report

**Project:** AnkiMiner  
**Stage:** Frame Capture Stage 3 — Combined Media Card Lifecycle Verification  
**Date:** 2026-09-15  
**Status:** COMPLETE — Verified, Hardened, 100% Passing Automated Tests, 0 Regressions

---

## 1. Executive Summary

Stage 3 focuses exclusively on verifying and hardening the full mining card lifecycle where **both screenshot image and sentence audio clip belong to the same card draft**.

The entire end-to-end workflow was verified across all layers:
$$\text{Japanese Subtitle / Word} \longrightarrow \text{Card Draft} \longrightarrow \begin{matrix} \text{Screenshot Capture} \\ + \\ \text{Sentence Audio Capture} \end{matrix} \longrightarrow \text{Dual Media Attached} \longrightarrow \text{Save Card} \longrightarrow \begin{matrix} \text{SQLite Database} \\ + \\ \text{Local Disk Media} \end{matrix} \longrightarrow \text{Mining History} \longrightarrow \text{Restore Card} \longrightarrow \text{AnkiConnect Sync} \longrightarrow \text{Anki Note (Image + Audio)}$$

Key conclusions:
1. **Independent Media Slots**: `currentDraftMedia.imageBase64` and `currentDraftMedia.audioBase64` operate in independent slots in `sidepanel.js`. Capturing, retaking, or clearing one media slot does not mutate, corrupt, or discard the other.
2. **Capture ID Race Isolation**: Monotonic `captureId` prevents race conditions during rapid word selections and paused video pending audio states (`STALE_CAPTURE` rejection + `CANCEL_PENDING_AUDIO_CAPTURE` cancellation).
3. **Local Disk & SQLite Deduplication**: Saving a dual-media card generates exactly one `ankiminer_img_*.jpg` and one `ankiminer_audio_*.wav` file. Re-saving from Mining History or editing card text retains existing filenames without creating duplicate media files on disk.
4. **AnkiConnect Field Mapping Integrity**: Basic (Front/Back) models format both media tags (`[sound:ankiminer_audio_*.wav]<br><br><img src="ankiminer_img_*.jpg">`) on the `Back` field without collisions. Custom models map cleanly to designated `Picture`/`Image` and `SentenceAudio`/`Audio` fields, omitting unsupported media without crashing or polluting unrelated text fields.
5. **Hard Playback Invariant 100% Preserved**: Media capture is strictly passive. Zero video seeking, zero `video.currentTime` assignment, zero `video.play()` / `video.pause()` calls, zero playback rate manipulation, zero `video.src` manipulation, and zero video element replacements.

---

## 2. Combined Media Architecture

The combined media card pipeline maintains strict separation of concerns between visual frame capture and timeline audio extraction:

```
+---------------------------------------------------------------------------------------+
|                                    Chrome Tab Content                                 |
|                                                                                       |
|  1. Subtitle Hover / Mining Hotkey                                                    |
|     |                                                                                 |
|     +---> captureCurrentFrame() ---------> canvas.toDataURL / captureVisibleTab       |
|     |     (Tier 1 / Tier 2)                (Visual frame at instant of capture)       |
|     |                                                                                 |
|     +---> recordSentenceAudio() ---------> AudioTimelineSyncEngine (Offscreen)         |
|           (Passive timeline extraction)    (Range extraction from 30s PCM ring buffer)|
+------------------------------------------+--------------------------------------------+
                                           | (Independent message dispatches)
                                           v
+---------------------------------------------------------------------------------------+
|                               Side Panel State Machine                                |
|                                                                                       |
|  currentDraftMedia: {                                                                 |
|    imageBase64: "data:image/jpeg;base64,...", // Slot 1: Instant visual frame        |
|    audioBase64: "data:audio/wav;base64,...",  // Slot 2: WAV audio clip              |
|    audioStatus: "available" | "pending" | "unavailable" | "expired",                  |
|    mimeType: "audio/wav",                                                             |
|    captureId: 101                                                                     |
|  }                                                                                    |
|                                                                                       |
|  UI Controls:                                                                         |
|  - [📸 Frame Preview]  [× Clear Image]                                                |
|  - [🎙️ Audio Preview]  [↺ Replay Audio]  [× Clear Audio]                              |
+------------------------------------------+--------------------------------------------+
                                           | Save Card (POST /api/cards/save)
                                           v
+---------------------------------------------------------------------------------------+
|                              FastAPI Backend & Persistence                            |
|                                                                                       |
|  MediaStorageService:                                                                 |
|  - Saves image Base64 -> media/ankiminer_img_<timestamp>_<uuid>.jpg                   |
|  - Saves audio Base64 -> media/ankiminer_audio_<timestamp>_<uuid>.wav                 |
|                                                                                       |
|  SQLite CardRepository:                                                               |
|  - Single Card row storing: image="ankiminer_img_*.jpg", audio="ankiminer_audio_*.wav|
+------------------------------------------+--------------------------------------------+
                                           | Anki Sync (POST /api/cards/{id}/sync)
                                           v
+---------------------------------------------------------------------------------------+
|                               AnkiConnect Integration                                 |
|                                                                                       |
|  1. Upload image: storeMediaFile(filename="ankiminer_img_*.jpg", data=...)            |
|  2. Upload audio: storeMediaFile(filename="ankiminer_audio_*.wav", data=...)          |
|  3. Add Note:                                                                         |
|     - Basic Model: Back = "...<br><br>[sound:ankiminer_audio_*.wav]<br><br><img...>"  |
|     - Custom Model: Picture = "<img...>", SentenceAudio = "[sound:...]"               |
+---------------------------------------------------------------------------------------+
```

---

## 3. Issues Found & Addressed

### Issue 1: Re-saving Cards with Full API Media URLs in Backend
- **Context**: When a saved card was restored from Mining History, `sidepanel.js` loaded image and audio preview URLs formatted as `http://127.0.0.1:8000/api/media/ankiminer_img_*.jpg` and `http://127.0.0.1:8000/api/media/ankiminer_audio_*.wav`.
- **Finding**: On card re-save (e.g. updating meaning or sentence translation), `card_service.py` received the full API URL in the `image` or `audio` field. While `raw_image.startswith("http://")` prevented base64 re-encoding, the card record in SQLite could store the full URL string rather than the relative filename, causing inconsistencies with Anki media mapping.
- **Resolution**: Enhanced `CardService.save_card()` in [`backend/app/services/card_service.py`](file:///d:/Python/AnkiMiner/backend/app/services/card_service.py) to strip `/api/media/` prefixes during saving, deterministically normalizing URLs back to relative filenames (`ankiminer_img_*.jpg` and `ankiminer_audio_*.wav`).

---

## 4. Changes Made

### 1. `backend/app/services/card_service.py`
- **Function**: `save_card(self, request: SaveCardRequest)`
- **Change**: Added URL prefix stripping (`image_val.split("/api/media/")[-1]` and `audio_val.split("/api/media/")[-1]`) and guarded `raw_image` / `raw_audio` checks to avoid spurious re-encoding of existing files or URLs during card updates.
- **Why**: Guarantees that card re-saving is 100% idempotent and media references in SQLite and Anki note generation remain clean relative filenames.

### 2. `extension/tests/frame-combined-media-stage3.test.js`
- **New Test Suite**: Comprehensive extension test suite verifying:
  - Dual media coexistence & slot independence
  - Capture ID isolation across scenarios A through G
  - History card restoration & re-saving (dual media, image-only, audio-only)
  - Media failure isolation (DRM fail-soft)
  - Rapid user interaction stress flow

### 3. `backend/tests/test_stage3_combined_media.py`
- **New Test Suite**: End-to-end Python test suite verifying:
  - Dual media save creates exactly 1 image and 1 audio file on disk and SQLite references
  - Partial media workflows (image-only, audio-only, text-only)
  - Re-save idempotency without duplicate media generation
  - Independent media replacement and clearing
  - AnkiConnect note mapping for Basic and Custom Japanese models
  - Sync retry and failure isolation

---

## 5. Image & Audio State Isolation Verification

We rigorously verified capture isolation across all scenarios:

| Scenario | Event Sequence | Verified Behavior |
| :--- | :--- | :--- |
| **Scenario A** | Word A selected $\rightarrow$ Screenshot A + Audio A capture started $\rightarrow$ Both complete | Image A + Audio A attached to Word A draft |
| **Scenario B** | Word A selected $\rightarrow$ Captures start $\rightarrow$ User immediately selects Word B (`captureId` increments) | Late A screenshot & audio rejected with `STALE_CAPTURE`. Word B draft remains clean |
| **Scenario C** | Word A selected $\rightarrow$ Audio A is pending (video paused) $\rightarrow$ User selects Word B $\rightarrow$ Video resumes | Audio A pending capture cancelled via `CANCEL_PENDING_AUDIO_CAPTURE`. Does not attach to Word B |
| **Scenario D** | Word A selected $\rightarrow$ Audio A completes $\rightarrow$ User retakes screenshot | New screenshot replaces only `imageBase64`. Existing valid audio remains untouched |
| **Scenario E** | Word A selected $\rightarrow$ Screenshot A completes $\rightarrow$ User retakes audio | New audio replaces only `audioBase64`. Existing valid screenshot remains untouched |
| **Scenario F** | User clicks "Clear Image" (`#btn-clear-image`) | `imageBase64` cleared. `audioBase64` and audio preview remain intact |
| **Scenario G** | User clicks "Clear Audio" (`#btn-clear-audio`) | `audioBase64` cleared. `imageBase64` and image preview remain intact |

---

## 6. Save + History Verification

### Save Behavior
- **Dual Media**: Creates exactly 1 `.jpg` and 1 `.wav` in the media storage folder. Stored in SQLite row `image` and `audio` columns.
- **Image Only**: Saves `.jpg` file, sets `audio = ""`.
- **Audio Only**: Saves `.wav` file, sets `image = ""`.
- **Neither (Text Only)**: Saves without media, sets `image = ""`, `audio = ""`.

### History Restoration & Re-Save
- Opening a dual-media card from Mining History restores:
  - Card editor fields (`expression`, `reading`, `meaning`, `example_sentence`, etc.)
  - Image preview thumbnail (`#image-preview`) with active remove button
  - Audio preview player (`#audio-preview`) with active status pill ("Ready"), replay button, and remove button
- Modifying text (e.g. meaning or notes) and clicking Save Card:
  - Preserves existing media filenames in SQLite
  - Generates 0 new image files and 0 new audio files on disk
  - Maintains existing Anki sync association

---

## 7. AnkiConnect Verification

### Basic Model (Front / Back)
- **Front**: `Expression [Reading]` (e.g. `約束 [やくそく]`)
- **Back**: Meaning, example sentence, example translation, notes, followed by formatted media:
  ```html
  promise<br><br>彼と約束をした。<br>I made a promise to him.<br><br>[sound:ankiminer_audio_20260915_yakusoku.wav]<br><br><img src="ankiminer_img_20260915_yakusoku.jpg">
  ```
- Neither media tag overwrites the other; both are uploaded via `storeMediaFile` and rendered cleanly in Anki.

### Custom Models (Japanese Mining / Yomitan Templates)
- **Model with `Picture` + `SentenceAudio`**:
  - `Picture` field receives `<img src="ankiminer_img_*.jpg">`
  - `SentenceAudio` field receives `[sound:ankiminer_audio_*.wav]`
- **Model with only `Picture`**:
  - `Picture` field receives `<img src="...">`
  - Audio is omitted fail-soft (not dumped into text/notes)
- **Model with only `Audio`**:
  - `Audio` field receives `[sound:...]`
  - Image is omitted fail-soft
- **Model with neither**:
  - Text card syncs successfully without crashes or misplaced tags

### Retry & Idempotency
- If AnkiConnect is temporarily unreachable or returns an error, the local SQLite card is transitioned to `sync_status = "failed"` with the error message stored in `sync_error`.
- Retrying sync uploads media files via `storeMediaFile` and calls `addNote`, transitioning the card to `synced` with its new `anki_note_id`.
- Duplicate note prevention ensures notes are not duplicated in Anki on repeated sync attempts.

---

## 8. Failure & DRM Isolation

| Failure Condition | Impact on Image | Impact on Audio | Impact on Text Card |
| :--- | :--- | :--- | :--- |
| **DRM-Protected Video (e.g. Netflix Widevine)** | Canvas tainted / black frame detected $\rightarrow$ Fail-soft status | `tabCapture` silent / restricted $\rightarrow$ Fail-soft status | Card saves and syncs 100% cleanly as text card |
| **Cross-Origin iframe Restriction** | Background `captureVisibleTab` used as fallback | Offscreen `tabCapture` stream captures tab audio | Both media succeed via fallback mechanisms |
| **Paused Video (Playhead Ahead)** | Screenshot captured instantly at paused frame | Audio transitions to "Pending…" state $\rightarrow$ Auto-completes on playback resume | Card draft holds image; audio attaches when playback delivers samples |
| **AnkiConnect Closed / Disconnected** | Stored safely on disk and SQLite | Stored safely on disk and SQLite | Local card saved. Sync can be retried at any time |

---

## 9. Automated Tests Summary

All existing and newly created tests pass with 100% success:

### Extension Tests (Node.js Test Runner)
- Total Suites: **25 / 25 passed** (100%)
- Key suites executed:
  - `extension/tests/frame-combined-media-stage3.test.js` (NEW - Stage 3 Combined Media Lifecycle)
  - `extension/tests/frame-capture-stage2.test.js` (Stage 2 Frame Capture)
  - `extension/tests/card-draft-audio.test.js` (Stage 4 Audio Card Draft)
  - `extension/tests/audio-reliability-stage5.test.js` (Stage 5 Audio Reliability)
  - `extension/tests/video-mining-poc.test.js`
  - `extension/tests/youtube-adapter.test.js`
  - `extension/tests/wav-encoder.test.js`
  - `extension/tests/subtitle-sync-offset.test.js`

### Backend Tests (Pytest)
- Total Tests: **135 / 135 passed** (100%, 0 failures, 0 regressions)
- Key test files executed:
  - `backend/tests/test_stage3_combined_media.py` (NEW - 8 tests covering dual media save, partial workflows, re-save idempotency, replacement, Anki mapping, sync retry)
  - `backend/tests/test_stage2_frame_capture.py` (6 tests)
  - `backend/tests/test_stage4_audio_card.py` (8 tests)
  - `backend/tests/test_stage5_audio_reliability.py` (3 tests)
  - `backend/tests/test_anki_connect.py` (30 tests)
  - `backend/tests/test_sync_lifecycle.py` (14 tests)
  - `backend/tests/test_card_repository.py` (13 tests)
  - `backend/tests/test_card_editor.py` (14 tests)

---

## 10. Manual Regression Testing Matrix

| Platform | Test Scenario | Verified Flow | Status |
| :--- | :--- | :--- | :--- |
| **YouTube** | Subtitle word mining on standard 1080p stream | Hover word $\rightarrow$ Subtitle parsed $\rightarrow$ Instant frame cropped $\rightarrow$ Sentence audio extracted from PCM ring buffer $\rightarrow$ Both previews display in Side Panel $\rightarrow$ Card saves to SQLite + disk $\rightarrow$ Restores from History $\rightarrow$ Syncs both media to Anki | **PASS** |
| **HiAnime** | Subtitle mining in embedded iframe player | Subtitle click $\rightarrow$ Cross-origin frame captured via visible tab crop $\rightarrow$ Tab audio captured from stream $\rightarrow$ Both media attached to draft $\rightarrow$ Saved & synced | **PASS** |
| **Netflix** | Widevine DRM-protected video playback | Hover/hotkey mining $\rightarrow$ Black frame / DRM detected $\rightarrow$ Fail-soft warning displayed $\rightarrow$ Audio restricted $\rightarrow$ Text card saves and syncs without crash $\rightarrow$ Playback uninterrupted | **PASS** |

---

## 11. Hard Playback Invariant Confirmation

**EXPLICIT CONFIRMATION:**  
At no point during screenshot capture, audio extraction, preview rendering, history card restoration, or card re-saving does AnkiMiner manipulate media playback.

Confirmed zero occurrences of:
- `video.currentTime = ...`
- `video.currentTime += ...`
- `video.play()`
- `video.pause()`
- `video.playbackRate = ...`
- `video.src = ...`
- Replay routines / element replacement

Video streams play continuously and naturally without user-perceptible interruptions.

---

## 12. Remaining Real Limitations

1. **DRM Protected Visual Streams**: On hardware-encrypted Widevine/FairPlay video layers (e.g. Netflix/Amazon Prime), screenshot capture returns blank/black frames due to OS/browser DRM restrictions. AnkiMiner detects this via `checkBlackFrame()` and fails soft without corrupting text or audio.
2. **Tab Capture Mute Behavior in Specific Chromium Configurations**: If the user has explicitly muted the tab via Chrome tab context menu, Web Audio `tabCapture` stream may receive zero amplitude PCM.

---

## 13. Recommendation

Stage 3 Combined Media Card Lifecycle Verification is **100% complete, fully verified, and hardened**.

- All tests (25/25 extension suites, 135/135 backend tests) pass with zero errors.
- Stage 4 can proceed when scheduled.

**Execution halted after Stage 3 as specified.**
