from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
import pytest
from app.db.connection import db_session, init_db
from app.repositories.review_repository import ReviewRepository
from app.services.anki_connect import AnkiConnectService
from app.services.anki_fsrs_sync import AnkiFSRSSyncService


def _insert_card(db_path, expression, reading, meaning, deck_name="N3 vocabs", anki_note_id=None):
    now = datetime.now(timezone.utc).isoformat()
    with db_session(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO cards (
                expression, reading, meaning, deck_name, anki_note_id,
                normalized_expression, normalized_reading, normalized_deck_name,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                expression,
                reading,
                meaning,
                deck_name,
                anki_note_id,
                expression,
                reading,
                deck_name.lower(),
                now,
                now,
            ),
        )
        card_id = cur.lastrowid
        conn.commit()
    return card_id

def test_first_load_auto_sync_imports_existing_cards():
    mock_anki = MagicMock()
    mock_repo = MagicMock()
    
    mock_anki.is_connected.return_value = (True, None)
    # Simulate finding existing card with 3 reps and interval 15 in Anki
    mock_anki.find_cards.return_value = [2001]
    mock_anki.get_cards_info.return_value = [{
        "cardId": 2001,
        "note": 555,
        "reps": 3,
        "lapses": 0,
        "interval": 15,
        "due": 1750000000
    }]
    mock_repo.get_cards_without_fsrs.return_value = [{"id": 10, "anki_note_id": 555}]
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=mock_repo)
    result = sync_service.first_load_import()
    
    assert result["imported_count"] == 1
    mock_repo.init_fsrs_from_anki.assert_called_once_with(
        card_id=10,
        anki_card_id=2001,
        reps=3,
        lapses=0,
        interval=15,
        due_timestamp=1750000000
    )

def test_sync_card_review_online():
    mock_anki = MagicMock()
    mock_repo = MagicMock()
    
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = True
    mock_repo.get_or_create_fsrs.return_value = {"anki_card_id": 3001}
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=mock_repo)
    res = sync_service.sync_card_review(card_id=5, rating=3)
    
    assert res["status"] == "synced"
    mock_anki.answer_card.assert_called_once_with(3001, 3)
    mock_repo.mark_review_synced.assert_called_once_with(card_id=5)

def test_sync_card_review_offline_queues():
    mock_anki = MagicMock()
    mock_repo = MagicMock()
    
    mock_anki.is_connected.return_value = (False, "Connection refused")
    mock_repo.get_or_create_fsrs.return_value = {"anki_card_id": 3001}
    
    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=mock_repo)
    res = sync_service.sync_card_review(card_id=5, rating=3)
    
    assert res["status"] == "queued"
    mock_repo.update_card_fsrs.assert_called_once_with(5, {"sync_state": "pending_anki"})


def test_anki_connect_answer_card_uses_answerCards_v6_action():
    service = AnkiConnectService()
    with patch.object(service, "_invoke", return_value=[True]) as mock_invoke:
        ok = service.answer_card(1790935494140, 4)
        assert ok is True
        mock_invoke.assert_called_once_with(
            "answerCards",
            answers=[{"cardId": 1790935494140, "ease": 4}],
        )

    with patch.object(service, "_invoke", return_value=[False]):
        assert service.answer_card(1790935494140, 3) is False

    with patch.object(service, "_invoke", return_value=[]):
        assert service.answer_card(1790935494140, 3) is False

    with patch.object(service, "_invoke", side_effect=RuntimeError("offline")):
        assert service.answer_card(1790935494140, 3) is False


def test_sync_card_review_resolves_missing_anki_card_id_from_note_id(tmp_path):
    db_path = tmp_path / "kiroku_resolve.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "来週", "らいしゅう", "next week", "N3 vocabs", anki_note_id=99001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"reps": 1, "state": 2, "sync_state": "pending_anki"})
    log_id = repo.log_review(card_id=card_id, rating=4, state=0, scheduled_days=6, elapsed_days=0)

    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = [88001]
    mock_anki.answer_card.return_value = True

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    res = sync_service.sync_card_review(card_id=card_id, rating=4, log_id=log_id)

    assert res == {"status": "synced", "anki_card_id": 88001}
    mock_anki.find_cards.assert_called_once_with("nid:99001")
    mock_anki.answer_card.assert_called_once_with(88001, 4)
    assert repo.get_or_create_fsrs(card_id)["anki_card_id"] == 88001
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "synced"
    assert repo.has_pending_anki_reviews() is False


