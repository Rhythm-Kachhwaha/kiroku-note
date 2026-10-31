# Kiroku Note Desktop — UI Implementation & Reconciliation Plan

> **Document Version:** 1.0.0  
> **Target Branch:** `feature/desktop-ui-from-stitch`  
> **Authority Precedence:**  
> 1. Real repository code (FastAPI routes, SQLite DBs, Electron shell supervisor)  
> 2. `stitch.md` (Audited feature checklist with verified evidence & DO NOT DESIGN appendix)  
> 3. `DESIGN.md` (Design tokens, screen registry, component inventory, responsive rules)  
> 4. `docs/HOME_SCREEN_DESIGN_SPEC.md` & locked Home screen  
> 5. Stitch generated exports (Visual and motion reference only)

---

## 1. Technical Architecture & Technology Decision

### 1.1 Existing Architecture Inspection
The Kiroku Note Windows desktop app consists of:
- **Electron Main Process (`desktop/src/main.js`):** Runs Node.js, supervises the local FastAPI backend subprocess tree via `ProcessManager` (`desktop/src/process_manager.js`), manages single-instance locking and Windows system tray integration, and initializes a frameless/resizable `BrowserWindow` (default `500 × 750`, min `380 × 500`).
- **Context Isolation & Security Bridge (`desktop/src/preload.js`):** Enforces `contextIsolation: true` and `nodeIntegration: false`. Exposes `window.desktopAPI` (window controls, subprocess status, store operations, and secure authenticated `studyRequest` IPC bridge to `/api/study/v1`) and a `window.chrome` compatibility shim.
- **Current Renderer (`desktop/src/shell.html` / `UI-exploration/`):** A lightweight diagnostic shell (`shell.html`) and an editorial UI exploration (`UI-exploration/home` & `UI-exploration/`) built with vanilla HTML5, CSS3 custom properties, and plain ES6 modules (`import` / `export`).

### 1.2 Proposed Approach for New UI: Vanilla ES6 Modules + Pure Local CSS
We select **Vanilla ES6 Modules + Pure Local CSS (Design Tokens)** with zero third-party framework runtime (no React, no Vue) and no runtime CDN dependencies.

**Justification & Tradeoff Analysis:**
1. **Faithful to Stitch Visuals & Animations:** Stitch's generated HTML is clean semantic HTML paired with standard utility styles and CSS keyframes. Compiling or converting these styles to native CSS classes and custom properties preserves 100% of the tactile physics, spring curves, and hover effects without framework overhead.
2. **Zero Runtime Install / Build Burden:** Does not introduce Node.js or React runtime overhead to the renderer. The desktop bundle remains lean, fast-launching, and completely isolated from the main process.
3. **Completely Independent of the Chrome Extension:** The extension continues using vanilla JS with its own MV3 service worker and side panel. Shared models (like WanaKana) are referenced locally without cross-contamination.
4. **Strict Security & Offline Conformance:** Electron's restrictive Content Security Policy (`CSP`) forbids runtime CDN scripts like `https://cdn.tailwindcss.com`. All CSS tokens and font files (`.woff2`) are hosted locally within `desktop/src/ui/`, ensuring 100% offline functionality.
5. **Direct Preload Bridge Integration:** Vanilla JavaScript directly consumes `window.desktopAPI` and `fetch('http://127.0.0.1:21828/...')` without complex state library wrappers.

### 1.3 Target Directory Structure
```text
desktop/
  src/
    main.js                 Electron main process & lifecycle supervisor
    preload.js              Context-isolated security bridge
    process_manager.js      FastAPI subprocess supervisor
    store.js                Local app data settings store
    study_api_client.js     Authenticated Study API client
    index.html              Single-page application entrypoint
    ui/
      assets_map.js         Single mapping file: slot name -> local asset path
      router.js             Client-side tab view router (Home, Vocab, Grammar, Kanji, Test, Study, Settings)
      shell/                Extracted shared application shell (Addendum 1)
        top_chrome.js       Frameless controls, wordmark letter-lift, live telemetry chips
        bottom_dock.js      Tactile floating navigation dock with active sliding pill
        shell.css           Top chrome and bottom dock styles
      views/                Modular tab view controllers
        home.js             Pixel-identical locked Home screen controller
        vocab_main.js       Vocab search, WanaKana IME, headword hero, mining form
        vocab_history.js    Cards inventory table, metrics, slide-over inspector
        grammar.js          Sentence analyzer, pitch-black visualizer, grammar card
        kanji.js            Kanji search, KanjiVG stroke player, readings, compounds
        test.js             JLPT N3 live simulation, countdown timer, split passage, palette
        study.js            Practice drill engine, objective grader, explanation, feedback
        settings.js         Service integrations, LLM configuration, doctor diagnostics
      services/             Data-fetching and IPC integration layer
        api_client.js       Localhost FastAPI cards, dictionary, grammar, OCR calls
        study_client.js     Wrapper around window.desktopAPI.studyRequest
        telemetry.js        Real-time loopback service polling (Anki, Yomitan, Backend, OCR)
      styles/
        tokens.css          Theme colors, spacing, typography variables (_design-system)
        tactile.css         Planetoño mechanical button/card depression physics
        bundle.css          Aggregated view styles & responsive layout rules
      assets/
        fonts/              Local offline WOFF2 fonts (Inter, Zen Kaku, Zen Old Mincho, Mochiy)
        mascot/             Checked-in SVG / Lottie mascot art
```

---

## 2. Per-Screen Reconciliation Table

Every interactive element and section in Stitch's generated screens is audited against ground truth (`stitch.md`, real backend routes, database schemas, and Electron shell).

