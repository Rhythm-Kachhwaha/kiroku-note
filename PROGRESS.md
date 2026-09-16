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

- [ ] Improve card preview
- [ ] Improve generated Anki HTML
- [ ] Improve default card template
- [ ] Improve media presentation
- [ ] Verify compatibility with custom Anki note models

### Stage 6 — UX & Accessibility

- [ ] Keyboard workflow review
- [ ] Accessibility review
- [ ] Error/loading states
- [ ] Empty states
- [ ] First-run experience
- [ ] Settings and preferences review

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