def test_offline_review_preserved_and_flushed_idempotently(tmp_path):
    db_path = tmp_path / "kiroku_offline_flush.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "明日", "あした", "tomorrow", "N3 vocabs", anki_note_id=77001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(
        card_id,
        {"reps": 2, "state": 2, "scheduled_days": 30, "due_date": "2027-04-27", "sync_state": "pending_anki"},
    )
    log_id = repo.log_review(card_id=card_id, rating=4, state=2, scheduled_days=30, elapsed_days=1)

    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.side_effect = lambda q: [77001] if "nid:77001" in q else []
    mock_anki.get_cards_info.return_value = [{
        "cardId": 77001,
        "card_id": 77001,
        "note": 77001,
        "reps": 1,
        "lapses": 0,
        "interval": 10,
        "queue": 2,
        "due": 500,
        "deck_name": "N3 vocabs",
    }]

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)

    # 1. first_load_import links anki_card_id but MUST NOT overwrite Kiroku's offline review progress
    sync_service.first_load_import("N3 vocabs")
    fsrs_after_import = repo.get_or_create_fsrs(card_id)
    assert fsrs_after_import["anki_card_id"] == 77001
    assert fsrs_after_import["reps"] == 2
    assert fsrs_after_import["due_date"] == "2027-04-27"
    assert fsrs_after_import["sync_state"] == "pending_anki"

    # 2. pull_anki_reviews MUST skip cards with unsynced Kiroku reviews
    pull_res = sync_service.pull_anki_reviews("N3 vocabs")
    assert pull_res["pulled_count"] == 0
    assert repo.get_or_create_fsrs(card_id)["reps"] == 2

    # 3. flush_pending_reviews pushes the queued review once and marks it synced
    mock_anki.answer_card.return_value = True
    flush_res = sync_service.flush_pending_reviews()
    assert flush_res["flushed_count"] == 1
    assert flush_res["remaining_count"] == 0
    mock_anki.answer_card.assert_called_once_with(77001, 4)
    assert repo.is_review_log_synced(log_id) is True
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "synced"

    # 4. Second flush is idempotent (never double-answers)
    flush_again = sync_service.flush_pending_reviews()
    assert flush_again["flushed_count"] == 0
    assert mock_anki.answer_card.call_count == 1


def test_mark_review_synced_waits_for_all_card_logs(tmp_path):
    db_path = tmp_path / "kiroku_multi_logs.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "先生", "せんせい", "teacher", "N3 vocabs")

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 55001, "sync_state": "pending_anki"})
    log1 = repo.log_review(card_id=card_id, rating=1, state=0, scheduled_days=0, elapsed_days=0)
    log2 = repo.log_review(card_id=card_id, rating=3, state=1, scheduled_days=1, elapsed_days=0)

    repo.mark_review_synced(log_id=log1, card_id=card_id)
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "pending_anki"

    repo.mark_review_synced(log_id=log2, card_id=card_id)
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "synced"


def test_pull_anki_reviews_updates_deck_mismatch_cleanly(tmp_path):
    db_path = tmp_path / "kiroku_deck_mismatch.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "名前", "なまえ", "name", "Old Deck", anki_note_id=66001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 66001, "reps": 1, "scheduled_days": 10, "sync_state": "synced"})

    mock_anki = MagicMock()
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = []
    mock_anki.get_cards_info.return_value = [{
        "cardId": 66001,
        "card_id": 66001,
        "note": 66001,
        "reps": 2,
        "lapses": 0,
        "interval": 25,
        "queue": 2,
        "deck_name": "N3 vocabs",
    }]

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    res = sync_service.pull_anki_reviews()
    assert res["pulled_count"] == 1

    with db_session(db_path) as conn:
        deck = conn.execute("SELECT deck_name FROM cards WHERE id = ?", (card_id,)).fetchone()["deck_name"]
    assert deck == "N3 vocabs"
