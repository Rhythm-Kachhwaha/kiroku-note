# Link map (Anime & Episode Persistence)

Persisted HTTP anime learning, watch history, subtitle analysis, and vocabulary mining.

## 1. Backend Persistence & Endpoints
- **HTTP Endpoints**: `backend/app/api/link.py` and `backend/app/api/link_episode.py`:
  - `GET /api/link/status`: Service status (HTTP persistence mode).
  - `GET /api/link/sessions`, `POST /api/link/sessions`: Persisted session statistics.
  - `POST /api/link/episodes/sync`: Subtitle cue ingestion, metrics calculation, and background analysis.
  - `POST /api/link/episodes/{hash}/position`: Playback position tracking with monotonically increasing timestamp/position checks.
  - `GET /api/link/episodes/{hash}/inspect`: Cached episode difficulty, JLPT distribution, gap words, and grammar points.
  - `GET /api/link/poster`: Secure image proxy with domain allowlist, SSRF protection, size limits, and local cache.
- **Data Persistence**: `link_episode` and `link_session_stat` tables in SQLite; `episode_cues` stores normalized subtitle cues per episode hash.
- **Analysis Pipeline**: `backend/app/link/analysis.py` (`LinkAnalysisService`) annotates incoming cues in the background.

## 2. Browser Extension Integration
- **Independent Ingestion**: Subtitle acquisition, parsing (SRT/ASS/VTT), and HTTP ingestion to backend endpoints (`/api/link/episodes/sync`, `/api/link/episodes/{hash}/position`, `/api/link/sessions`).
- **In-Page Overlay & HUD**: `extension/content/anime-hud.js` (track selector, subtitle offset adjuster, drag-and-drop subtitle files).
- **Session & Retry**: `extension/sidepanel/anime/session.js` (durable outbox with retry logic for position and session updates).
- **Title Parsing**: `extension/lib/title-parser.js` (`cleanAnimeTitle`, `hashTitleKey`).

## 3. Desktop Companion UI
- **Views**: `desktop/src/ui/views/anime.js` (Anime Library, Posters, Episode breakdown, Transcript, Gap words, JLPT difficulty breakdown, Flashcard review).
- **Services**: `desktop/src/ui/services/link_mine.js` (canonical vocabulary saving, known words update, duplicate detection, Anki sync).
- **Styles**: `desktop/src/ui/styles/views/anime.css` (design token compliance, `--font-japanese` Zen Old Mincho, zero raw hex).

## 4. Tests & Verification Suite
- **Backend Tests**: `backend/tests/test_link_episode.py`, `backend/tests/test_link_analysis.py`, `backend/tests/test_link_session.py`, `backend/tests/test_link_jimaku_key.py`.
- **Desktop Tests**: `desktop/tests/anime_library.test.js`, `desktop/tests/anime_cloud_sync.test.js`, `desktop/tests/final_lock.test.js`.
- **Extension Tests**: `extension/tests/anime-hud-dom.test.js`, `extension/tests/title-parser.test.js`, `extension/tests/subtitle-parser.test.js`.
