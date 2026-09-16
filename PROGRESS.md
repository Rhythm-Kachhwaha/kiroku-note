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
- [ ] Stage 3B.2.2: CardService multi-dictionary integration & JLPT resolution handoff
- [ ] Stage 3B.3: Side Panel declarative dictionary rendering & UI
  - [x] Stage 3B.3.1a: Structured Dictionary Study View Renderer (`renderDetails`, sense-bound POS/tags, pitch, freq, JLPT, ruby markup)
  - [x] Stage 3B.3.1b: Quick-Insert Actions & Progressive Disclosure Accordions (`insertSenseToMeaning`, `insertExampleToCard`, senses overflow accordion)
  - [x] Stage 3B.3.2: Side Panel Design System & Visual Polish (Precision Dark Utility tokens, typography, spacing, surfaces, borders, buttons, inputs, badges)
- [x] Stage 3B.4: Multi-dictionary presentation polish & Anki template alignment (`V1/Stage3B.4.md`)
  - [x] Step 1: Persist structured dictionary entries (`SaveCardRequest.entries` -> `CardDraft.entries` -> SQLite `meanings_json` -> `openSavedCard` restoration)
  - [x] Step 2: Dedicated AnkiFormatter service (`app.services.anki_formatter`: meaning, ruby, example, basic back, media sanitization)
  - [x] Step 3: AnkiConnect field mapping integration (`map_card_to_fields` + `sync_card` consuming `AnkiFormatter`, preserving keyword matrix)
  - [x] Step 4: Final regression, multi-model verification & live AnkiConnect testing (212/212 backend tests passed, 27/27 extension suites passed)


### Stage 4 — Frontend

- [x] Redesign Side Panel UI (Precision Dark Utility design system)
- [x] Improve typography (Noto Sans JP priority, reading accent, CJK word break, monospace data)
- [x] Improve layout and spacing (4px micro-spacing scale, surface hierarchy, zero overflow)
- [x] Improve card editor (token-based inputs, high-contrast focus rings, refined media previews)
- [x] Improve responsive behavior (320px, 400px, 600px width support)
- [x] Preserve existing extension behavior and DOM contracts (100% test compatibility)

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

- [ ] Local API security review
- [ ] Input validation review
- [ ] Extension permission review
- [ ] Error handling review
- [ ] Persistence/migration review

### Stage 8 — Documentation

- [ ] Finalize README
- [ ] Finalize architecture documentation
- [ ] Create current UI specification
- [ ] Clean remaining documentation
- [ ] Ensure archived reports remain outside active documentation

### Stage 9 — Release Harness

- [ ] Production configuration
- [ ] Extension packaging
- [ ] Backend launcher
- [ ] Clean-machine testing
- [ ] Versioning
- [ ] Release checks

### Stage 10 — Windows Distribution

- [ ] Build easy-to-use Windows package
- [ ] Package backend/launcher
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