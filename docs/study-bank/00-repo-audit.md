# Kiroku Note — JLPT Question Bank: Repository Audit & Technical Baseline

**Document ID:** `docs/study-bank/00-repo-audit.md`  
**Milestone:** Milestone 0 (Audit & Design)  
**Date:** 2026-10-30  
**Status:** Completed & Verified  

---

## 1. Executive Summary & Purpose

This audit establishes the concrete architectural and operational baseline for the **JLPT Question Bank & Custom Examination System** backend within Kiroku Note. 

Per the project ground rules in `AGENTS.md` and user directives:
- The backend foundation must be fully designed, implemented, and verified before the desktop user interface is constructed.
- The existing Electron desktop shell (tested and functional as of 2026-10-29 / 2026-10-30) and browser extension must remain fully operational and unaltered.
- The Question Bank is strictly local user data stored in a separate SQLite database: `study.db`. It must never be committed to version control, never bundled into installers, never synced to cloud queues (Render, Neon, or PostgreSQL), and never coupled to AnkiConnect.

---

## 2. Environment & Runtime Probing

All runtime versions and test suites were independently probed and executed on Windows x64:

| Component | Verified Specification | Notes |
|---|---|---|
| **Operating System** | Windows 10/11 x64 (NT kernel) | Target production and development host |
| **Python Version** | `Python 3.11.1` (64-bit) | Standard CPython runtime |
| **Development SQLite** | `SQLite 3.39.4` | Built into Python 3.11.1 standard library |
| **Node.js Runtime** | `v24.x` | Used for extension and desktop test suites |
| **FastAPI / Pydantic** | FastAPI with Pydantic v2 | Standard schemas, strict typing, discriminated unions |
| **Backend Port** | `127.0.0.1:21828` | Default port, configurable via `KIROKU_PORT` |
| **OCR Daemon Port** | `127.0.0.1:21829` | Optional standalone loopback daemon |

### 2.1 SQLite Engine Capabilities (`v3.39.4`)

SQLite 3.39.4 provides robust database primitives that directly support our requirements:
1. **STRICT Tables**: Enabled in SQLite 3.37.0+. Allows schema enforcement of types (`INT`, `TEXT`, `REAL`, `BLOB`, `ANY`).
2. **Foreign Key Enforcement**: Enabled via `PRAGMA foreign_keys = ON;` per connection. Supports `ON DELETE RESTRICT` and `ON DELETE CASCADE`.
3. **WAL Mode**: `PRAGMA journal_mode = WAL;` with `PRAGMA busy_timeout = 10000;` provides concurrent read operations alongside write transactions.
4. **Triggers for Immutability**: Supports `BEFORE UPDATE` and `BEFORE DELETE` triggers raising `RAISE(ABORT, 'message')` to enforce append-only revisions at the database engine level.
5. **JSON Functions**: Built-in `json()`, `json_extract()`, `json_array()`, and `json_each()` without external compilation.
6. **Generated Columns & Indexes**: Allows expression-based indexes and deterministic derived fields.
7. **RETURNING Clause**: Supported since SQLite 3.35.0 for atomic inserts and key retrieval.

---

## 3. Test Baseline Metrics

A complete run of all test suites was executed prior to modifying any files. All test suites passed with zero regressions:

```text
==================================== Baseline Test Summary ====================================
1. Backend Test Suite (Pytest):
   Command: $env:PYTHONPATH='.;backend'; python -m pytest backend/tests -q
   Results: 740 passed, 1 warning, 256 subtests passed in 102.75s (0:01:42)
   Status:  100% PASS

2. Extension Test Suite (Node Test Runner):
   Command: node --test extension/tests/*.test.js
   Results: 255 passed, 0 failed, 0 skipped in 7.19s
   Status:  100% PASS

3. Desktop Shell Test Suite (Electron Supervisor & Security):
   Command: npm.cmd run test:desktop
   Results: 10 passed, 0 failed, 0 skipped in 1.84s
   Status:  100% PASS
================================================================================================
```

---

## 4. Architectural Boundaries & Subsystem Audit

### 4.1 Database Access & Migration Infrastructure
- **Current Pattern (`backend/app/db/connection.py`)**:
  - Connects to `kiroku.db` (or legacy `ankiminer.db`) via `sqlite3.connect()`.
  - Sets `conn.row_factory = sqlite3.Row`, `foreign_keys = ON`, `journal_mode = WAL`.
  - Schema initialization is handled procedurally in `init_db()` via `executescript(SCHEMA_SQL)` followed by ad-hoc `ALTER TABLE ... ADD COLUMN` checks on `PRAGMA table_info`.
  - **Audit Finding**: The current codebase lacks a structured migration framework. 
  - **Decision for `study.db`**: We will establish a dedicated connection manager (`study_db_connection.py`) using ordered, forward-only SQL migration scripts with `PRAGMA user_version` tracking, accompanied by an automatic database pre-migration file backup routine (`study.db.vX.bak`).

### 4.2 Data Directory & Path Resolution (`backend/app/config.py`)
- Resolution order:
  1. Explicit `KIROKU_DATA_DIR` environment override.
  2. Frozen/packaged mode: `%LOCALAPPDATA%\KirokuNote\data` (Windows).
  3. Development mode: `<repo_root>/backend/data`.