### 2.1 Screen 1: Home (`HomeScreen`)
*Stitch Reference ID: `8feb0117b3294bfc81db87d66e3b3ddc` (Canonical) / `7394174104184535057` (Canvas Active)*  
*Ground Truth Spec: `docs/HOME_SCREEN_DESIGN_SPEC.md` & `UI-exploration/home/`*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Top Frameless Window Chrome** | `KEEP` | `desktop/src/main.js:296-317`, `UI-exploration/index.html:13-19` | Extracted into shared shell component. Contains Kiroku wordmark (letter lift), window controls, live status dots. |
| **Live Telemetry Strip** | `KEEP` | `desktop/src/main.js:28-34`, `desktop/src/process_manager.js:checkBackendHealth` | Backend (21828), Yomitan, AnkiConnect, OCR status pips. |
| **History & Settings Buttons** | `KEEP` | `desktop/src/ui/router.js:navigateToTab` | Clock icon deep-links to Vocab History; Gear icon deep-links to Settings. |
| **Mascot Companion Hero** | `KEEP` | `docs/HOME_SCREEN_DESIGN_SPEC.md:100-120`, `UI-exploration/home/cat.js` | Sphinx cat with cursor-following eyes. Uses `assets/dekstop/kiroku_cat.svg`. |
| **Comic Speech Bubble Greeting** | `KEEP` | `UI-exploration/home/home.js:getGreeting` | Time-of-day Japanese greetings (`おかえり`, `こんにちは`, etc.) in Mochiy Pop One. |
| **Today's Word Module** | `KEEP` | `GET /api/cards/stats`, `backend/app/repositories/card_repository.py` | Displays featured mined word with furigana; expands on hover. |
| **Editorial Study Streak Badge** | `KEEP` | `desktop/src/store.js:getStreak()` | 7-day tactile dot badge showing active consecutive study days. |
| **Continue Drill Action Card** | `KEEP` | `POST /api/study/v1/practice/sessions` | One-click button continuing learner's recent drill topic (e.g. N3 Grammar). |
| **Floating Bottom Nav Dock** | `KEEP` | `docs/HOME_SCREEN_DESIGN_SPEC.md:121-138`, `UI-exploration/src/components/nav.js` | 6 tactile tab pills (Home, Vocab, Grammar, Kanji, Test, Study). Extracted into shared shell. |
| **Stitch Inline Header/Dock Duplicates** | `REMOVE` | Addendum 1 Rule | Dropped in favor of extracted shared home chrome. |
| **Hardcoded Word & Streak Data** | `STATIC-TO-DYNAMIC` | `backend/app/repositories/card_repository.py:get_random_word` | Replace static "静寂" with dynamic backend word of the day. |

---

### 2.2 Screen 2: Vocab Main (`VocabMainScreen`)
*Stitch Reference ID: `48900048df864570acf3db631dbb694c` (Canonical) / `6ab2036ff448476184f0eadbbffa65ea` (Canvas Variant 3)*  
*Ground Truth Spec: `stitch.md` Section 4.1.1–4.1.6*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Window Chrome** | `REMOVE` | Addendum 1 Rule | Drop Stitch's custom window header in favor of shared home top chrome. |
| **Stitch Standalone Bottom Nav** | `REMOVE` | Addendum 1 Rule | Drop Stitch's custom bottom nav dock in favor of shared home bottom dock. |
| **Quick Add Search & IME Bar** | `KEEP` | `extension/lib/wanakana.js`, `GET /api/dictionary/search` | Input field with Hiragana, Katakana, and English mode toggle pills. Converts romanized keystrokes on the fly. |
| **Candidate Dropdown** | `KEEP` | `GET /api/dictionary/search`, `[ANIM_SLOT: candidate-dropdown-slide]` | Dropdown showing search matches with headword, reading, gloss, and JLPT level. |
| **Headword Showcase Block** | `KEEP` | `backend/app/services/card_service.py:create_card_payload` | Large kanji expression, ruby furigana, pitch accent contour downstep tag `[0] 平板`. |
| **Audio Playback Button** | `KEEP` | `backend/app/services/media_storage.py:get_audio_url` | Audio speaker button triggering local/Anki sound playback for the term. |
| **Pitch-Black JMdict Card** | `KEEP` | `backend/app/services/yomitan.py`, `backend/app/services/dictionary_provider.py` | Strict `#000000` pitch black background displaying JMdict senses, parts of speech, and glosses. |
| **Kanji Radical Breakdown Tile** | `KEEP` | `backend/app/services/kanji_strokes.py:get_kanji_details` | Deconstructs kanji into component radicals with stroke count and JLPT rank. |
| **Card Mining Persistence Form** | `KEEP` | `backend/app/repositories/card_repository.py:create_card`, `POST /api/cards` | Form fields: Expression, Reading, Meaning, Context Sentence, Translation, Deck selector, Note Model selector. |
| **Planetoño Save Card Button** | `KEEP` | `POST /api/cards`, `[ANIM_SLOT: card-save-stamp]` | Solid vermilion `#D94B38` tactile button with 180ms spring stamp depression physics. |
| **AnkiConnect Sync Status Pill** | `KEEP` | `backend/app/services/anki_connect.py:sync_card` | Live status: `● Synced to Anki (Note #...)`, amber `Pending Sync`, or vermilion `Sync Failed`. |
| **Mascot Slot `[MASCOT_SLOT: vocab-idle-reading]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:118` | 100x100 empty dashed placeholder container. Reserved for future pocket-dictionary cat asset. |
| **Fake AI Sentence Generator** | `REMOVE` | `stitch.md` Section 9.3 | Stitch included a mock "Generate sentence with AI" button. No backend route exists; dropped. |
| **Social / Cloud Share Buttons** | `REMOVE` | `stitch.md` Section 9.6 | Kiroku is local-first offline. Dropped. |
| **Hardcoded Word "食べる" & Definitions** | `STATIC-TO-DYNAMIC` | `GET /api/dictionary/search` & `POST /api/capture` | Wired dynamically to live dictionary lookup and user input. |

---

### 2.3 Screen 3: Vocab History (`VocabHistoryScreen`)
*Stitch Reference ID: `063f2a6e055441e9b3ef52a14901c6b0`*  
*Ground Truth Spec: `stitch.md` Section 4.1.7–4.1.11*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **Telemetry Metric Pods (5 cards)** | `KEEP` | `GET /api/cards/stats`, `backend/app/main.py:get_card_stats` | Total Cards, Synced to Anki, Pending Sync, Failed Sync, Today's Mined. |
| **"Sync All Pending" Action Stamp** | `KEEP` | `POST /api/cards/sync`, `backend/app/services/card_service.py:sync_all_cards` | Triggers background sync to AnkiConnect with live card counter badge. |
| **Filter & Search Toolbar** | `KEEP` | `GET /api/cards`, `backend/app/repositories/card_repository.py` | Search input with `⌘F` hotkey, status filter pills (All, Synced, Pending, Failed), Deck dropdown. |
| **Export Collection Button** | `KEEP` | `GET /api/cards/export`, `backend/app/main.py:export_cards_csv` | Exports local cards collection to standard CSV/TSV format. |
| **Sticky Bulk Selection Bar** | `KEEP` | `DELETE /api/cards/bulk`, `POST /api/cards/sync` | Appears when ≥ 1 cards are checked: count badge, Sync Selected, Change Deck, Delete Selected. |
| **Card Inventory Data Grid / Table** | `KEEP` | `GET /api/cards?limit=...&offset=...` | Multi-column table with selection checkboxes, expression, furigana reading, meaning, deck, date, status. |
| **Pagination Bar** | `KEEP` | `GET /api/cards`, `backend/app/repositories/card_repository.py:get_cards` | Previous, page number indicators, and Next controls. |
| **Slide-Over Card Inspector Drawer** | `KEEP` | `GET /api/cards/{id}`, `[ANIM_SLOT: card-drawer-slide]` | Right-hand slide-over drawer showing detailed card fields, audio playback button, and Anki note ID. |
| **Sync Failure Troubleshooting Callout** | `KEEP` | `backend/app/services/anki_connect.py:check_connection` | Amber/vermilion banner with AnkiConnect loopback diagnostic hint and "Retry" button. |
| **Mascot Slot `[MASCOT_SLOT: vocab-idle-reading]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:118` | Preserved as labeled 100x100 placeholder slot in header. |
| **Hardcoded Cards (食べる, 静寂, 木漏れ日)** | `STATIC-TO-DYNAMIC` | `GET /api/cards` | Bind dynamically to local SQLite `cards` table. |

