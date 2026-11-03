# Windows desktop application shell

1. **Entry point** — `npm.cmd run dev:desktop` or `npm.cmd --prefix desktop run dev`. `desktop/bin/launch.js` strips parent environment overrides and executes Electron. `desktop/src/main.js` creates the companion window (default 500x750, resizable), with single-instance locking and Windows system tray integration.
2. **Core logic** — `desktop/src/process_manager.js` orchestrates the FastAPI backend: health checks at `/api/health`, adopts pre-existing instances without spawning duplicates, and terminates owned processes via `taskkill /pid <PID> /T /F` on explicit quit.
3. **API/integration** — `desktop/src/preload.js` implements a strict context-isolated bridge (`contextIsolation: true`, `nodeIntegration: false`) exposing `window.desktopAPI` and a `window.chrome` compatibility shim for storage, runtime, and tabs.
4. **Data/configuration** — Settings persist in `%LOCALAPPDATA%\\KirokuNote\\desktop-storage.json`; logs stream to `%LOCALAPPDATA%\\KirokuNote\\logs\\desktop_backend.log`.
5. **Tests** — `npm.cmd run test:desktop` runs `node --test desktop/tests/*.test.js`; use named tests only unless explicitly asked for the full suite.
6. **Build/runtime dependencies** — Reuses sidepanel assets with desktop overrides for Quick Add and History; connects to FastAPI on port 21828. Desktop views live in `desktop/src/ui/views/`. `docs/design/stitch-export/` is immutable visual/motion reference material.
