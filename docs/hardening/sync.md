# Hardening: sync
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/sync/test_sync_scenarios.test.js
Suite-covers: module
Smoke-command: $env:PYTHONPATH='.;backend'; python -m pytest backend/tests/test_cloud_sync_service.py -q
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Push and pull across devices | Pushed card on device A appears exactly once when pulled by device B | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Cross-device delivery |
| S02 | Edit propagation via Last-Writer-Wins | Updated card replaces cloud payload and updates device B without being dropped | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | ON CONFLICT (user_id, id) DO NOTHING drops edits | LWW update propagation |
| S03 | Tombstone delete propagation | card_delete tombstone removes local/cloud card and prevents resurrection | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | ON CONFLICT (user_id, id) DO NOTHING drops tombstones | Tombstone deletion |
| S04 | Per-device cursor independence | Device A acknowledging an op does not prevent Device B from pulling it with its cursor | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Per-device cursor isolation |
| S05 | Self-push suppression | Device does not re-download its own pushed items when device_id is provided | tests/scenarios/sync/test_sync_scenarios.test.js | pass | high | handleSyncPush and handleSyncPull omit device_id tracking | Redundant transfer suppression |
| S06 | Idempotency on duplicate push | Submitting the same batch twice produces 200 ok with no duplicate rows | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Safe replay handling |
| S07 | Payload and batch limits | Batches > 100 items or > 512KB rejected with 413 Payload Too Large | tests/scenarios/sync/test_sync_scenarios.test.js | pass | high | | Overload prevention |
| S08 | Cursor pagination boundary handling | Limit and compound cursor (created_at and id) paginate correctly with has_more flag | tests/scenarios/sync/test_sync_scenarios.test.js | pass | high | | Pagination edge cases |
| S09 | Production auth enforcement | Unauthenticated returns 401; service key returns 403 on personal sync | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Auth boundary enforcement |
| S10 | Production fail-closed without Turso | Production mode returns 503 if Turso credentials missing | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Fail-closed availability |
| S11 | Multi-tenant user isolation | User A cannot read, pull, modify, or acknowledge User B cards | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | handleSyncAck unconditionally returns validIds.length | Tenant isolation |
| S12 | Extension offline queue draining | Queued offline cards drain to cloud; poison/409 items dead-letter after 10 tries | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | | Extension offline resilience |
| S13 | High-throughput low-latency batching | 100-card batch executes in single round-trip without multi-batch latency | tests/scenarios/sync/test_sync_scenarios.test.js | pass | high | | Anki-speed desktop sync |
| S14 | Clock-skew edit resolution | Updates with explicit timestamps resolve deterministically regardless of arrival | tests/scenarios/sync/test_sync_scenarios.test.js | pass | high | | Clock skew determinism |
| S15 | Ack transaction result unwrapping | POST /api/sync/ack returns accurate acked count when executeTursoTransaction unwraps result | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | executeTursoTransaction unwraps result, handleSyncAck looked for nested response.result | Verifier finding: ack returns 0 |
| S16 | Cross-device pull without prior ack filter | Initial pull without cursor receives user cards even if another device called ack | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | handleSyncPull forced WHERE ack = 0 filtering out cards on initial pull | Verifier finding: global ack blocks device B initial sync |
| S17 | Service role forbidden from sync ack | POST /api/sync/ack rejects service role with 403 Forbidden | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | handleSyncAck lacked check for auth.user.is_service | Verifier finding: service role allowed on ack |
| S18 | Python sync push includes updated_at for LWW | get_unsynced_cards includes c.updated_at in payload so newer edits win | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | get_unsynced_cards omitted c.updated_at in SELECT | Verifier R2 finding: updated_at missing from push |
| S19 | Tombstone check considers updated_at for resurrection | Edits strictly newer than deletion resurrect or update card | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | import_pulled_card checked created_at instead of updated_at | Verifier R2 finding: tombstone dropped newer edits |
| S20 | Worker LibSQL UPSERT LWW condition in SQL | user_op_log UPSERT has WHERE json_extract condition to preserve newer edits | tests/scenarios/sync/test_sync_scenarios.test.js | pass | critical | UPSERT lacked WHERE json_extract check on updated_at | Verifier R2 finding: stale push overwrote newer payload |