---

### 2.4 Screen 4: Grammar Studio (`GrammarAnalyzeScreen`)
*Stitch Reference ID: `8503948d33a649e08e301493a53ebc66` (Canonical) / `cbbd50795b514b938b02a995df4ba23c` (Canvas Variant 1)*  
*Ground Truth Spec: `stitch.md` Section 4.2.1–4.2.6*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **Sentence Analyzer Textarea & Action** | `KEEP` | `POST /api/grammar/analyze`, `backend/app/api/grammar.py:analyze_sentence` | Multi-line input area for Japanese sentences with tactile "Analyze Sentence" trigger button. |
| **Pitch-Black Segmented Visualizer** | `KEEP` | `backend/app/services/grammar_matcher.py`, `[ANIM_SLOT: grammar-chip-hover]` | Strict `#000000` pitch black container displaying parsed token spans with hover elevation and gold outlines. |
| **Grammar Point Detail Card** | `KEEP` | `backend/app/services/grammar_reference.py`, `backend/app/data/master_grammar_dataset.json` | Displays grammar point title, JLPT level badge (N5–N1), structural formations, and curated example sentences. |
| **Mastery Status Selector** | `KEEP` | `POST /api/grammar/points/{point_id}/status`, `backend/app/services/grammar_tracker.py` | Segmented toggle pills: `New (新規)`, `Learning (学習中)`, `Known (習得済み)`. |
| **Past Encounters Drawer** | `KEEP` | `GET /api/grammar/points/{point_id}/encounters`, `[ANIM_SLOT: encounter-drawer-slide]` | Slide-out panel listing sentences previously mined by the user containing this grammar pattern. |
| **Grammar Level Distribution Bar** | `KEEP` | `GET /api/grammar/stats`, `backend/app/services/grammar_service.py:get_stats` | Distribution meter showing mastered vs total grammar points across N5, N4, N3, N2, and N1. |
| **Mascot Slot `[MASCOT_SLOT: grammar-attentive-study]`**| `KEEP-VISUAL-ONLY` | `DESIGN.md:119`, `assets/dekstop/Cat typing.json` | Wired to `Cat typing.json` Lottie companion (cat studying/typing at desk) or labeled placeholder. |
| **Full Grammar Syllabus Tree** | `ADD` | `GET /api/grammar/points?level=...`, `backend/app/services/grammar_reference.py` | Stitch Variant 1 showed a study desk view but missed the searchable syllabus library; added to sidebar. |
| **Hardcoded Sentence & Token Breakdown** | `STATIC-TO-DYNAMIC` | `POST /api/grammar/analyze` | Replace static demo sentence with dynamic analysis output. |

---

### 2.5 Screen 5: Kanji Studio (`KanjiMainScreen`)
*Stitch Reference ID: `9ff158ed40dd48409cbf8638818da388`*  
*Ground Truth Spec: `stitch.md` Section 4.3.1–4.3.5*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **Kanji Search Bar & Level Filters** | `KEEP` | `GET /api/kanji/search`, `kiroku_dictionary/kanjidic.py` | Search input with filter pills for JLPT levels (N5–N1) and Joyo school grades. |
| **Hero Glyph Showcase Container** | `KEEP` | `backend/app/services/kanji_strokes.py`, `kiroku_dictionary/kanjidic.py` | Massive display of target kanji character, radical breakdown, grade, frequency rank, and JLPT tag. |
| **Pitch-Black KanjiVG Stroke Canvas** | `KEEP` | `backend/app/services/kanji_vg.py:get_kanji_svg_data`, `[ANIM_SLOT: stroke-order-draw]` | Strict `#000000` pitch black canvas rendering vector stroke paths with step-by-step progressive animation. |
| **Stroke Player Controls** | `KEEP` | `backend/app/services/kanji_vg.py` | Play, Pause, Replay, and stroke index scrubber controls. |
| **Readings Matrix** | `KEEP` | `kiroku_dictionary/kanjidic.py:lookup_kanji` | Formatted table: On'yomi (Katakana), Kun'yomi (Hiragana with okurigana separation), Nanori, English glosses. |
| **Common Compounds Table** | `KEEP` | `GET /api/kanji/{character}/compounds`, `backend/app/services/dictionary_provider.py` | High-frequency vocabulary words containing this kanji with readings, English meanings, and Mine buttons. |
| **1-Click "Mine Compound" Button** | `KEEP` | `POST /api/cards`, `backend/app/repositories/card_repository.py` | Quick stamp button saving compound directly to local cards table and triggering AnkiConnect sync. |
| **Mascot Slot `[MASCOT_SLOT: kanji-stroke-observing]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:120`, `assets/dekstop/svg_cat.svg` | Wired to sitting cat SVG (`svg_cat.svg`) observing strokes. |
| **Hardcoded Kanji "静" Data** | `STATIC-TO-DYNAMIC` | `GET /api/kanji/{character}` | Replaced with dynamic lookup from `kanjidic2` and `kanji_vg`. |

---

