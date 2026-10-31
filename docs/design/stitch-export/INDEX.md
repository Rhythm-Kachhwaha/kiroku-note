# Stitch UI Design Export Index — Kiroku Note Desktop

> **Project Title:** Kiroku dekstop  
> **Stitch Project ID:** `13699270005564697754`  
> **Export Date:** 2026-10-31  
> **Design Theme:** Sumi & Washi Neo-Tactile  
> **Colors:** Primary `#D94B38` (Vermilion), Neutral `#22211F` (Ink Black), Surface `#141311`, Text `#F5F1E8` (Warm Paper), Gold `#C8A94A`  
> **Rule:** Exported files in this folder are **immutable visual and motion references**. They must not be edited.

---

## 1. Exported Canonical & Active Screens Registry

| # | Screen Name / Title | Stitch Screen ID | Parent Tab | Status / Category | Exported Files | MCP Retrieval Status |
|---|---|---|---|---|---|---|
| 1 | **Kiroku Note — Home (Original Cat Asset & Flowing Nav)** | `8feb0117b3294bfc81db87d66e3b3ddc` | Home | Canonical DESIGN.md Home | `docs/design/stitch-export/home/home-original-cat-asset/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 2 | **Kiroku Note — Home (Original Cat SVG & Flowing Nav)** | `7394174104184535057` | Home | Active Canvas Variant (Home Page) | `docs/design/stitch-export/home/home-canvas-active/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 3 | **Kiroku Note — Vocab (Word Showcase & Card Mining)** | `48900048df864570acf3db631dbb694c` | Vocab | Canonical DESIGN.md Vocab Main | `docs/design/stitch-export/vocab/vocab-word-showcase-card-mining/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 4 | **Kiroku Note — Vocab (Variant 3: Minimalist Precision)** | `6ab2036ff448476184f0eadbbffa65ea` | Vocab | Active Canvas Variant | `docs/design/stitch-export/vocab/vocab-minimalist-precision/screen.html`, `screenshot.png` | Complete (HTML + Screenshot) |
| 5 | **Kiroku Note — Card History & Inventory** | `063f2a6e055441e9b3ef52a14901c6b0` | Vocab / History | Canonical DESIGN.md & Active Canvas | `docs/design/stitch-export/vocab/card-history-inventory/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 6 | **Kiroku Note — Grammar (Sentence Analyzer & Grammar Studio)** | `8503948d33a649e08e301493a53ebc66` | Grammar | Canonical DESIGN.md Grammar | `docs/design/stitch-export/grammar/grammar-sentence-analyzer-studio/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 7 | **Kiroku Note — Grammar (Variant 1: JLPT Syllabus & Study Desk)** | `cbbd50795b514b938b02a995df4ba23c` | Grammar | Active Canvas Variant | `docs/design/stitch-export/grammar/grammar-jlpt-syllabus-study-desk/screen.html`, `screenshot.png` | Complete (HTML + Screenshot) |
| 8 | **Kiroku Note — Kanji (Kanji Studio & Stroke Order Engine)** | `9ff158ed40dd48409cbf8638818da388` | Kanji | Canonical DESIGN.md & Active Canvas | `docs/design/stitch-export/kanji/kanji-studio-stroke-order-engine/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 9 | **Kiroku Note — Test (JLPT N3 Live Simulation)** | `9cb54725589d4626ba25c633aa8bb7f2` | Test | Canonical DESIGN.md & Active Canvas | `docs/design/stitch-export/test/test-jlpt-n3-live-simulation/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 10 | **Kiroku Note — Study (Practice Drill & Adaptive Grader)** | `1734b13c8bc4406a9f3f2ad14ae8bcdd` | Study | Canonical DESIGN.md & Active Canvas | `docs/design/stitch-export/study/study-practice-drill-adaptive-grader/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 11 | **Kiroku Note — Settings (Global Configuration & Telemetry)** | `b5e8ddda60ae4f59a8158894f5e04989` | Global / Settings | Canonical DESIGN.md Settings | `docs/design/stitch-export/settings/settings-global-config-telemetry/screen.html`, `screenshot.jpg` | Complete (HTML + Screenshot) |
| 12 | **Kiroku Note — Settings (Variant 1: Zen Studio Index)** | `f76fce792bb244ef9e4f6e1ec24379a4` | Global / Settings | Active Canvas Variant | `docs/design/stitch-export/settings/settings-zen-studio-index/screen.html`, `screenshot.png` | Complete (HTML + Screenshot) |
| 13 | **HOME_SCREEN_DESIGN_SPEC.md (v1.2.0 - Top Chrome Locked)** | `590e07f844e547b592508c5639b81b95` | Reference Doc | Canvas Markdown Spec | `docs/design/stitch-export/home/spec-canvas-doc/spec.md` | Complete (Markdown code) |