- **Media Storage**:
  - `MediaStorageService` (`backend/app/services/media_storage.py`) resolves `get_media_dir()` (`%LOCALAPPDATA%\KirokuNote\media` in packaged mode, `<repo_root>/backend/data/media` in dev).
- **Placement for Study Bank**:
  - Database: `get_data_dir() / "study.db"` (respecting environment overrides and `%LOCALAPPDATA%`).
  - Study Media: `get_study_media_dir()` pointing to `get_data_dir() / "study_media"` (or `%LOCALAPPDATA%\KirokuNote\study_media`).
  - Content-addressed hashing: Files will be stored as `sha256_<hash>.<ext>` to deduplicate binary assets across question revisions.

### 4.3 Packaging & Distribution Integrity
- **PyInstaller (`packaging/kiroku_backend.spec`)**:
  - Bundles `app`, `kiroku_dictionary`, `kiroku_cloud_queue`, and `app/data` (including `grammar_reference.sqlite` and `jlpt_reference.sqlite`).
  - User data files (`*.db` in user directories) are explicitly omitted from the bundle.
  - Excludes heavy libraries (`torch`, `pandas`, `scipy`, etc.).
- **Inno Setup (`installer/kiroku_setup.iss`)**:
  - Installs to `{localappdata}\Programs\Kiroku Note`.
  - Dedicated persistent data directories `{localappdata}\KirokuNote\data`, `media`, and `logs` are preserved across installs and uninstalls.
  - `study.db` and `study_media` will reside inside `{localappdata}\KirokuNote\data` and will never be bundled or deleted during upgrades.

### 4.4 Desktop Electron Shell & Supervisor Lifecycle
- **Electron Main Process (`desktop/src/main.js`)**:
  - Single-instance lock enforced (`app.requestSingleInstanceLock()`).
  - Launches 500x750 window, Windows system tray, and close-to-tray handling.
- **Process Supervisor (`desktop/src/process_manager.js`)**:
  - Supervises Python backend on port 21828.
  - Performs health checks against `/api/health`.
  - Adopts existing running instances (e.g., during development or testing) without terminating them on exit.
  - Spawns and supervises `run_backend.py` or `KirokuNote.exe`, terminating cleanly via Windows `taskkill /pid <PID> /T /F`.
  - **Constraint**: Adding Study Bank routers must not interfere with `/api/health` or increase server cold-start latency.

### 4.5 Grammar & JLPT Reference Datasets
- **`backend/app/data/grammar_reference.sqlite`**:
  - Contains 900 canonical concepts across N5–N1 with strict easiest-level enforcement (`N5 > N4 > N3 > N2 > N1`).
  - Read-only index accessed by `GrammarReferenceService` (`backend/app/services/grammar_reference.py`).
  - **Integration Opportunity**: Questions in `study.db` can link to `concept_id` / `pattern_key` foreign references without copying grammar metadata into `study.db`.
- **`backend/app/data/jlpt_reference.sqlite`**:
  - Contains modern OpenJLPT vocabulary and kanji levels.
  - Read-only reference accessed by `JlptReferenceService` (`backend/app/services/jlpt_reference.py`).

### 4.6 OCR Subsystem Boundary
- Standalone optional process running on port 21829.
- Controlled via `OcrProcessManager` and accessed through `OcrService`.
- CPU-only, lazy-loaded.
- The Study Bank ingestion pipeline will interface with `OcrService` for image-based question extraction without importing heavy OCR dependencies into the core backend.

### 4.7 Cloud Queue Isolation Boundary
- `kiroku_cloud_queue/` runs separately on Render/PostgreSQL for card submission from mobile devices.
- Local backend polls cards from the cloud queue into `kiroku.db`.
- **Strict Boundary**: The JLPT Question Bank is strictly local. No `study.db` tables, schemas, or attempts may ever be synchronized through `kiroku_cloud_queue`, Render, or Neon.

---

## 5. Identified Risks & Architectural Mitigations

1. **Risk: Concurrency on SQLite during tests and drills.**
   - *Mitigation*: WAL mode (`PRAGMA journal_mode = WAL;`), explicit connection timeouts (`10.0s`), and dedicated short-lived transactional sessions.
2. **Risk: Accidental corruption or loss of revision immutability.**
   - *Mitigation*: Database-level SQLite triggers that block `UPDATE` and `DELETE` on all revision and child choice/part rows, supplemented by service-layer immutability guards.
3. **Risk: Historical attempt skew when questions or passages are edited.**
   - *Mitigation*: Attempts pin both `(question_id, question_revision_id)` and `(content_group_id, group_revision_id)`. Attempts render exclusively against immutable revision snapshots.
4. **Risk: False question eligibility rendering unanswerable questions in exams.**
   - *Mitigation*: Dynamic multi-factor eligibility evaluation combining SQL view pre-filtering with Python deterministic checks, returning explicit reason codes (`NO_ANSWER`, `REQUIRED_ASSET_MISSING`, etc.).
5. **Risk: Audio/media bloat or orphan accumulation.**
   - *Mitigation*: SHA-256 content-addressed media storage, media metadata records with explicit MIME/size/duration, and database doctor integrity verification routines.

---

## 6. Audit Sign-off

The repository architecture has been verified. The existing codebase is stable, all 740 backend tests, 255 extension tests, and 10 desktop tests pass without defect. The path is clear to proceed with the database schema and contract specification.

