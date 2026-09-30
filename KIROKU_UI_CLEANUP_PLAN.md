# Kiroku Note — UI Cleanup & Fix Plan (Agent Brief & Roadmap)

> **Audience:** a coding agent working in `kiroku-note` (Chromium MV3 side panel + FastAPI backend).
> **Source:** a read-only review of the repo at commit `8c886f0`. Nothing was changed during the review.
> **Not verified in a browser.** Everything below comes from reading code, running both test suites, and
> curl-testing the backend. Anything marked **(verify)** must be reproduced before you fix it.

---

## Session Roadmap & Progress Tracker

> **Instructions for the Agent:**
> - When the user says **"start next session"** (or specifies a session), locate the **first unchecked session** below.
> - Execute **only** the tasks inside that single session. **Do not start subsequent sessions in the same run.**
> - **Token efficiency rule:** Do NOT run test suites before beginning implementation in a session. Only run tests **after** changes are implemented to verify them.
> - Keep all changes tightly scoped to that session's tasks. Follow locked boundaries from `AGENTS.md`.
> - Check off the tasks and the session checkbox when complete, and record verification in `PROGRESS.md`.

- [x] **Session 1: Test Suite Baseline & Trustworthiness** (Phase 0)
- [x] **Session 2: Backend Core Fixes & Security Hardening** (Phase 9 & Backend Health/Config)
- [x] **Session 3: LLM Backend Enhancements & Config API** (Phase 2 Backend & Gemini / Timeout / Storage)
- [x] **Session 4: Stray History Under Text Mode Fix** (Phase 1)
- [x] **Session 5: LLM Frontend Wiring, Escaping & Context Accuracy** (Phase 2 Frontend & LLM in Text tab)
- [ ] **Session 6: Section Visibility, Collapse Prefs & Collapsible Dictionary** (Phase 3)
- [ ] **Session 7: Floating Ask Drawer (Replacing Ask Tab - 4A)** (Phase 4)
- [ ] **Session 8: Hero Search & Quick Add Merging** (Phase 5)
- [ ] **Session 9: Settings Regrouping & Header Consolidation** (Phase 6)
- [ ] **Session 10: Per-Tab Decluttering (Video, History, Drawer)** (Phase 7)
- [ ] **Session 11: CSS Tokens, Contrast, Accessibility & Polish** (Phase 8)
- [ ] **Session 12: Documentation, Stale Checklist Cleanup & Final Handoff** (Phase 10)

---

## 0. Ground rules (read first)

Follow `AGENTS.md`. In particular:

1. **Read order before touching code:** `AGENTS.md` → `ARCHITECTURE.md` → `PROGRESS.md` → the design doc
   (it lives at **`docs/archive/DESIGN.md`**, not the repo root) → the relevant `skills/<area>/SKILL.md`
   (`frontend`, `extension`, `backend`, `testing`) → existing code and tests.
2. **Locked boundaries:** vanilla HTML/CSS/JS in the extension (no frameworks, no bundler, no new runtime deps),
   FastAPI backend, SQLite as source of truth, Yomitan only via `YomitanService`. A failed Anki sync must never
   discard a saved card.
3. **Smallest scoped change per session.** One session at a time. Do not refactor unrelated code.
4. **Additive only.** New element IDs, new CSS classes, new storage keys. **Never rename or delete an existing ID**
   that `sidepanel.js` or a test references.
5. **Defaults must preserve today's look.** All new visibility/collapse options default to *shown and expanded*, so a
   fresh install and an upgraded install look identical until the user changes something.
6. **Keep the hidden legacy DOM.** `#card-fields-section` (hidden + `display:none`), the hidden `.form-row-duo`,
   `#media-preview-collapsible` (`display:none !important`), `#card-target-destination` and the hidden inputs hold
   fields that `sidepanel.js` reads (`fieldExpression`, etc.) and the media pipeline writes to. Do not remove them.
   At most, group them under one `<div hidden>` with a comment.
7. **CSS has ~266 `!important` rules and 33 repeated top-level selectors.** Do not edit existing rules to change
   behavior. Append new rules in a clearly marked block at the end of `sidepanel.css` (or a new file loaded last).
