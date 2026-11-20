# Contract: extension
Depends-on: none

## Purpose
Core extension lifecycle, runtime messaging router, Manifest V3 security (CSP, minimal and accurate permissions), resilient iframe/DOM injection, reliable cross-context communications (background, content scripts, sidepanel, popup), and zero unhandled errors/rejections across all Chrome extension contexts.

## Boundaries
- Input: Runtime messages (`SET_MINING_MODE`, `GET_MINING_MODE`, `FETCH_YOUTUBE_TIMEDTEXT`, `FETCH_JIMAKU_API`, `JIMAKU_SEARCH`, `CAPTURE_VIDEO_FRAME`, `ANALYZE_GRAMMAR_SELECTION`, `VIDEO_DETECTED`, `GET_TAB_INFO`, `ENSURE_VIDEO_MINING`, `LOAD_SUBTITLE_CUES`, `CLEAR_SUBTITLES`, `SET_SUBTITLE_OFFSET`, `SELECT_YOUTUBE_TRACK`, `UPDATE_ANNOTATED_CUES`, `START_OCR_CAPTURE`, `OCR_REGION_SELECTED`, `OCR_SELECTION_CANCELLED`, `GRAMMAR_ANALYZE`, `TOKENIZE_SENTENCE`, `GRAMMAR_MINE`, `DELETE_CARD`, `SET_WORD_STATUS`, `HUD_LOOKUP`, `QUEUE_CARD`, `HUD_MINE`, `DRAIN_PENDING_QUEUE`, `OPEN_DICTIONARY`, `SP_OPEN_GRAMMAR`, `SP_SCROLL_TRANSCRIPT`, `SESSION_LOG_COUNTERS`, `SEEK_TO`, `EPISODE_SAVE_POSITION`, `EPISODE_SYNC_SUBTITLES`, `EPISODE_GET_STATUS`, `GET_LINK_STATUS`, `SESSION_GET_RECENT`), DOM events in host pages/iframes, keyboard shortcuts.
- Output: Broadcast runtime messages (`MINING_MODE_CHANGED`, `JAPANESE_TEXT_CAPTURED`, `SCREENSHOT_CAPTURED`, `SCREENSHOT_CAPTURE_STATUS`, `SUBTITLE_CUE_CHANGED`, `RECENT_CUES_UPDATED`, `OCR_RECOGNITION_COMPLETE`), Shadow-DOM host mounts (`kiroku-standalone-popup-host`, `kiroku-toast-host`), HTTP requests to local Kiroku backend (`http://127.0.0.1:21828/*`) and cloud workers, Chrome storage updates.

## State and storage
- `chrome.storage.local` keys:
  - `kiroku.mining_mode_enabled` (boolean)
  - `kiroku.mining.enabled` (boolean)
  - `kiroku.last_captured_word` (object)
  - `active_subtitle_cues`, `active_subtitle_filename`
  - `subtitle_timing_offset`, `active_sub_size`
  - `grammar_settings`
- Memory state in Service Worker:
  - `isMiningModeEnabled`
  - Active video / tab injection tracking
  - In-flight OCR & capture state

## Dependencies
- Chrome Extension APIs (Manifest V3): `chrome.runtime`, `chrome.storage.local`, `chrome.tabs`, `chrome.scripting`, `chrome.sidePanel`, `chrome.alarms`, `chrome.identity`, `chrome.commands`.
- Local Kiroku Backend (`http://127.0.0.1:21828`).
- Cloud Worker (`https://kiroku-note.rhythmkach.workers.dev`).

## Invariants
1. Modularity invariant: All sidepanel modules in `extension/sidepanel/modules/*.js` remain separate and canonical; monolithic or bundled `sidepanel.js` is strictly forbidden.
2. Comprehensive message coverage: Every defined message type received by `background.js` or content script returns a structured response (`{ ok: boolean, ... }`); no message handler leaves the channel open without responding or unhandled.
3. Zero extension errors: No uncaught runtime exceptions or unhandled promise rejections are surfaced in `chrome://extensions` or the service worker / content script consoles; global error and unhandledrejection guards capture and neutralize unhandled errors.
4. Iframe resilience: Content scripts (`content.js`, `hud-popup.js`, `toast.js`) safely run in all frames (`all_frames: true`), including sandboxed, cross-origin, and early-load frames; they never throw on null `document.body`, inaccessible `window.top`, or cross-origin restrictions.
5. CSP resilience: Content scripts and extension pages comply with Manifest V3 CSP; they avoid `eval`, inline script execution, or insecure style/network patterns; host-page CSP restrictions on `connect-src` or `script-src` never crash the extension or block mining.
6. Manifest accuracy: Permissions in `manifest.json` match code requirements without missing permissions or unauthorized APIs.
7. Safe message dispatch: All calls to `chrome.tabs.sendMessage` and `chrome.runtime.sendMessage` catch errors or verify `chrome.runtime.lastError` so that missing or dead receivers never log unchecked lastError faults.

## Failure behavior
- Content script not yet injected: `ensureContentScript` injects dependencies on demand; sendMessage failures are safely swallowed without throwing.
- Page with strict CSP or sandboxed iframe: DOM/ShadowRoot creation falls back safely; network queries routed via background service worker; DOM exceptions are caught and contained.
- Backend offline or fetch network error: Returns `{ ok: false, error: ... }` to caller without throwing unhandled rejections.
- Unknown message type: If an unrecognized message is explicitly targeted or handled, returns a safe fail-closed response without unhandled promise rejection.

## Out of scope
- Server-side SQLite schema migrations (handled by `db`).
- Cloud OAuth worker crypto implementation (handled by `cloud-auth`).
- Desktop UI rendering and Electron shell (handled by `desktop`).
