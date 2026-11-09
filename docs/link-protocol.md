# Kiroku Link Protocol (HTTP Only)

> [!NOTE]
> The live video WebSocket relay between the browser extension and Desktop companion (`/api/link/ws`, `link-client.js`, `link-bridge.js`, `hub.py`) was removed in v2.1. Desktop is no longer a live playback mirror.

## Endpoints (HTTP)
All link companion features communicate over standard loopback HTTP endpoints:
- `GET /api/link/status`: Returns companion connectivity and session stats.
- `GET /api/link/sessions`: Returns persisted link sessions.
- `POST /api/link/sessions`: Records or updates link session stats.
- `POST /api/link/export-condensed-audio`: Builds FFmpeg filter chain for condensed audio export.
- `POST /api/subtitles/export-condensed-audio`: Exports trimmed audio segments for cues.
