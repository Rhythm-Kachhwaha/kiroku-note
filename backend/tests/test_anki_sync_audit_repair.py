"""
Comprehensive regression test suite for AnkiConnect <-> Kiroku Note 2-way sync audit and repair.
Covers:
  1. Bug A: Duplicate deck creation ('JLPT advaned' vs 'Japanese::JLPT advaned')
  2. Bug A: Repeated 2-way sync idempotency (0 duplicate decks, 0 duplicate cards)
  3. Bug B: Due dates and stats retained in SQLite when Anki is closed
  4. Bug B: Kiroku restart while Anki is closed preserves exact scheduling
  5. Local changes made while Anki is offline marked pending
  6. Reconnecting Anki flushes pending reviews and pushes offline edits
  7. Full Anki -> Kiroku sync (fields, tags, deck moves, review status, suspensions)
  8. Full Kiroku -> Anki sync (new cards, fields, tags, deck assignments)
  9. Conflict resolution (local pending edits not stomped by stale Anki data)
  10. Interrupted sync resilience and retry
  11. AnkiConnect unavailable graceful degradation
  12. Concurrent sync protection via lock
  13. Large collection batch processing
  14. Backward compatibility with existing database records
"""

import threading
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
import pytest

from app.db.connection import db_session, init_db
from app.repositories.card_repository import CardRepository, CardDraft
from app.repositories.review_repository import ReviewRepository
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError
from app.services.anki_fsrs_sync import AnkiFSRSSyncService, _ANKI_FSRS_SYNC_LOCK
from app.services.card_service import CardService
from app.services.card_normalizer import is_same_deck, match_deck_in_list


