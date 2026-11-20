# Contract: extension-video
Depends-on: frozen-extension

## Purpose
Video mining engine, video player observation across top frames and cross-origin iframes, subtitle parsing and event-driven synchronization (SRT/VTT/ASS/timedtext), text-selectable overlay rendering with inline token highlighting, furigana mode display, styling controls (size, opacity, position, blur), fullscreen persistence and adaptation without flashing or delay, accurate timestamp extraction, video frame screenshot capture, and card-from-clip generation message flow without playback interference.

## Boundaries
- Input messages: `LOAD_SUBTITLE_CUES`, `CLEAR_SUBTITLES`, `SET_SUBTITLE_OFFSET`, `SET_SUBTITLE_SIZE`, `SET_SUBTITLE_OPACITY`, `SET_SUBTITLE_POSITION`, `RESET_SUBTITLE_POSITION`, `SET_SUBTITLES_DISPLAY`, `GET_SUBTITLES_DISPLAY`, `SET_FURIGANA_MODE`, `TRIGGER_VIDEO_SCREENSHOT`, `CAPTURE_VIDEO_FRAME`, `SEEK_TO`, `GET_VIDEO_STATE`, `GET_RECENT_CUES`, `UPDATE_ANNOTATED_CUES`, `HIGHLIGHT_SUBTITLE_WORD`, `SET_AUTO_PAUSE_ON_HOVER`.
- Input DOM/Browser events: HTML5 `<video>` events (`play`, `pause`, `timeupdate`, `seeked`, `loadeddata`), `fullscreenchange`, `webkitfullscreenchange`, keyboard navigation hotkeys (`a`, `s`, `d`, `Space`, `[`, `]`), Yomitan hover/mouse events, text selection mouseup/click.
- Output messages: `JAPANESE_TEXT_CAPTURED` (with `text`, `source`, `sourceType: "video"`, `videoTimestamp`, `cue`), `SCREENSHOT_CAPTURED` (with `dataUrl`, `timestamp`, `width`, `height`), `SCREENSHOT_CAPTURE_STATUS`, `SUBTITLE_FILE_LOADED`, `SUBTITLE_CUE_CHANGED`, `SUBTITLE_OFFSET_CHANGED`.
- Output DOM: `#ankiminer-video-overlay-container`, `#ankiminer-video-subtitle-box`, `#ankiminer-video-subtitle`, `#ankiminer-video-subtitle-handle`, token spans (`.video-sub-token`), furigana/ruby markup (`<ruby>`, `<rt>`).

## State and storage
- Storage keys (`chrome.storage.local`):
  - `active_subtitle_cues`
  - `active_subtitle_filename`
  - `subtitle_timing_offset`
  - `active_sub_size`
  - `subtitle_opacity`
  - `subtitle_overlay_position`
  - `kiroku.anime.prefs.furigana`
- Memory state:
  - active video detector and observer
  - synchronizer cue list and active cue
  - offsetMs / offset
  - SubtitleOverlayRenderer display state, position, font size, opacity, furigana mode, hover lock
  - Auto-pause controller

## Dependencies
- HTML5 `<video>` DOM API
- Chrome Extension MV3: `chrome.runtime`, `chrome.storage.local`, `chrome.tabs`, `chrome.scripting`
- `extension/lib/subtitle-parser.js`, `extension/lib/subtitle-provider.js`, `extension/lib/image-cropper.js`

## Invariants
1. Video playback integrity: Overlay rendering and subtitle synchronization must be strictly event-driven (listening to `timeupdate` and `seeked`); no continuous per-frame `requestAnimationFrame` polling loops that cause video stutter, delaying, or battery drain.
2. Fullscreen resilience: Entering or exiting fullscreen (native video element fullscreen, container fullscreen, or document fullscreen) must not hide, detach, or flash the subtitle overlay; the overlay must adapt positioning and remain rendered in the top layer.
3. Flash and delay prevention: Overlay positioning must update smoothly without visual jumpiness or white flashes; cue changes must immediately update text/tokens without lag or desync.
4. Hotkey safety: Subtitle hotkeys ('a', 's', 'd', 'Space', '[', ']') must never intercept keystrokes when the user is focused on editable elements (`input`, `textarea`, `select`, `[contenteditable]`, or elements with role `textbox`/`combobox`).
5. Complete subtitle control responsiveness: Controls for subtitle size (`SET_SUBTITLE_SIZE`), opacity (`SET_SUBTITLE_OPACITY`), offset (`SET_SUBTITLE_OFFSET`), display toggle (`SET_SUBTITLES_DISPLAY`), and position (`SET_SUBTITLE_POSITION`) must update the overlay DOM immediately and persist across cue updates and storage events.
6. Furigana mode conformance: Furigana mode settings (`all`, `none`, `advanced_only`) must control the visibility of `<rt>` furigana elements without concatenating reading text directly into base kanji or breaking Yomitan hover scanning.
7. Card-from-clip & timestamp fidelity: Capturing text or creating a card from a video clip must reliably extract and attach the exact `videoTimestamp` and cue metadata alongside screenshot data and sentence context.

## Failure behavior
- No video found: VideoDetector continues mutation observation safely without throwing errors.
- Protected / DRM video frame: If direct canvas capture fails or is tainted, falls back to `CAPTURE_VIDEO_FRAME` via background script; if DRM completely blocks capture, reports safe error status without crashing playback.
- Subtitle parse failure: SubtitleParser ignores corrupt cues and returns valid parsed cues or empty array without throwing.
- Disconnected video or frame unmount: SubtitleOverlayRenderer safely unmounts and removes event listeners without memory leaks.

## Out of scope
- Backend SQLite dictionary lookups or tokenization services (handled by backend).
- Desktop application window management.
- Video sidepanel UI redesign (user noted: no UI exists for video mode, let it be for now).
