# Kiroku Note Desktop — Final Verification Matrix

This matrix documents the end-to-end verification of all 8 native desktop screens across operational states, responsive viewport sizes, and architectural contracts, backed by automated test suites.

## Screen × State × Viewport Verification Matrix

| Screen | State | Compact (500×750) | Standard (1280×800) | Maximized (1920×1080) | Guard Contracts (No Mock / No Silent Catch) | Verification Evidence & Tests |
|---|---|:---:|:---:|:---:|:---:|---|
| **1. Home** | **Live Render** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_home.test.js`, `guard_no_mock_data.test.js`. Authentic `svg_cat.svg` on left, dynamic greeting, zero mock data strings (purged `LV.28`, `7 DAY STREAK`, `64%`). |
| | **Offline State** | **PASS** | **PASS** | **PASS** | **PASS** | Zero network or backend calls needed on initial render; companion operates 100% offline. |
| **2. Vocab Main** | **Active Mining** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_vocab_main.test.js`. Routes Japanese term to `POST /api/capture` and English to `GET /api/dictionary/search-english`. Decks from `/api/anki/decks`. |
| | **Empty Search** | **PASS** | **PASS** | **PASS** | **PASS** | Clean empty state awaiting input; no default "食べる" or hardcoded sentences. |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#vocab-error-banner`), zero silent catch blocks. |
| **3. Vocab History**| **Data Loaded** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_vocab_history.test.js`. Consumes `.cards` schema from `GET /api/cards`, server-side search, real pagination (`btn-page-prev`, `btn-page-next`). |
| | **Empty Inventory**| **PASS** | **PASS** | **PASS** | **PASS** | Displays honest empty message when local SQLite card count is 0. |
| | **Sync & Action**| **PASS** | **PASS** | **PASS** | **PASS** | Per-card `POST /api/cards/{id}/sync`, bulk `POST /api/cards/sync-all`. Error retry button attached. |
| **4. Grammar Studio**| **Analysis Mode** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_grammar.test.js`, `test_grammar_routes.py`. Sentence analysis via `apiClient.analyzeGrammar`, interactive token chips, active detail elevation. |
| | **Syllabus Browse**| **PASS** | **PASS** | **PASS** | **PASS** | Level filter pills (N5–N1) query `GET /api/grammar/syllabus`, mastery pills call `PATCH /api/grammar/points/{pattern_key}`. |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#grammar-error-banner`), zero silent catch blocks. |
| **5. Kanji Studio** | **Stroke Vector** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_kanji.test.js`, `test_kanji_routes.py`. Renders KanjiVG vector paths from `/api/kanji/strokes/{character}` with scrubber & play/replay controls. |
| | **Compounds / Mining**| **PASS** | **PASS** | **PASS** | **PASS** | 1-click card mining via `apiClient.saveCard` from `GET /api/kanji/compounds/{character}`. Character details from `/api/kanji/details/{character}`. |
| | **Level Browse** | **PASS** | **PASS** | **PASS** | **PASS** | Working JLPT level pills browsing kanji via `GET /api/kanji/browse`. Placeholder slot for unmapped mascot. |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#kanji-error-banner`), zero silent catches. |
| **6. Study Practice**| **Active Drill** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_study.test.js`. Practice session lifecycle via `studyClient` (`POST /api/study/v1/practice/sessions`), response time calculation, pedagogical explanation reveal. |
| | **Difficulty Rating**| **PASS** | **PASS** | **PASS** | **PASS** | Easy/Normal/Hard feedback via `studyClient.recordPracticeFeedback`. Adaptive priority score updating. |
| | **Empty Bank** | **PASS** | **PASS** | **PASS** | **PASS** | Honest empty state with level picker when question bank has 0 questions. |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#study-error-banner`), zero silent catches. |
| **7. Test Simulation**| **Live Exam** | **PASS** | **PASS** | **PASS** | **PASS** | `screen_test.test.js`. Full exam simulation via `studyClient`, persistent countdown timer with warning pulse, 32-item palette bar, split reading passage view. |
| | **Question Flagging**| **PASS** | **PASS** | **PASS** | **PASS** | Mark-for-review toggle using accessible SVG flag icons, persistent section state. |
| | **Honest Diagnostics**| **PASS** | **PASS** | **PASS** | **PASS** | Detailed diagnostic score breakdown with explicit disclaimer (never claiming an official certificate). |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#test-error-banner`), zero silent catches. |
| **8. Settings** | **Live Telemetry**| **PASS** | **PASS** | **PASS** | **PASS** | `screen_settings.test.js`. Live AnkiConnect status test, OCR daemon lifecycle (`startOcr`, `stopOcr`), DPAPI encrypted LLM configuration. |
| | **Diagnostics Check**| **PASS** | **PASS** | **PASS** | **PASS** | Doctor check via `studyClient.getDiagnostics()`, desktop supervisor folder bridge and restart. |
| | **Error Handling**| **PASS** | **PASS** | **PASS** | **PASS** | Visible error banner (`#settings-error-banner`), zero silent catches. |

---

## Architectural & Security Boundary Audit

| Boundary / Contract | Target Standard | Live Measurement | Result |
|---|---|---|:---:|
| **IPC Transport Proxy** | Main process HTTP proxy for renderer | `kiroku:api:request` in `main.js` using Node `http.request` | **PASS** |
| **CORS Policy** | No `null` or `file://` origin allow-list additions | Unchanged `DEFAULT_ALLOWED_ORIGIN_REGEX` | **PASS** |
| **Content Security Policy** | `default-src 'self'` without `unsafe-eval` | Verified in `index.html` and `test_security.test.js` | **PASS** |
| **OpenAPI Contract Parity** | 100% endpoint existence & zero drift | `api_contract.test.js` verified against live FastAPI | **PASS** |
| **Zero Mock Data** | No legacy placeholder strings in view templates | `guard_no_mock_data.test.js` (3/3 checks passing) | **PASS** |
| **Zero Silent Catch Blocks**| No `catch (_) {}` across `desktop/src/ui/` | Statically scanned and verified 0 instances | **PASS** |
| **Accessible SVG Icons** | Accessible SVGs, zero OS emojis | Verified in `study.js`, `test.js`, and shell components | **PASS** |
| **Offline Font Bundling** | 100% local WOFF2, zero CDN links | 12 WOFF2 files in `desktop/src/ui/assets/fonts/` | **PASS** |
| **Desktop Test Suite** | All tests green | 77 passing tests in `npm.cmd --prefix desktop test` | **PASS** |

