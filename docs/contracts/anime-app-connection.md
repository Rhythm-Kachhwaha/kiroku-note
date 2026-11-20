# Contract: anime-app-connection
Depends-on: db, cloud-auth, sync, extension

## Purpose
Reliable end-to-end synchronization, title parsing, AniList metadata caching, and cloud/local persistence for anime video playback, episode progression, and poster art across extension, local backend, and cloud worker without data loss or latency bottlenecks.

## Boundaries
- `POST /api/link/episodes/{hash}/position`: updates playback position (ms) in SQLite without overwriting metadata, mined count, or duration.
- `POST /api/link/episodes/sync`: syncs episode subtitles, cues, and metrics from video player, merging with existing progress.
- `GET /api/link/series`: returns watch history grouped by canonical anime series with cached AniList poster, synopsis, and episode lists.
- `GET /api/link/episodes/{hash}/inspect`: returns difficulty analytics, JLPT breakdown, and gap words for an episode.
- `POST /api/user/progress/anime`: Cloud endpoint updating per-user episode playback bookmark, completion status, poster URL, and mined card count.
- `GET /api/user/progress/anime/:seriesId`: Cloud endpoint retrieving per-user playback history for a series.
- `GET /api/link/poster-proxy`: Cloud and local proxy caching remote anime posters to eliminate CORS/CSP blocks.
- `TitleParser.cleanAnimeTitle(rawTitle, url)`: JS/Python parser extracting canonical series name, episode number (supporting Japanese kanji/fullwidth and English formats), and episode title.
- `fetch_anilist_metadata(title)`: Queries AniList GraphQL API with multi-tier in-memory and SQLite caching.

## State and storage
- Local SQLite `link_episode`: stores episode hash, title, site, known_pct, mined, minutes, last_position_ms, duration_ms, series, episode_key, media_type, poster_url, synopsis.
- Local SQLite `media_metadata`: caches AniList GraphQL queries and poster URLs under `anime:<cleaned_title>`.
- In-memory `METADATA_CACHE` / `cloudEpisodeCache`: caches AniList responses and active video sessions to prevent redundant network round-trips.
- Turso Cloud `user_anime_progress`: stores per-user anime progress (`user_id`, `series_id`, `episode_number`, `last_position_ms`, `duration_ms`, `completed`, `mined_card_count`, `last_watched_at`, `poster_url`, `series_title`, `synopsis`, `media_type`).

## Dependencies
- AniList GraphQL API (`https://graphql.anilist.co`): remote anime metadata provider.
- Turso Database (Cloud Worker): per-user progress storage.
- Local SQLite database (`get_db_connection()`): local-first episode store.
- Chromium extension TitleParser / video-mining content script: extraction of episode stream metrics.

## Invariants
- Episode data is NEVER overwritten: a position update or subtitle sync never zeroes out or decreases mined cards count, duration, synopsis, poster URL, or cues.
- Zero latency on series listing: repeated calls to `get_series_metadata` and `/api/link/series` must resolve from memory/SQLite caches in < 5ms without blocking synchronous HTTP requests.
- Dual-language episode number parity: Japanese notation (`第1話`, `第１話`, `第十二話`, `第11話「冬の魔法」`) and English notation (`Episode 01`, `Ep 1`, `S01E01`, `Show - 01`) correctly extract integer episode numbers.
- AniList search query sanitization: release tags, official video brackets (`【公式】`, `【予告】`, `【PV】`), and trailing episode markers are cleanly stripped so AniList lookups succeed.
- User data isolation in Cloud: each user's anime playback bookmarks, posters, and mined card stats are strictly partitioned by authenticated `user_id`.

## Failure behavior
- Network failure or timeout (AniList down): falls back gracefully to cached metadata or clean synthesized title; never crashes, never throws uncaught exceptions, never wipes existing episode records.
- Corrupted or empty payload: rejects invalid request with clear status code (400) without modifying existing database state.
- Unauthorized cloud request in production: rejects unauthenticated requests with 401 Unauthorized; in dev/local environment defaults to isolated developer principal.

## Out of scope
- Desktop UI video player rendering or CSS styling.
- Torrent or pirated video downloading/streaming protocols.
- Automated Anki note creation (handled by `ankiconnect` module).
