# Hardening: ankiconnect
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: python -m pytest tests/scenarios/ankiconnect/ -q
Suite-covers: module
Smoke-command: python -m pytest backend/tests/test_anki_connect.py -q
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Note creation when online | Card pushed creates note in Anki with deck, model, fields, and tags | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s01_note_creation_online | pass | critical | | Verified note creation |
| S02 | Offline handling preserves local card | Anki offline leaves card pending, raises AnkiConnectionError cleanly, no corruption | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s02_offline_handling_preserves_card | pass | critical | | Local card preserved in pending state |
| S03 | Duplicate note detection and resolution | Matches existing note across deck hierarchy, updates fields without duplicate note creation | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s03_duplicate_note_resolution | pass | critical | | Resolves existing note across deck hierarchies |
| S04 | Media attachment storage | Images and audio uploaded via storeMediaFile, failures handled without losing card | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s04_media_attachment_storage | pass | high | | Media stored or error gracefully handled |
| S05 | Model field mapping and capabilities | Resolves note model, maps fields correctly, handles missing non-essential fields | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s05_model_field_mapping | pass | high | | Fields mapped to model target schema |
| S06 | Japanese and unicode tags round-trip | Japanese tags and text round-trip without encoding corruption | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s06_japanese_unicode_tags | pass | critical | | Unicode Japanese tags preserved |
| S07 | Offline reviews preserved and flushed | Offline review stored in SQLite with synced_to_anki=0, flushed to Anki on reconnect | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s07_offline_reviews_preserved_and_flushed | pass | critical | | Reviews preserved and flushed |
| S08 | Multi-review flush ordering and deduplication | Multiple reviews for same card answered with latest review, prior superseded logs marked synced, no reverse answering | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s08_multi_review_flush_ordering | pass | critical | flush_pending_reviews left older superseded review_logs with synced_to_anki=0, causing reverse re-answering | Fixed by marking all prior logs synced on latest answer |
| S09 | Auto-creation of note on flush for unsynced card | Flushing offline review on card not yet in Anki creates note first, resolves cardId, answers review | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s09_auto_create_note_on_flush | pass | critical | _resolve_anki_card_id returned None when card was not yet in Anki, failing the review flush | Fixed by auto-creating card in Anki on review flush |
| S10 | Pull Anki reviews protects pending local reviews | Pulling Anki review updates does not stomp cards with unsynced local reviews | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s10_pull_anki_protects_pending_local_reviews | pass | critical | | Pending local reviews shielded from stale pulls |
| S11 | Accurate review stats alignment | Kiroku review stats (cards_due_today, due_count, new_count) strictly match SQLite get_due_cards; zero phantom sessions | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s11_review_stats_alignment_no_false_sessions | pass | critical | get_review_stats overwrote Kiroku cards_due_today with external Anki deck stats | Overwrite removed; Anki counts isolated to anki_* keys |
| S12 | Orphaned and deleted Anki card dead-lettering | Card deleted in Anki detected during flush, marked orphaned, does not block queue | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s12_orphaned_anki_card_dead_lettering | pass | high | mark_review_synced unconditionally overwrote orphaned sync_state to synced | Fixed by preserving orphaned sync_state |
| S13 | Concurrent sync serialization | Multiple concurrent sync and flush calls serialized via lock without double-answering | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s13_concurrent_sync_serialization | pass | high | | Concurrency lock prevents race conditions |
| S14 | Deleted note dead-lettering | Deleted note in Anki Desktop detected when cid unresolvable, marked orphaned to clear queue | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s14_deleted_note_dead_lettering | pass | critical | cid cannot be resolved when note is deleted in Anki; flush loop ignored dead-lettering | Fixed by marking orphaned and clearing review |
| S15 | Max retries dead-lettering | Repeated answer_card failures after max retries dead-letters without blocking flush queue | tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s15_max_retries_dead_lettering | pass | high | No retry budget on failed reviews; re-attempts forever on every flush | Fixed by adding retry counter and dead-letter on threshold |

## Baseline
Phase 3 red run (paste summary here):
```
.......FF.FF.                                                            [100%]
================================== FAILURES ===================================
FAILED tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s08_multi_review_flush_ordering
FAILED tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s09_auto_create_note_on_flush
FAILED tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s11_review_stats_alignment_no_false_sessions
FAILED tests/scenarios/ankiconnect/test_ankiconnect_scenarios.py::test_s12_orphaned_anki_card_dead_lettering
4 failed, 9 passed in 2.99s
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S08 | 1 | In flush_pending_reviews, answer latest rating for card and mark all prior review_logs up to log_id as synced_to_anki=1 so superseded reviews are not re-answered in reverse. | backend/app/repositories/review_repository.py:972-990, backend/app/services/anki_fsrs_sync.py:270 | pass | test_s08_multi_review_flush_ordering PASSED |
| S09 | 1 | In _resolve_anki_card_id, if card does not yet exist in Anki, auto-push/create the card in Anki using CardService so its anki_card_id can be resolved and the review answered. | backend/app/services/anki_fsrs_sync.py:194-206 | pass | test_s09_auto_create_note_on_flush PASSED |
| S11 | 1 | In ReviewRepository.get_review_stats, do not overwrite Kiroku's due_count, new_count, learn_count, cards_due_today with external Anki deck stats so they strictly match SQLite get_due_cards, preventing false review sessions. | backend/app/repositories/review_repository.py:575-588 | pass | test_s11_review_stats_alignment_no_false_sessions PASSED |
| S12 | 1 | Preserve orphaned sync_state in mark_review_synced when card is deleted in Anki. | backend/app/repositories/review_repository.py:982-986 | pass | test_s12_orphaned_anki_card_dead_lettering PASSED |
| S14 | 1 | In flush_pending_reviews, when card note is unresolvable or deleted in Anki, mark sync_state='orphaned' and mark review synced to unblock the flush queue. | backend/app/services/anki_fsrs_sync.py:280-288 | pass | test_s14_deleted_note_dead_lettering PASSED |
| S15 | 1 | Track consecutive flush failure attempts and dead-letter unrecoverable review logs after threshold. | backend/app/services/anki_fsrs_sync.py:307-318 | pass | test_s15_max_retries_dead_lettering PASSED |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 21 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: ...............                                                          [100%]
15 passed in 3.16s
[PASS] smoke: .......................................................................  [100%]
71 passed in 2.55s

GATE PASSED for module 'ankiconnect'
tag frozen-ankiconnect: created
```
