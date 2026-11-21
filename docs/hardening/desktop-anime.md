# Hardening: desktop-anime
State: frozen
Phase: frozen
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js
Suite-covers: module
Smoke-command: node --test desktop/tests/screen_anime.test.js desktop/tests/anime_library.test.js desktop/tests/anime_connection.test.js desktop/tests/anime_inspector.test.js
Verifier-rounds: 0/2
Verifier: pending

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|---|---|---|---|---|---|---|---|
| S01 | Anime Library clean empty state and offline backend resilience | Renders clean empty state when backend is unreachable or returns empty history without throwing unhandled exceptions | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | critical | | Verified graceful offline fallback |
| S02 | Continue-watching cards and progress bar calculations | Calculates percentage progress from playback_ms and duration_ms and renders continue-watching card | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Accurate 85% completion threshold |
| S03 | Series grouping and multi-episode hierarchy rendering | Groups episodes under their canonical series card with total episode count and episode rows | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Validated poster cards and episode rows |
| S04 | Inline Episode Inspector toggle and cache retention | Clicking inspect toggles accordion panel and caches inspection data by episode hash | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Cached inspect queries without refetch |
| S05 | JLPT difficulty breakdown and dynamic target level reactivity | Re-renders inspector with updated target level and clears cache when kiroku:learner-level-changed fires | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Target level updates dynamically |
| S06 | Episode inspector vocabulary and grammar filtering | Omits dumped grammar points and displays JLPT badges for candidate vocabulary | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Dumped grammar filtered from inspect & study |
| S07 | Brutalist Flashcard Review Screen modal and actions | Renders review modal with current word, handles Known and Mine actions, and closes cleanly | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | critical | Unicode multiplication sign violated no-emoji rule | Replaced with semantic SVG close icon |
| S08 | Language toggle title switching and preference persistence | Toggling language updates display between Japanese and English titles and saves to localStorage | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | medium | | Validated jp/en title switching |
| S09 | Subtitle parser multi-format support (SRT, VTT, ASS, SSA) | Accurately extracts start/end timestamps and clean text from SRT, VTT, ASS, and SSA subtitle sources | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Full SRT, VTT, ASS parse accuracy |
| S10 | Real-time connection stepper state transitions | Accurately transitions connection stepper across disconnected, extension detected, video linked, and subtitles ready | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | medium | | 4-step stepper responsive to LinkStore |
| S11 | Series pin and bookmark state toggles | Toggling pin/bookmark updates state and memory/local storage cleanly without throwing exceptions | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | Uncaught ReferenceError on missing localStorage in tests | Added safe memory storage fallback |
| S12 | Design tokens adherence and emoji prevention | anime.css has zero raw hex colors, uses tactile stroke/shadows, and contains no emoji | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Full compliance with tokens and typography |
| S13 | Tactile Sync Cloud button rendering & state transitions | Renders #btn-anime-sync and transitions between idle, syncing, synced, and retry without layout breaks | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Tactile button and spin animation |
| S14 | Non-destructive batch payload assembly | Assembles batch anime payload with accurate completion threshold, synopsis, and preserved posters | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Zero metadata loss on payload creation |
| S15 | Non-destructive bidirectional sync (cloud updates local) | Updates local episode watch position when cloud timestamp is strictly greater, avoiding regressions | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | critical | | Verified additive furthest position merge |
| S16 | Debounced auto-sync lifecycle | Collapses rapid playback progress triggers into debounced sync and cancels timer on unmount | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | medium | | Clean lifecycle debounce without spamming |
| S17 | Auth resolution & offline/unauthorized graceful recovery | Catches 401/network errors during sync, sets Sync Retry state, and never throws uncaught exceptions | tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js | pass | high | | Robust offline/auth error handling |

## Baseline
Phase 3 red run (paste summary here):
node --test tests/scenarios/desktop-anime/test_desktop_anime_scenarios.test.js
ℹ tests 12
ℹ suites 0
ℹ pass 6
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.3594

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|---|---|---|---|---|---|
| S07 | 1 | Brutalist card review modal contained unicode multiplication sign violating emoji rule | Replaced with SVG close icon in desktop/src/ui/views/anime.js | pass | ✔ S07 & S12 passed |
| S11 | 1 | Series pin and bookmark methods threw ReferenceError when localStorage is undefined | Added in-memory fallback storage in AnimeView | pass | ✔ S11 passed |

## Noticed, not fixed
- None

## Gate results
```
[PASS] contract: ok
[PASS] ledger: 17 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 0/2
[PASS] tests: 17 pass, 0 fail (205.7356ms)
[PASS] smoke: 17 pass, 0 fail (151.8161ms)

GATE PASSED for module 'desktop-anime'
```
