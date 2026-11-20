# Hardening: db
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: python -m pytest tests/scenarios/db/ -q
Suite-covers: module
Smoke-command: python -m pytest backend/tests/test_card_repository.py -q
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Fresh DB bootstrap | All core tables and indexes created on empty file; deck_settings default row present | tests/scenarios/db/test_db_scenarios.py::test_s01_fresh_db_bootstrap | pass | critical | | Verified tables and initial rows |
| S02 | Idempotent schema initialization | Successive init_db runs cause no error, preserve rows, create no duplicate schema | tests/scenarios/db/test_db_scenarios.py::test_s02_idempotent_init | pass | critical | | Verified data preservation |
| S03 | Transaction rollback on failure | Exception inside db_session context aborts and uncommitted row is rolled back | tests/scenarios/db/test_db_scenarios.py::test_s03_transaction_rollback | pass | critical | | Rollback cleanly handles uncommitted inserts |
| S04 | Foreign key and cascade enforcement | Missing parent raises IntegrityError; deleting parent card cascades to child rows | tests/scenarios/db/test_db_scenarios.py::test_s04_foreign_keys_and_cascades | pass | critical | | Foreign keys enabled and cascade deletions verified |
| S05 | Composite uniqueness enforcement | Inserting duplicate (normalized_expression, normalized_reading, normalized_deck_name) raises IntegrityError | tests/scenarios/db/test_db_scenarios.py::test_s05_composite_uniqueness | pass | critical | | Uniqueness constraint prevents duplicate identities |
| S06 | Connection pragmas and row factory | Connection enforces foreign_keys=1, journal_mode=wal, busy_timeout=10000, row_factory=Row | tests/scenarios/db/test_db_scenarios.py::test_s06_connection_pragmas | pass | critical | | Pragmas and row factory verified on open connections |
| S07 | Unicode, Japanese, and emoji round-trip | Multi-byte Japanese text and emojis round-trip byte-for-byte without corruption | tests/scenarios/db/test_db_scenarios.py::test_s07_unicode_and_emoji_roundtrip | pass | critical | | Text round-trip intact across Japanese characters & emojis |
| S08 | Recovery of interrupted sync states | Cards left in 'syncing' status are reset to 'pending' on init_db | tests/scenarios/db/test_db_scenarios.py::test_s08_interrupted_sync_recovery | pass | high | | Interrupted syncing recovers to pending |
| S09 | Concurrent read and write in WAL mode | Concurrent reader reads consistent snapshot while writer writes; no deadlock | tests/scenarios/db/test_db_scenarios.py::test_s09_concurrent_readers_writers_wal | pass | high | | WAL concurrency allows non-blocking reads during writes |
| S10 | Corrupted database file handling | Corrupted header file raises RuntimeError with diagnostic corruption message | tests/scenarios/db/test_db_scenarios.py::test_s10_corrupted_file_handling | pass | high | | Corrupted database files detected and safely rejected |
| S11 | db_session auto-commit on clean exit | Writes performed inside db_session without explicit commit persist to disk | tests/scenarios/db/test_db_scenarios.py::test_s11_db_session_autocommit_on_clean_exit | pass | critical | db_session missing conn.commit() after yield | Verifier finding: uncommitted writes lost on exit |
| S12 | ensure_cloud_sync_tables standalone resilience | Calling ensure_cloud_sync_tables on DB without cards table does not crash | tests/scenarios/db/test_db_scenarios.py::test_s12_ensure_cloud_sync_tables_on_empty_db | pass | high | cards indexes created unconditionally | Verifier finding: OperationalError on missing cards table |

## Baseline
Phase 3 red run (paste summary here):
```
collected 12 items / 10 deselected / 2 selected

tests/scenarios/db/test_db_scenarios.py::test_s11_db_session_autocommit_on_clean_exit FAILED [ 50%]
tests/scenarios/db/test_db_scenarios.py::test_s12_ensure_cloud_sync_tables_on_empty_db FAILED [100%]

================================== FAILURES ===================================
FAILED tests/scenarios/db/test_db_scenarios.py::test_s11_db_session_autocommit_on_clean_exit - AssertionError: Data lost: db_session must automatically commit on clean exit
FAILED tests/scenarios/db/test_db_scenarios.py::test_s12_ensure_cloud_sync_tables_on_empty_db - sqlite3.OperationalError: no such table: main.cards
====================== 2 failed, 10 deselected in 0.16s =======================
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S11 | 1 | Invoke conn.commit() in db_session on clean exit after yield | backend/app/db/connection.py:348 | pass | test_s11_db_session_autocommit_on_clean_exit PASSED |
| S12 | 1 | Check if cards table exists before creating cards indexes in ensure_cloud_sync_tables | backend/app/db/connection.py:1078-1090 | pass | test_s12_ensure_cloud_sync_tables_on_empty_db PASSED |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 14 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 12 passed in 0.26s
[PASS] smoke: 14 passed in 0.86s

GATE PASSED for module 'db'
tag frozen-db: created
```
