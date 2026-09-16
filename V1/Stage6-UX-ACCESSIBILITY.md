# Stage 6 — UX, Accessibility & Polish

## Overview

Stage 6 delivers comprehensive UX, accessibility (WCAG 2.1 AA), loading/empty feedback states, first-run guidance, and precision micro-polish across Kiroku Note's Chromium/Brave MV3 Side Panel interface.

All improvements strictly preserve existing DOM contracts, backend APIs, SQLite-first persistence invariants, Anki sync lifecycle guarantees, and video mining playback rules.

> [!IMPORTANT]
> **Strict Shortcut Constraint:** As mandated by the architecture and project rules, **NO custom keyboard shortcuts** (e.g. Ctrl+Enter, Ctrl+K, Ctrl+Shift+M, custom arrow keys) were introduced. All keyboard accessibility strictly relies on standard native Chromium keyboard navigation (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`).

---

## Completed Tasks

### 1. Semantic Structure & Heading Hierarchy
- Upgraded primary section headers (`CARD`, `CARD PREVIEW`, `DICTIONARY`, `HISTORY`) from generic `<div>` containers to semantic `<h2>` headings.
- Linked UI toggles and preview tabs to their corresponding view containers via explicit `aria-controls`:
  - `#toggle-optional` -> `aria-controls="optional-fields"`
  - `#preview-tab-front` -> `aria-controls="card-preview-container"`
  - `#preview-tab-back` -> `aria-controls="card-preview-container"`
- Scoped live regions to specific status badges and notices, removing the overly broad `aria-live="polite"` from the dictionary container to prevent excessive screen reader chatter during DOM updates.

### 2. WCAG AA Color Contrast & Reduced Motion
- Updated `--text-muted` design token from `#7d7971` (3.73:1 fail) to `#8e8a81` (4.65:1 pass), achieving full WCAG AA compliance across dark surfaces (`#161614`, `#1c1b18`, `#24231f`).
- Added `@media (prefers-reduced-motion: reduce)` override to neutralize all transition durations, animations, and glowing keyframes for users with motion sensitivities.

### 3. Focus Visibility & Non-Nested History Semantics
- Implemented high-contrast `:focus-visible` styling (`outline: 2px solid var(--border-focus); outline-offset: 1px/2px`) across buttons, selects, inputs, preview tabs, subtitle offset controls, and history actions.
- Eliminated WCAG nested interactive element violations in history cards: restructured `.history-item` container to remove `role="button"` and `tabIndex="0"`, introducing an internal native `<button class="history-item-card-btn">` sibling to `.history-item-actions` (`.btn-history-retry`, `.btn-history-delete`).

### 4. Loading States & Zero-Result Feedback
- Added a sleek CSS spinner `#dict-loading-indicator` that appears instantly when lookup/identification is triggered.
- Added `#dict-empty-notice` providing helpful guidance ("No dictionary entries found for this word.") when lookups yield zero results or offline errors.

### 5. Non-Blocking Inline Confirmations
- Replaced blocking browser-native `window.confirm()` dialogs with elegant 2-click inline confirmations:
  - Dictionary sense and example insertion: 1st click shows `"Replace?"` (`.confirm-replace`), 2nd click commits overwrite.
  - History card deletion: 1st click shows `"✕"` (`.confirm-delete`), 2nd click commits deletion.
  - Inactivity timeout (3 seconds) automatically reverts confirmation buttons to their idle state.

### 6. First-Run Setup Guide & Empty States
- Added `#first-run-guide` displaying a clear 4-step setup checklist:
  1. **Backend:** Start service (`python run.py` on port 8000)
  2. **Yomitan:** Install Yomitan extension and import dictionaries
  3. **Anki:** Open Anki with AnkiConnect enabled (port 8765)
  4. **Start Mining:** Toggle mining mode to capture words
- Automatically shown on clean start (when 0 cards exist in library and not previously dismissed), with 1-click persistent dismissal to `chrome.storage.local`.

---

## Verification Results

### Automated Test Suite
- **Extension Tests:** `node --test extension/tests/*.test.js`
  - **29/29 test suites passed** (0 failing, 0 skipped).
  - Includes dedicated `extension/tests/sidepanel-a11y-ux.test.js` validating headings, ARIA attributes, contrast tokens, focus rules, non-nested semantics, non-blocking confirmations, and zero keyboard shortcuts.
- **Backend Tests:** `python -m pytest backend/tests -o pythonpath=backend`
  - **231/231 tests passed** (100% pass rate).

---

## Files Modified

| File | Changes |
| :--- | :--- |
| `extension/sidepanel/sidepanel.html` | Semantic `<h2>` headings, ARIA controls, `#dict-loading-indicator`, `#dict-empty-notice`, `#first-run-guide` |
| `extension/sidepanel/sidepanel.css` | High-contrast focus rings, WCAG AA `--text-muted`, prefers-reduced-motion, inline confirmation states, first-run guide styles |
| `extension/sidepanel/sidepanel.js` | Non-nested history cards, inline 2-click confirmations, loading & empty feedback handlers, first-run preference tracking |
| `extension/tests/sidepanel-a11y-ux.test.js` | New dedicated automated accessibility and UX verification test suite |
| `extension/tests/dictionary-study-view.test.js` | Updated quick-insert assertions to verify 2-click inline confirmations |
| `PROGRESS.MD` | Updated Stage 6 status and completion logs |
| `V1/Stage6-UX-ACCESSIBILITY-AUDIT.md` | Comprehensive Stage 6.1 audit record |
| `V1/Stage6-UX-ACCESSIBILITY.md` | Stage 6 implementation & verification report |