### 2.6 Screen 6: Test Simulation (`TestLiveScreen`)
*Stitch Reference ID: `9cb54725589d4626ba25c633aa8bb7f2`*  
*Ground Truth Spec: `stitch.md` Section 4.4.1–4.4.8*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **Exam Header Strip** | `KEEP` | `backend/app/study/exam/session.py`, `backend/app/study/exam/blueprints.py` | Exam title (e.g. JLPT N3 Official Simulation), Section name, Question index. |
| **Anti-Cheat Persistent Timer** | `KEEP` | `backend/app/study/exam/session.py:get_remaining_seconds`, `[ANIM_SLOT: timer-urgent-pulse]` | Persistent countdown timer. Pulses red/amber when < 5 minutes remaining. Supports Pause/Resume. |
| **Mascot Proctor Slot `[MASCOT_SLOT: test-exam-proctor]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:121` | Labeled 80x80 placeholder slot beside timer. |
| **Split-View Reading Passage Pane** | `KEEP` | `backend/app/study/contracts/f4.py`, `backend/app/study/markup/` | Strict `#000000` pitch black pane rendering long-form reading passages with furigana markup and passage anchors. |
| **Pitch-Black Question Prompt Card** | `KEEP` | `backend/app/study/markup/to_plain_text.py`, `backend/app/study/contracts/` | Question prompt rendered in high-contrast text on pitch-black background with underline blanks. |
| **4-Choice Option Cards** | `KEEP` | `desktop/src/study_api_client.js:recordExamCandidateSelection` | Tactile options 1–4 with keyboard shortcuts (`1`, `2`, `3`, `4`) and selected state indicator. |
| **"Mark for Review" Flag Button** | `KEEP` | `backend/app/study/exam/service.py:record_candidate_selection` | Toggles bookmark flag on current question for quick review before finishing. |
| **32-Item Question Palette Bar** | `KEEP` | `backend/app/study/exam/session.py:get_item_palette` | Grid of numbered buttons showing question state: Unanswered (grey), Answered (vermilion), Flagged (gold star). |
| **Finish Section / Submit Button** | `KEEP` | `POST /api/study/v1/exam/sessions/{id}/finish` | Triggers confirmation modal and calculates estimated scaled score snapshot. |
| **Instant Grading Banner / Feedback** | `REMOVE` | `stitch.md` Section 4.4.7 (Strict Exam Rules) | Official JLPT exams forbid instant feedback. Dropped from Test screen (belongs in Study). |
| **Hardcoded N3 Exam Question & Passage** | `STATIC-TO-DYNAMIC` | `window.desktopAPI.studyRequest({ endpoint: '/api/study/v1/exam/sessions/...' })` | Bind dynamically to active exam session from local `study.db`. |

---

### 2.7 Screen 7: Study Practice (`StudyPracticeActiveScreen`)
*Stitch Reference ID: `1734b13c8bc4406a9f3f2ad14ae8bcdd`*  
*Ground Truth Spec: `stitch.md` Section 4.5.1–4.5.7*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **Practice Session Header** | `KEEP` | `desktop/src/study_api_client.js:getPracticeSession` | Drill topic/level badge (e.g. N3 Grammar Practice), Question counter (`Item 4 of 15`), Active elapsed timer. |
| **Pitch-Black Question Card (F1–F6)** | `KEEP` | `backend/app/study/contracts/`, `backend/app/study/markup/` | Strict `#000000` pitch black surface displaying target vocabulary/grammar question with furigana ruby markup. |
| **Interactive Choice Buttons (1–4)** | `KEEP` | `desktop/src/study_api_client.js:gradePracticeItem` | Tactile buttons depressing to `translate(2px, 2px)` on click; submits objective grade. |
| **Objective Grading Feedback Banner** | `KEEP` | `backend/app/study/session/grader.py:DeterministicGrader`, `[ANIM_SLOT: grade-feedback-pop]` | Jade green spring pop (`+10 Points • 正解`) for correct; Vermilion shake for incorrect. |
| **Pedagogical Explanation Card** | `KEEP` | `backend/app/study/verification/explanation.py` | Nuanced explanation breaking down the grammatical rule, correct usage, and common misconceptions. |
| **Adaptive Repetition Rating Bar** | `KEEP` | `backend/app/study/session/service.py:record_feedback`, `calculate_priority_score()` | Three tactile buttons: `Easy [1]`, `Normal [2]`, `Hard [3]`. Adjusts priority score in `study.db`. |
| **Next Question Button** | `KEEP` | `desktop/src/study_api_client.js:advancePracticeSession` | Advances to the next eligible question in the active session. |
| **Mascot Cheer Slot `[MASCOT_SLOT: study-drill-cheer]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:122`, `assets/dekstop/rainbow cat.json` | Lottie celebration cat animation or labeled placeholder slot. |
| **Audio Pronunciation Player (F5/F6)** | `ADD` | `backend/app/study/media/media_store.py`, `backend/app/api/study/media.py` | Stitch missed listening question audio player; added RFC 7233 byte-range audio player bar. |
| **Hardcoded Question & Choices** | `STATIC-TO-DYNAMIC` | `window.desktopAPI.studyRequest({ endpoint: '/api/study/v1/practice/sessions/...' })` | Bind to live session generated by `PracticeService`. |

---

### 2.8 Screen 8: Global Settings (`GlobalSettingsScreen`)
*Stitch Reference ID: `b5e8ddda60ae4f59a8158894f5e04989` (Canonical) / `f76fce792bb244ef9e4f6e1ec24379a4` (Canvas Variant 1)*  
*Ground Truth Spec: `stitch.md` Section 4.6.1–4.6.7*

| Section / Element | Classification | Ground Truth Mapping (File : Symbol / Route) | Action & Rationale |
|---|---|---|---|
| **Stitch Standalone Chrome & Dock** | `REMOVE` | Addendum 1 Rule | Drop in favor of shared home top chrome and bottom dock. |
| **AnkiConnect Integration Card** | `KEEP` | `backend/app/config.py:ANKI_CONNECT_URL`, `POST /api/anki/test` | AnkiConnect URL input, default deck dropdown, and Test Connection button. |
| **Yomitan Integration Card** | `KEEP` | `backend/app/config.py:YOMITAN_URL`, `GET /api/dictionary/status` | Yomitan dictionary provider endpoint and Test Connection button. |
| **OCR Daemon Controls Card** | `KEEP` | `GET /api/ocr/status`, `POST /api/ocr/start`, `POST /api/ocr/stop` | Port 21829 status indicator, Start/Stop toggle button, model path info. |
| **LLM Provider Configuration Card** | `KEEP` | `GET /api/llm/settings`, `POST /api/llm/settings`, `POST /api/llm/test` | Provider dropdown (Groq, Gemini, Ollama, None), model name input, API key input (DPAPI-encrypted), Test Latency button (`[ANIM_SLOT: test-connection-spin]`). |
| **Subprocess Health & Doctor Report** | `KEEP` | `backend/app/study/doctor.py:run_doctor`, `desktop/src/study_api_client.js:runDoctorCheck` | Runs read-only diagnostic inspecting SQLite integrity, triggers, media hashes, migration status. |
| **System Folder Affordances** | `KEEP` | `desktop/src/main.js:openUserDataFolder`, `openExtensionInstructions` | "Open App Data Folder" and "View Extension Setup Instructions" buttons. |
| **Restart Backend Button** | `KEEP` | `window.desktopAPI.restartBackend()`, `desktop/src/main.js` | Triggers graceful supervisor restart of local FastAPI backend tree. |
| **Mascot Slot `[MASCOT_SLOT: settings-mechanic-cat]`** | `KEEP-VISUAL-ONLY` | `DESIGN.md:123` | Labeled 100x100 placeholder slot in header. |
| **Hardcoded Telemetry & Latencies** | `STATIC-TO-DYNAMIC` | `GET /api/health`, `POST /api/llm/test` | Bind to live health responses and LLM latency pings. |

---

## 3. Animations, Transitions & Motion Inventory

All animations from Stitch and `DESIGN.md` are preserved faithfully using crisp CSS spring curves (`cubic-bezier(0.34, 1.56, 0.64, 1)`).

