# Phase 0 Baseline and Proof of Failure Report

**Date**: 2026-10-31  
**Target**: Kiroku Note Desktop (`desktop/`) & FastAPI Backend (`backend/`)  
**Branch**: `feature/desktop-wireup`  

---

## 1. Baseline Test Suites Execution

All baselines executed clean prior to changes:

| Suite | Command | Tests Run | Passed | Failed | Warnings | Duration |
|---|---|---|---|---|---|---|
| **Backend Pytest** | `$env:PYTHONPATH="backend;."; python -m pytest backend/tests` | 1,087 | 1,087 | 0 | 2 | 96.13s |
| **Extension Node Tests** | `node --test extension\tests\*.test.js` | 255 | 255 | 0 | 0 | 7.07s |
| **Desktop Tests** | `npm.cmd --prefix desktop test` | 32 | 32 | 0 | 0 | 11.78s |

---

## 2. Real Electron Window Failure Reproduction

### Method
Executed `desktop/tests/run_cors_repro.js`, which:
1. Spawns the live FastAPI backend on `http://127.0.0.1:21828` with an isolated temporary `KIROKU_DATA_DIR`.
2. Launches the real Electron binary (`desktop/node_modules/electron/dist/electron.exe`) loading `file:///.../desktop/src/index.html` with production `webPreferences` (`preload.js`, `contextIsolation: true`, `nodeIntegration: false`).
3. Executes HTTP requests from the renderer context under `file://` origin to verify CORS, network boundaries, and route contracts.

### Captured Evidence (`docs/desktop-wireup/reproduce_cors_evidence.json`)
```json
{
  "windowOrigin": "file://",
  "windowProtocol": "file:",
  "tests": {
    "getHealth": {
      "status": 200,
      "ok": true,
      "headers": {
        "content-length": "89",
        "content-type": "application/json",
        "date": "Sat, 31 Oct 2026 15:11:37 GMT",
        "server": "uvicorn"
      }
    },
    "getStats": {
      "status": 200,
      "ok": true,
      "headers": {
        "content-length": "223",
        "content-type": "application/json",
        "date": "Sat, 31 Oct 2026 15:11:37 GMT",
        "server": "uvicorn"
      }
    },
    "postOldCardsRoute": {
      "status": 405,
      "ok": false,
      "headers": {
        "allow": "GET",
        "content-length": "31",
        "content-type": "application/json",
        "date": "Sat, 31 Oct 2026 15:11:37 GMT",
        "server": "uvicorn"
      }
    },
    "postRealCardsSaveRoute": {
      "status": 200,
      "ok": true
    }
  }
}
```

### Analysis of Root Causes:
1. **Origin Rejection & Security Boundary**:
   In `backend/app/main.py`:
   ```python
   # State-changing methods Origin validation (prevent cross-site forged requests)
   if request.method in ("POST", "PUT", "PATCH", "DELETE"):
       origin = request.headers.get("origin")
       if origin and not ALLOWED_ORIGIN_PATTERN.match(origin):
           return JSONResponse(status_code=403, content={"detail": "Forbidden: Untrusted Origin."})
   ```
   `ALLOWED_ORIGIN_REGEX` allows only `chrome-extension://.*` and `http://(localhost|127.0.0.1)`. Any browser origin `"null"` or `"file://"` is rejected with 403 on state-changing requests, and lacks `Access-Control-Allow-Origin` on GET requests.
   **Per Rule 1**: We do NOT relax CORS to allow "null" or "file://". Instead, the renderer must never use `fetch()` directly to the backend. All backend requests must route through main process IPC (`kiroku:api:request`), mirroring `study:request`.

2. **Route Mismatches in `api_client.js`**:
   - `apiClient.createCard()` sent `POST /api/cards` -> Backend returned `405 Method Not Allowed` (`Allow: GET`). The real endpoint is `POST /api/cards/save`.
   - `apiClient.syncAllPendingCards()` called `POST /api/cards/sync` -> Backend returned `404 Not Found`. The real endpoint is `POST /api/cards/sync-all`.
   - Dictionary search called `GET /api/dictionary/search?q=...` -> Backend returned `404 Not Found`. Real routes: `POST /api/capture` (Japanese) and `GET /api/dictionary/search-english` (English).

3. **Missing Main Process IPC Handler**:
   In `preload.js`:
   ```javascript
   getServicesStatus: () => ipcRenderer.invoke('backend:services-status')
   ```
   In `main.js`: `backend:services-status` was never registered in `setupIpcHandlers()`. Calling it crashed with:
   `Error: No handler registered for 'backend:services-status'`.

---

## 3. Playwright UI Verification Defect Analysis

