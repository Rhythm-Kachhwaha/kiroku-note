"""Unit and integration tests for Sync All functionality."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest, SyncAllResponse
from app.services.anki_connect import AnkiConnectionError, AnkiConnectService
from app.services.card_service import CardService


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db_path = Path(path)
    init_db(db_path)
    yield db_path
    if db_path.exists():
        try:
            db_path.unlink()
        except PermissionError:
            pass


class TestSyncAllService:
    def test_sync_all_zero_eligible_cards(self, temp_db):
        """When no cards exist in SQLite, sync_all returns zero counts."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)

        service = CardService(card_repository=repo, anki_service=mock_anki)
        result = service.sync_all()

        assert isinstance(result, SyncAllResponse)
        assert result.total_eligible == 0
        assert result.synced_count == 0
        assert result.failed_count == 0
        assert result.results == []
        assert result.error is None
        mock_anki.find_existing_note.assert_not_called()
        mock_anki.add_note.assert_not_called()

    def test_sync_all_single_pending_card(self, temp_db):
        """Syncing 1 pending card creates note in Anki and marks card synced."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 10001
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="山", reading="やま", meaning="mountain"))
        assert saved.sync_status == "pending"

        result = service.sync_all()
        assert result.total_eligible == 1
        assert result.synced_count == 1
        assert result.failed_count == 0
        assert len(result.results) == 1
        assert result.results[0].sync_status == "synced"
        assert result.results[0].anki_note_id == 10001

        # Confirm persisted in SQLite
        card_db = repo.get_by_id(saved.id)
        assert card_db.sync_status == "synced"
        assert card_db.anki_note_id == 10001
        assert card_db.synced_at is not None

    def test_sync_all_multiple_pending_cards(self, temp_db):
        """Syncing multiple pending cards processes all cards sequentially."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.side_effect = [20001, 20002, 20003]
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        service = CardService(card_repository=repo, anki_service=mock_anki)
        service.save_card(SaveCardRequest(expression="川", reading="かわ", meaning="river"))
        service.save_card(SaveCardRequest(expression="海", reading="うみ", meaning="sea"))
        service.save_card(SaveCardRequest(expression="空", reading="そら", meaning="sky"))

        result = service.sync_all()
        assert result.total_eligible == 3
        assert result.synced_count == 3
        assert result.failed_count == 0
        assert len(result.results) == 3
        assert [r.anki_note_id for r in result.results] == [20001, 20002, 20003]

    def test_sync_all_retryable_failed_cards(self, temp_db):
        """Cards previously marked failed are picked up and retried during sync_all."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="雨", reading="あめ", meaning="rain"))
        repo.mark_failed(saved.id, "Previous timeout")

        # Confirm card is in failed state
        assert repo.get_by_id(saved.id).sync_status == "failed"

        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 30001
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        result = service.sync_all()
        assert result.total_eligible == 1
        assert result.synced_count == 1
        assert result.failed_count == 0

        card_db = repo.get_by_id(saved.id)
        assert card_db.sync_status == "synced"
        assert card_db.anki_note_id == 30001
        assert card_db.sync_error == ""

    def test_sync_all_skips_already_synced_cards(self, temp_db):
        """Cards already marked synced are not included in eligible cards or resynced."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved1 = service.save_card(SaveCardRequest(expression="木", reading="き", meaning="tree"))
        repo.mark_synced(saved1.id, 40001)

        saved2 = service.save_card(SaveCardRequest(expression="花", reading="はな", meaning="flower"))
        # saved2 remains pending

        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 40002
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        result = service.sync_all()
        assert result.total_eligible == 1
        assert result.synced_count == 1
        assert result.results[0].id == saved2.id

        # Verify mock was only called once for saved2
        assert mock_anki.add_note.call_count == 1

    def test_sync_all_mixed_success_and_failure_does_not_abort(self, temp_db):
        """If card #2 fails, card #1 and #3 still succeed and are marked synced."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.find_existing_note.return_value = None
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        service = CardService(card_repository=repo, anki_service=mock_anki)
        c1 = service.save_card(SaveCardRequest(expression="犬", reading="いぬ", meaning="dog"))
        c2 = service.save_card(SaveCardRequest(expression="猫", reading="ねこ", meaning="cat"))
        c3 = service.save_card(SaveCardRequest(expression="鳥", reading="とり", meaning="bird"))

        def add_note_side_effect(deck_name, card_data, tags=None, model_name=None):
            if card_data["expression"] == "猫":
                raise AnkiConnectionError("Failed on cat note")
            return 50000 + c1.id

        mock_anki.add_note.side_effect = add_note_side_effect

        result = service.sync_all()
        assert result.total_eligible == 3
        assert result.synced_count == 2
        assert result.failed_count == 1

        db1 = repo.get_by_id(c1.id)
        db2 = repo.get_by_id(c2.id)
        db3 = repo.get_by_id(c3.id)

        assert db1.sync_status == "synced"
        assert db2.sync_status == "failed"
        assert "Failed on cat note" in db2.sync_error
        assert db3.sync_status == "synced"

    def test_sync_all_anki_unavailable(self, temp_db):
        """When AnkiConnect is unreachable, sync_all safely returns diagnostic error without corrupting cards."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (False, "Connection refused on port 8765")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="星", reading="ほし", meaning="star"))

        result = service.sync_all()
        assert result.total_eligible == 0
        assert result.synced_count == 0
        assert result.failed_count == 0
        assert "Connection refused" in result.error

        # Card remains pending and undamaged
        card_db = repo.get_by_id(saved.id)
        assert card_db.sync_status == "pending"

    def test_repeated_sync_all_does_not_create_duplicates(self, temp_db):
        """Calling sync_all twice consecutively syncs on first run and finds 0 eligible on second run."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 60001
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        service = CardService(card_repository=repo, anki_service=mock_anki)
        service.save_card(SaveCardRequest(expression="月", reading="つき", meaning="moon"))

        run1 = service.sync_all()
        assert run1.total_eligible == 1
        assert run1.synced_count == 1

        run2 = service.sync_all()
        assert run2.total_eligible == 0
        assert run2.synced_count == 0
        assert mock_anki.add_note.call_count == 1

    def test_sync_all_with_deck_filter(self, temp_db):
        """sync_all filtered by deck only syncs cards belonging to that deck."""
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.find_existing_note.return_value = None
        mock_anki.add_note.return_value = 70001
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])

        service = CardService(card_repository=repo, anki_service=mock_anki)
        c_anime = service.save_card(SaveCardRequest(expression="忍者", reading="にんじゃ", deck_name="Anime Mining"))
        c_general = service.save_card(SaveCardRequest(expression="侍", reading="さむらい", deck_name="General Vocab"))

        result = service.sync_all(deck_name="Anime Mining")
        assert result.total_eligible == 1
        assert result.synced_count == 1
        assert result.results[0].id == c_anime.id

        assert repo.get_by_id(c_anime.id).sync_status == "synced"
        assert repo.get_by_id(c_general.id).sync_status == "pending"


class TestSyncAllApi:
    def test_api_sync_all_endpoint(self, temp_db):
        """Test POST /api/cards/sync-all endpoint through FastAPI TestClient."""
        client = TestClient(app)

        with patch("app.main.init_db"):
            with patch.dict(os.environ, {"ANKIMINER_DB_PATH": str(temp_db)}):
                # 1. Save 2 cards
                client.post("/api/cards/save", json={"expression": "本", "reading": "ほん", "meaning": "book"})
                client.post("/api/cards/save", json={"expression": "紙", "reading": "かみ", "meaning": "paper"})

                with patch("app.services.card_service.AnkiConnectService.is_connected", return_value=(True, None)), \
                     patch("app.services.card_service.AnkiConnectService.find_existing_note", return_value=None), \
                     patch("app.services.card_service.AnkiConnectService.add_note", side_effect=[80001, 80002]), \
                     patch("app.services.card_service.AnkiConnectService.resolve_note_model", return_value=("Basic", ["Front", "Back"])):

                    resp = client.post("/api/cards/sync-all")
                    assert resp.status_code == 200
                    data = resp.json()
                    assert data["total_eligible"] == 2
                    assert data["synced_count"] == 2
                    assert data["failed_count"] == 0
                    assert len(data["results"]) == 2
                    assert data["error"] is None