---

## 2. Design System Directory (`_design-system/`)

- `_design-system/DESIGN_SYSTEM.md`: Full Design System markdown specification (Sumi & Washi Neo-Tactile).
- `_design-system/tokens.json`: Structured token definitions (colors, typography scales, spacing scale).
- `_design-system/theme.json`: Verbatim theme metadata as exported by Stitch MCP.
- `_design-system/global.css`: Generated CSS custom property definitions ready for app consumption.

---

## 3. Verification Against DESIGN.md

- [x] **Every screen in DESIGN.md is exported:**
  1. `HomeScreen` (`8feb0117b3294bfc81db87d66e3b3ddc`) -> `docs/design/stitch-export/home/home-original-cat-asset/`
  2. `VocabMainScreen` (`48900048df864570acf3db631dbb694c`) -> `docs/design/stitch-export/vocab/vocab-word-showcase-card-mining/`
  3. `VocabHistoryScreen` (`063f2a6e055441e9b3ef52a14901c6b0`) -> `docs/design/stitch-export/vocab/card-history-inventory/`
  4. `GrammarAnalyzeScreen` (`8503948d33a649e08e301493a53ebc66`) -> `docs/design/stitch-export/grammar/grammar-sentence-analyzer-studio/`
  5. `KanjiMainScreen` (`9ff158ed40dd48409cbf8638818da388`) -> `docs/design/stitch-export/kanji/kanji-studio-stroke-order-engine/`
  6. `TestLiveScreen` (`9cb54725589d4626ba25c633aa8bb7f2`) -> `docs/design/stitch-export/test/test-jlpt-n3-live-simulation/`
  7. `StudyPracticeActiveScreen` (`1734b13c8bc4406a9f3f2ad14ae8bcdd`) -> `docs/design/stitch-export/study/study-practice-drill-adaptive-grader/`
  8. `GlobalSettingsScreen` (`b5e8ddda60ae4f59a8158894f5e04989`) -> `docs/design/stitch-export/settings/settings-global-config-telemetry/`

- [x] **Extras flagged:**
  - `7394174104184535057` (Active Canvas Home Page)
  - `6ab2036ff448476184f0eadbbffa65ea` (Active Canvas Vocab Variant 3)
  - `cbbd50795b514b938b02a995df4ba23c` (Active Canvas Grammar Variant 1)
  - `f76fce792bb244ef9e4f6e1ec24379a4` (Active Canvas Settings Variant 1)
  - `590e07f844e547b592508c5639b81b95` (Canvas Spec Markdown)

- [x] **Missing screens from DESIGN.md:** None (0 missing). All 8 canonical DESIGN.md screens were successfully exported verbatim.

---

## 4. MCP Retrieval Log

- **MCP Tools Used:**
  - `stitch.list_projects`: Identified target project `projects/13699270005564697754`.
  - `stitch.get_project`: Extracted project design theme, tokens, and canvas instances.
  - `stitch.list_screens`: Listed active screens in the project.
  - `stitch.get_screen`: Extracted resource file names for each screen.
  - `stitch.download_file`: Downloaded full HTML and binary screenshots.
- **Failures / Missing Data:** None. Every requested screen returned full HTML code and corresponding screenshot.
