"""Tests for CardService resync capability, deck retention, and self-healing repository migration."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from app.db.connection import init_db
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest, SyncCardResponse
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


class TestCardServiceResync:
    def test_sync_card_force_updates_existing_note(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.note_matches_card.return_value = True
        mock_anki.get_note_deck.return_value = "N3 vocabs"
        mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
        mock_anki._invoke.return_value = [{"modelName": "Basic", "deckName": "N3 vocabs"}]
        mock_anki.map_card_to_fields.return_value = {"Front": "喫茶店", "Back": "coffee shop"}

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="喫茶店", reading="きっさてん", meaning="coffee shop", deck_name="Default"))
        repo.mark_synced(saved.id, 99001)

        # Force resync
        res = service.sync_card(saved.id, force=True)
        assert res.sync_status == "synced"
        assert res.anki_note_id == 99001
        assert res.deck_name == "N3 vocabs"
        mock_anki.update_note_fields.assert_called_once_with(99001, {"Front": "喫茶店", "Back": "coffee shop"})
        mock_anki.add_note.assert_not_called()

        # Check local DB updated deck_name to match Anki note
        updated_card = repo.get_by_id(saved.id)
        assert updated_card.deck_name == "N3 vocabs"

    def test_sync_card_unforced_already_synced_returns_cached_without_updates(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (True, None)
        mock_anki.note_matches_card.return_value = True
        mock_anki.get_note_deck.return_value = "Default"

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="本", reading="ほん", meaning="book"))
        repo.mark_synced(saved.id, 88001)

        res = service.sync_card(saved.id, force=False)
        assert res.sync_status == "synced"
        assert res.anki_note_id == 88001
        mock_anki.update_note_fields.assert_not_called()
        mock_anki.add_note.assert_not_called()

    def test_sync_card_offline_anki_preserves_synced_status(self, temp_db):
        repo = CardRepository(temp_db)
        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.note_matches_card.side_effect = AnkiConnectionError("Connection refused")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        saved = service.save_card(SaveCardRequest(expression="机", reading="つくえ", meaning="desk"))
        repo.mark_synced(saved.id, 77001)

        # Syncing while Anki is offline should NOT corrupt card to 'failed'
        res = service.sync_card(saved.id, force=False)
        assert res.sync_status == "synced"
        assert res.anki_note_id == 77001

        card_db = repo.get_by_id(saved.id)
        assert card_db.sync_status == "synced"
        assert card_db.anki_note_id == 77001

    def test_get_anki_decks_unions_saved_decks_even_when_offline(self, temp_db):
        repo = CardRepository(temp_db)
        repo.save(CardDraft(expression="猫", reading="ねこ", meaning="cat", deck_name="N3 vocabs"))
        repo.save(CardDraft(expression="犬", reading="いぬ", meaning="dog", deck_name="Mining Deck"))

        mock_anki = MagicMock(spec=AnkiConnectService)
        mock_anki.is_connected.return_value = (False, "Offline")
        mock_anki.list_decks.side_effect = Exception("Offline")

        service = CardService(card_repository=repo, anki_service=mock_anki)
        resp = service.get_anki_decks()
        assert resp.connected is False
        assert "Default" in resp.decks
        assert "N3 vocabs" in resp.decks
        assert "Mining Deck" in resp.decks

    def test_repository_heals_validation_failed_synced_cards(self, temp_db):
        repo = CardRepository(temp_db)
        # Create a card artificially in failed validation state with an existing note ID
        c, *_ = repo.save(CardDraft(expression="映画", reading="えいが", meaning="movie", deck_name="N3 vocabs"))
        repo.mark_synced(c.id, 55555)
        repo.mark_failed(c.id, "Existing Anki note validation failed; retrying sync.")
        # Ensure it has anki_note_id
        repo.set_anki_note_id(c.id, 55555)

        card_before = repo.get_by_id(c.id)
        assert card_before.sync_status == "failed"
        assert card_before.anki_note_id == 55555
        assert card_before.sync_error == "Existing Anki note validation failed; retrying sync."

        # Running repo healing / init_db
        repo.heal_validation_failed_cards()

        card_after = repo.get_by_id(c.id)
        assert card_after.sync_status == "synced"
        assert card_after.sync_error == ""
        assert card_after.anki_note_id == 55555
