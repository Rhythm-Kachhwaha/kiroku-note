# Kiroku Note — Audit Checkpoint & Findings

## 1. Test Suite Verification
- **Backend Tests:** 458/458 passed (`python -m pytest -o pythonpath=backend backend/tests`).
- **Extension Tests:** 145/145 passed (`node --test extension/tests/*.test.js`).
- **Playwright Full Dry-Run (`dry_run_full_test.py`):** 18/18 checks passed when backend is running:
  - Header wordmark & status indicators tooltips (T1-A)
  - Furigana writing mode dropdown & settings popover
  - Hero showcase reactive rendering (`identify('勉強')`)
  - Browser TTS speaker button (T2-D)
  - JLPT / POS / Pitch badges & live card preview
  - KanjiVG stroke order SVG diagrams (T4-E)
  - SQLite card persistence & duplicate detection
  - Video mining controls & "Mine sentence" button (T4-F)
  - Quick Add reverse English search (T2-F)
  - Mining stats collapsible dashboard (T3-F)
  - History bulk multi-select action bar (T4-A)
  - 5-second Undo delete toast (T3-C)
  - Ask tab AI Assistant offline fallback & chip counter

## 2. Bugs Identified & Fixed
1. **Critical DOM Nesting Bug (`extension/sidepanel/sidepanel.html`):**
   - `<div id="layout-settings-popover">` was unclosed (missing closing `</div>` before `#undo-toast`).
   - Caused `#undo-toast` to be nested inside the hidden settings popover, rendering it invisible (0×0 size) whenever settings was closed.
   - **Fix:** Closed `#layout-settings-popover` properly at line 954. HTML parser validation confirmed 0 tag mismatches.
2. **Side Panel Non-Extension Test Environment Mock (`extension/sidepanel/sidepanel.js`):**
   - When loaded in browser automation outside an MV3 extension context, `chrome.runtime.onMessage.addListener` was a no-op dummy, preventing content script / test message dispatching.
   - **Fix:** Enhanced the mock to store listeners in an array, dispatch messages via `_dispatch` / `sendMessage`, and exposed `setLoadedSubtitleCues` and `setRecentSubtitleCues` on `window`.

## 3. Interactive Verification Results (`interactive_feature_test.py`)
- **Undo Delete Toast (T3-C):** Verified soft delete triggers 5s toast, clicking Undo cancels deletion, and letting the 5s timer expire permanently deletes card from SQLite.
- **Bulk Operations (T4-A):** Verified selecting multiple cards, bulk moving them to another deck (`BulkMinedDeck`), and bulk deleting removes them from SQLite.
- **Video Subtitles (T4-B, T4-C):** In-track cue search filters and highlights correctly; recent cues list renders last cues with clickable words.
- **Settings & Furigana Density (T3-H):** Mode toggle ("none", "advanced_only", "all") persists in `currentCardTemplateSettings`.
- **Ask AI Assistant (Tier 5):** Prompt chips populate composer, char counter updates, and 501 unconfigured error renders cleanly in chat bubble without uncaught promise rejection.

## 4. Pending / Next Steps
1. **Yomitan Integration Verification:**
   - Confirm local Yomitan HTTP server on port 19633 responds to `/tokenize` and `/termEntries`.
2. **Video Content Script Smoke Test:**
   - Verify `video-mining-poc.js` on real video stream (e.g. YouTube / local HTML5 video) to confirm cue overlay positioning and audio capture.
3. **Documentation Update:**
   - Record completed audit results in `PROGRESS.md`.
