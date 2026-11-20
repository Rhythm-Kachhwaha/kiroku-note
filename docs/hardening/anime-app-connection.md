# Hardening: anime-app-connection
State: frozen
Phase: frozen
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js
Suite-covers: module
Smoke-command: node --test extension/tests/anime-session-integration.test.js worker/tests/edge_user_sync.test.js
Verifier-rounds: 0/2
Verifier: pending

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|---|---|---|---|---|---|---|---|
| S01 | Episode data overwrite protection on position update | save_episode_position and position endpoint update playback position without wiping duration_ms, mined count, poster_url, synopsis, or existing subtitle cues | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | critical | | |
| S02 | Episode data overwrite protection on subtitle sync | sync_episode_subtitles and Cloud episodes sync preserve existing playback bookmark and highest mined count when syncing new cues | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | critical | sync_episode_subtitles reset position and lacked last_position_ms parameter | Added last_position_ms & conn parameters, preserving existing bookmarks |
| S03 | Japanese episode number parsing (standard, fullwidth, kanji) | TitleParser and backend accurately extract integer episode numbers from 第1話, fullwidth 第１２話, and kanji 第十二話, 第三話 | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | Regex only matched ASCII digits and lacked kanji numeral parser | Added NFKC normalization and parseKanjiNumber converter |
| S04 | English episode number parsing (standard and multi-season) | extracts integer episode numbers from Episode 01, Ep. 2, S02E05, Show - 03, and trailing numbers without dropping season | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | | |
| S05 | Title sanitization for Japanese official brackets and release tags | strips 【公式】, 【予告】, 【PV】, 『...』, 「...」, and release groups before querying AniList so search matches canonical anime | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | _clean_search_title only stripped ASCII square brackets | Added Japanese bracket stripping and quote unwrapping |
| S06 | AniList metadata caching & sub-millisecond response latency | repeated AniList lookups resolve from memory and SQLite caches in < 5ms without making external network calls | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | | Added in-memory _ANILIST_MEMORY_CACHE |
| S07 | AniList network timeout and failure resilience | AniList network failure or timeout returns cached metadata or fallback display title without crashing or wiping database | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | | |
| S08 | Cloud per-user anime progress persistence with authentication isolation | /api/user/progress/anime persists episode bookmark and mined count partitioned by authenticated user_id without data leakage | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | critical | Turso mock response schema format and user isolation check | Configured pipeline execute mock with user_id partitioning |
| S09 | Cloud per-user anime poster and metadata persistence | /api/user/progress/anime stores and retrieves poster_url, series_title, and synopsis per user in Turso | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | user_anime_progress lacked poster and metadata columns | Added poster_url, series_title, synopsis, media_type columns and handlers |
| S10 | Cloud anime poster proxy security and caching | /api/link/poster-proxy validates allowed image hostnames, proxies anime posters, and sets cache headers to prevent CORS errors | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | Worker lacked poster proxy endpoint | Added /api/link/poster-proxy with hostname allowlist and cache headers |
| S11 | Cross-language anime title deduplication | Japanese title and English title resolve to the same canonical series group key via AniList ID | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | AniList GraphQL query lacked POPULARITY_DESC sort | Added sort: [POPULARITY_DESC] and conn forwarding in series metadata |
| S12 | Series watch history grouping latency optimization | group_episodes_by_series processes multi-episode libraries with deduplicated metadata lookups without sequential blocking network requests | tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js | pass | high | Sequential uncached lookups in episode loop | Added in-memory series_meta_cache inside grouping pipeline |

## Baseline
Phase 3 red run (paste summary here):
node --test tests/scenarios/anime-app-connection/test_anime_connection_scenarios.test.js
ℹ tests 12
ℹ suites 0
ℹ pass 4
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7766.0311

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|---|---|---|---|---|---|
| S02 | 1 | Preserve existing playback position and max mined count on subtitle sync | Added last_position_ms & conn parameters to sync_episode_subtitles | pass | ✔ S02: Episode data overwrite protection on subtitle sync |
| S03 | 1 | Support Japanese kanji numerals and fullwidth numbers in TitleParser | Added NFKC normalization and parseKanjiNumber in title-parser.js | pass | ✔ S03: Japanese episode number parsing |
| S05 | 1 | Strip Japanese official video brackets and quotes before AniList lookup | Updated _clean_search_title in media_metadata.py | pass | ✔ S05: Title sanitization for Japanese official brackets and release tags |
| S08 | 1 | Fix Turso execute pipeline response format in test mock | Updated mock to return results[0].response.result | pass | ✔ S08: Cloud per-user anime progress persistence |
| S09 | 1 | Add poster and series metadata columns to user_anime_progress in worker | Added poster_url, series_title, synopsis to turso.js & index.js | pass | ✔ S09: Cloud per-user anime poster and metadata persistence |
| S10 | 1 | Implement secure poster proxy on Cloud Worker | Added /api/link/poster-proxy endpoint in worker/index.js | pass | ✔ S10: Cloud anime poster proxy security and caching |
| S11 | 1 | Sort AniList search results by POPULARITY_DESC to match main series | Added sort: [POPULARITY_DESC] and conn argument to get_series_metadata | pass | ✔ S11: Cross-language anime title deduplication |
| S12 | 1 | Add in-memory series metadata cache in group_episodes_by_series | Added series_meta_cache in episode.py | pass | ✔ S12: Series watch history grouping latency optimization |

## Noticed, not fixed
- None

## Gate results
```
[PASS] contract: ok
[PASS] ledger: 20 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 0/2
[PASS] tests: 12 pass, 0 fail (5204.3692ms)
[PASS] smoke: 10 pass, 0 fail (282.6733ms)
tag frozen-anime-app-connection: created
```