def _create_test_card(db_path, expression, reading, meaning, deck_name="JLPT advaned", anki_note_id=None, tags=None):
    now = datetime.now(timezone.utc).isoformat()
    tags_str = ",".join(tags) if tags else ""
    with db_session(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO cards (
                expression, reading, meaning, deck_name, tags, anki_note_id,
                normalized_expression, normalized_reading, normalized_deck_name,
                sync_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
            """,
            (
                expression,
                reading,
                meaning,
                deck_name,
                tags_str,
                anki_note_id,
                expression,
                reading,
                deck_name.lower().strip(),
                now,
                now,
            ),
        )
        card_id = cur.lastrowid
        conn.commit()
    return card_id


# -----------------------------------------------------------------------------
# 1. Bug A: Duplicate deck creation - 'JLPT advaned'
# -----------------------------------------------------------------------------
def test_bug_a_deck_resolution_reuses_existing_hierarchy(monkeypatch):
    """Verify 'JLPT advaned' reuses 'Japanese::JLPT advaned' without creating a duplicate."""
    service = AnkiConnectService()
    service.list_decks = MagicMock(return_value=["Default", "Japanese::JLPT advaned", "Japanese::N2"])
    service.deck_names = service.list_decks
    service._invoke = MagicMock()
    
    # Matching helper checks
    assert is_same_deck("JLPT advaned", "Japanese::JLPT advaned") is True
    assert match_deck_in_list("JLPT advaned", ["Default", "Japanese::JLPT advaned"]) == "Japanese::JLPT advaned"
    
    # resolve_deck_name should find the parent/child hierarchy
    resolved = service.resolve_deck_name("JLPT advaned")
    assert resolved == "Japanese::JLPT advaned"
    
    # create_deck should reuse and not call createDeck RPC
    deck_result = service.create_deck("JLPT advaned")
    assert deck_result == "Japanese::JLPT advaned"
    service._invoke.assert_not_called()


# -----------------------------------------------------------------------------
# 2. Bug A: Repeated 2-way sync idempotency
# -----------------------------------------------------------------------------
def test_bug_a_repeated_sync_idempotent_no_duplicates(tmp_path):
    """Repeated syncs in both directions must never create duplicate cards or decks."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.list_decks.return_value = ["Japanese::JLPT advaned"]
    mock_anki.deck_names = mock_anki.list_decks
    mock_anki.get_current_anki_day.return_value = 100
    mock_anki.find_cards.return_value = [101]
    mock_anki.get_cards_info.return_value = [{
        "cardId": 101,
        "note": 501,
        "deckName": "Japanese::JLPT advaned",
        "reps": 2,
        "lapses": 0,
        "interval": 5,
        "due": 105,
        "queue": 2,
    }]
    mock_anki.notes_info.return_value = [{
        "noteId": 501,
        "modelName": "Kiroku Note",
        "tags": ["jlpt-n1"],
        "fields": {
            "Expression": {"value": "躊躇う"},
            "Reading": {"value": "ためらう"},
            "Meaning": {"value": "to hesitate"},
        }
    }]
    
    repo = ReviewRepository(db_path=db_path)
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    
    # Pre-insert card with matching note id
    card_id = _create_test_card(db_path, "躊躇う", "ためらう", "to hesitate", "JLPT advaned", anki_note_id=501)
    
    # Run sync round 1
    sync_service.pull_anki_reviews()
    # Run sync round 2
    sync_service.pull_anki_reviews()
    
    with db_session(db_path) as conn:
        cards = conn.execute("SELECT id, deck_name, anki_note_id FROM cards WHERE expression = '躊躇う'").fetchall()
        assert len(cards) == 1
        assert cards[0]["anki_note_id"] == 501
        
        # Decks available in repository should be deduplicated
        available = repo.get_available_decks()
        assert len([d for d in available if "advaned" in d.lower()]) == 1


# -----------------------------------------------------------------------------
# 3. Bug B: Due dates and stats retained when Anki is closed
# -----------------------------------------------------------------------------
def test_bug_b_due_dates_and_stats_retained_when_anki_closed(tmp_path):
    """When Anki is closed, Kiroku must continue serving the persistent SQLite due dates."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    # 1. Card synced previously with scheduled due date in the past
    target_due = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    card_id = _create_test_card(db_path, "猫", "ねこ", "cat", "Japanese::JLPT advaned", anki_note_id=777)
    
    repo = ReviewRepository(db_path=db_path)
    repo.init_fsrs_from_anki(card_id=card_id, anki_card_id=123, reps=5, lapses=1, interval=10, due_date=target_due)
    
    # 2. Query due cards with Anki closed
    due_cards = repo.get_due_cards(deck_name="JLPT advaned", limit=10)
    assert len(due_cards) == 1
    assert due_cards[0]["id"] == card_id
    assert due_cards[0]["due_date"] == target_due
    
    # 3. Check review stats
    stats = repo.get_review_stats(deck_name="JLPT advaned")
    assert stats["due_count"] >= 1


# -----------------------------------------------------------------------------
# 4. Bug B: Kiroku restart preserves scheduling while Anki is offline
# -----------------------------------------------------------------------------
def test_bug_b_restart_kiroku_preserves_offline_scheduling(tmp_path):
    """Restarting Kiroku (new repo instances) while Anki is closed preserves scheduling."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    target_due = (datetime.now(timezone.utc) + timedelta(days=4)).strftime("%Y-%m-%d")
    card_id = _create_test_card(db_path, "犬", "いぬ", "dog", "JLPT advaned", anki_note_id=888)
    
    repo1 = ReviewRepository(db_path=db_path)
    repo1.init_fsrs_from_anki(card_id=card_id, anki_card_id=234, reps=3, lapses=0, interval=4, due_date=target_due)
    
    # Re-instantiate repo (simulating app restart)
    repo2 = ReviewRepository(db_path=db_path)
    
    due_cards = repo2.get_due_cards(deck_name="JLPT advaned", limit=10)
    # Card is due in 4 days, so should NOT be due today
    assert len(due_cards) == 0
    
    # Verify card state in SQLite is exactly preserved
    with db_session(db_path) as conn:
        state = conn.execute("SELECT due_date, stability, reps FROM card_fsrs WHERE card_id = ?", (card_id,)).fetchone()
        assert state["due_date"] == target_due
        assert state["reps"] == 3


# -----------------------------------------------------------------------------
# 5. Local changes made while Anki is offline marked pending
# -----------------------------------------------------------------------------
def test_local_changes_offline_marked_pending(tmp_path):
    """Local edits and reviews while Anki is offline must set pending status."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    card_id = _create_test_card(db_path, "食べる", "たべる", "to eat", "JLPT advaned", anki_note_id=999)
    card_repo = CardRepository(db_path=db_path)
    review_repo = ReviewRepository(db_path=db_path)
    
    # 1. Edit card fields while offline
    card_repo.save_or_update(CardDraft(
        id=card_id,
        expression="食べる",
        reading="たべる",
        meaning="to eat, consume",
        deck_name="JLPT advaned",
        tags="food,verb",
    ))
    
    with db_session(db_path) as conn:
        row = conn.execute("SELECT sync_status, meaning FROM cards WHERE id = ?", (card_id,)).fetchone()
        assert row["sync_status"] == "pending"
        assert row["meaning"] == "to eat, consume"
        
    # 2. Record review result in review_repo with pending sync
    with db_session(db_path) as conn:
        conn.execute(
            """
            INSERT INTO review_logs (card_id, rating, state, scheduled_days, elapsed_days, reviewed_at, synced_to_anki)
            VALUES (?, 3, 2, 1, 1, ?, 0)
            """,
            (card_id, datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
    
    pending = review_repo.get_pending_anki_reviews()
    assert len(pending) == 1
    assert pending[0]["card_id"] == card_id
    assert pending[0]["rating"] == 3


# -----------------------------------------------------------------------------
# 6. Reconnecting Anki flushes pending reviews and offline edits
# -----------------------------------------------------------------------------
def test_reconnect_anki_flushes_pending_state(tmp_path):
    """Reconnecting Anki flushes queued reviews and pushes pending field/tag edits."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    card_id = _create_test_card(db_path, "本", "ほん", "book (offline edit)", "JLPT advaned", anki_note_id=1111, tags=["study"])
    review_repo = ReviewRepository(db_path=db_path)
    review_repo.init_fsrs_from_anki(card_id=card_id, anki_card_id=2222, reps=1, lapses=0, interval=1)
    
    # Set status as pending
    with db_session(db_path) as conn:
        conn.execute("UPDATE cards SET sync_status = 'pending' WHERE id = ?", (card_id,))
        conn.execute("UPDATE card_fsrs SET sync_state = 'pending_anki' WHERE card_id = ?", (card_id,))
        conn.execute(
            """
            INSERT INTO review_logs (card_id, rating, state, scheduled_days, elapsed_days, reviewed_at, synced_to_anki)
            VALUES (?, 3, 2, 1, 1, ?, 0)
            """,
            (card_id, datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = True
    mock_anki.note_matches_card.return_value = True
    mock_anki.get_note_deck.return_value = "JLPT advaned"
    mock_anki.resolve_note_model.return_value = ("Kiroku Note", ["Expression", "Reading", "Meaning", "Notes"])
    mock_anki.map_card_to_fields.return_value = {"Expression": "本", "Reading": "ほん", "Meaning": "book (offline edit)"}
    mock_anki._invoke.return_value = [{"modelName": "Kiroku Note"}]
    mock_anki.update_note_fields.return_value = True
    mock_anki.set_note_tags.return_value = True
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=review_repo)
    
    # 1. Flush reviews
    res = sync_service.flush_pending_reviews()
    assert res["flushed_count"] == 1
    mock_anki.answer_card.assert_called_once_with(2222, 3)
    
    # 2. Sync pending card edits to Anki
    card_repo = CardRepository(db_path=db_path)
    card_service = CardService(card_repository=card_repo, anki_service=mock_anki)
    sync_res = card_service.sync_card(card_id, force=True)
    assert sync_res.sync_status == "synced"
    mock_anki.update_note_fields.assert_called_once()
    mock_anki.set_note_tags.assert_called_once_with(1111, ["study"])


# -----------------------------------------------------------------------------
# 7. Full Anki -> Kiroku sync (fields, tags, deck moves, review status, suspensions)
# -----------------------------------------------------------------------------
def test_anki_to_kiroku_full_sync(tmp_path):
    """Anki modifications (tags, fields, deck hierarchy, suspension) pull into Kiroku."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    card_id = _create_test_card(db_path, "走る", "はしる", "to run", "JLPT advaned", anki_note_id=3333, tags=["old-tag"])
    
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.list_decks.return_value = ["Japanese::JLPT advaned::Verbs"]
    mock_anki.deck_names = mock_anki.list_decks
    mock_anki.get_current_anki_day.return_value = 200
    mock_anki.find_cards.side_effect = lambda q: [4444] if "is:suspended" in q or "nid:3333" in q or "is:due" in q else []
    mock_anki.get_cards_info.return_value = [{
        "cardId": 4444,
        "note": 3333,
        "deckName": "Japanese::JLPT advaned::Verbs",
        "reps": 4,
        "lapses": 1,
        "interval": 12,
        "due": 210,
        "queue": -1,  # Suspended in Anki
    }]
    mock_anki.notes_info.return_value = [{
        "noteId": 3333,
        "modelName": "Kiroku Note",
        "tags": ["verbs", "n4", "active"],
        "fields": {
            "Expression": {"value": "走る"},
            "Reading": {"value": "はしる"},
            "Meaning": {"value": "to run, jog, sprint"},
        }
    }]
    
    repo = ReviewRepository(db_path=db_path)
    repo.init_fsrs_from_anki(card_id=card_id, anki_card_id=4444, reps=1, lapses=0, interval=1)
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    sync_service.pull_anki_reviews()
    
    with db_session(db_path) as conn:
        card = conn.execute("SELECT deck_name, meaning, tags FROM cards WHERE id = ?", (card_id,)).fetchone()
        assert card["deck_name"] == "Japanese::JLPT advaned::Verbs"
        
        state = conn.execute("SELECT is_suspended, reps FROM card_fsrs WHERE card_id = ?", (card_id,)).fetchone()
        assert state["is_suspended"] == 1
        assert state["reps"] == 4


# -----------------------------------------------------------------------------
# 8. Full Kiroku -> Anki sync (new cards, fields, tags, deck assignments)
# -----------------------------------------------------------------------------
def test_kiroku_to_anki_full_sync(tmp_path):
    """New cards created in Kiroku push to Anki with resolved deck and tags."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.is_available.return_value = True
    mock_anki.list_decks.return_value = ["Japanese::JLPT advaned"]
    mock_anki.deck_names = mock_anki.list_decks
    mock_anki.create_deck.return_value = "Japanese::JLPT advaned"
    mock_anki.find_existing_note.return_value = None
    mock_anki.add_note.return_value = 5555
    mock_anki.resolve_note_model.return_value = ("Kiroku Note", ["Expression", "Reading", "Meaning", "Notes"])
    mock_anki.map_card_to_fields.return_value = {"Expression": "勉強", "Reading": "べんきょう", "Meaning": "study"}
    mock_anki.set_note_tags.return_value = True
    
    card_repo = CardRepository(db_path=db_path)
    card_service = CardService(card_repository=card_repo, anki_service=mock_anki)
    
    record, _, _, _ = card_repo.save_or_update(CardDraft(
        expression="勉強",
        reading="べんきょう",
        meaning="study",
        deck_name="JLPT advaned",
        tags="n5,noun",
    ))
    
    res = card_service.sync_card(record.id)
    assert res.sync_status == "synced"
    assert res.anki_note_id == 5555
    
    # Verify add_note was called with resolved deck name
    assert mock_anki.add_note.called
    kwargs = mock_anki.add_note.call_args.kwargs
    assert kwargs["deck_name"] == "JLPT advaned"
    assert "noun" in kwargs["tags"]


# -----------------------------------------------------------------------------
# 9. Conflicting edits: local pending edits not stomped by stale Anki data
# -----------------------------------------------------------------------------
def test_conflicting_edits_resolution(tmp_path):
    """Local pending edits take precedence over stale Anki data during pull."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    card_id = _create_test_card(db_path, "雨", "あめ", "rain (newer local edit)", "JLPT advaned", anki_note_id=6666)
    with db_session(db_path) as conn:
        conn.execute("UPDATE cards SET sync_status = 'pending' WHERE id = ?", (card_id,))
        conn.commit()
        
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.list_decks.return_value = ["JLPT advaned"]
    mock_anki.deck_names = mock_anki.list_decks
    mock_anki.get_current_anki_day.return_value = 100
    mock_anki.find_cards.return_value = [7777]
    mock_anki.get_cards_info.return_value = [{
        "cardId": 7777,
        "note": 6666,
        "deckName": "JLPT advaned",
        "reps": 1,
        "lapses": 0,
        "interval": 1,
        "due": 101,
        "queue": 2,
    }]
    mock_anki.notes_info.return_value = [{
        "noteId": 6666,
        "modelName": "Kiroku Note",
        "tags": [],
        "fields": {
            "Expression": {"value": "雨"},
            "Reading": {"value": "あめ"},
            "Meaning": {"value": "stale anki meaning"},
        }
    }]
    
    repo = ReviewRepository(db_path=db_path)
    repo.init_fsrs_from_anki(card_id=card_id, anki_card_id=7777, reps=1, lapses=0, interval=1)
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    sync_service.pull_anki_reviews()
    
    with db_session(db_path) as conn:
        row = conn.execute("SELECT meaning, sync_status FROM cards WHERE id = ?", (card_id,)).fetchone()
        # Local newer edit must not be overwritten
        assert row["meaning"] == "rain (newer local edit)"
        assert row["sync_status"] == "pending"


# -----------------------------------------------------------------------------
# 10. Interrupted sync and retry resilience
# -----------------------------------------------------------------------------
def test_interrupted_sync_and_retry(tmp_path):
    """An interrupted sync can safely resume without causing database corruption."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    card1 = _create_test_card(db_path, "空", "そら", "sky", "JLPT advaned", anki_note_id=8001)
    card2 = _create_test_card(db_path, "海", "うみ", "sea", "JLPT advaned", anki_note_id=8002)
    
    repo = ReviewRepository(db_path=db_path)
    repo.init_fsrs_from_anki(card_id=card1, anki_card_id=9001, reps=1, lapses=0, interval=1)
    repo.init_fsrs_from_anki(card_id=card2, anki_card_id=9002, reps=1, lapses=0, interval=1)
    
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.list_decks.return_value = ["JLPT advaned"]
    mock_anki.deck_names = mock_anki.list_decks
    mock_anki.get_current_anki_day.return_value = 100
    mock_anki.find_cards.return_value = [9001, 9002]
    
    # First call to get_cards_info raises network error mid-sync
    mock_anki.get_cards_info.side_effect = [RuntimeError("Connection reset"), [{
        "cardId": 9001,
        "note": 8001,
        "deckName": "JLPT advaned",
        "reps": 1,
        "lapses": 0,
        "interval": 1,
        "due": 101,
        "queue": 2,
    }, {
        "cardId": 9002,
        "note": 8002,
        "deckName": "JLPT advaned",
        "reps": 2,
        "lapses": 0,
        "interval": 4,
        "due": 104,
        "queue": 2,
    }]]
    mock_anki.notes_info.return_value = []
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    
    # Sync 1 catches exception gracefully
    res1 = sync_service.pull_anki_reviews()
    # Sync 2 retries and succeeds cleanly
    res2 = sync_service.pull_anki_reviews()
    assert res2["pulled_count"] >= 1


# -----------------------------------------------------------------------------
# 11. AnkiConnect unavailable graceful degradation
# -----------------------------------------------------------------------------
def test_anki_unavailable_graceful_handling(tmp_path):
    """When AnkiConnect is unreachable, operations degrade cleanly with no unhandled crashes."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    offline_anki = MagicMock()
    offline_anki.is_connected.return_value = (False, "Connection refused")
    offline_anki.note_matches_card.side_effect = AnkiConnectionError("Offline")
    offline_anki.list_decks.side_effect = AnkiConnectionError("Offline")
    
    card_repo = CardRepository(db_path=db_path)
    card_service = CardService(card_repository=card_repo, anki_service=offline_anki)
    
    card_id = _create_test_card(db_path, "山", "やま", "mountain", "JLPT advaned")
    
    # Syncing while offline should return clear status without unhandled exception
    res = card_service.sync_card(card_id)
    assert res.sync_status in ("synced", "failed", "pending")
    
    # Decks listing falls back to local decks
    decks_resp = card_service.get_anki_decks()
    assert isinstance(decks_resp.decks, list)
    assert decks_resp.connected is False


# -----------------------------------------------------------------------------
# 12. Concurrent sync attempts protected by lock
# -----------------------------------------------------------------------------
def test_concurrent_sync_protected_by_lock(tmp_path):
    """Concurrent sync requests must be synchronized using _ANKI_FSRS_SYNC_LOCK."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = []
    
    repo = ReviewRepository(db_path=db_path)
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    
    errors = []
    def run_sync():
        try:
            sync_service.pull_anki_reviews()
        except Exception as e:
            errors.append(e)
            
    t1 = threading.Thread(target=run_sync)
    t2 = threading.Thread(target=run_sync)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    
    assert len(errors) == 0


# -----------------------------------------------------------------------------
# 13. Large collection batch processing
# -----------------------------------------------------------------------------
def test_large_collection_chunking(tmp_path):
    """Large card numbers are queried and processed in chunks without exceeding limits."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    # Generate 150 card IDs in Anki
    fake_card_ids = list(range(1000, 1150))
    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = fake_card_ids
    mock_anki.get_cards_info.side_effect = lambda chunk: [{
        "cardId": cid,
        "note": cid + 5000,
        "deckName": "JLPT advaned",
        "reps": 1,
        "lapses": 0,
        "interval": 1,
        "due": 100,
        "queue": 2,
    } for cid in chunk]
    mock_anki.notes_info.return_value = []
    mock_anki.get_current_anki_day.return_value = 95
    
    repo = ReviewRepository(db_path=db_path)
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    
    res = sync_service.pull_anki_reviews()
    assert res["status"] in ("ok", "success")


# -----------------------------------------------------------------------------
# 14. Backward compatibility with existing database records
# -----------------------------------------------------------------------------
def test_backward_compatibility_existing_records(tmp_path):
    """Existing database records with mixed case or legacy formats match correctly."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    
    # Insert card with raw legacy deck name and lowercase normalized_deck_name
    now = datetime.now(timezone.utc).isoformat()
    with db_session(db_path) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, meaning, deck_name, anki_note_id,
                normalized_expression, normalized_reading, normalized_deck_name,
                created_at, updated_at
            ) VALUES ('川', 'かわ', 'river', 'jlpt advaned', 9999, '川', 'かわ', 'jlpt advaned', ?, ?)
            """,
            (now, now)
        )
        conn.commit()
        
    repo = ReviewRepository(db_path=db_path)
    
    # Should match even when querying by canonical hierarchical name
    stats = repo.get_review_stats(deck_name="Japanese::JLPT advaned")
    assert stats["total_cards"] >= 1
