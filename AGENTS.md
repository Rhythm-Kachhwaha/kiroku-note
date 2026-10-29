# Kiroku Note Agent Guide

## Purpose and boundaries

Kiroku Note is a local-first Japanese vocabulary and sentence-mining companion:

`see Japanese -> capture -> identify/enrich -> edit -> save locally -> sync to Anki`

The checked-in application is a Windows FastAPI backend plus a Chromium
Manifest V3 extension. It is not an Anki replacement, a cloud SaaS
application, or an AI chatbot.

Locked boundaries:

- The current application UI is the extension Side Panel. It uses vanilla
  HTML, CSS, and JavaScript; do not introduce React, Electron, or Node.js
  runtime code into the extension.
- FastAPI and SQLite are the backend and local source of truth.
- Dictionary access is behind `YomitanService` and the provider seam in
  `backend/app/services/dictionary_provider.py`.
- JLPT data is local and replaceable; do not put JLPT rules in the UI.
- AnkiConnect is an integration, never the source of truth. Failed syncs must
  leave locally saved cards intact.
- User interfaces use accessible SVG icons, not OS emojis.
- The standalone OCR daemon remains optional, CPU-only, lazy-loaded, and
  isolated from the main backend process.

Before modifying a feature, consult its section below, inspect the listed
entry points and dependencies, and then read only the additional files needed
for the specific change. Update this map when a path, owner, or runtime
dependency changes. For design decisions, see
`ARCHITECTURE.md`; `docs/archive/DESIGN.md` is historical and is not an active
design specification.

## Verified project map

```text
backend/
  app/
    main.py                 FastAPI app, lifecycle, middleware, central routes
    config.py               host/port, user-data, resource and provider config
    schemas.py              shared request/response models
    api/                    grammar and subtitle routers
    db/connection.py        SQLite path, connection and schema initialization
    repositories/           card persistence boundary
    services/               domain services and external integration seams
    data/                   bundled grammar/JLPT/KANJIVG runtime resources
  tests/                    backend unit, integration and packaging tests
extension/
  manifest.json             MV3 permissions, scripts and Side Panel entrypoint
  background.js             service worker and backend/message routing
  content/                  capture, media, subtitle, video and OCR scripts
  lib/                      shared browser-side adapters and parsers
  sidepanel/                sole extension UI and feature controllers
  tests/                    Node test suite
kiroku_dictionary/          standalone stdlib-only local dictionary engine
ocr_server/                 optional standalone OCR HTTP daemon
kiroku_cloud_queue/         separately deployable cloud queue and worker
packaging/                  PyInstaller specs and version metadata
installer/                  Inno Setup scripts and installation instructions
release/                    Windows build scripts
tools/                      grammar/index, dictionary and contract utilities
  manual_tests/             retained, explicitly invoked browser checks
docs/                       active technical docs and historical archive
.github/workflows/          backend/extension CI and Windows release workflow
run_backend.py, start_backend.bat root backend launchers
```

## Backend startup and shared infrastructure

1. **Entry point** — `run_backend.py` starts Uvicorn; `start_backend.bat` is
   a Windows convenience wrapper. `backend/app/main.py` creates the FastAPI
   application.
2. **Core logic** — `backend/app/main.py` owns lifespan startup/shutdown,
   CORS/host validation, health checks, and currently also contains many
   card, dictionary, Anki, media, OCR, JLPT, LLM and cloud route handlers.
3. **API/integration** — `backend/app/api/grammar.py` and
   `backend/app/api/subtitle.py` are registered by `main.py`; other routes are
   registered directly there. `backend/app/schemas.py` is the shared API
   contract.
4. **Data/configuration** — `backend/app/config.py` resolves ports, packaged
   resources, `%LOCALAPPDATA%\KirokuNote`, legacy `ankiminer.db` paths, logs,
   LLM configuration and encrypted-secret locations. `backend/app/db/connection.py`
   initializes SQLite and provides `db_session`.
5. **Tests** — `backend/tests/test_backend_security_and_health.py`,
   `test_port_configuration.py`, `test_buildsetup.py`,
   `test_packaging_config.py`, and the full `backend/tests` suite.
6. **Build/runtime dependencies** — `packaging/kiroku_backend.spec` bundles
   `app`, `kiroku_dictionary`, cloud queue modules and `backend/app/data`;
   `release/build-backend.ps1` builds it; `installer/kiroku_setup.iss`
   preserves user data during upgrades.

## Grammar

1. **Entry point** — `backend/app/api/grammar.py` exposes
   `/api/grammar/analyze`, setup, points, stats and encounter endpoints.
2. **Core logic** — `backend/app/services/grammar_service.py`,
   `grammar_matcher.py`, `grammar_reference.py`, and `grammar_tracker.py`.
3. **API/integration** — the router is included by `backend/app/main.py`;
   `extension/sidepanel/sidepanel.js` and content/video controllers request and
   render analysis.
