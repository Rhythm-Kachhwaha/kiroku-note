# Link map

Loopback video dialogue streaming & mining between Chromium Extension and Desktop Companion.

## 1. Backend Hub & Endpoints
- **WebSocket Hub**: `backend/app/link/hub.py` (multi-client routing: `(ext_sid, tab, frame)`, backpressure, rejection auditing).
- **Session Tracking**: `backend/app/link/session.py` (`LinkVideoSession`, `SessionDict`).
- **Schemas & Protocol**: `backend/app/schemas_link.py` (v=1 envelope: `video.attach`, `video.detach`, `video.state`, `peer.status`, `sub.status`, `cue.list`, `cue.active`, `cmd.clip`, `cmd.subs`, `ack`).
- **HTTP Endpoints**: `backend/app/api/link.py` (`/api/link/status`, `/api/link/sessions`, `/api/link/episodes/{hash}`, `/api/link/export-condensed-audio`).
- **Auth**: `backend/app/link/hub.py` via `authenticate_link_token`, pairing code redemption in `backend/app/api/study/auth.py`.

## 2. Browser Extension Integration
- **Background Relay & Lifecycle**: `extension/background.js` (eager connect, storage token reload, alarms keepalive, `video.detach` on tab close).
- **In-Page Overlay & HUD**: `extension/content/anime-hud.js` (closed shadow root, track selector, drag-and-drop SRT/ASS/VTT, offset adjuster, fullscreen reparenting).
- **Link Bridge**: `extension/content/link-bridge.js` (detects `<video>`, emits state and cues, handles `cmd.*` playback, `cmd.subs`, and `cmd.clip`).
- **Title Parsing**: `extension/lib/title-parser.js` (`cleanAnimeTitle`, `hashTitleKey` across 16 anime site conventions).
- **Clip Capture**: `extension/link/clip.js` (`LinkClipHandler` snapshot canvas capture + fallback).

## 3. Desktop Companion UI
- **Views**: `desktop/src/ui/views/anime.js` (two-pane layout with Live Cue Hero, seekable progress bar, tabbed deck for Transcript, Inspector, Queue, and collapsible Session History).
- **Services**: `desktop/src/ui/services/link_client.js`, `desktop/src/ui/services/link_store.js`, `desktop/src/ui/services/link_mine.js`.
- **Styles**: `desktop/src/ui/styles/views/anime.css` (design token compliance, `--font-japanese` Zen Old Mincho, zero raw hex).
- **Connection Stepper**: 4-step quick connect onboarding (Hub -> Extension -> Video -> Subtitles) with hub rejection alerts.

## 4. Tests & Verification Suite
- **Backend Tests**: `backend/tests/test_link_hub.py`, `backend/tests/test_link_schemas.py`, `backend/tests/test_link_episode.py`, `backend/tests/test_link_live_pairing.py`.
- **Desktop Tests**: `desktop/tests/anime_view.test.js`, `desktop/tests/anime_connection.test.js`, `desktop/tests/link_client.test.js`, `desktop/tests/link_mine.test.js`, `desktop/tests/anime_controls.test.js`, `desktop/tests/final_lock.test.js`.
- **Extension Tests**: `extension/tests/anime-hud-dom.test.js`, `extension/tests/title-parser.test.js`, `extension/tests/manifest-permissions.test.js`, `extension/tests/link-bridge.test.js`, `extension/tests/link_client.test.js`.
- **End-to-End Suite**: `python tools/anime_e2e/run_e2e.py all` (15 scenarios: `e01` through `e15` all passing).
