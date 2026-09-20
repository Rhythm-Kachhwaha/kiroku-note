# Kiroku Note — Progress

## Current Status

Kiroku Note is a local-first Japanese vocabulary and sentence mining tool.

Current development target: **V1.0**

The core mining pipeline is functional. Current work is focused on polishing, reliability, UX, and preparing the project for public release.

---

## Core Stack

- **Extension:** Chromium/Brave MV3
- **UI:** Vanilla HTML/CSS/JavaScript
- **Backend:** Python + FastAPI
- **Database:** SQLite
- **Dictionary:** Yomitan / Jitendex
- **Anki:** AnkiConnect
- **Architecture:** Local-first

---

## Completed

### Japanese Text Mining

- [x] Japanese text selection capture
- [x] Mining mode
- [x] Yomitan dictionary lookup
- [x] Dictionary result display
- [x] Card editing
- [x] SQLite card storage
- [x] Duplicate prevention
- [x] AnkiConnect integration
- [x] Explicit card sync to Anki

### Card Library

- [x] Mining history
- [x] Search
- [x] Deck filtering
- [x] Sync status filtering
- [x] Saved card viewing
- [x] Re-save cards
- [x] Local card deletion
- [x] Retry failed sync

### Subtitle Mining

- [x] External subtitle detection
- [x] Subtitle synchronization with video
- [x] YouTube subtitle mining
- [x] Netflix subtitle mining
- [x] HiAnime subtitle mining
- [x] Custom subtitle overlay
- [x] Subtitle navigation
- [x] Subtitle offset
- [x] Pause-on-hover

### Media

- [x] Frame capture
- [x] Frame persistence
- [x] Frame display in cards
- [x] Media persistence and deduplication
- [x] Frame + subtitle integration

### Reliability

- [x] Capture ID / stale-response protection
- [x] SQLite-first storage
- [x] Anki sync state tracking
- [x] DRM frame-capture fail-soft behavior
- [x] Regression testing across supported video sites

---

## Current V1 Work

### Stage 2 — Repository & Branding

- [x] Rename product from AnkiMiner to Kiroku Note
- [x] Audit remaining AnkiMiner references
- [x] Preserve backward compatibility for persisted/internal identifiers
- [x] Clean obsolete repository artifacts
- [x] Prepare repository for `kiroku-note`

### Stage 3 — Dictionary

- [x] Stage 3A: Dictionary architecture research & technical design (`V1/Stage3A.md`)
- [x] Stage 3B.1: Backend AST normalizer & provider-neutral domain models (`V1/Stage3B1.md`)
- [x] Stage 3B.2.1: CardService multi-sense draft synthesis (`synthesize_default_meaning`, `synthesize_default_example`)
- [x] Stage 3B.2.2: CardService multi-dictionary integration & JLPT resolution handoff
- [x] Stage 3B.3: Side Panel declarative dictionary rendering & UI
  - [x] Stage 3B.3.1a: Structured Dictionary Study View Renderer (`renderDetails`, sense-bound POS/tags, pitch, freq, JLPT, ruby markup)
  - [x] Stage 3B.3.1b: Quick-Insert Actions & Progressive Disclosure Accordions (`insertSenseToMeaning`, `insertExampleToCard`, senses overflow accordion)
  - [x] Stage 3B.3.2: Side Panel Design System & Visual Polish (Precision Dark Utility tokens, typography, spacing, surfaces, borders, buttons, inputs, badges)
- [x] Stage 3B.4: Multi-dictionary presentation polish & Anki template alignment (`V1/Stage3B.4.md`)
  - [x] Step 1: Persist structured dictionary entries (`SaveCardRequest.entries` -> `CardDraft.entries` -> SQLite `meanings_json` -> `openSavedCard` restoration)
  - [x] Step 2: Dedicated AnkiFormatter service (`app.services.anki_formatter`: meaning, ruby, example, basic back, media sanitization)
  - [x] Step 3: AnkiConnect field mapping integration (`map_card_to_fields` + `sync_card` consuming `AnkiFormatter`, preserving keyword matrix)
  - [x] Step 4: Final regression, multi-model verification & live AnkiConnect testing (212/212 backend tests passed, 27/27 extension suites passed)
- [x] Stage 3B.5: Kanji Reading & Multi-Dictionary Expansion (Kanji-Bank / KANJIDIC / JPDB Integration)
  - [x] Step 1: Root Cause Analysis — Yomitan separate `/kanjiEntries` endpoint (`{"character": "..."}`) vs `/termEntries` (`{"term": "..."}`).
  - [x] Step 2: Backend `KanjiEntry` domain dataclass, Pydantic schema, and Yomitan normalization parsing Onyomi (katakana), Kunyomi (with okurigana formatting), Nanori, character meanings, tags, stats (`strokes`, `grade`, `jlpt`, `freq`).
  - [x] Step 3: Persistence & Draft Synthesis — SQLite `meanings_json` serialization supporting both legacy arrays and `{ "entries": [...], "kanji_entries": [...] }` without SQLite schema migration.
  - [x] Step 4: Frontend Side Panel UI — Dedicated `.study-kanji-card` with interactive Onyomi (`.pill-onyomi`) and Kunyomi (`.pill-kunyomi`) click-to-set reading pills, quick-insert meanings, stats badges, and progressive disclosure `<details class="study-kanji-accordion">` for multi-kanji vocabulary terms.
  - [x] Step 5: Full verification — 241/241 backend pytest tests passing, 32/32 extension test suites passing.
- [x] Stage 3B.6: Anki Card & Preview Rich Kanji Sync + JLPT Historical Fix
  - [x] Step 1: Backend `AnkiFormatter` kanji enrichment (`format_kanji_html`, `format_kunyomi`, scoped `.kn-kanji-card` CSS, isolated vs compound card layouts, dictionary attribution).
  - [x] Step 2: Side Panel Live Card Preview kanji alignment (`renderPreviewKanjiCard` DOM renderer, `.kn-card .kn-kanji-card` styles, full semantic parity with Anki output).
  - [x] Step 3: JLPT historical classification fix: disambiguated pre-2010 4-level scale (`Old JLPT 1–4`) from modern post-2010 scale (`JLPT N1–N5`), preventing misleading badge presentation without speculative level conversion.
  - [x] Step 4: Full verification across AnkiConnect payload mappings, custom models, and Side Panel preview (246/246 backend pytest tests passing, 32/32 extension test suites passing).


### Stage 4 — Frontend

- [x] Redesign Side Panel UI (Precision Dark Utility design system)
- [x] Improve typography (Noto Sans JP priority, reading accent, CJK word break, monospace data)
- [x] Improve layout and spacing (4px micro-spacing scale, surface hierarchy, zero overflow)
- [x] Improve card editor (token-based inputs, high-contrast focus rings, refined media previews)
- [x] Improve responsive behavior (320px, 400px, 600px width support)
- [x] Preserve existing extension behavior and DOM contracts (100% test compatibility)
- [x] Stage 4.1: Card Editor + Preview UX Consolidation & Centered Composition
  - [x] Unified Card Workspace: established live `.kn-card` preview as single visual source of truth.
  - [x] Removed redundant standalone hero display (`#captured-word-section` hidden while preserving all DOM bindings).
  - [x] Streamlined 2-column Japanese input row for Expression & Reading (`.form-row-compact`).
  - [x] Compact 2-column Media Preview grid (`.media-preview-container`) maintaining thumbnail, audio replay, status badge, and clear actions without vertical bloat.
  - [x] Centered panel container layout (`max-width: 560px; margin: 0 auto; width: 100%;`).
  - [x] Retained Dictionary & Reference section below as secondary exploration dock with click-to-fill reading pills and insert buttons.
  - [x] Full test verification: 32/32 extension test suites passing, 246/246 backend pytest tests passing.

### Stage 5 — Anki Cards

- [x] Stage 5.1: Media De-duplication & Idempotency Hardening (`backend/app/services/anki_connect.py`, `backend/app/services/anki_formatter.py`)
  - [x] Basic model media detection recognizing all supported image/audio keywords (`image`, `picture`, `sentenceimage`, `vocabimage`, `screenshot`, `photo`, `snapshot`, `illustration`, etc.)
  - [x] Single-source media assignment: dedicated media fields prevent image/audio inclusion in composite `Back` HTML
  - [x] Idempotent image fallback preventing duplicate append during re-sync or existing image references in `Notes`/`Back`
  - [x] Automated test suite expanded to 222/222 backend tests (55/55 AnkiConnect tests, 10 dedicated Stage 5.1 regression tests)