4. **Data/configuration** — `backend/app/data/grammar_reference.sqlite`,
   `backend/app/data/master_grammar_dataset.json`,
   `backend/app/data/master_grammar_provenance.json`,
   `backend/app/data/openjlpt_grammar/`, and grammar attribution notices.
   The dataset strictly enforces the easiest-supported-level rule (N5 > N4 > N3 > N2 > N1).
5. **Tests** — `backend/tests/test_grammar_*.py`,
   `backend/tests/test_master_grammar_reconciliation.py`,
   `extension/tests/*grammar*.test.js`, and `tools/grammar_coverage.py`.
6. **Build/runtime dependencies** — `tools/reconcile_grammar_dataset.py`
   reconciles all 848 reference audit entries with OpenJLPT and curated seeds;
   `tools/build_grammar_index.py` compiles the master dataset into the checked-in
   `grammar_reference.sqlite` index; the PyInstaller spec must continue bundling it.
   Do not regenerate or move the database during unrelated refactors.

## OCR

1. **Entry point** — `python -m ocr_server.server` launches the independent
   loopback daemon on port 21829.
2. **Core logic** — `ocr_server/server.py` performs lazy CPU-only
   `manga-ocr` loading; `backend/app/services/ocr_service.py` is the sole
   client boundary and `ocr_process_manager.py` manages optional processes.
3. **API/integration** — `backend/app/main.py` exposes OCR status/start/stop/
   recognize routes; `extension/content/ocr-selection.js` and
   `extension/lib/ocr-cropper.js` provide capture input.
4. **Data/configuration** — `backend/app/config.py` resolves the OCR URL;
   model discovery is configured through the OCR process manager and
   `KIROKU_OCR_MODEL_PATH`. OCR model files are packaged separately.
5. **Tests** — `backend/tests/test_ocr_*.py`,
   `test_phase6_ocr_code_runtime.py`, and
   `extension/tests/ocr-*.test.js`.
6. **Build/runtime dependencies** — `packaging/kiroku_ocr.spec`,
   `installer/kiroku_ocr_setup.iss`, `release/build-ocr.ps1`, and
   `release/build-ocr-installer.ps1`. Keep OCR optional and isolated.

## LLM and secrets

1. **Entry point** — `/api/llm/*` routes currently live in
   `backend/app/main.py`.
2. **Core logic** — `backend/app/services/llm_service.py` implements the
   provider-neutral request flow and Groq, Gemini, Ollama and compatible
   providers; prompt construction is in the same service.
3. **API/integration** — `backend/app/schemas.py`, `main.py`, and the Side
   Panel settings/ask controllers configure and invoke it.
4. **Data/configuration** — `backend/app/config.py` stores non-secret settings
   in the user data directory; `backend/app/services/secret_store.py` owns
   encrypted Windows DPAPI-backed secret storage.
5. **Tests** — `backend/tests/test_llm_*.py` and `test_secret_store.py`.
6. **Build/runtime dependencies** — preserve provider timeouts, offline
   `none`/Ollama operation, encrypted secrets, and redaction when changing
   configuration or packaging.

## Vocabulary, cards, dictionary and Anki

1. **Entry point** — capture and save requests originate in
   `extension/sidepanel/sidepanel.js` and `extension/content/content.js`;
   backend entrypoints are `/api/capture`, `/api/cards/*`, dictionary routes
   and Anki routes in `backend/app/main.py`.
2. **Core logic** — `backend/app/services/card_service.py`,
   `card_normalizer.py`, `anki_formatter.py`, `media_storage.py`, and
   `verb_metadata.py`; persistence is `backend/app/repositories/card_repository.py`.
3. **API/integration** — `backend/app/services/yomitan.py` is the Yomitan HTTP
   boundary; `dictionary_provider.py` selects Yomitan/local/auto providers;
   `anki_connect.py` is the AnkiConnect boundary.
4. **Data/configuration** — SQLite is resolved by `config.py`; local dictionary
   resources are in `kiroku_dictionary/` and `kiroku_dict.sqlite`; card media
   is resolved by `media_storage.py`.
5. **Tests** — `backend/tests/test_capture_*.py`, `test_cards_*.py`,
   `test_card_*.py`, `test_dictionary*.py`, `test_yomitan*.py`,
   `test_anki*.py`, `test_sync_*.py`, plus corresponding extension tests.
6. **Build/runtime dependencies** — preserve duplicate identity, SQLite-first
   saves, pending/failed sync states, Anki external duplicate checks, and all
   manifest-declared browser message paths.

## Media and subtitles

1. **Entry point** — browser content scripts and Side Panel media controls in
   `extension/content/`, `extension/lib/`, and `extension/sidepanel/`.
2. **Core logic** — `backend/app/services/subtitle_annotator.py`,
   `media_storage.py`, and the capture/media helpers in the extension.
3. **API/integration** — `backend/app/api/subtitle.py` owns subtitle
   annotation and known-word routes; `main.py` registers it.