8. **Hide with the `hidden` attribute plus a class, not inline `style.display`.** `switchMiningTab` already writes inline
   display styles on several sections; a second mechanism will fight it.
9. **Tests are a custom harness** that reads `sidepanel.js` source and evaluates functions against mock DOM
   (see `extension/tests/customizable-layout.test.js`, `tier5-ask-tab.test.js`). New tests should follow that
   pattern. Pure logic (prefs merge/validate) may go in a new UMD file under `extension/sidepanel/` or
   `extension/lib/` with its own test; check `extension/tests/extension-packaging.test.js` and `packaging/` so the
   new file is included in builds.
10. **Verification after every session:**
    Run tests **only after** implementation is done:
    ```bash
    python -m pytest -o pythonpath=backend backend/tests
    node --test extension/tests/*.test.js
    ```
    Then record files changed, behavior delivered, verification run, and remaining risk in `PROGRESS.md`.
11. **Do not edit** `AGENTS.md`, `ARCHITECTURE.md`, design docs or skill files unless a phase says so. If something
    conflicts with them, write the question in `PROGRESS.md` and stop (see "Stop and ask", §12).

---

## Session Details & Work Breakdown

---

### Session 1: Test Suite Baseline & Trustworthiness (Phase 0)

**Observed:** pytest: 453 passed, 3 skipped, **2 failed**. node: 141 passed, **1 failed** (3 subtests cancelled).

- [x] **`extension/tests/hero-view.test.js`** — the parent `test(..., (t) => {` is not `async` and the `t.test(...)`
      subtests are not awaited, so Node cancels 3 of 4 subtests ("test did not finish before its parent").
      Fix: make the parent `async` and `await t.test(...)` for each subtest. (A local copy with this change passes all 4;
      the hero code itself is fine.) Check for the same pattern in other test files:
      `grep -L "async (t)" $(grep -l "t\.test(" extension/tests/*.test.js)`.
- [x] **`backend/tests/test_packaging_config.py`** — `test_frozen_mode_windows_localappdata_resolution` and
      `test_frozen_mode_fallback_to_legacy_db_if_exists` patch `os.name = "nt"`, which makes `pathlib` raise
      `NotImplementedError` on Linux/macOS. Fix by not patching `os.name` (patch `sys.platform` and the env dict only, or patch the path function directly),
      or `@pytest.mark.skipif(sys.platform != "win32", ...)` with a comment. Do not weaken what the tests assert on Windows.
- [x] Add a CI job (`.github/workflows/`) that runs both suites on Linux and Windows. Existing workflow is
      `build-windows.yml` only. Include a step checking `git ls-files extension/lib` to prevent .gitignore regression risk.

**Done when:** both test suites run and pass cleanly on Linux/macOS and Windows without cancelled subtests or platform crashes.

---

### Session 2: Backend Core Fixes & Security Hardening (Phase 9 & Backend Health)

Verified against running backend:
- `OPTIONS` with `Origin: null` returns `access-control-allow-origin: null` (regex in `main.py` includes `|null`). A sandboxed iframe or `data:` page can therefore read/delete cards. `Origin: https://evil.com` is correctly refused.
- Body-less POSTs (`/api/cards/sync-all`, `/api/ocr/start`, `/api/ocr/stop`) are CORS "simple requests" a web page can fire cross-site.
- `/api/health` builds `CardService`, `YomitanService` and `OcrService` on every call and hits external services serially while the extension polls Anki every 10s.