- [x] Stage 5.2: Learner-focused Anki Card HTML & Scoped CSS (`backend/app/services/anki_formatter.py`, `backend/tests/test_anki_formatter.py`)
  - [x] Self-contained scoped CSS stylesheet (`ANKI_CARD_CSS`, `get_anki_card_css()`) embedded in generated Basic `Back` card HTML inside `.kn-card`
  - [x] Full light and dark mode support (`.nightMode .kn-card`, `.night_mode .kn-card`, `body.nightMode .kn-card`, `body.night_mode .kn-card`, `@media (prefers-color-scheme: dark)`)
  - [x] Japanese typography hierarchy with robust system fallbacks (`Noto Sans JP`, `Hiragino Sans`, `Yu Gothic`, `Meiryo`)
  - [x] Semantic badges for POS (`.kn-pos`) and domain tags (`.kn-tag`), subtle Tokyo pitch badge pill (`.kn-pitch`), example sentence card surface (`.kn-example-block`), and responsive media containment (`max-height: 240px; object-fit: contain;`)
  - [x] Automated test suite expanded to 224/224 backend tests (15/15 dedicated AnkiFormatter tests, 55/55 AnkiConnect tests, 27/27 extension suites)
- [ ] Stage 5.3: Dedicated Kiroku Japanese Note Model & Template Provisioning (Deferred)
- [x] Stage 5.4: Side Panel Live Anki Card Preview (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`, `extension/sidepanel/sidepanel.js`, `extension/tests/card-preview.test.js`)
  - [x] Collapsible `#card-preview-section` embedded in Side Panel between `#card-editor-section` and `#dictionary-section` preserving narrow 320px–600px responsiveness
  - [x] Front/Back toggle tabs (`#preview-tab-front`, `#preview-tab-back`) with aria state management and keyboard accessibility
  - [x] Semantic `.kn-card` DOM renderer matching Stage 5.2 Anki layout (prominent expression, ruby furigana, Tokyo pitch pills, structured meanings with POS/tag badges, example blocks, hints, notes, media previews)
  - [x] 100% XSS defense via safe DOM construction (`document.createElement`, `document.createTextNode`, `replaceChildren`) with zero unsafe `innerHTML` injection
  - [x] Debounced reactive live-update pipeline (`scheduleCardPreviewUpdate`) bound to card editor inputs, media triggers, and history card opening
  - [x] Comprehensive automated test suite (`extension/tests/card-preview.test.js`) passing 12/12 dedicated test scenarios (28/28 extension suites passed, 224/224 backend tests passed)
- [x] Stage 5.5: Final Anki Card Regression, Compatibility & Live Verification (`backend/tests/test_stage5_regression.py`, `backend/tests/verify_live_anki.py`)
  - [x] Live Anki Desktop verification confirmed active (AnkiConnect v6 at `127.0.0.1:8765`)
  - [x] Live Basic model note creation verified (clean Front, scoped CSS `.kn-card`, reading, Tokyo pitch badge, ruby furigana, divider, structured meanings, example blocks, notes)
  - [x] Live multi-sense word verification (`掛ける`) preserving sense ordering and sense-bound POS/tag badges
  - [x] Live media de-duplication verified: dedicated image fields populated without duplication into Back; idempotent fallback on repeated sync
  - [x] Live custom note models compatibility verified across installed user models (`Kaishi 1.5k`, `japanese mining`, `Core 2000`, `Japanese sentences`, `Basic`)
  - [x] Security & XSS escaping verified across script injection, iframe, SVG onload, and malicious media filename breakout attempts
  - [x] Side Panel preview vs Anki rendering semantic parity verified with intentional environment differences documented
  - [x] Dictionary domain tag decluttering & sub-term isolation: stripped noisy domain tags (e.g. `stock market`, `card games`, `math`) from card meanings and previews, keeping only clean Part-of-Speech badges (`[noun]`, `[v1]`, etc.); prevented component sub-words from leaking into compound term cards
  - [x] Full automated test suites green: 231/231 backend tests passed (including dedicated `test_stage5_regression.py`), 28/28 extension suites passed

### Stage 6 — UX & Accessibility

- [x] Stage 6.1: Comprehensive UX & Accessibility Audit (`V1/Stage6-UX-ACCESSIBILITY-AUDIT.md`)
- [x] Stage 6.2: Semantic Structure & Heading Hierarchy (prominent section `<h2>` tags, `aria-controls` bindings, `aria-selected` tab management)
- [x] Stage 6.3: WCAG AA Color Contrast & Reduced Motion (`--text-muted` updated to `#8e8a81` for 4.65:1 contrast, `@media (prefers-reduced-motion: reduce)` override added)
- [x] Stage 6.4: Focus Visibility & History Semantics (high-contrast `:focus-visible` rings on all interactive elements, eliminated nested interactive elements by replacing container `role="button"` with native `.history-item-card-btn`)
- [x] Stage 6.5: Loading & Zero-Result Feedback (`#dict-loading-indicator` spinner, `#dict-empty-notice` zero-result helper)
- [x] Stage 6.6: Non-Blocking Confirmations (replaced browser-native `window.confirm()` with 2-click inline confirmations `.confirm-replace` and `.confirm-delete` with auto-revert timeouts)
- [x] Stage 6.7: First-Run Experience & Empty States (`#first-run-guide` step-by-step setup checklist with persistent 1-click dismissal)
- [x] Stage 6.8: Verified NO Keyboard Shortcuts Added (strictly compliant with constraint: native Tab/Shift+Tab/Enter/Space/Escape navigation only)
- [x] Full Automated Verification: 231/231 backend tests passed, 29/29 extension test suites passed (including dedicated `extension/tests/sidepanel-a11y-ux.test.js`, documented in `V1/Stage6-UX-ACCESSIBILITY.md`)

### Stage 7 — Security & Reliability

- [x] Stage 7.1: Comprehensive Security & Reliability Audit (`V1/Stage7-SECURITY-RELIABILITY-AUDIT.md`)
- [x] Stage 7.2: Launcher Hardening (`run_backend.py`, `backend/app/main.py`)
  - [x] Disabled development reload by default (`reload=False`); guarded behind `KIROKU_DEBUG=1`
  - [x] Gated FastAPI `/docs` and `/redoc` endpoints behind `KIROKU_DEBUG=1` (returns 404 in non-debug mode)
- [x] Stage 7.3: YouTube Timedtext URL Validation (`extension/background.js`, `extension/tests/timedtext-url-validation.test.js`)
  - [x] Implemented `isAllowedTimedtextUrl` with strict exact & subdomain boundary matching on approved Google/YouTube CDN hostnames (`youtube.com`, `googlevideo.com`, `ytimg.com`, `googleapis.com`, `google.com`)
  - [x] Enforced HTTPS scheme and explicitly rejected localhost, loopback (`127.0.0.1`, `::1`), private IP ranges (`10.x`, `172.16-31.x`, `192.168.x`), deceptive hostnames (`evil-youtube.com`), and malformed URLs
- [x] Stage 7.4: API Limit Cap & Stale Database Cleanup (`backend/app/main.py`, `backend/app/repositories/card_repository.py`, `backend/tests/test_cards_api.py`)
  - [x] Added `Query(default=50, ge=1, le=500)` and `Query(default=0, ge=0)` to `GET /api/cards` with 422 Unprocessable Entity responses for invalid boundaries (0, >500, negative)
  - [x] Added repository clamping `min(500, max(1, limit))` as defense-in-depth
  - [x] Verified and safely removed obsolete 0-byte `backend/data/cards.db` while strictly preserving active `ankiminer.db` (245 KB)
- [x] Stage 7.5: CSP & Offline Local Font Bundling (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`, `extension/fonts/README.md`, `extension/tests/sidepanel-a11y-ux.test.js`)
  - [x] Added restrictive Content Security Policy meta tag to Side Panel (`default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' http://127.0.0.1:8000 data: blob:; media-src 'self' http://127.0.0.1:8000 data: blob:; connect-src http://127.0.0.1:8000; script-src 'self';`)
  - [x] Removed external Google Fonts CDN links (`fonts.googleapis.com`, `fonts.gstatic.com`)
  - [x] Added `@font-face` rules in `sidepanel.css` with local Japanese font bindings (`Noto Sans JP`, `Hiragino Sans`, `Yu Gothic`, `Meiryo`, `Noto Serif JP`, `Yu Mincho`) for offline visual parity
- [x] Stage 7.6: Reliability Hardening & Interrupted Sync Recovery (`backend/app/db/connection.py`, `backend/tests/test_stage7_reliability_security.py`)
  - [x] Added startup sync recovery in `init_db()`: resets cards stuck in `sync_status='syncing'` to `pending` without touching `synced`, `failed`, or `pending` cards
  - [x] Hardened SQLite initialization in `get_db_connection()`: gracefully catches `sqlite3.DatabaseError` on corruption, safely closes connection handles, and raises descriptive `RuntimeError` without deleting the database
- [x] Full Automated Verification:
  - Backend: 236/236 unit and integration tests passing (`python -m pytest -o pythonpath=backend backend/tests`)
  - Extension: 30/30 test suites passing (`node --test extension/tests/*.test.js`)

### Subtitle Overlay & Fullscreen Polish

- [x] HiAnime External Subtitle Fullscreen Fix (`extension/content/video-mining-poc.js`)
  - [x] Diagnosed fullscreen DOM container reparenting & z-index/stacking isolation on HiAnime embedded players
  - [x] Hardened `getTargetContainer()` and `ensureMounted()` to re-attach overlay to active fullscreen player wrapper and bring overlay to the top of the stacking context
  - [x] Added multi-stage delayed re-anchoring (0ms, 50ms, 150ms, 300ms, 600ms) on fullscreen transitions to reliably catch asynchronous player DOM updates
- [x] Movable Subtitle Overlay with Normalized Position Model (`extension/content/video-mining-poc.js`, `extension/tests/movable-subtitle-overlay.test.js`)
  - [x] Added dedicated drag affordance handle (`#ankiminer-video-subtitle-handle` with 6-dot SVG grip icon) separating drag interactions from text selection
  - [x] Preserved 100% Japanese text selection and Yomitan/Kiroku hover scanning on subtitle text (`#ankiminer-video-subtitle`)
  - [x] Implemented normalized relative coordinate system `{ relX, relY }` surviving fullscreen, window resize, and player reparenting with strict player boundary clamping
  - [x] Preserved default bottom-center position (`{ relX: 0.5, relY: 0.78 }`) for seamless backward compatibility
  - [x] Added local storage persistence (`subtitle_overlay_position` in `chrome.storage.local` & `localStorage`) and runtime message handlers (`SET_SUBTITLE_POSITION`, `GET_SUBTITLE_POSITION`, `RESET_SUBTITLE_POSITION`)
  - [x] Strictly preserved playback invariants: 0 seeks, 0 currentTime changes, 0 play/pause modifications, 0 keyboard shortcuts added
- [x] Verification:
  - Extension: 31/31 test suites passing (`node --test extension/tests/*.test.js`) including dedicated `extension/tests/movable-subtitle-overlay.test.js`
  - Backend: 236/236 unit and integration tests passing (`python -m pytest -o pythonpath=backend backend/tests`)


### Stage 8 — Documentation

- [ ] Finalize README
- [ ] Finalize architecture documentation
- [ ] Create current UI specification
- [ ] Clean remaining documentation
- [ ] Ensure archived reports remain outside active documentation

### Stage 9 — Release Harness

- [x] Production configuration
- [x] Extension packaging
- [x] Backend launcher
- [ ] Clean-machine testing
- [ ] Versioning
- [ ] Release checks

### Stage 10 — Windows Distribution

- [x] Build easy-to-use Windows package
- [x] Package backend/launcher
- [x] Package Chromium extension
- [x] Configure Windows Inno Setup installer (`installer/kiroku_setup.iss`, `release/build-installer.ps1`)
- [ ] Document installation
- [ ] Test on clean Windows environment

### Stage 11 — Final Regression

- [ ] Backend test suite
- [ ] Extension test suite
- [ ] YouTube regression
- [ ] Netflix regression
- [ ] HiAnime regression
- [ ] AnkiConnect regression
- [ ] Yomitan regression
- [ ] Frame capture regression
- [ ] Playback invariant verification

### Stage 12 — V1.0 Release

- [ ] Final version bump
- [ ] Final changelog
- [ ] GitHub repository cleanup
- [ ] GitHub release
- [ ] Public documentation
- [ ] V1.0 package

---

## Deferred Features

These are intentionally outside V1.

### V2

- OCR

### V3

- Audio capture / audio mining

### Later

- Video clips
- GIF/video snippets
- Cloud functionality

Existing audio implementation remains in the repository but is not part of the V1 product scope.

---

## Important Invariants

These rules must not be broken during V1 development.

### Playback

Normal mining must not manipulate video playback.

Do not introduce:

- `currentTime` seeking
- automatic play
- automatic pause
- playback-rate changes
- video replacement

Pause-on-hover is the only intentional playback exception.

### Storage

SQLite is the source of truth.

Saving a card must not implicitly send it to Anki.

### Architecture

Preserve the existing capture and subtitle pipelines unless a specific bug requires changing them.

Avoid large rewrites of working systems.

### Compatibility

Existing cards, media, settings, and persisted data must not be casually invalidated during the rename or refactoring work.

### Development

Changes should be incremental and independently testable.

Do not modify unrelated functionality while working on a specific V1 stage.

---

## Current Baseline

The core application and media-mining functionality has already been implemented and tested.

Before beginning each major V1 stage:

1. Inspect the existing implementation.
2. Establish the current behavior.
3. Make the smallest appropriate change.
4. Run the existing test suites.
5. Perform relevant manual regression testing.
6. Verify critical invariants.
7. Review the final diff.

---

## Project Direction

The goal of V1 is not to add a large number of new features.

The goal is to turn the existing working mining tool into a **polished, reliable, understandable, and easy-to-install public product**.

New major features should generally be deferred unless they are necessary for the V1 experience.

---

### Customizable Card Layout & Section Reordering
- **Feature Delivered:** Modular Layout Settings system allowing users to customize the vertical order of the 6 card workspace sections (`preview`, `fields`, `media`, `settings`, `optional`, `dictionary`) via drag-and-drop or accessible Move Up / Move Down buttons.
- **Key Architectural Decisions:**
  - Sections grouped inside `#card-layout-container` with stable `data-layout-section="id"` attributes.
  - DOM element reparenting preserves form inputs, values, active audio playback, and event bindings without destruction or re-initialization.
  - Storage persistence via `chrome.storage.local` with fallback to `localStorage` under `kiroku.layout.cardSectionOrder`.
  - Robust migration & validation via `resolveValidSectionOrder`: strips unknown/corrupted IDs, deduplicates, and restores missing canonical sections.
  - Accessible keyboard & screen-reader friendly controls (Move Up / Move Down buttons with dynamic disabling and ARIA feedback, Escape key handling, click outside popover dismiss).
  - Immediate Reset to Default button restoring canonical layout.
- **Verification:**
  - 33/33 extension tests passed (`node --test extension/tests/*.test.js`).
  - 246/246 backend pytest tests passed (`python -m pytest -o pythonpath=backend backend/tests`).

### Anki Sync All & Per-Deck Duplicate Handling
- **Feature Delivered:**
  - **Deck-Scoped Duplicate Invariant:** Uniqueness identity is enforced as `(normalized expression + normalized reading + normalized deck)`. Cards with identical expressions and readings across different decks (`Anime Mining` vs `Japanese N3`) are saved and synced as distinct cards without collision. Same-deck cards correctly identify duplicates.
  - **Explicit Sync All Action:** Added a dedicated `Sync All` button and live status container in the History / Card Library header.
  - **Resilient Batch Sync Engine:** Syncs all eligible `pending` and retryable `failed` cards sequentially. Individual card failures do not abort the batch; diagnostic error states are retained for later retries; already-synced cards are skipped to prevent duplicate notes.
- **Key Architectural Decisions:**
  - Preserved SQLite-first persistence: cards are stored locally in SQLite and only pushed to Anki on explicit user triggers (`Send to Anki` or `Sync All`).
  - Frontend `identify()` now passes the currently active deck to `POST /api/capture` to ensure duplicate checks evaluate against the selected deck.
  - Added `POST /api/cards/sync-all` and alias `POST /api/anki/sync-all` returning `SyncAllResponse` with structured summary statistics and itemized results.
  - Designed accessible Side Panel UI with `:focus-visible` high-contrast rings, busy state during sync, live `aria-live="polite"` feedback, and automatic history refreshes.
- **Verification:**
  - 262/262 backend pytest tests passed (`python -m pytest -o pythonpath=backend backend/tests`).
  - 34/34 extension test suites passed (`node --test extension/tests/*.test.js`).

### Deck-Aware Duplicate UI State Fix
- **Bug Fixed:** Switching the selected deck after capturing or saving a word previously left the Side Panel in a stale "ALREADY SAVED" state with the previous deck's card ID, preventing saving the word in a different deck without recapturing.
- **Key Fixes & Architectural Alignment:**
  - **Dynamic Deck-Scoped State Recalculation:** Added reactive `refreshDuplicateState()` / `scheduleDuplicateCheck()` listening to `change` and `input` events on `fieldDeckSelect`, `fieldDeckName`, `fieldExpression`, and `fieldReading`.
  - **Uniqueness Tuple Integrity:** Duplicate evaluation evaluates `(normalized expression + normalized reading + normalized deck)`. When switching to an unsaved deck, `saveBadge` is hidden, status is reset to draft, `fieldCardId` is cleared, and `updateSyncUI` reflects ready status.
  - **Reversible Duplicate Recognition:** Switching between decks (e.g. Deck A -> Deck B -> Deck A) accurately recognizes the corresponding card ID and duplicate state for each deck without overwriting or losing form edits.
- **Verification:**
  - 263/263 backend pytest tests passing (`python -m pytest -o pythonpath=backend backend/tests`).
  - 35/35 extension test suites passing (`node --test extension/tests/*.test.js`), including new dedicated `extension/tests/deck-aware-duplicate-ui.test.js` covering scenarios A through F.

### Dedicated Backend Port Configuration (Port 21828)
- **Change Delivered:**
  - Migrated default backend listening port from generic dev port `8000` to dedicated unassigned port `21828` (`127.0.0.1:21828`).
  - Added centralized configuration in `backend/app/config.py` with resolution order: `KIROKU_PORT` -> `PORT` -> `DEFAULT_KIROKU_PORT (21828)` with strict 1-65535 boundary validation.
  - Wrapped `run_backend.py` with actionable error handling catching occupied-port socket bind failures (`OSError` / WinError 10048), printing clear guidance for `KIROKU_PORT`.
  - Centralized extension backend URL in `sidepanel.js` via `BACKEND_BASE_URL = "http://127.0.0.1:21828"`, deriving all route constants and media resolution endpoints.
  - Updated `sidepanel.html` CSP `connect-src`, `img-src`, and `media-src` to `http://127.0.0.1:21828`.
  - Updated `manifest.json` `host_permissions` to `http://127.0.0.1:21828/*`.
  - Maintained zero changes to Yomitan (`127.0.0.1:19633`) and AnkiConnect (`127.0.0.1:8765`).
- **Verification:**
  - 275/275 backend pytest tests passing (`python -m pytest tests` in `backend/`).
  - 36/36 extension test suites passing (`node extension/tests/*.test.js`), including dedicated `backend-port-centralization.test.js`.

### Standalone Backend Executable Packaging (PyInstaller V1)
- **Artifacts Delivered:**
  - `packaging/kiroku_backend.spec`: PyInstaller onefile specification bundling the Python 3.11 runtime, FastAPI, Uvicorn, SQLite3, Starlette, Pydantic, and all internal `app.*` services while excluding development dependencies (`pytest`, test directories, documentation, git).
  - `release/build-backend.ps1`: Automated PowerShell build script that validates environment tooling, cleans previous build artifacts, runs PyInstaller, and verifies binary output.
  - `dist/backend/KirokuNote.exe`: Standalone Windows single-file executable (49.76 MB).
- **Key Architectural Decisions & User Data Separation:**
  - **Persistent User Data Architecture:** In packaged mode (`getattr(sys, "frozen", False)` is True), user data strictly resides outside the bundle directory at `%LOCALAPPDATA%\KirokuNote\` with dedicated `data\`, `media\`, and `logs\` subdirectories.
  - **Backward-Compatible Precedence:** Supported environment variables (`KIROKU_PORT`, `PORT`, `KIROKU_DB_PATH`, `ANKIMINER_DB_PATH`, `KIROKU_MEDIA_DIR`, `ANKIMINER_MEDIA_DIR`, `KIROKU_DATA_DIR`) take precedence over defaults.
  - **Production Security Invariants:** API documentation (`/docs`, `/redoc`) and auto-reload are disabled by default in production; enabled only when `KIROKU_DEBUG=1` is explicitly set.
  - **Socket Collision Handling:** Early socket-binding check provides actionable error guidance when port 21828 is occupied.
- **Verification:**
  - 285/285 backend pytest tests passing (`python -m pytest tests` in `backend/`), including:
    - 8/8 packaging & path resolution tests (`test_packaging_config.py`)
    - 2/2 isolated standalone executable runtime tests (`test_standalone_executable.py`) verifying binary presence, HTTP status endpoint, disabled docs (404), fresh SQLite initialization, card save/list persistence, and port collision exit code 1.

### Chromium MV3 Extension Packaging (V1.0.0)
- **Artifacts Delivered:**
  - `release/build-extension.ps1`: Automated PowerShell packaging script that validates `manifest.json`, checks all referenced runtime resources, cleans prior outputs, stages runtime-only files to `dist/extension/unpacked/`, executes a strict zero-test/zero-dev audit, and generates `dist/extension/KirokuNote-extension-v1.0.0.zip`.
  - `dist/extension/KirokuNote-extension-v1.0.0.zip`: Clean distribution ZIP (96.81 KB).
  - `dist/extension/unpacked/`: Clean unpacked extension directory ready to be loaded in Brave/Chromium developer mode.
  - `extension/tests/extension-packaging.test.js`: Automated packaging and manifest validation test suite.
- **Key Architectural Decisions & Content Isolation:**
  - **Manifest Alignment:** Bumped `extension/manifest.json` version from `0.1.0` to `1.0.0` (Manifest V3, name `Kiroku Note`).
  - **Zero Leakage:** Strictly excluded all 36 test suites, test fixtures, `.md` files, `.git` metadata, temporary files, and development artifacts from the ZIP and unpacked distribution folders.
### Windows Inno Setup Installer Packaging (V1.0.0)
- **Artifacts Delivered:**
  - `installer/kiroku_setup.iss`: Inno Setup 6 compilation script creating 64-bit per-machine installer `Kiroku-Note-Setup-v1.0.0.exe`.
  - `installer/extension_instructions.txt`: Clear user instructions on how to load the unpacked Chromium extension from `{app}\extension`.
  - `release/build-installer.ps1`: Automated PowerShell script to validate payload, audit user-data exclusion, locate `ISCC.exe`, and build installer.
  - `backend/tests/test_installer_config.py`: Automated static and configuration test suite for the installer script.
- **Key Architectural Decisions & User Data Safety:**
  - **Installation Layout:** Installs `KirokuNote.exe`, the complete `extension/` runtime directory, and `extension_instructions.txt` to `{autopf}\Kiroku Note\` (`C:\Program Files\Kiroku Note\`).
  - **Zero User-Data Tampering:** User database (`kiroku.db`), media, and logs reside strictly in `%LOCALAPPDATA%\KirokuNote\` and are never bundled, overwritten, or deleted by installation, updates, or uninstalls.
  - **Extension Stability:** Installs extension to fixed `{app}\extension` folder so updates overwrite runtime code in-place without invalidating browser extension IDs or requiring users to locate new random folders.
  - **Start Menu & Shortcuts:** Creates Start Menu shortcuts for `Kiroku Note`, `Extension Setup Instructions`, `Open Extension Folder`, and Windows uninstaller, with optional Desktop shortcut.
  - **Zero Backend/Extension Interference:** Unmodified backend executable (`KirokuNote.exe`, 49.76 MB) and extension packaging (`dist/extension/unpacked/`).
- **Verification:**
  - 290/290 backend pytest tests passing (`python -m pytest tests` in `backend/`), including 5/5 dedicated `test_installer_config.py` tests.
### Phase 2 OCR Service Boundary & Standalone Daemon (V2 Milestone)
- **Artifacts Delivered:**
  - `backend/app/services/ocr_service.py`: Encapsulated core backend service boundary (`OcrService`) for OCR daemon discovery, health checking, request forwarding, and response normalization.
  - `backend/app/main.py`: Backend gateway endpoints `GET /api/ocr/status` and `POST /api/ocr/recognize` proxying requests to the daemon and returning normalized provider-neutral responses.
  - `backend/app/config.py`: Centralized OCR daemon configuration (`DEFAULT_OCR_HOST = "127.0.0.1"`, `DEFAULT_OCR_PORT = 21829`, `resolve_ocr_url()`, `resolve_ocr_port()`).
  - `backend/app/schemas.py`: Pydantic validation schemas (`OcrStatusResponse`, `OcrRecognizeRequest`, `OcrRecognizeResponse`).
  - `ocr_server/server.py`: Standalone local OCR HTTP daemon with FastAPI/Uvicorn binding strictly to `127.0.0.1:21829`, featuring lazy CPU-only `manga-ocr` loading on first inference request.
- **Key Architectural Decisions & Dependency Isolation:**
  - **Zero Dependency Leakage:** `torch`, `transformers`, and `manga-ocr` are strictly excluded from the core Kiroku backend dependencies (`backend/requirements.txt`).
  - **Process Crash Isolation:** If the OCR daemon crashes, encounters OOM, or is not running, the core backend handles it safely with 503/504 errors without crashing or compromising database/Anki operations.
  - **Extension Decoupling:** The browser extension communicates exclusively with Kiroku on port `21828` and never directly with port `21829`.
  - **Lazy CPU Inference:** `manga-ocr` model weights are loaded on the first recognition request rather than at server startup.
- **Verification:**
  - 325/325 backend pytest tests passing (`python -m pytest tests` in `backend/`), including:
    - 6/6 OCR config and schemas tests (`test_ocr_config_and_schemas.py`)
    - 14/14 OcrService boundary tests (`test_ocr_service.py`)
    - 9/9 FastAPI OCR gateway route tests (`test_ocr_api.py`)
    - 5/5 Standalone OCR daemon tests (`test_ocr_daemon.py`)
    - 1/1 Live end-to-end OCR pipeline test (`test_ocr_integration.py`)
  - 39/39 extension test suites passing (`node --test extension/tests/*.test.js`).

### Phase 3 OCR Capture Pipeline & Extension UI (V2 Milestone)
- **Artifacts Delivered:**
  - `extension/lib/ocr-cropper.js`: Dedicated OCR image cropper computing coordinate normalization, 4-directional drag bounds, High-DPI/OS display scaling (`window.devicePixelRatio`, zoom), coordinate clamping, and canvas-based cropping.
  - `extension/content/ocr-selection.js`: Content script overlay creating an interactive region selection UI (`#kiroku-ocr-overlay`, `#kiroku-ocr-selection-box`) with mouse drag, live dimensions badge, Escape cancellation, minimum dimension guard (5px), and clean DOM teardown.
  - `extension/manifest.json`: Content script registration for `extension/lib/ocr-cropper.js` and `extension/content/ocr-selection.js`.
  - `extension/background.js`: Routing handler for `START_OCR_CAPTURE`, `OCR_REGION_SELECTED` (orchestrating `chrome.tabs.captureVisibleTab`), and `OCR_SELECTION_CANCELLED`.
  - `extension/sidepanel/sidepanel.html`: Added `#indicator-ocr` service connection indicator and `#ocr-capture-btn` in Text Mining controls.
  - `extension/sidepanel/sidepanel.css`: Added `.btn-ocr` button styles and focus states adhering to Obsidian dark theme tokens.
  - `extension/sidepanel/sidepanel.js`: Added `checkOcrStatus()`, `handleOcrCropProcess()`, and direct forwarding of recognized Japanese text into the canonical `identify(text)` Yomitan/card creation pipeline.
  - `extension/tests/ocr-cropper.test.js`: Unit tests for OCR cropper math and coordinate transformations.
  - `extension/tests/ocr-selection.test.js`: Unit tests for region selection overlay, event handling, and cancellation.
  - `extension/tests/ocr-background-routing.test.js`: Unit tests for background script message routing and screenshot capture.
  - `extension/tests/ocr-sidepanel-integration.test.js`: Integration tests for Side Panel OCR button, status checks, crop handling, `identify()` forwarding, and error states.
- **Key Architectural Decisions & Pipeline Integration:**
  - **Single Input Source Invariant:** OCR is purely an input source. Recognized text is forwarded directly into `identify(text)`; zero custom card editors, duplicate dictionary paths, or separate OCR history were created.
  - **High-DPI Coordinate Normalization:** Computes scale factors `imgNaturalWidth / viewportWidth` and `imgNaturalHeight / viewportHeight` to reliably map CSS viewport selection coordinates to screenshot image pixels across 100%, 125%, 150%, 200% DPI and browser zoom levels.
  - **Video Frame Cropper Isolation:** `extension/lib/image-cropper.js` remains 100% untouched and reserved exclusively for video frame mining.
  - **Media Attachment:** Cropped image snippet is attached to `currentDraftMedia.imageBase64` so it populates the card image preview and Anki note payload automatically.
  - **Graceful Error Handling:** Handled OCR daemon offline (503), timeout (504), invalid crops (400), empty OCR results, and user cancellation without exposing raw stack traces.
- **Verification:**
  - 325/325 backend pytest tests passing (`python -m pytest tests` in `backend/`).
  - 43/43 extension test suites passing (`node --test extension/tests/*.test.js`).

### Phase 4 OCR Packaging & Process Management (V2 Milestone)
- **Artifacts Delivered:**
  - `backend/app/services/ocr_process_manager.py`: Safe singleton process manager handling installation discovery, non-blocking subprocess startup with bounded timeouts, failure cooldowns (preventing restart loops), and automatic shutdown cleanup.
  - `backend/app/config.py`: Added `resolve_ocr_exe_path()` and `get_ocr_model_dir()` for robust discovery across frozen (`{app}\ocr\`), local app data (`%LOCALAPPDATA%\KirokuNote\ocr\`), and development directory layouts.
  - `backend/app/services/ocr_service.py`: Updated `OcrService` to make `GET /api/ocr/status` strictly observational while providing a controlled, single startup attempt on `POST /api/ocr/recognize` if installed and offline.
  - `backend/app/main.py`: Updated FastAPI `lifespan` context manager to trigger optional initial startup if installed, and ensure guaranteed child process termination on backend shutdown.
  - `packaging/kiroku_ocr.spec`: Dedicated standalone PyInstaller `onedir` specification targeting CPU-only PyTorch, Hugging Face `transformers`, `manga-ocr`, and morphological tokenizers with explicit CUDA/GPU and user-data exclusions.
  - `installer/kiroku_ocr_setup.iss`: Standalone Inno Setup 6 addon installer script creating `Kiroku-Note-OCR-Setup-v1.0.0.exe` targeting `{app}\ocr\` without touching user data or core files.
  - `release/build-ocr.ps1`: Automated PowerShell script to compile standalone `KirokuOCR.exe` with CPU-only PyTorch and environment validation.
  - `release/build-ocr-installer.ps1`: Automated PowerShell script to compile the Inno Setup addon installer.
  - `backend/tests/test_ocr_process_manager.py`: Dedicated unit tests covering absent/present executable detection, mocked subprocess startup, health-check timeouts, cooldown throttling, and controlled startup.
  - `backend/tests/test_ocr_packaging_config.py`: Static configuration tests verifying zero leaks of user databases/media, strict CPU-only exclusions, and 64-bit architecture constraints.
- **Key Architectural Decisions & User Isolation:**
  - **Strict Observational Status:** `GET /api/ocr/status` does not spawn processes or cause heavy side effects.
  - **Zero Dependency Leakage:** `torch`, `transformers`, and `manga-ocr` remain 100% excluded from `backend/requirements.txt` and core `KirokuNote.exe`.
  - **CPU-Only PyTorch Optimization:** Prescribes official PyTorch CPU wheel (`torch --index-url https://download.pytorch.org/whl/cpu`) eliminating >2.5 GB of redundant NVIDIA/CUDA runtime binaries.
  - **Safe Process Lifecycle:** Uses bounded timeouts (5.0s), failure threshold (3 attempts), and 10s cooldown to strictly prevent CPU thrashing or restart loops.
- **Verification:**
### Phase 5 OCR Build & Runtime Verification (V2 Milestone)
- **Status Summary:**
  - ✅ **Isolated Build Environment:** Dedicated `.venv-ocr/` environment configured with Python 3.11.1 x64, CPU-only PyTorch `2.14.0+cpu` (from `https://download.pytorch.org/whl/cpu`), `torchvision 0.29.0+cpu`, `transformers 5.17.0`, `manga-ocr 0.1.16`, `fugashi 1.5.2`, and `unidic-lite 1.0.8`.
  - ✅ **Zero CUDA / GPU Leakage:** Confirmed `torch.cuda.is_available() == False` with 0 CUDA/NVIDIA runtime binaries bundled.
  - ✅ **Offline Model Verification:** Pre-packaged model directory (`dist/ocr/models/manga-ocr-base/`, 423.66 MB) verified with `TRANSFORMERS_OFFLINE=1` and `HF_HUB_OFFLINE=1`.
  - ✅ **Direct Daemon Runtime Verified:** `ocr_server/server.py` daemon bound strictly to `127.0.0.1:21829`. Verified:
    - Lazy loading on first inference request (initial `/health` reported `model_loaded: false`, first `/recognize` loaded model and returned `278.54ms`, subsequent `/health` reported `model_loaded: true`).
    - Real Japanese text inference verified: `"日本語の勉強"` -> `"日本語の勉強"`, `"魔法少女まどか"` -> `"魔法少女まどか"`, `"記録ノート"` -> `"記録ノート"`.
  - ✅ **Core Backend Gateway Integration Verified:** Full end-to-end flow tested:
    - Extension / Client -> Core FastAPI (`127.0.0.1:21828`) `/api/ocr/status` and `/api/ocr/recognize` -> `OcrService` -> Standalone Daemon (`127.0.0.1:21829`) -> `manga-ocr`.
    - Real Japanese image recognition (`"約束のネバーランド"`) returned `"約束のネバーラン"` in `342.91ms`.
    - Text forwarding into canonical card capture (`POST /api/capture`) verified.
  - ✅ **Failure Mode & Isolation Verification:**
    - Daemon offline / stopped: Core backend remains 100% operational; `/api/ocr/status` reports `available: false` with graceful error message without throwing unhandled exceptions.
    - User data isolation: SQLite database (`ankiminer.db`) and card library unaffected.
  - ❌ **Installer Build Deferred:** `ISCC.exe` unavailable in current environment; `installer/kiroku_ocr_setup.iss` statically validated and ready for build machines with Inno Setup.
- **Size Metrics:**
  - `Kiroku Core (KirokuNote.exe)`: ~49.76 MB
  - `KirokuOCR Onedir Package`: ~792.41 MB (uncompressed)
  - `manga-ocr Model Directory`: ~423.66 MB (uncompressed)
  - `Total OCR Add-on (Uncompressed)`: ~1216.07 MB (~1.19 GB)
  - Largest dependencies: `torch` (359.18 MB), `unidic_lite` (248.40 MB), `transformers` (38.62 MB), `numpy.libs` (20.02 MB), `PIL` (12.80 MB).
- **Automated Regression Test Results:**
  - Backend: **337/337 passed** (`python -m pytest tests` in `backend/`).
  - Extension: **43/43 suites passed** (`node --test extension/tests/*.test.js`).
### Phase 6 OCR Workflow & Side Panel UI Polish (V2 Milestone)
- **Status Summary:**
  - ✅ **API Contract & Schema Alignment:** Fixed `sidepanel.js` `handleOcrCropProcess` payload contract to send `{ image: croppedDataUrl }` matching FastAPI `OcrRecognizeRequest` schema (eliminating 422 Unprocessable Entity failure).
  - ✅ **Model Load State Synchronization:** Fixed `checkOcrStatus()` property mapping from `data.loaded` to `data.model_loaded` returned by `/api/ocr/status`, accurately reflecting model load status in memory.
  - ✅ **6-State OCR UX Hierarchy:** Enhanced `#indicator-ocr` badge states to cleanly distinguish:
    1. *OCR Not Installed* (`installed: false`, `available: false` -> `.indicator-pill.unavailable`, tooltip `"OCR: Not installed"`)
    2. *OCR Offline* (`installed: true`, `available: false` -> `.indicator-pill.unavailable`, tooltip `"OCR: Offline"`)
    3. *OCR Ready (Idle)* (`available: true`, `model_loaded: false` -> `.indicator-pill.connected`, tooltip `"OCR: Ready (Idle)"`)
    4. *OCR Ready (Loaded)* (`available: true`, `model_loaded: true` -> `.indicator-pill.connected`, tooltip `"OCR: Ready (Loaded)"`)
    5. *OCR Processing* (in-flight -> `.indicator-pill.checking`, tooltip `"OCR: Processing…"`)
    6. *OCR Error* (fault/timeout -> `.indicator-pill.error`, tooltip with diagnostic details)
  - ✅ **Visual Design Integration:** Added `.indicator-pill.error` styles and high-contrast focus/error rings adhering to Obsidian dark theme tokens in `sidepanel.css`.
  - ✅ **High-DPI Coordinate Normalization:** Updated `KirokuOcrCropper.calculateOcrCropBounds` and `handleOcrCropProcess` to support both `left`/`top` and `x`/`y`, and `innerWidth`/`width` and `innerHeight`/`height` across 100%, 125%, 150%, 200% DPI and browser zoom levels.
  - ✅ **Canonical Card Mining Path Verified:** Verified end-to-end flow:
    `User selects region -> Crop screenshot -> POST /api/ocr/recognize -> OCR text -> user inspects/corrects in Expression field -> POST /api/capture -> Yomitan enrichment -> card draft (with attached image snippet) -> SQLite -> Anki sync`.
  - ✅ **Error Edge Cases Verified:** Handled uninstalled daemon, offline daemon, daemon timeouts (504), daemon errors (502), invalid base64 (400), empty OCR results, small regions (< 5px), screen-edge selections, and Escape cancellation without corrupting active card drafts or database state.
- **Automated Regression Test Results:**
  - Backend: **348/348 passed** (`python -m pytest tests` in `backend/`), including 11/11 dedicated `test_phase6_ocr_code_runtime.py` tests.
  - Extension: **44/44 suites passed** (`node --test extension/tests/*.test.js`), including new dedicated `ocr-phase6-workflow.test.js`.
- **Core Invariants Preserved:**
  - OCR is purely an input source to `POST /api/capture`; zero duplicate editors, secondary dictionary engines, or separate OCR databases.
  - Backend remains 100% independent of heavy ML libraries (`torch`, `transformers`, `manga-ocr`).
  - Core database and Anki operations remain 100% available when OCR is offline.

### Phase 7 Subtitle Acquisition & Multi-Site Mining Polish (V2 Milestone)
- **Status Summary:**
  - ✅ **ASS / SSA Subtitle Parser (`extension/lib/subtitle-parser.js`):**
    - Implemented native `parseASS(text)` supporting both Advanced SubStation Alpha (ASS v4.00+) and SubStation Alpha (SSA v4.00).
    - Added parsing of `[Events]` header Format descriptors (supporting variable field order for `Start`, `End`, `Text`), timestamp parsing (`H:MM:SS.cc` to milliseconds), and newline conversion (`\N`, `\n`).
    - Added auto-format detection sniffing `[Script Info]`, `[Events]`, `WEBVTT`, or SRT numeric sequence counters.
  - ✅ **Subtitle Normalizer & Clean-up Pipeline:**
    - `stripASSTags(text)`: Strips all ASS style/override tags (`{\pos(x,y)}`, `{\an8}`, `{\fad(100,200)}`, `{\c&HFFFFFF&}`, etc.) and drawing commands.
    - `stripSpeakerLabel(text)`: Intelligently strips character speaker prefixes (e.g., `山田:`, `エレン：`, `[Narrator]`, `(Alice)`) while strictly preserving Japanese kanji words with colons like `日本語:勉強` or URLs.
    - `cleanCueText(text)`: Robust pipeline executing ASS strip -> HTML/VTT tag strip -> positioning tag strip (`\b(?:align|size|position|line|vertical):[0-9a-zA-Z%,.-]+`) -> speaker prefix strip -> whitespace collapse.
    - `normalizeCues(cues)`: Cleans all cue texts, collapses consecutive duplicates with identical text into a single extended cue duration, and discards zero-duration or empty cues.
  - ✅ **Provider-Agnostic Subtitle Architecture (`extension/lib/subtitle-provider.js`):**
    - `BaseSubtitleProvider`: Base class defining `name`, `getTracks()`, `loadTrack(trackId)`, and `isAvailable()`.
    - `LocalFileSubtitleProvider`: Handles user-selected or dropped files (`.srt`, `.vtt`, `.ass`, `.ssa`).
    - `YouTubeSubtitleProvider`: Extracts native and auto-translated Japanese caption tracks directly from YouTube player config and SRV3 endpoints.
    - `NetflixSubtitleProvider`: Intercepts live `timedtext` streams from Netflix web players without DRM interference.
    - `SubtitleProviderRegistry`: Discovers and registers active providers, aggregating available tracks across sources.
  - ✅ **Community Anime Subtitle Integration (`extension/lib/jimaku-provider.js`):**
    - Implemented `JimakuSubtitleProvider` providing anime subtitle search and direct download from `https://jimaku.cc/api/*`.
    - Secure key management: API key stored purely in user's `chrome.storage.local`.
    - Background fetch guard: `extension/background.js` enforces HTTPS only, strictly checks `isAllowedJimakuUrl` against loopback/private IPs (SSRF protection), and proxies requests to avoid CORS.
  - ✅ **Side Panel UI Integration (`extension/sidepanel/`):**
    - Updated file selector to `accept=".srt,.vtt,.ass,.ssa"`.
    - Added "Search Subtitles" button opening modal dialog for Jimaku anime title search.
    - Added Jimaku search modal with anime entry results, file listings, downloading status, and API key management modal with Obsidian dark theme styling.
    - Wired subtitle loading and normalization into Video Mining POC drag-and-drop and manual file picker.
  - ✅ **Canonical Capture Pipeline Preserved:**
    - Subtitle cues feed directly into standard `POST /api/capture` via video overlay hover/click or Side Panel selection.
    - Zero duplicate card editors, custom dictionaries, or separate subtitle databases.
- **Automated Regression Test Results:**
  - Backend: **348/348 passed** (`python -m pytest tests` in `backend/`).
  - Extension: **68/68 passed** (`node --test extension/tests/*.test.js`), including 6 new Phase 7 test suites:
    - `ass-parser.test.js` (4/4)
    - `subtitle-normalizer.test.js` (4/4)
    - `subtitle-providers.test.js` (4/4)
    - `jimaku-provider.test.js` (5/5)
    - `sidepanel-subtitles-ui.test.js` (2/2)
    - `phase7-subtitle-polish.test.js` (5/5)

### Phase 7.5 OCR Development Daemon Diagnosis, Cleanup & Runner
- **Status Summary:**
  - ✅ **Root Cause Diagnosed:**
    - The persistent `manga-ocr import error: No module named 'torch.distributed'` (HTTP 503) was caused by a stale background instance of the packaged `dist/ocr/KirokuOCR/KirokuOCR.exe` (PID 5872) listening on port 21829.
    - Status `/health` and `/api/ocr/status` showed `available: true` / green because `is_available()` only checked if `import manga_ocr` succeeded, but full inference lazily triggers `from manga_ocr import MangaOcr` which requires `torch.distributed`. Because PyInstaller failed to package `torch.distributed` in the old EXE build, recognition failed with 503 while health checks passed.
    - When the daemon was offline, `OcrProcessManager` previously fell back to searching `dist/ocr/KirokuOCR/KirokuOCR.exe`, automatically respawning the broken packaged EXE.
  - ✅ **Cleaned Obsolete Packaged OCR Builds:**
    - Stopped and killed the rogue `KirokuOCR.exe` process (PID 5872).
    - Permanently deleted generated build outputs: `dist/KirokuOCR/`, `dist/ocr/KirokuOCR/`, `build/kiroku_ocr/`, and `build/ocr/`.
    - Preserved offline model weights at `dist/ocr/models/manga-ocr-base`.
    - Confirmed zero remaining `KirokuOCR.exe` binaries in `dist/` or `build/`.
  - ✅ **Direct Development Environment Verification:**
    - Verified `.venv-ocr\Scripts\python.exe` (Python 3.11.1) contains working `torch 2.14.0+cpu`, `torch.distributed` (`<module 'torch.distributed'>`), `manga-ocr 0.1.16`, `transformers 5.17.0`, `fugashi 1.5.2`, and `unidic-lite 1.0.8`.
  - ✅ **Smallest Development-Only Process Manager Adjustment:**
    - Added `resolve_ocr_dev_command()` in `backend/app/config.py` so in development mode (when no packaged EXE exists), `OcrProcessManager` seamlessly detects and spawns `run_ocr.py` using `.venv-ocr` python.
    - Updated `OcrProcessManager.is_installed()` and `OcrProcessManager.start()` in `backend/app/services/ocr_process_manager.py` to support development runner execution.
  - ✅ **End-to-End Verification:**
    - `run_ocr.py` running on `http://127.0.0.1:21829` (CPU-only, lazy-loading).
    - Direct `GET http://127.0.0.1:21829/health` -> `status: ok, engine: manga-ocr, device: cpu, model_loaded: false, installed: true`.
    - Direct `POST http://127.0.0.1:21829/recognize` -> HTTP 200, recognized text returned in ~287ms with `model_loaded: true`.
    - Core Backend `GET http://127.0.0.1:21828/api/ocr/status` -> `available: true, installed: true, engine: manga-ocr, device: cpu, model_loaded: true`.
    - Core Backend `POST http://127.0.0.1:21828/api/ocr/recognize` -> HTTP 200, successful recognition piped through backend.
    - Extension UI workflow verified via integration tests (`ocr-sidepanel-integration.test.js`, `ocr-phase6-workflow.test.js`).
- **Automated Test Results:**
  - Backend OCR tests: **41/41 passed** (`test_ocr_process_manager.py`, `test_ocr_api.py`, `test_ocr_service.py`, `test_ocr_daemon.py`, `test_ocr_config_and_schemas.py`).
  - Extension OCR tests: **All passed**.

### Phase 7.6 Jimaku Subtitle Download Fix & Subtitle Directory Selector
- **Status Summary:**
  - ✅ **Jimaku "DOWNLOAD INVALID URL" Fix (`extension/background.js`, `extension/lib/jimaku-provider.js`):**
    - Corrected URL validation in `isAllowedJimakuUrl` to resolve relative API paths (e.g. `/files/123/download`, `/api/entries/123/files`) against `https://jimaku.cc` and allow all legitimate HTTPS subtitle download endpoints (including direct storage/CDN links).
    - Preserved strict SSRF loopback and private IP protections (`localhost`, `127.0.0.1`, `::1`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`).
    - Added `resolveJimakuUrl` normalization helper to ensure well-formed absolute URLs before initiating network requests.
    - Preserved raw subtitle file text (`rawText`) in track data for direct local saving.
  - ✅ **Dedicated Subtitle Directory Selector & Quick Dropdown (`extension/sidepanel/`):**
    - Added "📁 Folder" button (`#btn-select-subtitles-folder`) with HTML5 directory picker (`#subtitles-dir-input`).
    - Added subtitle directory quick selector (`#folder-subtitles-select`) listing all available `.srt`, `.vtt`, `.ass`, and `.ssa` subtitle files found in the chosen folder.
    - Persistent folder memory: Remembers chosen subtitle folder across sessions and allows switching between subtitle files with a single click.
  - ✅ **Jimaku Subtitle Auto-Save Destination Option:**
    - Added "Download Subfolder / Destination" setting (`#jimaku-download-folder-input`, default: `KirokuSubtitles`) in Jimaku Search modal.
    - Added "Auto-save downloaded subtitles to folder" toggle (`#toggle-save-subtitle-disk`).
    - Automatically saves downloaded Jimaku subtitle files to the designated local subfolder on disk and dynamically indexes them in the quick folder dropdown.
### Phase 7.7 Dictionary Pipeline & Side Panel UI Polish
- **Status Summary:**
  - ✅ **Fix 1 — Outermost AST Cross-Reference Extraction (`backend/app/services/yomitan.py`, `backend/app/schemas.py`):**
    - Added `CrossReference` schema and `cross_references: list[CrossReference]` to `Sense` and `DictionarySense` with 100% field parity.
    - Implemented `_find_outer_marked`, `_extract_cross_reference`, and `_unique_cross_references` capturing target term, ruby reading, label, and gloss summary from outer AST nodes (`content: xref`).
    - Cleaned `notes` to only capture `("note", "sense-note")`, eliminating duplicate text fragments.
  - ✅ **Fix 2 — Default Meaning Sense Deduplication (`backend/app/services/card_service.py`):**
    - In `synthesize_default_meaning`, added order-independent gloss set deduplication (`seen_gloss_sets`), skipping duplicate senses across entries.
  - ✅ **Fix 3 — Live Card Preview Meaning Field Priority & Reference Exemption (`extension/sidepanel/sidepanel.js`):**
    - Inverted `renderPreviewMeanings` to prioritize user-edited `data.meaning` over raw entries summary.
    - Excluded kanji reference blocks from live Card Preview (`#card-preview-card`), preserving kanji info strictly in Study View.
  - ✅ **Fix 4 — Consolidated Kanji Card Renderers (`extension/sidepanel/sidepanel.js`):**
    - Unified `renderPreviewKanjiCard` and `renderKanjiCard` into `renderKanjiCard(kanji, options = { mode: "full", isProminent: false })` supporting `mode: "compact"` and `mode: "full"` with backward compatibility for boolean flag.
  - ✅ **Fix 5 — Retired Full Dict Separate View (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.js`):**
    - Removed `#btn-toggle-full-dict` and `#dict-raw-view` container and raw rendering loop while preserving `formatRawDictionaryText` for `#btn-copy-raw-dict`.
  - ✅ **Fix 6 — Cross-Reference Chips with Draft-Safety (`extension/sidepanel/sidepanel.js`, `extension/sidepanel/sidepanel.css`):**
    - Rendered clean `.study-xref-chip` clickable chips per `cross_reference`.
    - Implemented draft dirty protection: clean drafts trigger immediate lookup, while unsaved/dirty drafts require 2-click `.confirm-replace` confirmation before replacing card editor content with `identify(target_term)`.
- **Verification Results:**
  - Backend test suite: **352/352 passed** (`python -m pytest -o pythonpath=backend backend/tests`).
  - Extension test suite: **73/73 passed** (`node --test extension/tests/*.test.js`).
  - Real capture verified on `合` AST.

### Phase 7.8 Side Panel Card Editor De-claustrophobing, Top Action Bar & Smart Collapsible Media Previews
- **Status Summary:**
  - ✅ **Moved Save Card & Sync Actions to Top (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`):**
    - Repositioned `.editor-actions` from bottom of form to a sticky, elevated top action bar (`.editor-actions.editor-actions-top`) directly beneath the Card header.
    - Features a 2-column action bar with primary `Save Card` button (`#save-card-btn`) and secondary `Send to Anki` (`#sync-anki-btn`) with right-aligned Anki status pill (`#anki-sync-status`).
    - Pinned with `position: sticky; top: 0; backdrop-filter: blur(12px)` so saving a mined card is always 1 click away without scrolling down past long fields and media.
  - ✅ **Collapsible & Context-Aware Media Previews (`extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.js`, `extension/sidepanel/sidepanel.css`):**
    - Wrapped `#media-preview-container` in `<details id="media-preview-collapsible">` with summary indicator and state badge (`#media-summary-badge`).
    - Smart auto-collapse: In regular text/image vocabulary mining when no frame or audio is captured, media is collapsed to a 28px header, eliminating broken image icons and "Waiting for playback..." clutter.
    - Smart auto-expand: Whenever a screenshot frame is captured or audio is recorded, `updateMediaPreviews()` automatically expands the details element (`open = true`) and updates badge ("Image", "Audio", "Image + Audio", "Recording…").
    - Single-media mode: When only an image is present, `.single-media` automatically expands the image preview to full container width and suppresses the empty audio card companion.
    - Fixed Chromium broken image rendering: Added `style="display: none;"` and `.media-thumbnail[hidden] { display: none !important; }` with empty alt text when hidden.
    - Reordering contract preserved: Preserved `data-layout-section="media"` on the wrapper so the layout settings drag-and-drop / accessible up-down reorderer remains completely intact.
  - ✅ **De-Claustrophobic UI & Refined Spacing (`extension/sidepanel/sidepanel.css`):**
    - Added custom sleek, minimalist dark scrollbars (`::-webkit-scrollbar { width: 6px; }`).
    - De-nested Card Preview: Replaced claustrophobic triple-box borders with smooth surface hierarchy and generous padding (`padding: 14px 16px`).
    - Expanded Card Editor form inputs: Increased height to 38px, padding to `8px 11px`, border-radius to 6px (`var(--radius-md)`), and added soft glow focus rings (`outline: 2px solid rgba(217, 119, 87, 0.35)`).
    - Increased textarea comfortable height to 60px with `1.5` line-height.
- **Verification Results:**
  - Extension test suite: **73/73 passed** (`node --test extension/tests/*.test.js`).
  - Backend test suite: **352/352 passed** (`python -m pytest -o pythonpath=backend backend/tests`).

### Phase 7.9 Side Panel Card Template Settings, Authoritative Front/Back Preview Semantics & Media Pipeline Decoupling
- **Status Summary:**
  - ✅ **Authoritative Single Source of Truth for Front/Back Card Configuration:**
    - Default Front renders **only the Japanese expression** (e.g. `計画`), eliminating the bracketed reading mismatch (`計画 [けいかく]`).
    - Standardized `card_settings` across schemas (`SaveCardRequest`, `SaveCardResponse`), repositories (`CardRecord`, `CardDraft`, SQLite `meanings_json` embedding), services (`CardService`), and Anki mappers (`map_card_to_fields`, `format_basic_back`).
    - Verified strict separation of Word Reading (`reading`: expression reading) and Kanji Reading (on'yomi/kun'yomi from `kanji_entries`), preventing duplicate reading fields.
  - ✅ **Card Settings Modal / Popover (`extension/sidepanel/`):**
    - Repurposed the gear icon beside `CARD` (`#btn-layout-settings`) into a real Card Settings control.
    - Added Japanese font selection inside Card Settings (`#field-font-select`), removing per-card repetitive font switching from the main editor flow.
    - Added checkboxes for Front Side (`Show reading`, `Show meaning`, `Show kanji reading`) and Back Side (`Show reading`, `Show meaning`).
    - Stored settings persistently in `chrome.storage.local` under `kiroku.card_template_settings`.
  - ✅ **Exact DOM Preview & Anki Output Parity:**
    - Updated `renderCardPreviewDOM` and `map_card_to_fields` to share exact CSS classes (`.kn-front-expression`, `.kn-front-reading`, `.kn-front-kanji-reading`, `.kn-front-meaning`, `.kn-reading`, `.kn-kana`, `.kn-meaning`).
    - Rendered kanji cards on Back side preview matching `format_basic_back` for isolated single-kanji and vocabulary cards.
  - ✅ **Clean Decoupling & Removal of Visible Media Controls in Editor:**
    - Removed visible media controls and empty placeholders/spacers from the card editor flow (`#media-preview-collapsible` hidden with `display: none !important;`).
    - Fully preserved `currentDraftMedia` and automatic OCR image attachment, video frame screenshot capture, and sentence audio recording pipeline without alteration.
  - ✅ **Compact Sticky Action Toolbar:**
    - Sleek single-row sticky toolbar sitting flush (`margin: -14px -16px 8px -16px; padding: 8px 16px`) with primary `Save Card` and secondary `Send to Anki` (`min-height: 34px`).
    - Added `scroll-margin-top: 54px` across editor sections ensuring sticky controls never obscure editor fields when scrolling or focusing.
  - ✅ **Dense Reference-Oriented Dictionary View:**
    - Refined `.study-entry` padding (`8px 10px`) and margin (`8px`) with subtle borders for a clean, reference-first reading experience.
- **Verification Results:**
  - Extension test suite: **73/73 passed** (`node --test extension/tests/*.test.js`).
  - Backend test suite: **353/353 passed** (`python -m pytest -o pythonpath=backend backend/tests`).
  - End-to-end setting matrix verified: All combinations of Front (expression only, +reading, +kanji reading, +meaning, all enabled) and Back (+reading, +meaning, suppress reading, suppress meaning, suppress both) tested for exact output parity between Anki Basic model mapping and Kiroku Preview.

### Phase 7.10 Modern JLPT (N5–N1) Feature & Deprecated Old Scale Removal
- **Status Summary:**
  - ✅ **OpenJLPT SQLite Bundled Reference (`backend/app/data/jlpt_reference.sqlite`):**
    - Bundled pre-indexed OpenJLPT SQLite database (8,334 vocabulary entries, 2,211 kanji entries).
    - Added open-source attribution notice at `backend/app/data/JLPT_REFERENCE_NOTICE.md` under CC BY-SA 4.0.
    - Zero external pip/npm dependencies added; queried using Python standard library `sqlite3` via read-only URI mode.
  - ✅ **JlptReferenceService & Yomitan Fallback (`backend/app/services/jlpt_reference.py`, `backend/app/services/yomitan.py`):**
    - Implemented `JlptReferenceService` with fast indexed lookup (`lookup_word` and `lookup_kanji`) and fail-soft error handling.
    - Preserved Yomitan dictionary tags as first priority (`jlpt-n[1-5]`, `n[1-5]`). When absent, seamlessly falls back to `JlptReferenceService`.
  - ✅ **Removal of Deprecated "Old JLPT 1–4" Scale:**
    - Completely removed the pre-2010 4-level scale ("Old JLPT 1-4") from `anki_formatter.py` and `sidepanel.js`.
    - Modern N5–N1 level is now the sole standard across the entire application.
  - ✅ **Prominent JLPT Badge in Card Preview & Synced Anki Card (`sidepanel.js`, `sidepanel.css`, `anki_formatter.py`):**
    - Added prominent `.kn-tag.kn-jlpt` badge rendered directly in `.kn-reading` beside kana reading and pitch accent in both Card Preview and synced Anki cards.
    - Elevated visual weight: bold 700 font weight, 0.82em, subtle cobalt/blue border and background matching design tokens (`var(--accent-jlpt)`).
  - ✅ **Card Template Settings Toggle (`sidepanel.html`, `sidepanel.js`):**
    - Integrated "Show JLPT level" toggle into the existing `#layout-settings-popover` (`#setting-show-jlpt`).
    - Enabled by default (`show_jlpt: true`), persisting locally via `chrome.storage.local` with `localStorage` fallback.
    - When disabled, cleanly suppresses the JLPT badge from Card Preview and generated Anki card HTML.
- **Verification Results:**
  - Backend test suite: **360/360 passed** (`python -m pytest tests` in `backend/`).
  - Extension test suite: **73/73 passed** (`node --test extension/tests/*.test.js`).
  - Unit tests added: `test_jlpt_reference.py`, `test_18_jlpt_historical_vs_modern` updated, `test_21_format_basic_back_jlpt` added, `test_11_map_card_to_fields_jlpt_level_and_toggle` added, and `test 15` in `card-preview.test.js`.
  - Visual verification: Captured screenshots covering Card Preview enabled/disabled, synced Anki card output, and settings popover in both enabled/disabled states.
 
+### Phase 7.10.1 Immediate Hover JLPT Visibility in Card Preview & Dictionary Header
+- **Status Summary:**
+  - ✅ **Automatic Card Preview Update on Word Hover / Identification (`extension/sidepanel/sidepanel.js`):**
+    - Resolved issue where hovering or capturing text programmatically updated input fields but did not fire DOM input events, leaving the Card Preview blank.
+    - Added explicit calls to `updateCardPreview()` and `scheduleCardPreviewUpdate()` inside `identify()` immediately following draft population.
+    - In `getCardPreviewData()`, added robust fallback resolution for `jlpt_level` from `currentDictionaryEntries` tags and `currentKanjiEntries` tags.
+  - ✅ **Prominent Dictionary Section Header Badge (`extension/sidepanel/sidepanel.html`, `sidepanel.css`, `sidepanel.js`):**
+    - Added `#dict-jlpt-badge` directly into the Dictionary section title row (`.dict-title-row`) beside `DICTIONARY`.
+    - Displays the JLPT level (e.g. `JLPT N5`) prominently at the top of the dictionary section the moment a word is hovered, without requiring the user to scroll through definitions.
+    - Enhanced `.pill-jlpt` styling on dictionary entries with bold font weight, 11px size, and `var(--accent-jlpt)` cobalt badge styling.
+    - If Yomitan returns 0 definitions or is disconnected, but a JLPT level is resolved from the offline reference, renders a clean banner in `#dict-empty-notice` displaying the JLPT badge.
+- **Verification Results:**
+  - Extension test suite: **73/73 passed** (`node --test extension/tests/*.test.js`).
+  - Backend test suite: **360/360 passed** (`python -m pytest tests` in `backend/`).
+  - Visual verification screenshot captured (`shot_hover_views.png`) confirming prominent JLPT badge display in both Dictionary View header and Card Preview on hover.