4. **Data/configuration** — SQLite card/known-word tables and the configured
   media directory; subtitle providers and parsers are in `extension/lib/`.
5. **Tests** — `backend/tests/test_subtitle_*.py`, media/audio/frame stage
   tests, and extension subtitle/capture/video tests.
6. **Build/runtime dependencies** — `extension/manifest.json` must list every
   content script and library in load order; do not mix browser code into
   backend services.

## Browser extension

1. **Entry point** — `extension/manifest.json` points to
   `background.js`, `sidepanel/sidepanel.html`, and content scripts.
2. **Core logic** — `extension/sidepanel/` owns the UI; `content/` owns page
   capture/adapters; `lib/` owns parsers/providers; `background.js` owns
   service-worker messaging and backend port routing.
3. **API/integration** — localhost backend calls use the manifest's
   `http://127.0.0.1:21828/*` permission and message passing between content,
   worker and Side Panel.
4. **Data/configuration** — browser settings and optional provider keys use
   extension storage; icons/fonts are under `extension/icons/` and
   `extension/fonts/`.
5. **Tests** — `extension/tests/*.test.js`, run with
   `node --test extension\tests\*.test.js`.
6. **Build/runtime dependencies** — `release/build-extension.ps1`,
   `installer/kiroku_setup.iss`, manifest paths, and the CI tracking check for
   `extension/lib/wanakana.js`.

## Cloud queue

1. **Entry point** — `kiroku_cloud_queue/server.py` (API) and
   `worker.py` (polling/processing).
2. **Core logic** — `queue_adapter.py`, `queue_db.py`, `queue_store.py`,
   `postgres_store.py`, `enrichment.py`, and `anki_mirror.py`.
3. **API/integration** — cloud clients use `kiroku_client.py`; the local
   backend imports the queue through an explicit path setup in `main.py`.
4. **Data/configuration** — `kiroku_cloud_queue/*.db`, `.env.example`,
   `postgres_schema.sql`, `render.yaml`, `Dockerfile`, and deployment docs.
5. **Tests** — `kiroku_cloud_queue/tests/` with its own requirements and
   `pytest.ini`.
6. **Build/runtime dependencies** — this remains a separately deployable
   component; do not make it depend on desktop GUI libraries or extension
   files.

## Backend packaging and resources

1. **Entry point** — `run_backend.py` owns direct backend startup and port
   validation. There is no supported tray host.
2. **Core logic** — `backend/app/config.py` provides port/data resolution;
   `ocr_server/server.py` is the standalone OCR launcher module.
3. **API/integration** — backend health is exposed at `/api/health`; the
   browser extension connects to the configured backend port.
4. **Data/configuration** — development data is under `backend/data/` and
   runtime user data under `%LOCALAPPDATA%\KirokuNote`; the local archive at
   `backend/data/archive/` holds displaced root databases. The required
   `kiroku_dict.sqlite` dictionary build output remains at the repository root
   because the standalone dictionary package resolves that path.
5. **Tests** — `backend/tests/test_standalone_executable.py`,
   `test_installer_config.py`, and
   `test_packaging_config.py`.
6. **Build/runtime dependencies** — `packaging/*.spec`, `installer/*.iss`,
   `release/*.ps1`, `assets/icon.*`, and `.github/workflows/build-windows.yml`.
   Generated `build/` and `dist/` outputs are not source-of-truth.

## Testing and maintenance

- Backend regression: `$env:PYTHONPATH='.;backend'; python -m pytest backend\tests -q`
- Extension regression: `node --test extension\tests\*.test.js`
- Grammar coverage: `$env:PYTHONPATH='.;backend'; python tools\grammar_coverage.py`
- Build verification: `release/build-backend.ps1`, `build-extension.ps1`,
  `build-ocr.ps1`, and installer scripts on Windows.
- CI definitions: `.github/workflows/test.yml` and
  `.github/workflows/build-windows.yml`.

When adding or moving a runtime file, update all import paths, manifest entries,
resource lookups, PyInstaller data/hidden imports, installer sources, tests,
and this map together. Before proposing deletion, check `git ls-files`,
imports/callers, dynamic discovery, tests, build manifests, and history. If
evidence is incomplete, retain the file and classify it as unresolved rather
than deleting it.

## Documentation and planned desktop work

`ARCHITECTURE.md` is the detailed system contract and `PROGRESS.md` records
completed work and verification. `docs/archive/` contains historical plans
and design material, including the archived `DESIGN.md`; there is currently
no root-level active `DESIGN.md`.

A future native desktop window is planned but not implemented. The audit
recommendation is to evaluate Tauri against Electron before introducing either
framework. Any desktop shell must reuse the existing localhost FastAPI API,
preserve the browser extension, keep SQLite authoritative, and manage backend
and OCR lifecycles without duplicate instances or arbitrary filesystem/process
access.
