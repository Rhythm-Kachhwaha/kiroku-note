from unittest.mock import MagicMock
import pytest
from app.services.anki_fsrs_sync import AnkiFSRSSyncService

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