### 3.1 Screen-by-Screen Motion Registry

| Animation / Interaction Name | Screen & Trigger | Duration & Easing | Animated Properties & Physics Intent |
|---|---|---|---|
| **Wordmark Letter Lift** | Header Wordmark (`:hover`) | 120ms ease-out | `transform: translateY(-2px)` with 30ms sequential letter stagger. |
| **Tactile Stamp Depression** | Primary Buttons (`:active`) | 80ms snappy | `transform: translate(2px, 2px); box-shadow: 1px 1px 0 #151413`. |
| **Tactile Button Lift** | Primary Buttons (`:hover`) | 80ms snappy | `transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #151413`. |
| **Nav Tab Active Glide (`[ANIM_SLOT: nav-tab-spring-glide]`)** | Bottom Dock Tab Click | 240ms `cubic-bezier(0.34, 1.56, 0.64, 1)` | Sliding red indicator pill with smooth horizontal translation and scale bounce. |
| **Candidate Dropdown Slide (`[ANIM_SLOT: candidate-dropdown-slide]`)** | Quick Add Search Focus/Typing | 150ms ease-out | Vertical accordion dropdown `opacity: 0 -> 1; transform: translateY(-4px) -> translateY(0)`. |
| **Card Save Stamp (`[ANIM_SLOT: card-save-stamp]`)** | Save Card Button Click | 180ms spring | Physical downward punch `scale(0.96)` followed by spring recovery and green sync dot pulse. |
| **Card Drawer Slide (`[ANIM_SLOT: card-drawer-slide]`)** | Card History Row Click | 250ms `cubic-bezier(0.16, 1, 0.3, 1)` | Right-hand slide-over drawer entry: `transform: translateX(100%) -> translateX(0)`. |
| **Grammar Chip Hover (`[ANIM_SLOT: grammar-chip-hover]`)** | Tokenized Sentence Hover | 80ms ease-out | `transform: translateY(-2px)` with solid gold accent outline highlight. |
| **Encounter Drawer Slide (`[ANIM_SLOT: encounter-drawer-slide]`)** | Past Encounters Click | 200ms ease-out | Smooth vertical slide-open drawer displaying mined sentence context. |
| **Stroke Order Draw (`[ANIM_SLOT: stroke-order-draw]`)** | KanjiVG Stroke Replay | 0.8s per stroke ease-in-out | Progressive SVG `stroke-dashoffset` reveal tracing kanji calligraphic path. |
| **Timer Urgent Pulse (`[ANIM_SLOT: timer-urgent-pulse]`)** | Exam Timer (< 5 mins) | 1000ms infinite | Breathing opacity pulse between `1.0` and `0.4` in vermilion `#D94B38`. |
| **Grade Feedback Pop (`[ANIM_SLOT: grade-feedback-pop]`)** | Practice Drill Answer Click | 200ms spring pop | Correct: green banner pop `scale(1.04) -> scale(1)`. Incorrect: horizontal shake `translateX(-4px, 4px)`. |
| **Settings Gear Rotation** | Settings Icon Hover | 350ms `cubic-bezier(0.34, 1.56, 0.64, 1)` | `transform: rotate(45deg)`. |
| **Test Connection Spin (`[ANIM_SLOT: test-connection-spin]`)** | Test Latency Click | 600ms linear infinite | 360° continuous rotation until HTTP handshake resolves. |

### 3.2 Prefers-Reduced-Motion Compliance & Performance Guardrails
- **Accessibility Fallback:** A mandatory `@media (prefers-reduced-motion: reduce)` block disables all transforms and translations:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- **Performance Guardrails for Low-End Laptops:**
  - Zero backdrop blur (`backdrop-filter`) or heavy gaussian blurs.
  - Zero multiple box-shadows. Shadows are strictly solid 0-blur offsets (`box-shadow: 3px 3px 0 #151413`).
  - Animations operate exclusively on GPU-composited properties (`transform` and `opacity`).
  - Off-screen tab views are unmounted or set to `display: none` to stop animation rAF loops.

---

## 4. Responsive Window Plan & Font Stack Rules

### 4.1 Compact Window (`500 × 750`, Resizable down to `380 × 500`)
- **Top Chrome:** Compresses telemetry dots into compact 8px pips; hides text labels (`● Backend` -> `●`), keeping green/amber status. Wordmark and window controls remain accessible.
- **Layout Flow:** Single-column vertical stack with native smooth scrolling:
  - *Home:* Compact mascot hero stacks above Today's Word; streak badge and continue drill card follow sequentially.
  - *Vocab:* Quick Add input -> Headword hero -> Pitch-black JMdict definition -> Expandable card editor drawer.
  - *Vocab History:* 5 metric pods reflow into 2-column grid; table columns truncate deck/date, showing expression + status; clicking row opens full-height bottom modal sheet.
  - *Grammar:* Analyzer textarea stacks above pitch-black visualizer; grammar point card stacks below.
  - *Kanji:* Stroke order player scales to 100% width with playback controls below; readings and compounds table follow sequentially.
  - *Test / Study:* Split view collapses into vertical sequence: passage card on top (max height 240px, scrollable), question and 4 tactile choice buttons below.
- **Floating Bottom Dock:** Pill width contracts to fit viewport; tab labels hide on < 420px, displaying crisp SVGs with 10px padding.

### 4.2 Expanded Window (`>= 1024px`, up to 4K)
- **Top Chrome:** Full telemetry strip with port labels, connection latency, wordmark, history, and settings buttons.
- **Two-Column Asymmetric Stage:**
  - *Left Zone (50–55% width):* Dedicated to reading, passage comprehension, stroke canvas, or dictionary definitions.
  - *Right Zone (45–50% width):* Dedicated to interactive controls, card mining form, question choices, or inspector drawers.
- **Mascot Presence:** Dedicated `[MASCOT_SLOT: ...]` container sits prominently at top-right without colliding with content.
- **History Data Grid:** Full multi-column table with persistent right-hand slide-over inspector drawer.

### 4.3 Typography & Font Stack Contracts
- **English-Only UI Labels:** All system headers, buttons, tabs, badges, settings, and instructions are in English.
- **Japanese Content Font Stack:** Japanese text appears exclusively as user-mined study material.
  - *Japanese Headwords & Greetings:* `Mochiy Pop One`, sans-serif.
  - *Brand Wordmark & Editorial Headings:* `Zen Old Mincho`, Georgia, serif.
  - *Japanese Body Text, Sentences, Kanji & Reading:* `Zen Kaku Gothic New`, sans-serif.
  - *UI Labels, Timers, Counters, Monospace Shortcuts:* `Inter`, system-ui, sans-serif.