- [x] Remove `|null` from `allow_origin_regex` in `backend/app/main.py`. First check `grep -rn "null" backend/tests` for tests that depend on it (`test_stage7_reliability_security.py`); update them deliberately. Allow only `chrome-extension://.*` and local requests.
- [x] Add request validation middleware in `backend/app/main.py`:
      - For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`): if an `Origin` header is present and not matching allowed extension/local origins, return `403`.
      - Check that `Host` header is `127.0.0.1[:port]` or `localhost[:port]` (preventing DNS rebinding).
      - Allow requests with no `Origin` header (curl, tray app, local tests).
- [x] Fix query param shadowing in `backend/app/main.py`: `export_cards_csv` parameter `status` shadows `fastapi.status`. Rename query param internally and use `alias="status"`.
- [x] Tighten loose bulk endpoint typing in `backend/app/schemas.py` or routers: change `list[int | str]` to `list[int]` if string IDs are not supported.
- [x] Add a short in-process cache (3–5 seconds) to `/api/health` in `main.py` so repeated rapid polling doesn't reconstruct services or flood Anki/Yomitan serially.

**Done when:** Security tests pass, origin null is blocked, host checks are enforced, and health check is cached.

---

### Session 3: LLM Backend Enhancements & Config API (Phase 2 Backend)

Context: `backend/app/services/llm_service.py`, `backend/app/main.py`, `backend/app/config.py`, `backend/app/schemas.py`.

- [x] **Configurable Timeout:** Replace hardcoded `5.0s` timeout across `LLMService` and providers. Add `KIROKU_LLM_TIMEOUT` in `config.py` (default `45`s, clamp between 5–180s). Pass timeout from `config` in `get_llm_service()`. Add special lowered default for Groq if appropriate.
- [x] **Gemini Security & Key Handling:** Move Gemini API key from URL query param (`?key=...`) to `x-goog-api-key` header in `llm_service.py`. Ensure error messages never leak request URLs, headers, or keys.
- [x] **Chat History & Prompt Capping:**
      - In `LLMRequest` schema, cap `messages` to max 20 entries and total chars.
      - In `LLMService.ask`, retain only the last 10 messages for prompt construction.
      - Map roles safely: reject client-supplied `role="system"` or remap cleanly.
- [x] **Task Validation:** Raise `ValueError` instead of silent `else: prompt = text` fallthrough in `LLMService.ask`.
- [x] **LLM Configuration & Test Endpoints:**
      - Add `GET /api/llm/config` and `PUT /api/llm/config`: persist settings (provider, model, Ollama URL, API key) to a JSON config file in `get_data_dir()`. Environment variables still take precedence if present.
      - `GET` must **never return raw keys** (return `has_key: bool` and masked preview).
      - Add `POST /api/llm/test` that executes a 1-token dummy query and returns `{ok: true}` or descriptive error.
- [x] Add `docs/llm-setup.md` covering setup, supported providers (Groq, Gemini, Ollama), env vars, UI settings, and cloud privacy disclosure (sentences sent to external provider).

**Done when:** Backend LLM tests pass with configurable timeout, header-based Gemini auth, capped history, and working config endpoints.

---

### Session 4: Stray History Under Text Mode Fix (Phase 1)

**Report from the owner:** "unused history shown in text mode bottom."

**Suspected cause:**
- `#history-section` starts `hidden` in HTML and `switchMiningTab()` hides it on non-history tabs.
- But `applyHistoryVisibility()` in `sidepanel.js` sets `historySec.hidden = false; style.display = ""` whenever `currentCardTemplateSettings.show_history !== false` regardless of active tab.
- Called from `saveStoredCardTemplateSettings()` and `syncCardTemplateSettingsUI()` on startup and setting changes.

- [x] Make panel visibility a pure function of active tab: extract and ensure `applyTabVisibility(tab)` is the single authority controlling `hidden`/`display` on `#history-section`.
- [x] Turn `applyHistoryVisibility()` into a no-op (keep the function exported for test/call-site compatibility, but remove its side effect).
- [x] Remove the **"Show History"** switch (`#setting-show-history`) from Settings HTML/UI. Maintain backwards compatibility for stored config parsing without toggling panel visibility.
- [x] Ensure deterministic startup order: read active tab first, invoke `switchMiningTab(saved)` once, and ensure `loadStoredCardTemplateSettings` never displays History on non-history tabs.
- [x] Add unit test `extension/tests/history-visibility.test.js`: verify `#history-section` remains hidden on `text`, `video`, `ask` tabs across startup, deck change, and settings save.

