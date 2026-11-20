# Hardening: desktop
State: frozen
Phase: frozen
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/desktop/test_desktop_scenarios.test.js
Suite-covers: module
Smoke-command: node --test desktop/tests/security_and_preload.test.js desktop/tests/store.test.js desktop/tests/process_manager.test.js
Verifier-rounds: 0/2
Verifier: pending

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|---|---|---|---|---|---|---|---|
| S01 | Electron IPC Request Validation and SSRF Prevention | kiroku:api:request and study:request reject external schemes, path traversal, and malicious protocols without SSRF | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | critical | | Verified path normalization and method allowlists |
| S02 | Ephemeral Token Boundary and Redaction | Study API bearer token is generated with 256-bit crypto, held strictly in main process memory, never exposed to renderer, and redacted from logs | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | critical | | Cryptographically secure token isolated in main memory |
| S03 | DesktopStore Atomic Writes and Corruption Resilience | desktop-storage.json uses atomic temp-file rename, and corrupted JSON on disk loads safely without crashing and preserves backup | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | Missing backup creation on corrupt JSON in store.load | Added corrupt file backup before safe empty fallback |
| S04 | Chrome Storage Shim IPC Protocol | chrome.storage.local get, set, remove, clear handle promises and callbacks, object defaults, arrays, and single string keys | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | | Supports all chrome.storage argument shapes |
| S05 | Missing Database Clean Launch | Launching with missing SQLite database initializes full schema, runs migrations, and establishes operational state cleanly | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | critical | | Clean bootstrap creates cards, known_words, deck_settings |
| S06 | Corrupted Database Launch Containment | Corrupted SQLite database file on launch raises descriptive RuntimeError and is contained without infinite respawn loop or uncaught crash | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | critical | | Detected corruption raises descriptive error and stops loop |
| S07 | Offline Queue Drain Atomicity | Offline captured cards and sync batches drain atomically upon reconnection without duplicate insertions or corrupt sync states | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | critical | | Sync status recovery transitions 'syncing' to 'pending' |
| S08 | Offline Review Preservation | Review answers recorded while AnkiConnect is offline preserve synced_to_anki=0 in review_logs without data loss or corruption | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | | Pending reviews retained with synced_to_anki=0 |
| S09 | MascotHost Lifecycle and Freeze Prevention | MascotHost pauses on hidden, resumes on visible, handles zero-size canvas resize without throwing, and falls back to SVG on runtime error | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | | Pause/resume on visibility, zero-size guard, whenReady timeout |
| S10 | Single-Instance Lock and Multi-Window Deadlock Guard | Window minimization/destruction during in-flight IPC calls resolves safely without unhandled rejections or deadlocks | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | | Enforces single-instance lock and checks window destruction |
| S11 | Router Navigation Queue Serialization | Rapid consecutive tab navigation calls serialize cleanly through navigationQueue without unhandled rejections or race condition deadlocks | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | high | | navigationQueue serializes tabs and catches rejections |
| S12 | HTTP Keep-Alive IPC Latency and Connection Reuse | Main process IPC API proxy utilizes persistent keep-alive HTTP agent to eliminate TCP handshake overhead on high-frequency requests | tests/scenarios/desktop/test_desktop_scenarios.test.js | pass | medium | | Persistent keep-alive agent with maxSockets configured |

## Baseline
Phase 3 red run (paste summary here):
node --test tests/scenarios/desktop/test_desktop_scenarios.test.js
ℹ tests 12
ℹ suites 0
ℹ pass 7
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1085.1066

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|---|---|---|---|---|---|
| S03 | 1 | Back up corrupted storage file to .corrupt.<timestamp> before falling back to empty object in DesktopStore.load() | desktop/src/store.js:36-40 | pass | S03: DesktopStore Atomic Writes and Corruption Resilience passed |

## Noticed, not fixed
- None

## Gate results
```
[PASS] contract: ok
[PASS] ledger: 13 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 0/2
[PASS] tests: 12 pass, 0 fail (1214.1015ms)
[PASS] smoke: 17 pass, 0 fail (2328.9108ms)

GATE PASSED for module 'desktop'
tag frozen-desktop: created
```