- **Mandatory Pitch Black Surface:**
  - `#000000` pitch black background strictly applied to JMdict dictionary entries, KanjiVG stroke canvas, exam reading passages, and practice question cards (`DESIGN.md:22`, `stitch.md:26`).

---

## 5. Assets Inventory & Slot-to-Asset Mapping

### 5.1 Assets Inspection & Inventory (`assets/dekstop`)
*Note on folder location:* The physical asset directory in the repository is `assets/dekstop` (spelled `dekstop`, matching Stitch project `Kiroku dekstop`). Sibling folder `assets/` holds application icons.

| Asset File Name | Type | Dimensions | File Size | Transparency | Likely Purpose & Performance Assessment |
|---|---|---|---|---|---|
| `kiroku_cat.svg` | SVG Vector | 736 × 736 | 16,123 B (~16 KB) | Yes | **Canonical Kiroku Sphinx Cat:** Primary Home companion mascot with cursor-following pupils. Lightweight vector; approved. |
| `Cat typing.json` | Lottie JSON | 500 × 500 (30 fps, 150 frames) | 13,491 B (~13.5 KB) | Yes | **Cat Typing Animation:** 5.0s smooth loop of cat typing at keyboard. Perfect for Grammar / Study desk. Approved. |
| `Cat typing.svg` | SVG Vector | 500 × 500 | 5,701 B (~5.7 KB) | Yes | **Static Typing Cat:** Static poster fallback for `Cat typing.json`. Approved. |
| `rainbow cat.json` | Lottie JSON | 800 × 800 (60 fps, 40 frames) | 89,493 B (~89.5 KB) | Yes | **Celebration Animation:** Rainbow reward celebration for exam completion or streak milestone. Approved. |
| `rainbowcat_svg.svg` | SVG Vector | 800 × 800 | 68,155 B (~68 KB) | Yes | **Static Rainbow Cat:** Static celebration vector fallback. Approved. |
| `svg_cat.svg` | SVG Vector | 338 × 600 pt | 9,568 B (~9.5 KB) | Yes | **Sitting Cat Vector:** Upright sitting cat watching screen. Ideal for Kanji stroke observation. Approved. |
| `Black Cat Green Eyes Peeping.svg` | SVG Vector | 1440 × 2560 | 5,995 B (~6.0 KB) | Yes | **Peeping Cat:** Curious cat peeking over edge. Suitable for empty/zero-data states. Approved. |
| `Cartoon Black Cat Sticker.png` | PNG Raster | 941 × 1672 | 701,142 B (~701 KB) | Yes (RGBA) | **Oversized Vinyl Sticker:** Flagged as too heavy (701 KB) for runtime bundling. Retained in assets, but excluded from renderer in favor of SVGs. |
| `assets/icon.png` | PNG Raster | 256 × 256 | 23,591 B (~24 KB) | Yes | **Desktop App Icon:** Application logo and window chrome identity. Approved. |

### 5.2 Slot-to-Asset Mapping Table

| Mascot / Graphic Slot Identifier | Screen & Location | Assigned Asset Path | Status / Reason |
|---|---|---|---|
| `[MASCOT_SLOT: home-companion-sphinx]` | **HomeScreen** (Left Hero) | `assets/dekstop/kiroku_cat.svg` | **Asset Used:** Canonical cat mascot with interactive pupil tracking. |
| `[MASCOT_SLOT: grammar-attentive-study]` | **GrammarAnalyzeScreen** (Header/Input) | `assets/dekstop/Cat typing.json` | **Asset Used:** Exact semantic match (cat typing/studying Japanese notes). |
| `[MASCOT_SLOT: kanji-stroke-observing]` | **KanjiMainScreen** (Beside Stroke Canvas) | `assets/dekstop/svg_cat.svg` | **Asset Used:** Exact match (upright sitting cat observing strokes). |
| `[MASCOT_SLOT: test-result-celebration]` | **TestLiveScreen** (Exam Completion Hero) | `assets/dekstop/rainbow cat.json` | **Asset Used:** Celebration reward animation for passing exam simulation. |
| `[MASCOT_SLOT: vocab-idle-reading]` | **VocabMainScreen** & **VocabHistoryScreen** | *Placeholder Kept* | No pocket-dictionary reading pose exists yet. Labeled placeholder preserved. |
| `[MASCOT_SLOT: test-exam-proctor]` | **TestLiveScreen** (Exam Header) | *Placeholder Kept* | No proctor cat pose exists yet. Labeled placeholder preserved. |
| `[MASCOT_SLOT: study-drill-cheer]` | **StudyPracticeActiveScreen** (Feedback) | *Placeholder Kept* | Labeled placeholder preserved; quick one-line swap when pose art is added. |
| `[MASCOT_SLOT: settings-mechanic-cat]` | **GlobalSettingsScreen** (Header Right) | *Placeholder Kept* | No mechanic cat pose exists yet. Labeled placeholder preserved. |

*Asset Swapping Architecture:* All mascot slots reference a single mapping in `desktop/src/ui/assets_map.js`. Adding a new cat pose later is a single-line path update.

---

## 6. Dropped Chrome & Proposed Adjustments Register

### 6.1 Stitch Header/Nav/Footer Dropped in Favor of Home Shell (Addendum 1)
In strict accordance with Addendum 1 ("HOME CHROME IS THE ONLY CHROME"), every navigation header and dock generated by Stitch on interior screens is dropped:

| Screen Name | Stitch Dropped Header / Navigation Elements | Replacement from Shared Home Shell |
|---|---|---|
| **VocabMainScreen** | Dropped Stitch custom top bar (`<header class="fixed top-0...">`) and Stitch bottom pill dock (`<nav class="fixed bottom-6...">`). | Replaced by shared top chrome (Wordmark, live telemetry, window controls) and shared bottom dock with active `Vocab` pill. |
| **VocabHistoryScreen** | Dropped Stitch custom header with duplicate window dots and duplicate bottom navigation. | Replaced by shared top chrome and bottom dock with active `Vocab` pill. Screen title and search bar moved into page body. |
| **GrammarAnalyzeScreen** | Dropped Stitch header and dock. Page title moved to top of body container. | Replaced by shared top chrome and bottom dock with active `Grammar` pill. |
| **KanjiMainScreen** | Dropped Stitch header and dock. Kanji search bar moved to top of body container. | Replaced by shared top chrome and bottom dock with active `Kanji` pill. |
| **TestLiveScreen** | Dropped Stitch global window header and dock. Exam-specific countdown timer and proctor header retained inside exam stage. | Replaced by shared top chrome and bottom dock with active `Test` pill. |
| **StudyPracticeActiveScreen** | Dropped Stitch global window header and dock. Drill session counter and timer retained inside drill card header. | Replaced by shared top chrome and bottom dock with active `Study` pill. |
| **GlobalSettingsScreen** | Dropped Stitch header and dock. Page title moved to top of body container. | Replaced by shared top chrome and bottom dock with active `Settings` link. |