`desktop/src/verify_ui_playwright.py` failed to catch any of these errors because:
1. It launched standard Chromium (`p.chromium.launch()`), not Electron.
2. It bypassed `desktop/src/preload.js`, leaving `window.desktopAPI` undefined.
3. It ran with zero backend process active.
4. It only asserted that CSS selectors (`#cards-table`, `#jmdict-block`, `.test-option-card[data-choice="2"]`) existed in the DOM. Because the views were hardcoded with static design mockups, all selectors were found and the test reported false success.

---

## 4. PyPDF2 Dependency Analysis & Fix

- **Inspection**: `backend/requirements.txt` contains:
  ```
  fastapi>=0.115,<1.0
  uvicorn>=0.30,<1.0
  Pillow>=10.0,<13.0
  pystray>=0.19,<1.0
  ```
  `PyPDF2` was missing from `backend/requirements.txt` but was imported unconditionally in `backend/app/study/ingestion/adapters/pdf_text.py`.
- **Decision & Fix**:
  PDF ingestion is an optional offline ingestion modality (Milestone 3), not a core runtime dependency. To avoid bloating the minimal runtime requirements and to support both modern `pypdf` and legacy `PyPDF2` without deprecation warnings, the import was converted to a lazy import inside `PdfTextInputAdapter.extract()`. If neither is installed, it raises an actionable `ImportError` when PDF ingestion is explicitly invoked. All 8 ingestion tests pass with zero regressions.

---

## 5. Live Backend Ground-Truth Inventory

Generated via `app.openapi()` to `docs/desktop-wireup/openapi.json` and `desktop/tests/fixtures/openapi.json`:
- **Total Paths**: 95
- **Total HTTP Endpoints**: 103

### Core Route Inventory:
- **Health**: `GET /api/health`
- **Cards & Sync**:
  - `GET /api/cards`, `POST /api/cards/save`, `DELETE /api/cards/bulk`, `POST /api/cards/bulk-deck`, `POST /api/cards/bulk-sync`
  - `GET /api/cards/export`, `GET /api/cards/stats`, `POST /api/cards/sync-all`
  - `GET /api/cards/{card_id}`, `DELETE /api/cards/{card_id}`, `POST /api/cards/{card_id}/sync`
- **Anki Integration**: `GET /api/anki/decks`, `GET /api/anki/models`, `GET /api/anki/model-capabilities`, `GET /api/anki/status`, `POST /api/anki/sync-all`
- **Dictionary & Vocab**:
  - `POST /api/capture` (Unified Yomitan/Local search with card synthesis)
  - `GET /api/dictionary/search-english`
  - `GET /api/known-words`, `POST /api/known-words/mark`, `DELETE /api/known-words/mark/{word}`
  - `POST /api/jlpt/batch`
- **Grammar**:
  - `POST /api/grammar/analyze`, `GET /api/grammar/stats`, `GET /api/grammar/points`
  - `PATCH /api/grammar/points/{pattern_key}`, `GET /api/grammar/points/{pattern_key}/encounters`
  - `POST /api/grammar/setup-check`, `POST /api/grammar/encounters`
- **Kanji**:
  - `GET /api/kanji/strokes/{character}`
- **LLM**:
  - `GET /api/llm/config`, `PUT /api/llm/config`, `POST /api/llm/test`, `POST /api/llm/ask`, `GET /api/llm/status`
- **Study Engine (`/api/study/v1/...`)**:
  - Practice sessions: `POST /api/study/v1/practice/sessions`, `GET /api/study/v1/practice/sessions/{id}`, `POST /api/study/v1/practice/sessions/{id}/answer`, `POST /api/study/v1/practice/sessions/{id}/complete`
  - Exam sessions: `POST /api/study/v1/exam/sessions`, `GET /api/study/v1/exam/sessions/{id}`, `PUT .../answer`, `POST .../submit`
  - Diagnostics & Bank: `GET /api/study/v1/bank/summary`, `GET /api/study/v1/diagnostics`, `GET /api/study/v1/bookmarks`

### Measured Database Row Counts:
- **`backend/app/data/grammar_reference.sqlite`**:
  - `grammar_index`: 900
- **`backend/app/data/jlpt_reference.sqlite`**:
  - `vocab`: 8,334
  - `kanji`: 2,211
  - `grammar`: 100
- **`backend/app/data/kanji_strokes.sqlite`**:
  - `kanji_strokes`: 2,211
- **`kiroku_dict.sqlite`**:
  - `terms`: 436,555
  - `kanji`: 10,384
  - `tags`: 47
  - `meta`: 6
- **`study.db` (Migrated schema)**:
  - 43 STRICT tables initialized via forward migrations 0001–0008
  - Official format taxonomy: 20 formats, 81 level mappings, 5 JLPT exam profiles