## Baseline
Phase 3 red run (paste summary here):
```
▶ Sync Hardening Scenario Suite
  ✔ S01: Push and pull across devices (37.1174ms)
  ✖ S02: Edit propagation via Last-Writer-Wins (4.8568ms)
  ✖ S03: Tombstone delete propagation (3.2027ms)
  ✔ S04: Per-device cursor independence (3.0586ms)
  ✖ S05: Self-push suppression (1.671ms)
  ✔ S06: Idempotency on duplicate push (2.3802ms)
  ✔ S07: Payload and batch limits (2.8734ms)
  ✔ S08: Cursor pagination boundary handling (10.7885ms)
  ✔ S09: Production auth enforcement (1.2973ms)
  ✔ S10: Production fail-closed without Turso (0.8654ms)
  ✖ S11: Multi-tenant user isolation (2.0186ms)
  ✔ S12: Extension offline queue draining (1.2036ms)
  ✔ S13: High-throughput low-latency batching (2.0362ms)
  ✔ S14: Clock-skew edit resolution (1.9226ms)
✖ Sync Hardening Scenario Suite (77.376ms)
ℹ tests 14
ℹ suites 1
ℹ pass 10
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 203.2638
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S02 | 1 | Use ON CONFLICT DO UPDATE in handleSyncPush to update payload and reset ack on edits | worker/index.js:3538-3548 | pass | ✔ S02: Edit propagation via Last-Writer-Wins (3.4737ms) |
| S03 | 1 | ON CONFLICT DO UPDATE handles tombstone op_type updates without dropping deletions | worker/index.js:3538-3548 | pass | ✔ S03: Tombstone delete propagation (2.6223ms) |
| S05 | 1 | Embed device_id in payload on push and suppress matching device_id on pull | worker/index.js:3527-3538,3596,3650-3660 | pass | ✔ S05: Self-push suppression (2.1556ms) |
| S11 | 1 | Count actual affected rows from Turso update transaction to verify user ownership in handleSyncAck | worker/index.js:3704-3715 | pass | ✔ S11: Multi-tenant user isolation (2.1822ms) |
| S15 | 1 | Inspect both r and r.response.result for affected_row_count in handleSyncAck | worker/index.js:3707-3716 | pass | ✔ S15: Ack transaction result unwrapping (1.3087ms) |
| S16 | 1 | Allow initial pull without cursor to return uncompacted user ops regardless of ack status | worker/index.js:3602-3607 | pass | ✔ S16: Cross-device pull without prior ack filter (1.5797ms) |
| S17 | 1 | Reject service credentials with 403 Forbidden in handleSyncAck | worker/index.js:3677-3679 | pass | ✔ S17: Service role forbidden from sync ack (0.7001ms) |
| S18 | 1 | Include c.updated_at in get_unsynced_cards SELECT and item dict | backend/app/services/cloud_sync_service.py:109,163 | pass | ✔ S18: Python sync push includes updated_at for LWW (625.1137ms) |
| S19 | 1 | Compare card_updated (updated_at or created_at) against tombstone in import_pulled_card | backend/app/services/cloud_sync_service.py:263 | pass | ✔ S19: Tombstone check considers updated_at for resurrection (579.8358ms) |
| S20 | 1 | Add WHERE json_extract condition to worker UPSERT SQL statement | worker/index.js:3542-3549 | pass | ✔ S20: Worker LibSQL UPSERT LWW condition in SQL (3.0422ms) |
| S15 | 1 | Inspect both r and r.response.result for affected_row_count in handleSyncAck | worker/index.js:3707-3716 | pass | ✔ S15: Ack transaction result unwrapping (1.3087ms) |
| S16 | 1 | Allow initial pull without cursor to return uncompacted user ops regardless of ack status | worker/index.js:3602-3607 | pass | ✔ S16: Cross-device pull without prior ack filter (1.5797ms) |
| S17 | 1 | Reject service credentials with 403 Forbidden in handleSyncAck | worker/index.js:3677-3679 | pass | ✔ S17: Service role forbidden from sync ack (0.7001ms) |
| S18 | 1 | Include c.updated_at in get_unsynced_cards SELECT and item dict | backend/app/services/cloud_sync_service.py:109,163 | pass | ✔ S18: Python sync push includes updated_at for LWW |
| S19 | 1 | Compare card_updated (updated_at or created_at) against tombstone in import_pulled_card | backend/app/services/cloud_sync_service.py:263 | pass | ✔ S19: Tombstone check considers updated_at for resurrection |
| S20 | 1 | Add WHERE json_extract condition to worker UPSERT SQL statement | worker/index.js:3542-3549 | pass | ✔ S20: Worker LibSQL UPSERT LWW condition in SQL |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 36 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 20 passed in 1.25s
[PASS] smoke: 4 passed in 1.63s

GATE PASSED for module 'sync'
tag frozen-sync: created
```