**Done when:** History panel NEVER shows at the bottom of Text mode under any combination of startup or setting toggles.

---

### Session 5: LLM Frontend Wiring, Escaping & Context Accuracy (Phase 2 Frontend)

Context: `extension/sidepanel/sidepanel.js`, `extension/sidepanel/sidepanel.html`, `tier5-ask-tab.test.js`.

- [x] **Payload Construction Fix for "Sense in Context" and "Mnemonic Hook":**
      - `sendAskQuery` must send proper fields based on task:
        - `explain_sense`: `word` = current card expression, `text` = example sentence (or source text), `context` = dictionary meaning.
        - `mnemonic`: `word` = expression, `context` = meaning, `text` = expression.
        - `translate` / `explain_grammar`: `text` = sentence only, `context` = empty.
        - `answer_question` / `chat`: `text` = user question, `context` = selected options/notes only.
- [x] **Fix Duplicate Text Transmission:** Context buttons (Solve/Grammar/Translate) must not send `activeAskContext.text` as both `text` and `context`.
- [x] **XSS Escaping & Error Handling:**
      - Replace `innerHTML` injections of `data.detail`, `err.message`, `aiProvider`, and `aiModel` with safe DOM construction using `textContent`.
      - If `data.detail` is an array of objects (FastAPI 422 validation errors), show a clean generic message instead of `[object Object]`.
- [x] **Task Chip Stickiness & Reset:** Reset `currentAskTask` after query completion or clearly reflect task state on the action button.
- [x] **Client History Capping:** Cap client-side `askChatHistory` array to max 10 messages before dispatch.
- [x] **UI Polish & Status Colors:**
      - Replace hardcoded `#c94f3d` and `#81c784` with CSS tokens `--accent-error` / `--accent-success`.
      - Fix Ask status dot in HTML: start in `checking`/neutral state rather than premature `online`.
- [x] **Settings Integration:** Wire Settings → AI Assistant to the new `GET/PUT /api/llm/config` and `POST /api/llm/test` endpoints with provider dropdown, model field, password-type key field, and "Test Connection" button.
- [x] **LLM Context Buttons in Text Tab:** Add small action buttons in the Text tab next to Dictionary (Translate sentence, Best sense, Memory hook) with one-click "Add to Notes".
- [x] Add `fetchWithTimeout` helper (default 15s, LLM 60s) to avoid UI getting stuck indefinitely on "Checking..." or "Analyzing...".

**Done when:** Ask queries send correct word/sentence/meaning payloads, all responses/errors are escaped via textContent, and LLM configuration is manageable from Settings.

---

### Session 6: Section Visibility, Collapse Prefs & Collapsible Dictionary (Phase 3)

