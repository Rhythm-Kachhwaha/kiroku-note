# Kiroku Note Desktop — Design Specification & Stitch Screen Registry

> **Status:** Phase 2 Complete — Stitch Screens Generated & Verified  
> **Target Project:** `Kiroku dekstop` (`projectId: 13699270005564697754`)  
> **Design System:** `Sumi & Washi Neo-Tactile` (`assets/d6a689e6b3a34faaa610b51ae03c99cf`)  
> **Source Brief:** [`stitch.md`](file:///d:/Python/AnkiMiner/stitch.md) & [`docs/HOME_SCREEN_DESIGN_SPEC.md`](file:///d:/Python/AnkiMiner/docs/HOME_SCREEN_DESIGN_SPEC.md)

---

## 1. Executive Summary & Design System Tokens

The Kiroku Note Windows Desktop App features a fresh, playful, yet disciplined Japanese pop minimalist aesthetic ("Sumi & Washi Neo-Tactile"). It completely rejects generic SaaS dashboards, sterile blue accents, and ambient glassmorphism in favor of high-contrast tactile surfaces, solid black ink strokes, and Planetoño physical offset geometry that mimics mechanical keycaps and vinyl stickers.

### 1.1 Color Tokens

| Token | Hex / Value | Semantic Role |
| :--- | :--- | :--- |
| `--ink-black` | `#22211F` / `#141311` | Deep matte sumi ink canvas floor; non-harsh background |
| `--warm-paper` | `#F5F1E8` | Hand-pressed washi paper; primary text, inverted pods, floating dock |
| `--vermilion` | `#D94B38` | Torii gate / red hanko seal; primary action stamps, active tabs, error badges |
| `--gold-eye` | `#C8A94A` | Companion feline eye gold; badges, focus outlines, secondary chrome accents |
| `--reading-black` | `#000000` | **Mandatory Pitch Black** reading surface (dictionary definitions, stroke order canvas, question passages) |
| `--tactile-stroke` | `#151413` | Crisp 1.5px solid stroke on interactive cards, buttons, and floating dock |
| `--ink-surface` | `#1C1B19` / `#2A2926`| Elevated structural containers and quiet background cards |
| `--ink-border` | `rgba(245, 241, 232, 0.12)` | Subtle ambient border for non-interactive containers |
| `--jade-green` | `#4EBB7B` / `#4ADE80` | Correct grading feedback, online telemetry dot, successful sync status |
| `--amber-status`| `#F59E0B` | Pending sync count, idle OCR daemon ring |

### 1.2 Elevation & Physicality (The Mechanical Model)

* **Rest State:** Surface elevated with crisp zero-blur offset shadow: `box-shadow: 3px 3px 0 #151413`.
* **Hover State:** Subtle lift: `transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #151413`.
* **Active / Pressed State:** Physical compression downward: `transform: translate(2px, 2px); box-shadow: 1px 1px 0 #151413`.
* **Pure Pitch Black Surfaces:** Reading panes use `#000000` background with `1.5px solid #151413` stroke and `3px 3px 0 #151413` shadow.

### 1.3 Typography Hierarchy

* **Expressive Display / Comic (`Epilogue`):** Heavy geometric display weights for brand mark, dialogue bursts, and speech bubbles.
* **Editorial Literary (`Zen Old Mincho` / `Noto Serif`):** Japanese kanji glyphs, headwords, literary passage text, and brand mark headers.
* **Operational Interface (`Inter`):** UI labels, telemetry counters, keyboard shortcuts, status badges, and timer meters.
* **Japanese Modern (`Zen Kaku Gothic New`):** High-legibility exam questions, reading passage prose, and answer choices.

---

## 2. Screen Inventory & Stitch Generated Screens

All screens have been generated directly inside Stitch Project `13699270005564697754` without modifying the user's existing Home screen.

| Screen Key | Screen Name / Title | Stitch Screen ID | Parent Tab | Stitch HTML Code | Screenshot Preview |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **HomeScreen** | *Kiroku Note — Home (Original Cat SVG & Flowing Nav)* | `8feb0117b3294bfc81db87d66e3b3ddc` | Home | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/8feb0117b3294bfc81db87d66e3b3ddc:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/screenshot_00065f1ff213fcad0925d478bb226754:download) |
| **VocabMainScreen** | *Kiroku Note — Vocab (Word Showcase & Card Mining)* | `48900048df864570acf3db631dbb694c` | Vocab | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/db598a157ae24466bd9b9d47ea076e5e:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/9c130c78c5b24932bc4deec0dc221594:download) |
| **VocabHistoryScreen** | *Kiroku Note — Card History & Inventory* | `063f2a6e055441e9b3ef52a14901c6b0` | Vocab / History | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/ab563c8fc4164f8a8a073c38e9852832:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/cc18d5f15a1846ae924bd14108d05615:download) |
| **GrammarAnalyzeScreen** | *Kiroku Note — Grammar (Sentence Analyzer & Grammar Studio)* | `8503948d33a649e08e301493a53ebc66` | Grammar | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/5a771953fbaa4fc2a8ad892091fb92af:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/4c6dd4342a584eab869274e140d0db5b:download) |
| **KanjiMainScreen** | *Kiroku Note — Kanji (Kanji Studio & Stroke Order Engine)* | `9ff158ed40dd48409cbf8638818da388` | Kanji | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/5c72dc6249394c78a66afd068cb611e3:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/d6c5c3315c7548709850e9c575960375:download) |
| **TestLiveScreen** | *Kiroku Note — Test (JLPT N3 Live Simulation)* | `9cb54725589d4626ba25c633aa8bb7f2` | Test | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/4a8fe64145cd43999452466efe9a2192:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/8508286f829d48cea44798036db3cf3c:download) |
| **StudyPracticeActiveScreen** | *Kiroku Note — Study (Practice Drill & Adaptive Grader)* | `1734b13c8bc4406a9f3f2ad14ae8bcdd` | Study | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/8c2e2b26477441fc8353df1fbe61e5b0:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/bf3604d9c2564e8dae9730abba9b2acf:download) |
| **GlobalSettingsScreen** | *Kiroku Note — Settings (Global Configuration & Telemetry)* | `b5e8ddda60ae4f59a8158894f5e04989` | Global / Settings | [Download HTML](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/3d65088bda984d6fa60f4238883732a8:download) | [View Screenshot](https://stitch.googleapis.com/v1/projects/13699270005564697754/files/6e1996f83f8c45bc8937099a768b35a0:download) |

---

## 3. Reusable Component Inventory

Every component in the desktop UI is built strictly from real backend schemas, API responses, and database models.

### 3.1 Top Frameless Window Chrome (48px)
* **Wordmark:** `KIROKU` in serif (`Zen Old Mincho` / `Epilogue`) with letter-lift hover mechanics (each glyph lifts 3px on hover).
* **Section Tag:** Pill badge in tactile gold (`#C8A94A`) or vermilion (`#D94B38`) denoting active section (e.g. `VOCAB 語彙`, `GRAMMAR 文法`).
* **Live Telemetry Dots:** Real-time loopback connection chips:
  * `● Backend (21828)` (Jade Green `#4ADE80`)
  * `● Yomitan` (Jade Green `#4ADE80`)
  * `● AnkiConnect` (Jade Green `#4ADE80`)
  * `○ OCR Engine` (Amber ring `#F59E0B` for idle, Jade Green for active)
* **Global Action Controls:** History icon button (clock SVG), Settings button (gear SVG with 45° spring rotation on hover), and Windows frameless controls (Minimize gold `#C8A94A`, Maximize paper border, Close vermilion `#D94B38`).

### 3.2 Floating Bottom Tactile Navigation Dock
* **Surface:** Elevated pill (`border-radius: 9999px`) in Warm Paper (`#F5F1E8`) with `1.5px solid #151413` stroke and `4px 4px 0 #151413` hard drop shadow, floating 20px above viewport bottom.
* **Tabs (6 items):**
  1. `Home (ホーム)`
  2. `Vocab (語彙)`
  3. `Grammar (文法)`
  4. `Kanji (漢字)`
  5. `Test (テスト)`
  6. `Study (学習)`
* **Active Indicator:** Sliding solid Vermilion (`#D94B38`) pill with white text and active depression physics.

### 3.3 Quick Add & IME Conversion Bar
* **Surface:** Container on `#1C1B19` with `1.5px solid #151413` stroke and `3px 3px 0 #151413` shadow.
* **Controls:** Search icon, clear button (`✕`), and IME mode pills (`Hiragana` active vermilion, `Katakana`, `English`).
* **Candidate Dropdown (`[ANIM_SLOT: candidate-dropdown-slide]`):** Suggestion rows with headword, reading, English gloss, JLPT level badge, and saved indicator.

### 3.4 Pitch-Black Reading Surface (`#000000`)
* **Strict Rule:** All content-heavy reading surfaces (JMdict dictionary glosses, KanjiVG vector canvas, reading passages, and test prompt cards) MUST use `#000000` pitch black background.
* **Contrast:** High legibility on dark background, framed with subtle tactile border and `3px 3px 0 #151413` hard shadow.

### 3.5 Card Editor & Mining Form
* **Fields:** Expression, Reading (furigana), English Meaning, Example Sentence (with embedded `[sound:...]` audio tag), Example Translation, Notes, Target Deck selector, and Target Note Model selector.
* **Actions:**
  * Primary: `Save Card` stamp button (solid vermilion `#D94B38`, `3px 3px 0 #151413` shadow) with `[ANIM_SLOT: card-save-stamp]`.
  * Status: Live `● Synced to Anki (Note #...)` soft green pill, or amber `Pending Sync`, or vermilion `Sync Failed — Retry`.
  * Reset / Discard button in subtle tactile ink style.

### 3.6 Planetoño Tactile Buttons
* **Primary Action (Tactile Stamp):** Solid Vermilion (`#D94B38`), Warm Paper label, `1.5px solid #151413` stroke, `box-shadow: 3px 3px 0 #151413`. Depresses to `translate(2px, 2px)` with `box-shadow: 1px 1px 0 #151413`.
* **Paper Action (Sticker Button):** Solid Warm Paper (`#F5F1E8`), ink black label, `1.5px solid #151413` stroke, `box-shadow: 3px 3px 0 #151413`.
* **Ghost Utility:** Transparent fill, `1px solid rgba(245, 241, 232, 0.12)`, text in `#F5F1E8`.

---

## 4. Labeled Placeholder Slot Register

In accordance with strict design guidelines, mascot characters and micro-animations are represented as **explicit empty placeholder slots** to maintain perfect layout geometry without inventing unapproved artwork or animation code.

### 4.1 Mascot Slots (`[MASCOT_SLOT: ...]`)

| Slot Identifier | Screen / Location | Recommended Size | Pose Concept (Reserved for Future Art) |
| :--- | :--- | :--- | :--- |
| `[MASCOT_SLOT: vocab-idle-reading]` | **VocabMainScreen** & **VocabHistoryScreen** (Header top-right) | 100 × 100 px | Black cat lying down reading a pocket dictionary |
| `[MASCOT_SLOT: grammar-attentive-study]`| **GrammarAnalyzeScreen** (Header top-right) | 100 × 100 px | Black cat with spectacles intently analyzing Japanese grammar notes |
| `[MASCOT_SLOT: kanji-stroke-observing]` | **KanjiMainScreen** (Above stroke canvas) | 100 × 100 px | Black cat sitting upright watching stroke animation |
| `[MASCOT_SLOT: test-exam-proctor]` | **TestLiveScreen** (Top exam chrome, beside timer) | 80 × 80 px | Serious proctor cat with arm band holding timer watch |
| `[MASCOT_SLOT: study-drill-cheer]` | **StudyPracticeActiveScreen** (Beside feedback card) | 100 × 100 px | Cheering cat with paw raised celebrating correct streak |
| `[MASCOT_SLOT: settings-mechanic-cat]` | **GlobalSettingsScreen** (Modal header right) | 100 × 100 px | Mechanic cat holding wrench adjusting engine telemetry gears |

### 4.2 Animation Slots (`[ANIM_SLOT: ...]`)

| Slot Identifier | Component / Trigger | Target Duration & Physics Intent |
| :--- | :--- | :--- |
| `[ANIM_SLOT: candidate-dropdown-slide]` | Quick Add search input | Smooth 150ms ease-out dropdown accordion expansion with 4px translation |
| `[ANIM_SLOT: card-save-stamp]` | Save Card button click | 120ms spring stamp depression (`scale(0.96)`) followed by ink-splash particle ring |
| `[ANIM_SLOT: card-drawer-slide]` | Card History row click | 250ms slide-over drawer entry from right viewport margin (`transform: translateX(0)`) |
| `[ANIM_SLOT: grammar-chip-hover]` | Parsed sentence tokens | 80ms chip elevation on hover (`translateY(-2px)`) with gold accent outline pop |
| `[ANIM_SLOT: encounter-drawer-slide]` | Past Encounters link | 200ms smooth drawer slide opening past mined sentences |
| `[ANIM_SLOT: stroke-order-draw]` | KanjiVG replay button | Vector path progressive stroke reveal with 0.8s per stroke draw easing |
| `[ANIM_SLOT: timer-urgent-pulse]` | Exam timer (< 5 minutes) | Subtle red/amber opacity breathing pulse (1s infinite heartbeat) |
| `[ANIM_SLOT: grade-feedback-pop]` | Practice drill answer click | Immediate 180ms green banner elastic pop with `+10 Points` badge float |
| `[ANIM_SLOT: test-connection-spin]` | Diagnostics test connection | 600ms continuous 360° gear rotation until HTTP socket handshake resolves |

---

## 5. Responsive Window Layout Rules

The Electron desktop window defaults to compact companion mode (`500 × 750`), resizable up to 4K maximized view.

```text
+---------------------------------------------------------------------------------+
| Compact Window (500 x 750)                    Maximized Window (>= 1024px)     |
|                                                                                 |
| [Top Chrome: Wordmark + Telemetry]            [Top Chrome: Full Telemetry + Cat]|
|                                                                                 |
| [Single Column Flow:                         [Split-View Layout:               |
|  - Headword Showcase                          Left 50%:                         |
|  - Pitch-Black Reading Card                    - Reading / Passage / Canvas     |
|  - Inline Collapsible Drawers]                Right 50%:                        |
|                                                - Questions / Options / Mining]  |
|                                                                                 |
| [Floating Bottom Dock: Icon Pills]            [Floating Bottom Dock: Expanded]  |
+---------------------------------------------------------------------------------+
```

### 5.1 Compact Window Behavior (`500 × 750`)
* **Top Chrome:** Compresses telemetry dots into compact badge pills; hides text labels, retaining live green/amber dots.
* **Layout Structure:** Reflows from dual-column into a single stacked column.
  * *Vocab:* Headword hero stacks above Pitch-Black JMdict card; Card Editor form docks below as an expandable bottom drawer.
  * *Grammar:* Analyzer input box stacks directly above segmented visualizer; detected grammar cards stack vertically.
  * *Kanji:* Stroke canvas scales to 100% card width with controls beneath; readings and compounds table follow sequentially.
  * *Test:* Reading passage pane becomes the top pane with question and choices in bottom pane, scrollable independently.
* **Floating Bottom Dock:** Compresses tab items to icon-only pills with 12px padding.

### 5.2 Maximized / Full-Size Window (`>= 1024px`)
* **Two-Column Asymmetric Stage:** Left column (50–55% width) hosts the primary reading or interactive canvas; right column (45–50% width) hosts persistent inspector tools, card forms, or question choices.
* **Mascot Presence:** Dedicated `[MASCOT_SLOT: ...]` container sits prominently at top-right without obscuring workspace content.
* **Table Views (History):** Full multi-column data grid with dedicated slide-over right inspector drawer (`[ANIM_SLOT: card-drawer-slide]`).

---

## 6. Feature Traceability Matrix

Every audited feature from [`stitch.md`](file:///d:/Python/AnkiMiner/stitch.md) marked `IMPLEMENTED` or `PARTIAL` has been verified in the generated Stitch designs:

| Tab | Feature Name | Status in Code | Code Evidence Path | Screen Housing Feature |
| :--- | :--- | :--- | :--- | :--- |
| **Vocab** | Quick Add WanaKana IME & Search | IMPLEMENTED | `extension/lib/wanakana.js` | `VocabMainScreen` |
| **Vocab** | Headword Showcase & Furigana | IMPLEMENTED | `backend/app/services/card_service.py` | `VocabMainScreen` |
| **Vocab** | JMdict & Pitch-Black Definitions | IMPLEMENTED | `backend/app/services/yomitan.py` | `VocabMainScreen` |
| **Vocab** | Kanji Radical Breakdown Tile | IMPLEMENTED | `backend/app/data/kanji_vg/` | `VocabMainScreen` |
| **Vocab** | Card Mining Persistence Form | IMPLEMENTED | `backend/app/repositories/card_repository.py` | `VocabMainScreen` |
| **Vocab** | AnkiConnect Sync Status Pill | IMPLEMENTED | `backend/app/services/anki_connect.py` | `VocabMainScreen` |
| **Vocab** | Card Inventory & Telemetry Metrics | IMPLEMENTED | `GET /api/cards/stats` | `VocabHistoryScreen` |
| **Vocab** | Failed Sync Retry & Diagnostic Drawer | IMPLEMENTED | `POST /api/cards/sync` | `VocabHistoryScreen` |
| **Vocab** | Bulk Card Selection & Deletion | IMPLEMENTED | `DELETE /api/cards/{id}` | `VocabHistoryScreen` |
| **Grammar** | Sentence Analyzer Input & Breakdown | IMPLEMENTED | `backend/app/api/grammar.py:analyze_sentence` | `GrammarAnalyzeScreen` |
| **Grammar** | Pitch-Black Segmented Visualizer | IMPLEMENTED | `backend/app/services/grammar_service.py` | `GrammarAnalyzeScreen` |
| **Grammar** | Grammar Point Card & Formations | IMPLEMENTED | `backend/app/data/master_grammar_dataset.json` | `GrammarAnalyzeScreen` |
| **Grammar** | Status Selector (New/Learning/Known)| IMPLEMENTED | `backend/app/services/grammar_tracker.py` | `GrammarAnalyzeScreen` |
| **Grammar** | Encounter Mining History Link | IMPLEMENTED | `backend/app/api/grammar.py:get_encounters` | `GrammarAnalyzeScreen` |
| **Grammar** | Grammar Library Distribution Bar | IMPLEMENTED | `GET /api/grammar/stats` | `GrammarAnalyzeScreen` |
| **Kanji** | Kanji Search & Level Filtering | IMPLEMENTED | `kiroku_dictionary/kanjidic.py` | `KanjiMainScreen` |
| **Kanji** | Hero Glyph & Metadata Badges | IMPLEMENTED | `backend/app/data/kanji_vg/` | `KanjiMainScreen` |
| **Kanji** | Pitch-Black KanjiVG Stroke Player | IMPLEMENTED | `backend/app/services/kanji_vg.py` | `KanjiMainScreen` |
| **Kanji** | Readings Matrix (On/Kun/Nanori) | IMPLEMENTED | `backend/app/services/dictionary_provider.py` | `KanjiMainScreen` |
| **Kanji** | Common Compounds Table + Mine Card | IMPLEMENTED | `GET /api/cards/word/{headword}` | `KanjiMainScreen` |
| **Test** | Anti-Cheat Section Countdown Timer | IMPLEMENTED | `backend/app/study/exam/session.py` | `TestLiveScreen` |
| **Test** | Mark for Review Navigation Toggle | IMPLEMENTED | `backend/app/study/exam/service.py` | `TestLiveScreen` |
| **Test** | Split-View F4 Reading Passage Pane | IMPLEMENTED | `backend/app/study/contracts/f4.py` | `TestLiveScreen` |
| **Test** | Pitch-Black 4-Choice Option Cards | IMPLEMENTED | `backend/app/study/markup/` | `TestLiveScreen` |
| **Test** | Strict Simulation (No Instant Feedback)| IMPLEMENTED | `backend/app/study/exam/scoring.py` | `TestLiveScreen` |
| **Test** | 32-Item Question Palette Bar | IMPLEMENTED | `backend/app/study/exam/blueprints.py` | `TestLiveScreen` |
| **Study** | Practice Drill Session & Item Counter | IMPLEMENTED | `backend/app/study/session/service.py` | `StudyPracticeActiveScreen` |
| **Study** | Pitch-Black Question Card (F1) | IMPLEMENTED | `backend/app/study/contracts/f1.py` | `StudyPracticeActiveScreen` |
| **Study** | Deterministic Objective Grader Banner | IMPLEMENTED | `backend/app/study/session/grader.py` | `StudyPracticeActiveScreen` |
| **Study** | Pedagogical Nuance Explanation Card | IMPLEMENTED | `backend/app/study/verification/` | `StudyPracticeActiveScreen` |
| **Study** | Adaptive Repetition Rating (Easy/Norm/Hard)| IMPLEMENTED | `calculate_priority_score()` in `session.py` | `StudyPracticeActiveScreen` |
| **Global** | Top Chrome Live Telemetry Indicators | IMPLEMENTED | `desktop/src/process_manager.js` | All Screens |
| **Global** | Floating Tactile Bottom Dock (6 Tabs) | IMPLEMENTED | `desktop/src/main.js` | All Screens |
| **Global** | AnkiConnect & Yomitan Configuration | IMPLEMENTED | `backend/app/config.py` | `GlobalSettingsScreen` |
| **Global** | Windows DPAPI Encrypted Secret Store | IMPLEMENTED | `backend/app/services/secret_store.py` | `GlobalSettingsScreen` |
| **Global** | LLM Provider Config & Test Latency | IMPLEMENTED | `backend/app/services/llm_service.py` | `GlobalSettingsScreen` |
| **Global** | Subprocess Supervisor & Doctor Check | IMPLEMENTED | `backend/app/study/doctor.py` | `GlobalSettingsScreen` |

---

## 7. Deviation Analysis & Strict Boundary Review

During the Stitch screen generation phase, strict verification was conducted against [`stitch.md`](file:///d:/Python/AnkiMiner/stitch.md) to ensure zero deviations:

1. **Quarantined Features Excluded:**
   * **SRS Review Scheduling Engine:** Kept strictly in Anki; Kiroku Note does not contain an internal SRS review scheduler.
   * **Study Bank Sync to Render / Neon:** Excluded completely; `study.db` remains 100% offline and loopback-only.
   * **Chrome Extension Mining Overlays:** Video subtitles, page OCR crops, and selection bubbles remain tagged `EXTENSION-ONLY` and were not generated.
2. **Mascot & Animations Treated as Slots:**
   * No arbitrary mascot illustrations or AI-hallucinated cat images were introduced into code. All mascot positions were delivered as `[MASCOT_SLOT: ...]` empty dashed containers.
   * All micro-interactions remain clearly marked as `[ANIM_SLOT: ...]`.
3. **Reading Surfaces Adhered to Pitch Black:**
   * Every reading comprehension passage, dictionary gloss container, and stroke canvas rendered in `#000000` pitch black background.
4. **Existing Home Screen Intact:**
   * Screen `8feb0117b3294bfc81db87d66e3b3ddc` was preserved completely without overwriting.

---

## 8. Implementation Next Steps

With Stitch UI screens generated and verified, the next implementation phase proceeds as follows:

1. **Download HTML & CSS Assets:**
   * Extract HTML and CSS stylesheets from the Stitch download URLs into `desktop/src/views/` or `desktop/src/ui/`.
2. **Component Templating:**
   * Modularize the Top Chrome, Floating Dock, and Pitch-Black Reading Cards into reusable vanilla JS templates adhering to the Electron shell sandbox.
3. **API Wiring:**
   * Connect `VocabMainScreen` to `/api/capture` and `/api/cards`.
   * Connect `VocabHistoryScreen` to `/api/cards/stats` and `/api/cards/sync`.
   * Connect `GrammarAnalyzeScreen` to `/api/grammar/analyze`.
   * Connect `KanjiMainScreen` to `/api/kanji`.
   * Connect `TestLiveScreen` and `StudyPracticeActiveScreen` to `/api/study/v1` session endpoints.
   * Connect `GlobalSettingsScreen` to `/api/config` and `/api/llm`.
4. **Artwork Placement:**
   * Place finalized Ghibli-style black cat SVG illustrations into the designated `[MASCOT_SLOT: ...]` containers.
5. **Micro-Interaction Wiring:**
   * Implement CSS spring transitions for `[ANIM_SLOT: ...]` markers.

