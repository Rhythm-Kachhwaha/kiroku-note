# Contract: desktop
Depends-on: db

## Purpose
Windows desktop application shell for Kiroku Note. Orchestrates the local companion window via Electron, supervises the local FastAPI backend subprocess lifecycle, provides secure IPC bridges with context isolation and an ephemeral bearer token for authenticated Study API access, manages single-instance locking and Windows system tray integration, ensures atomic persistence for application settings and user sessions in `%LOCALAPPDATA%/KirokuNote/desktop-storage.json`, and coordinates offline resilience, queue draining, and responsive rendering.

## Boundaries
- IPC channels (Main Process <-> Preload / Renderer):
  - `kiroku:api:request` -> forwards validated HTTP requests to local FastAPI backend using keep-alive HTTP agent, rejecting SSRF / forbidden endpoints.
  - `study:request` -> proxies authenticated Study API requests (`/api/study/...`, `/api/journey/...`), securely injecting ephemeral Bearer token in main process without leaking it to renderer.
  - `chrome:storage:get`, `chrome:storage:set`, `chrome:storage:remove`, `chrome:storage:clear` -> compatibility shim backed by `DesktopStore` with atomic file persistence.
  - `chrome:runtime:sendMessage` -> internal messaging shim relaying extension / main events.
  - `window:minimize`, `window:toggle-maximize`, `window:close`, `window:set-fullscreen`, `window:is-fullscreen` -> native window state control.
  - `auth:start-oauth`, `auth:get-session`, `auth:save-session`, `auth:clear-session`, `auth:verify-token` -> secure session storage and verification with offline fallback.
  - `runtime:get-rive-asset-url`, `runtime:get-rive-asset-buffer` -> resolution and loading of offline companion assets.
  - `backend:info`, `backend:retry`, `backend:services-status` -> subprocess telemetry and recovery.
- Process lifecycle:
  - `ProcessManager`: handles spawning python / packaged backend, health checks at `/api/health`, adopting pre-existing backend without duplicate processes, graceful termination (`taskkill /pid <PID> /T /F`), and port management.
- Offline queue & data sync:
  - `SyncCoordinator` / local queue drains offline captured cards and study logs once backend / cloud is available without duplicate entries or data loss.
- Mascot lifecycle:
  - `MascotHost`: single persistent Rive / SVG mascot host; pauses rendering when tab/window is hidden, resumes on visible, handles drawing surface resizing, and falls back to static SVG companion on asset or WebAssembly errors without freezing the UI or main thread.

## State and storage
- Settings & configuration: `%LOCALAPPDATA%\KirokuNote\desktop-storage.json` managed via `DesktopStore` with atomic write (`.tmp` + rename).
- Subprocess logs: `%LOCALAPPDATA%\KirokuNote\logs\desktop_backend.log` and `%LOCALAPPDATA%\KirokuNote\logs\desktop.log`.
- In-memory state: ephemeral Study API bearer token, single instance lock, window state.

## Dependencies
- Node.js & Electron runtime (`electron`, `http`, `crypto`, `fs`, `path`, `child_process`).
- Local FastAPI backend service on port 21828 (or `KIROKU_PORT`).
- SQLite database (`kiroku.db` / `study.db`).

## Invariants
- 1. Context isolation is always enabled (`contextIsolation: true`, `nodeIntegration: false`); Node.js globals, `require`, and filesystem access are never leaked to renderer window.
- 2. Ephemeral Study API bearer token is held strictly in main process memory and never exposed to renderer or logged in plain text.
- 3. IPC requests are strictly validated: no SSRF, paths must be relative or starting with `/api/`, and unhandled errors return clean structured error objects rather than crashing the main process or leaving unresolved promises.
- 4. Single-instance lock ensures only one desktop companion instance runs; subsequent launch attempts focus existing window.
- 5. Persistent storage (`desktop-storage.json`) writes are atomic via temporary file rename, preventing partial or corrupt configuration state.
- 6. Corrupted or missing storage/database files at launch do not crash the application: missing files bootstrap default schema, and corrupt storage safely falls back without throwing unhandled exceptions.
- 7. Background offline queues (reviews, captured cards) drain atomically when connectivity is restored; offline state never overwrites or corrupts local cards.
- 8. Mascot animation and canvas rendering are strictly contained; errors in WebAssembly, canvas resize, or Rive files fall back gracefully to SVG without freezing the event loop or blocking user interaction.
- 9. Navigation queue and IPC communication are deadlock-free: all promises resolve or reject with timeout guards.

## Failure behavior
- Backend failure or port occupied: Main process shows `error.html` with retry options, allowing user to retry or quit cleanly.
- Backend DB corruption: Detected and handled gracefully; subprocess error is logged, and recovery/error view is presented without hanging.
- Missing configuration: Automatically recreated with empty default dictionary.
- Storage corruption: `DesktopStore` catches JSON parse errors, backs up corrupt data, and resets to safe defaults without crashing.
- Asset loading failure: `MascotHost` triggers fallback to static SVG mascot (`svg_cat.svg`) and sets ready state so UI is never blocked.
- Window destruction during in-flight IPC: IPC handlers safely check `mainWindow && !mainWindow.isDestroyed()` before acting.

## Out of scope
- Specific view implementations for individual tabs (e.g. grammar view, anime inspector, manga reader, kanji canvas) — to be hardened individually.
- Direct Cloud DB queries from desktop renderer (always mediated by backend or secure main process IPC).