### 6.2 Proposed Adjustments Register (Addendum 2)

#### Category A: Polish-Level Adjustments (Pre-Approved under Addendum 2)
1. **Container Padding & Safe Areas:** Adjusted body top padding to `pt-16` (`64px`) and bottom padding to `pb-28` (`112px`) across all interior screens so content never collides with or scrolls under the fixed top chrome or floating bottom dock.
2. **Unified Tactile Classes:** Normalized divergent Stitch button classes (`.tactile-btn`, `.tactile-pill`, `.tactile-card`) into a single shared `desktop/src/ui/styles/tactile.css` with identical 1.5px borders and 3px offset drop shadows.
3. **Contrast & Legibility on Pitch-Black Surfaces:** In JMdict glosses and question prompts, set text to `#F5F1E8` (Warm Paper) with furigana in `#C8A94A` (Gold Eye) to ensure AAA contrast against `#000000`.
4. **Offline Font Sourcing:** Replaced external Google Fonts `<link>` tags with local `@font-face` links to `assets/fonts/*.woff2`.
5. **Icon SVG Normalization:** Replaced external Material Symbols font references with inline accessible vector SVGs.

#### Category B: Larger Adjustments (Awaiting User Approval)
1. **Vocab vs History Tab Architecture:** In Stitch, "Card History & Inventory" was designed as a full separate screen with its own header. We propose treating **Vocab** and **History** as sub-views within the single **Vocab** tab (toggled via a segmented switch `[Word Mining | History Log]` in the page body, or opened directly via the top History clock button).
2. **Settings Modal vs Full Route:** In Stitch, Settings was designed as a full 1280px screen (`f76fce792bb244ef9e4f6e1ec24379a4`). We propose rendering Settings as a full route inside the shell that can also be toggled as a slide-over modal over any active screen when pressing the top Gear button.

---

## 7. Implementation Milestones & Verification Plan

### Milestone 0: Shell Extraction & Navigation Foundation (Addendum 1 & 4) — [COMPLETED]
- **Scope:** Extract the top chrome (wordmark, window controls, live telemetry indicators, history/settings buttons) and bottom floating dock (6 tabs: Home, Vocab, Grammar, Kanji, Test, Study) from `UI-exploration/` into a single shared app shell component (`desktop/src/ui/shell/`). Make the Home screen consume the shared shell.
- **Files to Create / Modify:**
  - Create: `desktop/src/index.html`
  - Create: `desktop/src/ui/shell/top_chrome.js`
  - Create: `desktop/src/ui/shell/bottom_dock.js`
  - Create: `desktop/src/ui/shell/shell.css`
  - Create: `desktop/src/ui/router.js`
  - Modify: `desktop/src/main.js` (point default window load to `desktop/src/index.html` when ready)
- **Risk:** Regressing Home screen visuals or breaking frameless window drag controls.
- **Test Plan:**
  - Automated: `npm.cmd run test:desktop` (verify 32/32 tests pass).
  - Manual Checklist: Verify Home is pixel-identical to `UI-exploration/home/index.html` at both `500 × 750` and `1280 × 800`. Verify window controls (minimize, maximize, close) work. Verify all 6 bottom nav tabs click and highlight.
- **Acceptance Criteria:** Home screen unchanged, shell shared, active-state works for all tabs, both window sizes verified.
- **Rollback Note:** `desktop/src/main.js` can be pointed back to `shell.html`.

### Milestone 1: Shared Foundation (Design Tokens, Local Fonts, Tactile Physics, API Layer) — [COMPLETED]
- **Scope:** Establish `tokens.css` from `_design-system/global.css`, bundle local woff2 fonts, implement `.tactile-btn`, `.tactile-card`, `.tactile-pill` physics, `#000000` pitch-black utility, and build the central data clients (`api_client.js` and `study_client.js`).
- **Files to Create:**
  - `desktop/src/ui/styles/tokens.css`
  - `desktop/src/ui/styles/tactile.css`
  - `desktop/src/ui/styles/fonts.css`
  - `desktop/src/ui/services/api_client.js`
  - `desktop/src/ui/services/study_client.js`
  - `desktop/src/ui/services/telemetry.js`
  - `desktop/src/ui/assets_map.js`
- **Risk:** Broken font paths or incorrect API error handling.
- **Test Plan:** Automated desktop IPC tests; verify live telemetry pings Backend, Yomitan, AnkiConnect, and OCR.
- **Acceptance Criteria:** Tokens and fonts render offline; telemetry chips update dynamically within 3s.

### Milestone 2: Screen 1 — Vocab Main (Word Showcase, WanaKana IME, Mining Form) — [COMPLETED]
- **Scope:** Implement `VocabMainScreen` inside shared shell: WanaKana IME input, candidate search dropdown (`[ANIM_SLOT: candidate-dropdown-slide]`), headword showcase, pitch-black JMdict gloss, radical breakdown, card mining form with AnkiConnect sync status pill.
- **Files to Create:**
  - `desktop/src/ui/views/vocab_main.js`
  - `desktop/src/ui/styles/vocab.css`
- **Risk:** WanaKana IME input handling conflicts with Electron keyboard events.
- **Test Plan:** Manual search for "taberu" -> converts to "たべる" -> searches JMdict -> populates form -> saves card to local DB and verifies Anki sync status.
- **Acceptance Criteria:** Cards save to local SQLite; duplicate detection flags existing cards; pitch-black reading card renders with AAA contrast.

### Milestone 3: Screen 2 — Vocab History (Inventory Grid, Telemetry Metrics, Slide-Over Inspector) — [COMPLETED]
- **Scope:** Implement `VocabHistoryScreen`: 5 telemetry cards, bulk selection bar, cards data table with pagination and status filters, slide-over card inspector drawer (`[ANIM_SLOT: card-drawer-slide]`), failed sync retry with troubleshooting alert.
- **Files to Create:**
  - `desktop/src/ui/views/vocab_history.js`
  - `desktop/src/ui/styles/history.css`
- **Risk:** High card count performance degradation in table DOM.
- **Test Plan:** Verify table pagination (25 items/page); test bulk delete and bulk sync; open inspector drawer.
- **Acceptance Criteria:** Table binds to `GET /api/cards`; sync retry invokes `/api/cards/sync`; drawer slides smoothly without layout shift.

### Milestone 4: Screen 3 — Grammar Studio (Sentence Analyzer, Visualizer, Grammar Card) — [COMPLETED]
- **Scope:** Implement `GrammarAnalyzeScreen`: sentence textarea, pitch-black tokenized visualizer with hover chips (`[ANIM_SLOT: grammar-chip-hover]`), grammar point card, mastery status toggle pills (`New`/`Learning`/`Known`), past encounters drawer (`[ANIM_SLOT: encounter-drawer-slide]`), and syllabus level distribution bar.
- **Files to Create:**
  - `desktop/src/ui/views/grammar.js`
  - `desktop/src/ui/styles/grammar.css`
