# Kiroku Note

Kiroku Note is a local-first Japanese vocabulary mining tool designed for fast capture, enrichment, editing, and syncing into Anki.

The workflow is intentionally simple:

see Japanese word -> capture -> identify/enrich -> edit -> save locally -> send to Anki

This project is built as a Chromium/Brave extension paired with a local Python backend. It keeps your data local, avoids cloud dependence, and uses SQLite as the source of truth before syncing to Anki through AnkiConnect.

This README explains the project, what is included in the V1 build, and how to install and run it locally.

---

## Project purpose

Kiroku Note is not a replacement for Anki or a Japanese-learning platform. It is a focused mining utility for collecting Japanese vocabulary and sentence cards from the web, subtitles, and other content you are reading.

Core goals:

- Capture Japanese text from web pages and video subtitle contexts
- Identify and enrich terms using local dictionary services
- Let users review and edit card details before storing them
- Persist cards locally in SQLite
- Synchronize accepted cards to Anki via AnkiConnect
- Keep the whole flow local-first and privacy-friendly

---

## What is included in the V1 build

The current V1 project is a functional local-first stack with the following elements:

- Chromium/Brave extension shell
- Side panel UI for editing and previewing cards
- Python FastAPI backend for enrichment and persistence
- SQLite database for saved cards and sync state
- Yomitan/Jitendex dictionary integration boundary
- JLPT level resolution via a local replaceable service
- AnkiConnect integration for exporting cards to Anki
- Media handling for frames, screenshots, and audio-related card content
- Local packaging/build files for backend and extension distribution

This repository also includes packaging and installer scripts under the release and build areas for a desktop-oriented, packaged build flow.

---

## High-level architecture

### 1. Extension layer
The extension runs as a Chromium/Brave Manifest V3 add-on and keeps the user-facing experience in a side panel.

Responsibilities:

- capture selected or hovered Japanese text
- detect subtitle/video-related mining contexts
- present the card editor and live preview
- send requests to the local backend
- display dictionary and study information

The extension is intentionally implemented with vanilla HTML, CSS, and JavaScript and does not rely on React or Electron.

### 2. Backend layer
The backend is a local Python + FastAPI application.

Responsibilities:

- validate and expose local API routes
- orchestrate dictionary lookup and enrichment
- normalize dictionary results into project-level data models
- persist cards in SQLite
- manage sync state and Anki export flows
- keep the database as the local source of truth

### 3. Data layer
SQLite is the authoritative local store for:

- mined cards
- saved card history
- sync status
- duplicate checks
- presentation metadata
- media references

Cards are saved locally before any sync attempt is made to Anki. If Anki is down or a sync fails, the card remains available locally and can be retried later.

### 4. External integrations
The main external services are:

- Yomitan or Jitendex dictionary endpoint for lookup
- AnkiConnect for note creation and sync
- local JLPT classification dataset/service

The project is designed so these integrations are isolated behind service boundaries rather than being spread across the UI or other modules.

---

## Main project structure

```text
AnkiMiner/
├── AGENTS.md
├── ARCHITECTURE.md
├── PROGRESS.MD
├── README.md
├── run_backend.py
├── start_backend.bat
├── backend/
│   ├── app/
│   ├── data/
│   ├── requirements.txt
│   └── tests/
├── build/
├── extension/
├── installer/
├── packaging/
├── release/
├── skills/
├── V1/
└── ...
```

Key folders:

- backend: FastAPI backend code, DB logic, services, and tests
- extension: browser extension files, side panel, and content scripts
- build: packaged build output and generated artifacts
- release: packaging and release scripts
- installer: setup instructions and installer assets
- skills: project domain guidance and workflow documentation
- V1: historical design and stage docs for the product roadmap

---

## Core features

### Card mining
- capture Japanese text from selected or hovered content
- detect related context such as subtitles, video overlays, and page text
- synthesize a card draft with meaning, reading, example, and metadata

### Dictionary enrichment
- fetch dictionary entries from Yomitan/Jitendex-like local services
- normalize response data into project-level structures
- surface parts of speech, tags, readings, examples, and JLPT info

### Card editing and preview
- edit expression, reading, meaning, notes, and example fields
- review a live card preview before saving
- use a dark utility-focused side panel interface optimized for desk work

### Local persistence
- save card data to SQLite
- preserve sync state such as pending, syncing, synced, and failed
- avoid losing cards if AnkiConnect is unavailable

### Anki sync
- export cards to Anki using AnkiConnect
- map note fields to supported Anki models
- avoid creating duplicates by checking for existing matching note data
- leave failed syncs recoverable and retryable

---

## Requirements

### Required software

- Python 3.10+ recommended
- A Chromium-based browser such as Brave, Chrome, Edge, or Chromium
- Anki desktop installed locally with AnkiConnect running on the default URL
- Yomitan or a compatible local dictionary service running on its configured endpoint

### Recommended local setup

- local dictionary service accessible on http://127.0.0.1:19633
- AnkiConnect available at http://127.0.0.1:8765
- a stable local data directory for SQLite and media files

---

## Installation steps

## 1. Clone or open the project

From a terminal or shell, navigate to the repository root:

```bash
cd path/to/AnkiMiner
```

## 2. Create a virtual environment

```bash
python -m venv .venv
```

On Windows:

```bash
.venv\Scripts\activate
```

On macOS/Linux:

```bash
source .venv/bin/activate
```

## 3. Install backend requirements

From the repository root:

```bash
pip install -r backend/requirements.txt
```

This installs the FastAPI and Uvicorn dependencies required by the local backend.

## 4. Start the backend

You can start the backend using the included runner:

```bash
python run_backend.py
```

Or on Windows, the helper batch file:

```bat
start_backend.bat
```

The app defaults to:

- host: 127.0.0.1
- port: 21828

This is configurable through environment variables such as:

```bash
set KIROKU_PORT=21829
python run_backend.py
```

or

```bash
KIROKU_PORT=21829 python run_backend.py
```

### Optional debug mode

```bash
set KIROKU_DEBUG=1
python run_backend.py
```

When debug mode is enabled, the API docs endpoints may be available locally for inspection.

## 5. Ensure dependencies for dictionary and Anki are active

Before using the mining flow, confirm the following are running locally:

- Yomitan or compatible dictionary service on its configured endpoint
- Anki desktop with AnkiConnect active on port 8765

If AnkiConnect is unavailable, the app can still save cards locally, but sync to Anki will remain pending or failed until the service is available again.

## 6. Load the browser extension

Open the browser and go to:

- Brave: brave://extensions
- Chrome: chrome://extensions
- Edge: edge://extensions

Enable Developer mode and click Load unpacked.

Select the extension directory:

```text
<project-root>/extension
```

The extension should appear as Kiroku Note and can be pinned to the toolbar for quick access.

---

## Configuration notes

### Default local endpoints

The project expects local services at roughly these endpoints:

- Backend: http://127.0.0.1:21828
- Yomitan: http://127.0.0.1:19633
- AnkiConnect: http://127.0.0.1:8765
- Optional OCR Daemon: http://127.0.0.1:21829

### Optional OCR Companion Add-on

OCR is an optional companion component powered by `manga-ocr` running locally on CPU (`KirokuOCR.exe`).

- **Optionality:** The core Kiroku Note application (~50 MB) does not bundle PyTorch or heavy ML models. If the OCR add-on is absent, Kiroku Note runs 100% normally.
- **Process Management:** When installed (in `{app}\ocr\`, `%LOCALAPPDATA%\KirokuNote\ocr\`, or via `KIROKU_OCR_EXE`), Kiroku Note automatically detects it, provides safe non-blocking startup with failure cooldowns, and cleanly terminates the daemon upon application exit.
- **Offline Inference:** Pre-downloaded model weights reside in `{app}\ocr\models\` or `%LOCALAPPDATA%\KirokuNote\models\manga-ocr-base\`, requiring zero internet connectivity during inference.
- **Building the Add-on:** See `release/build-ocr.ps1` and `release/build-ocr-installer.ps1`. Requires CPU-only PyTorch (`pip install torch --index-url https://download.pytorch.org/whl/cpu`) and `manga-ocr`.

### Data directories

The backend resolves user data and media storage based on environment and packaged mode. In source/development mode, it typically uses the project-level backend data directory; in packaged mode it prefers the OS app data directory such as the Windows LocalAppData folder.

This keeps user content local and stable instead of tying it to a temporary development directory.

---

## Typical usage flow

1. Open a page or video with Japanese text you want to mine.
2. Activate the extension and start mining mode.
3. Capture the relevant Japanese expression or subtitle text.
4. Review the generated card draft in the side panel.
5. Edit the card fields as needed.
6. Save it locally.
7. Sync it to Anki when ready.
8. Repeat on more terms while keeping a local archive of vocabulary cards.

---

## Safety and reliability principles

The project intentionally favors local-first reliability:

- SQLite is the local source of truth
- cards are saved before sync attempts
- sync failures do not delete local cards
- duplicate prevention happens in backend logic
- external provider details stay behind service boundaries
- packaged/runtime defaults favor safe local operation over developer convenience

---

## Packaging and build notes

This repository includes build and release assets to support a packaged V1 distribution, including:

- build generated output folders
- release scripts for backend and extension packaging
- installer scripts for local desktop deployment

These are intended for local project packaging and distribution workflows rather than for app development itself.

---

## Useful references in this repository

- AGENTS.md: project-level instructions and rules for working on the repo
- ARCHITECTURE.md: system design and component boundaries
- PROGRESS.MD: V1 completion status and feature milestones
- backend/requirements.txt: backend dependency list
- run_backend.py: backend startup entry point
- extension/: browser extension source files
- release/: packaging scripts
- installer/: installation guidance and packaged installation assets

---

## Summary

Kiroku Note is a local-first Japanese card mining tool built around a clean split between:

- browser extension capture UI
- backend enrichment and storage logic
- AnkiConnect-based syncing
- durable local-first persistence

The V1 build is ready as a practical, self-contained local workflow for capturing and saving Japanese vocabulary cards while preserving data safety and avoiding cloud dependence.

---

## License

This project is provided in the repository under its included license terms. Please review the LICENSE file before redistributing or packaging the project.
