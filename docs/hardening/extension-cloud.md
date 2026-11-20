# Hardening: extension-cloud
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js
Suite-covers: module
Smoke-command: node --test extension/tests/extension_cloud_sync.test.js
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Three-tier save: local backend reachable | HUD_MINE saves to local /api/cards/save, returns sync_destination: "local" and card_id | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Local first priority verified |
| S02 | Three-tier save: local offline, cloud edge fallback | HUD_MINE falls back to cloud /sync/push when local backend is down and token exists, returns sync_destination: "cloud" | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Cloud fallback when local down verified |
| S03 | Three-tier save: local and cloud offline, queues locally | HUD_MINE falls back to queueCardLocally when both are offline, returns sync_destination: "queued" and persists in kiroku_pending_cards | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | critical | | Offline queue fallback verified |
| S04 | Concurrency protection: withQueueLock serializes concurrent appends | Multiple concurrent queueCardLocally calls all persist without lost updates or race corruption | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Mutex concurrency guard verified |
| S05 | Queue capacity limit enforcement | queueCardLocally rejects appends and returns false when queue size reaches 1000 items | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | medium | | Capacity guard against memory bloat verified |
| S06 | Queue drain: local backend online | drainPendingCardsQueue drains items to local backend /api/cards/save and clears acknowledged items | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | critical | | Online local sync drain verified |
| S07 | Queue drain: local backend offline, cloud online | drainPendingCardsQueue drains items to cloud /sync/push with Bearer token when local offline | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | critical | | Online cloud sync drain verified |
| S08 | Queue drain concurrency safety: items added mid-drain preserved | New card appended to queue during drainPendingCardsQueue execution is preserved in kiroku_pending_cards | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Atomic drain acknowledgement verified |
| S09 | Dead-letter queue: HTTP 409 conflict eviction | Item returning 409 Conflict from cloud worker is evicted from pending and recorded in kiroku_dead_letter_cards | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Dead letter eviction on 409 verified |
| S10 | Dead-letter queue: max retry threshold (10 attempts) | Item exceeding 10 failed attempts is moved to kiroku_dead_letter_cards and removed from pending queue | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Permanent failure containment verified |
| S11 | Drain re-entrancy prevention: isDrainingQueue guard | Concurrent drainPendingCardsQueue call while already draining returns 0 immediately | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | medium | | Re-entrancy prevention verified |
| S12 | Sidepanel modularity invariant | extension/sidepanel/modules/*.js are live and separate; monolithic sidepanel.js is absent | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | critical | | Canonical sidepanel structure verified |
| S13 | KirokuApi saveCard and capture cloud fallback | KirokuApi falls back to cloudBaseUrl /sync/push or /api/capture when local baseUrl fails | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | KirokuApi client fallback verified |
| S14 | Background runtime message handling for DRAIN_PENDING_QUEUE and QUEUE_CARD | Runtime messages QUEUE_CARD and DRAIN_PENDING_QUEUE invoke appropriate queue operations and respond asynchronously | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | | Runtime messaging interface verified |
| S15 | HUD_MINE cloud 409 conflict dead-letters card | When Cloud worker returns HTTP 409 during HUD_MINE, card is recorded in kiroku_dead_letter_cards and NOT queued in kiroku_pending_cards | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | high | In HUD_MINE fallback, 409 Conflict from cloud worker fell through to queueCardLocally instead of being routed to kiroku_dead_letter_cards | Fixed by routing 409 in HUD_MINE directly to kiroku_dead_letter_cards |
| S16 | KirokuApi capture with cloud auth token pushes valid payload | api.capture with local success and cloudAuthToken does not throw ReferenceError for cardPayload, extracting captured card ops | tests/scenarios/extension-cloud/test_extension_cloud_scenarios.test.js | pass | critical | In KirokuApi.capture, line 110 referenced undefined cardPayload instead of parsed cards from capture response | Fixed by extracting captureCards from parsed response instead of undefined cardPayload |

## Baseline
Phase 3 red run (paste summary here):
```
▶ extension-cloud hardening scenario suite
  ✔ S01: Three-tier save: local backend reachable (65.955ms)
  ✔ S02: Three-tier save: local offline, cloud edge fallback (75.1356ms)
  ✔ S03: Three-tier save: local and cloud offline, queues locally (74.8918ms)
  ✔ S04: Concurrency protection: withQueueLock serializes concurrent appends (1.2045ms)
  ✔ S05: Queue capacity limit enforcement (0.8709ms)
  ✔ S06: Queue drain: local backend online (0.7186ms)
  ✔ S07: Queue drain: local backend offline, cloud online (0.428ms)
  ✖ S08: Queue drain concurrency safety: items added mid-drain preserved (17.4886ms)
  ✔ S09: Dead-letter queue: HTTP 409 conflict eviction (0.5152ms)
  ✔ S10: Dead-letter queue: max retry threshold (10 attempts) (0.2911ms)
  ✔ S11: Drain re-entrancy prevention: isDrainingQueue guard (0.4627ms)
  ✖ S12: Sidepanel modularity invariant (0.4624ms)
  ✖ S13: KirokuApi saveCard and capture cloud fallback (1.9754ms)
  ✔ S14: Background runtime message handling for DRAIN_PENDING_QUEUE and QUEUE_CARD (128.9141ms)
✖ extension-cloud hardening scenario suite (375.1101ms)
ℹ tests 14
ℹ suites 1
ℹ pass 11
ℹ fail 3
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S15 | 1 | Handle cloudResp.status === 409 in HUD_MINE by saving to kiroku_dead_letter_cards and returning conflict error instead of falling back to queueCardLocally | extension/background.js:1119-1128 | pass | ✔ S15: HUD_MINE cloud 409 conflict dead-letters card (0.2754ms) |
| S16 | 1 | In KirokuApi.capture, parse response to extract cards array for ops payload instead of referencing undefined cardPayload | extension/lib/kiroku-api.js:101-118 | pass | ✔ S16: KirokuApi capture with cloud auth token pushes valid payload (30.5568ms) |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 16 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 17 passed, 0 failed
[PASS] smoke: 4 passed, 0 failed
GATE PASSED for module 'extension-cloud'
tag frozen-extension-cloud: created
```