- **Risk:** Complex Japanese grammatical tokenization failure on edge cases.
- **Test Plan:** Enter "雨が降っているから、傘を持って行ったほうがいい。" -> verify tokens highlight -> check past encounters.
- **Acceptance Criteria:** Tokens mapped correctly to master grammar index; status updates persist in SQLite.

### Milestone 5: Screen 4 — Kanji Studio (Search, KanjiVG Stroke Player, Readings, Compounds) — [COMPLETED]
- **Scope:** Implement `KanjiMainScreen`: kanji search with JLPT filter, hero glyph container, pitch-black KanjiVG stroke order player (`[ANIM_SLOT: stroke-order-draw]`), on/kun readings table, common compounds table with 1-click mine card button.
- **Files to Create:**
  - `desktop/src/ui/views/kanji.js`
  - `desktop/src/ui/styles/kanji.css`
- **Risk:** SVG stroke order replay animation stutter.
- **Test Plan:** Search kanji "静" -> play stroke animation -> step through stroke slider -> click "Mine" on compound.
- **Acceptance Criteria:** KanjiVG paths render smoothly; compound mining saves directly to cards table.

### Milestone 6: Screen 5 — Test Engine (JLPT Simulation, Timer, Split Passage, Question Palette) — [COMPLETED]
- **Scope:** Implement `TestLiveScreen`: exam header with persistent anti-cheat countdown timer (`[ANIM_SLOT: timer-urgent-pulse]`), proctor mascot slot, split-view F4 reading passage pane (`#000000` pitch black), 4-choice tactile options, mark for review toggle, 32-item question palette bar, and finish section submission modal.
- **Files to Create:**
  - `desktop/src/ui/views/test.js`
  - `desktop/src/ui/styles/test.css`
- **Risk:** Countdown timer drift or cheating via route navigation.
- **Test Plan:** Start official N3 simulation -> answer questions -> toggle mark for review -> verify timer persistence -> finish exam and verify score estimation snapshot.
- **Acceptance Criteria:** Session state persisted in `study.db`; strict no-feedback rule maintained during exam.

### Milestone 7: Screen 6 — Study Engine (Practice Drill, Objective Grader, Nuance Explanation) — [COMPLETED]
- **Scope:** Implement `StudyPracticeActiveScreen`: practice drill header, pitch-black question prompt card, 4 tactile answer choices, objective grading banner (`[ANIM_SLOT: grade-feedback-pop]`), pedagogical explanation card, adaptive difficulty rating (Easy/Normal/Hard), and next question button.
- **Files to Create:**
  - `desktop/src/ui/views/study.js`
  - `desktop/src/ui/styles/study.css`
- **Risk:** Feedback priority calculation sync latency.
- **Test Plan:** Start practice drill -> select choice -> verify instant green/vermilion banner -> click "Normal" rating -> verify advance.
- **Acceptance Criteria:** Graded deterministically without AI; feedback score updates priority score in `study.db`.

### Milestone 8: Screen 7 — Global Settings (Integrations, LLM Config, Doctor Diagnostics) — [COMPLETED]
- **Scope:** Implement `GlobalSettingsScreen`: AnkiConnect configuration, Yomitan status, OCR daemon controls, LLM provider settings with DPAPI encrypted storage, Test Latency button (`[ANIM_SLOT: test-connection-spin]`), Subprocess Doctor report, and app data / log affordances.
- **Files to Create:**
  - `desktop/src/ui/views/settings.js`
  - `desktop/src/ui/styles/settings.css`
- **Risk:** Accidental exposure of encrypted secrets.
- **Test Plan:** Change Anki port -> test connection -> save LLM key -> run Doctor check -> verify secret store remains redacted in logs.
- **Acceptance Criteria:** Secrets safely stored via Windows DPAPI; Doctor report executes read-only diagnostics without DB mutations.

### Milestone 9: Final Hardening, Responsive Verification & Packaging
- **Scope:** Execute full end-to-end verification across both window sizes (`500 × 750` compact and maximized), run all test suites against recorded baselines (backend 1087 passed / 2 warnings, extension 255 passed, desktop 32 passed), run package build (`release/build-desktop.ps1`).
- **Acceptance Criteria:** Zero regression across backend, extension, and desktop test suites; clean executable launch.

---

## 8. Gaps & Missing Endpoints Register

The following items were identified where Stitch designs diverged from existing code or where backend endpoints are partially implemented:

1. **Kanji Compounds Endpoint (`GET /api/kanji/{character}/compounds`):**
   - *Status:* `PARTIAL`. `kiroku_dictionary/kanjidic.py` contains headword lookup and stroke counts, but a dedicated endpoint returning pre-filtered common compounds for a single kanji character is missing.
   - *Resolution Strategy:* Query `GET /api/dictionary/search` with the kanji headword or resolve via existing `YomitanService` provider seam. No new route invented silently; documented as an open question.
2. **Grammar Encounters Listing by Point ID (`GET /api/grammar/points/{point_id}/encounters`):**
   - *Status:* `PARTIAL`. `backend/app/services/grammar_tracker.py` has `get_encounters_for_grammar_point()`, but the HTTP route currently accepts a sentence rather than an explicit point ID.
   - *Resolution Strategy:* Wire past encounters drawer to filter user's locally mined cards via `GET /api/cards?q=...` or use existing tracker function.
3. **DO NOT DESIGN Items Identified in Stitch Output (Dropped):**
   - *SRS Review Scheduling Engine:* Stitch included mock SRS interval badges ("Review in 4 days"). Dropped (AnkiConnect owns SRS).
   - *Cloud Sync Buttons:* Dropped (Study bank is 100% offline).
   - *AI Chat Dialog Stream:* Dropped (Kiroku is not a chatbot; only single-shot `/api/llm/ask` exists).

---

## 9. Open Questions for the User

1. **Vocab vs History Tab Placement:** Should "History & Inventory" exist as a toggleable view inside the **Vocab** tab (with a deep-link from the top History icon), or should History have a dedicated shortcut in the Home launcher?
2. **Settings Window Experience:** Should clicking the top Settings gear open Settings as a full route in the main viewport or as a slide-over modal drawer over the current screen?
3. **Mascot Asset for Vocab / Study:** For the slots without custom pose art (`[MASCOT_SLOT: vocab-idle-reading]`, `[MASCOT_SLOT: study-drill-cheer]`), would you like us to use `Cat typing.json` / `svg_cat.svg` temporarily or keep the clean labeled placeholder slots?
4. **Kanji Compounds Data Source:** May we resolve kanji compounds dynamically by querying the existing dictionary provider search (`/api/dictionary/search?q={kanji}`), or would you prefer a dedicated backend helper route?