- [x] **Prefs Storage (`kiroku.layout.cardSectionPrefs`):**
      - Store visibility and collapse states: `preview`, `optional`, `settings`, `dictionary`.
      - Store dictionary contents toggles: `kanji`, `strokes`, `examples`, `otherDicts`, `xrefs`, `senseTags`.
      - Implement pure helper functions `normalizeSectionPrefs(raw)` and `defaultSectionPrefs()`.
      - Defaults must be all visible and expanded (preserves exact today's layout for existing users).
      - Core editing zones (`hero`, Primary Action buttons) cannot be hidden; legacy hidden sections remain untouched.
- [x] **Apply Prefs Function:**
      - Implement `applySectionPrefs(prefs)`: toggle `.is-user-hidden` (`display:none !important`) and `.is-collapsed`. Set `aria-hidden="true"` when hidden.
      - Wire into startup sequence right after `applySectionOrder`.
- [x] **Collapsible Dictionary Header:**
      - Add `<button type="button" id="btn-dict-collapse" aria-expanded="true" aria-controls="dict-body">` in `.dict-header-row`. (Do not use `<details>`).
      - Wrap `#dict-loading-indicator`, `#dict-empty-notice`, `#meanings`, `#examples` in `<div id="dict-body" class="collapsible-body">`.
      - When collapsed, retain visible: title, JLPT badge, Copy button, and a `#dict-collapsed-summary` line showing first gloss.
- [x] **Dictionary Contents Visibility (CSS only):**
      - Implement CSS classes on `#meanings`: `.hide-kanji`, `.hide-strokes`, `.hide-examples`, `.hide-other-dicts`, `.hide-xrefs`, `.hide-sense-tags`.
      - Ensure data is still fully fetched, stored in `meanings_json`, and passed to Anki even if visually toggled off.
- [x] **Settings UI:**
      - Extend Settings layout list with visibility eye icon and collapse toggle per section.
      - Add Dictionary contents checklist.
      - Add presets: Minimal, Standard, Full study.
      - "Reset to Default" (`#btn-reset-layout`) resets section prefs as well.
      - when settings is opened, it should be as a tab so user can clearly view the settings instead of how it is right now (a dropdown)
- [x] Tests: `extension/tests/section-prefs.test.js`.

**Done when:** Sections and dictionary contents can be hidden or collapsed without breaking data flow, with state persisted and defaults preserved.

---

### Session 7: Floating Ask Drawer (Replacing Ask Tab - Phase 4A)

- [x] **Floating Action Button (FAB):** Add `#ask-fab` at bottom-right (`aria-label="Ask AI"`, `aria-expanded`, `aria-controls="ask-float"`). Indicator dot for unread replies.
- [x] **Bottom Drawer Container:**
      - Move Ask DOM elements (keeping all existing IDs intact) into `<aside id="ask-float" role="dialog" aria-modal="false" aria-label="Ask AI" hidden>`.
      - Drawer covers ~65% height with header (title, New Chat, minimize, close).
      - Closing toggles `hidden` without clearing chat state or draft.
- [x] **Tab Strip & Editor Decoupling:**
      - Remove `#tab-btn-ask` from the tab strip.
      - Adjust `hideEditor` in `switchMiningTab` so card editor stays visible on non-history tabs while Ask drawer is open.
      - Retain `switchMiningTab("ask")` as a backwards-compatible alias that calls `openAskFloat()`.
- [x] **Focus & Shortcuts:**
      - `openAskFloat()` focuses `#ask-input-box`; `Esc` closes drawer and refocuses trigger button.
      - Add shortcut command `toggle-ask` (or `Alt+Shift+A` / `Ctrl+/`).
- [x] **Context Entry Points:**
      - Small icon on Hero, Video current-cue, and OCR result opens Ask drawer with context prefilled.
- [x] **Notice & Disclosures:** Show cloud privacy notice when using cloud provider ("Selected text and sentences are sent to <provider>").
- [x] Tests: `extension/tests/ask-float.test.js`.

**Done when:** Ask is accessible as an overlay drawer across all tabs without hiding the card editor, and tab strip contains Text, Video, and History.

---

### Session 8: Hero Search & Quick Add Merging (Phase 5)

- [x] **Hero Search Input:**
      - Add `#hero-search-input` in the hero slot (`role="combobox"`, `aria-expanded`, `aria-controls="hero-search-popup"`).
      - States:
        1. *Idle*: shows input with placeholder "Type romaji, kana or English…".
        2. *Captured*: displays existing hero word; clicking word or `/` reactivates search input.
        3. *Searching*: dropdown open with candidates.
- [x] **Auto-Detect Search Mode:**
      - If input is ASCII, check `wanakana.toKana(q)`. If fully kana (`nomu` → `のむ`), use kana search; otherwise (`water`), use English search. If ambiguous (`ai`), display Japanese and English groups.
      - Keep manual toggle icon and F6/F7 shortcuts.
- [x] **Candidate Dropdown & Selection:**
      - Render suggestions reusing candidate list styles (`executeQuickAddLookup`, `renderQuickAddSuggestions`).
      - Maintain JLPT pill, "Already saved" pill, and `isCardDraftDirty()` "Replace draft?" check on selection.
      - Provenance set to `quick_add` in History.
- [x] **Quick Add Tab Removal:**
      - Remove `#tab-btn-quickadd` and `#quickadd-mining-view`.
      - In `loadTabPreference()`, map saved `quickadd` tab to `text`.
      - Remove dead references to `#quickadd-mode-katakana`.
- [x] Update and rewrite tests: `quick-add.test.js`, `quick-add-english-mode.test.js`, `quick-add-status.test.js`.

**Done when:** Quick Add tab is removed, search is accessible directly in the Hero on Text and Video tabs, and auto-detects kana vs English seamlessly.

---

### Session 9: Settings Regrouping & Header Consolidation (Phase 6)

- [x] **Settings Regrouping:**
      - Reorganize settings into 4 clean sections: **Display**, **Card**, **Connections**, **Video**.
      - Compact grid for Front/Back card fields (Reading, Meaning, Hint, Kanji reading) keeping existing input IDs intact.
      - Remove redundant "Connection Indicators" legend.
      - Dynamic AnkiConnect URL display from `/api/anki/status` or `/api/health`.
- [x] **Header Consolidation:**
      - Consolidate Yomitan / Anki / OCR / AI status dots into a single unified status indicator with hover popover detailing each service.
      - Keep original dot IDs hidden in DOM for JS update compatibility.
      - Relocate Japanese input (JP) toggle out of global header into the Card Editor's free-text field toolbar.
      - Remove `#btn-nav-collapse-toggle` arrow if unused.

**Done when:** Settings are organized into 4 clear groups and header has a streamlined unified status indicator and clean tab strip.

---

### Session 10: Per-Tab Decluttering (Video, History, Drawer) (Phase 7)

- [ ] **Video Tab Decluttering:**
      - Reorder layout: Source bar (`Load subtitles ▾` + file status) → Current cue + **Mine sentence** → Collapsed **Tools** row (search, recent cues, folder, offset).
      - Streamline offset control into compact stepper `− 0 ms +`.
      - Move Jimaku API key and download folder to Settings → Video.
- [ ] **Ask Drawer Streamlining:**
      - Merge context buttons and task chips into a single unified chip bar.
      - Make Send an icon button.
- [ ] **History Tab Improvements:**
      - Group sort, export, bulk-select, and sync-all under a single **⋯** action menu.
      - Consolidate stats into a single line summary ("12 today · 163/213 synced").
      - Add pagination or virtualization to history list rendering to handle up to 500 cards without lag.
- [ ] **Media Preview Check:**
      - Confirm visual presence of captured image/audio status before saving; add chip row (`Image ✓ Audio ✓ ×`) if needed.

**Done when:** Video, History, and Ask drawer interfaces are tidy, responsive, and free of duplicated or bloated controls.

---

### Session 11: CSS Tokens, Contrast, Accessibility & Polish (Phase 8)

- [ ] **CSS Variables & Tokens:**
      - Standardize typography scale tokens in appended CSS block (floor at 11px for informative text).
      - Eliminate inline `style=""` declarations from HTML and JS where classes can be used.
- [ ] **Contrast Audit:**
      - Replace low-contrast `--text-faint` (`#48433d` on `#121110`, 1.9:1) with `--text-muted` (`#8e8a81`, 5.5:1) for any informative content.
- [ ] **Motion & Accessibility:**
      - Add `prefers-reduced-motion` support for drawers, chevrons, and dropdowns.
      - Ensure all buttons have explicit `aria-label`, collapse buttons have `aria-expanded` and `aria-controls`.
      - Consolidate all error accents to `--accent-error`.

**Done when:** All text meets accessible contrast ratios, CSS is tokenized in the appended block, and interactive elements have proper ARIA attributes.

---

### Session 12: Documentation, Stale Checklist Cleanup & Final Handoff (Phase 10)

- [ ] Update `PROGRESS.md` with final summary of completed phases and verification logs.
- [ ] Update `newfeatures.md`: update LLM-1 to LLM-5 checkboxes to reflect reality.
- [ ] Update `ARCHITECTURE.md` and `DECISIONS.md` to document the unified hero search, floating Ask drawer, section layout prefs, and security middleware.
- [ ] Clean up obsolete dev test scripts and leftovers: evaluate `preview_demo.html`, `dry_run_full_test.py`, `test_plan_verification.py`, `interactive_feature_test.py`.

**Done when:** All documentation matches the implemented architecture and codebase is clean and ready.

---

## 11. Global Acceptance Checklist

- [ ] Fresh install and upgraded install look identical by default (nothing hidden, nothing collapsed).
- [ ] No existing element ID removed or renamed.
- [ ] `#history-section` visible only on the History tab.
- [ ] Ask reachable from every tab via the FAB; chat survives close/open; card editor stays visible while Ask is open.
- [ ] Quick tab gone; hero search covers romaji, kana and English; stored `quickadd` tab falls back to Text.
- [ ] Dictionary is collapsible; sections and Dictionary sub-blocks can be hidden from Settings; hidden content is still saved in `meanings_json` and still exported to Anki.
- [ ] LLM: sense/mnemonic prompts contain the real word and meaning; errors are escaped; timeouts are configurable.
- [ ] Both test suites (`pytest` and `node --test`) run and pass green with no cancelled subtests.
- [ ] `PROGRESS.md` updated for every session.

---

## 12. Stop and Ask the Owner

- Should Ask 4B (floating window on web pages) be built at all, or is the in-panel drawer enough?
- Is it acceptable to narrow the `<all_urls>` permissions (affects video mining on unknown sites)?
- Is there a visible way to view/remove captured media before saving, or should the chip row be added (Session 10)?
- Should API keys be stored in a local config file (Session 3), or remain environment-variable-only?
- Which of the housekeeping files in Session 12 can be deleted?

---

## Appendix A — Measured findings (for reference)

- Tests: pytest 453 passed / 3 skipped / 2 failed; node 141 passed / 1 failed (3 cancelled subtests, `hero-view.test.js`).
- `sidepanel.js` ≈ 9.5k lines; `sidepanel.css` ≈ 180 KB (266 `!important`, 33 repeated top-level selectors, 88 custom properties, 3 `@media` blocks); `sidepanel.html` ≈ 970 lines with ~66 buttons and 19 inline `style=""`.
- 27 `await fetch(` calls in `sidepanel.js` with no `AbortController` timeouts (Quick Add's lookup does abort stale requests). Add a small `fetchWithTimeout` helper (default 15 s; LLM 60 s) and use it for new code first.
- `/api/health` builds `CardService`, `YomitanService` and `OcrService` on each call and pings all of them; the panel also polls Anki every 10 s. Consider a 3–5 s in-process cache.
- LLM defaults: Groq `llama-3.1-8b-instant`, Gemini `gemini-2.0-flash`, Ollama `qwen2.5:1.5b`; 5 s timeout everywhere.

## Appendix B — Key symbols and where to find them

| Thing | Where |
|---|---|
| Tab switching | `switchMiningTab`, `loadTabPreference` (`active_mining_tab`) in `sidepanel.js` |
| History visibility bug | `applyHistoryVisibility` (~L333), `saveStoredCardTemplateSettings` (~L419), `syncCardTemplateSettingsUI` (~L425) |
| Section order/layout | `DEFAULT_CARD_SECTION_ORDER`, `SECTION_METADATA`, `applySectionOrder`, `renderLayoutSettingsList`, `resetLayoutSettings` |
| Dictionary rendering | `renderDetails`, `renderStudySenseItem`, `renderKanjiCard`, `clearDictionaryView` |
| Quick Add | `initQuickAdd`, `executeQuickAddLookup`, `renderQuickAddSuggestions`, `selectQuickAddCandidate`, `setQuickAddSearchMode` |
| Editor suggestions (JP mode) | `setEditorJapaneseMode`, `handleEditorTokenLookup`, `renderEditorSuggestions` |
| Ask / LLM UI | `sendAskQuery`, `setAskContext`, `checkLLMStatus`, `formatAIResponse` |
| LLM backend | `backend/app/services/llm_service.py`, `main.py` (`/api/llm/*`), `schemas.py` (`LLMRequest`), `config.py` |
| CORS | `main.py` → `CORSMiddleware(allow_origin_regex=...)` |
