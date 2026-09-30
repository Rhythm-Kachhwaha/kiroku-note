"""Unit and integration tests for bulk card operations (T4-A)."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SyncAllResponse
from app.services.anki_connect import AnkiConnectService
from app.services.card_service import CardService


class TestCardRepositoryBulk(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_repo_bulk.db"
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_delete_many_and_get_many(self):
        c1, _ = self.repo.save(CardDraft(expression="食べる", reading="たべる", meaning="to eat"))
        c2, _ = self.repo.save(CardDraft(expression="飲む", reading="のむ", meaning="to drink"))
        c3, _ = self.repo.save(CardDraft(expression="走る", reading="はしる", meaning="to run"))

        records = self.repo.get_many([c1.id, c2.id])
        self.assertEqual(len(records), 2)
        record_ids = {r.id for r in records}
        self.assertIn(c1.id, record_ids)
        self.assertIn(c2.id, record_ids)
        self.assertNotIn(c3.id, record_ids)

        deleted_count = self.repo.delete_many([c1.id, c3.id])
        self.assertEqual(deleted_count, 2)

        self.assertIsNone(self.repo.get_by_id(c1.id))
        self.assertIsNotNone(self.repo.get_by_id(c2.id))
        self.assertIsNone(self.repo.get_by_id(c3.id))

    def test_delete_many_empty_and_invalid(self):
        self.assertEqual(self.repo.delete_many([]), 0)
        self.assertEqual(self.repo.delete_many(["invalid", 99999]), 0)
        self.assertEqual(self.repo.get_many([]), [])

    def test_update_deck_many(self):
        c1, _ = self.repo.save(CardDraft(expression="犬", reading="いぬ", deck_name="DeckA"))
        c2, _ = self.repo.save(CardDraft(expression="猫", reading="ねこ", deck_name="DeckA"))
        c3, _ = self.repo.save(CardDraft(expression="鳥", reading="とり", deck_name="DeckA"))

        count = self.repo.update_deck_many([c1.id, c2.id], "DeckB")
        self.assertEqual(count, 2)

        r1 = self.repo.get_by_id(c1.id)
        r2 = self.repo.get_by_id(c2.id)
        r3 = self.repo.get_by_id(c3.id)

        self.assertEqual(r1.deck_name, "DeckB")
        self.assertEqual(r2.deck_name, "DeckB")
        self.assertEqual(r3.deck_name, "DeckA")


class TestCardsBulkApi(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_api_bulk.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    def test_api_bulk_delete(self):
        c1, _ = self.repo.save(CardDraft(expression="本", reading="ほん", meaning="book"))
        c2, _ = self.repo.save(CardDraft(expression="ペン", reading="ぺん", meaning="pen"))
        c3, _ = self.repo.save(CardDraft(expression="机", reading="つくえ", meaning="desk"))

        # Bulk delete c1 and c2 using object payload
        res = self.client.request("DELETE", "/api/cards/bulk", json={"card_ids": [c1.id, c2.id]})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["deleted_count"], 2)
        self.assertTrue(data["deleted"])
        self.assertEqual(set(data["card_ids"]), {c1.id, c2.id})

        self.assertIsNone(self.repo.get_by_id(c1.id))
        self.assertIsNone(self.repo.get_by_id(c2.id))
        self.assertIsNotNone(self.repo.get_by_id(c3.id))

    def test_api_bulk_delete_raw_list_and_string_ids(self):
        c1, _ = self.repo.save(CardDraft(expression="山", reading="やま"))
        c2, _ = self.repo.save(CardDraft(expression="川", reading="かわ"))

        res = self.client.request("DELETE", "/api/cards/bulk", json=[str(c1.id), str(c2.id)])
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["deleted_count"], 2)

    def test_api_bulk_deck_update(self):
        c1, _ = self.repo.save(CardDraft(expression="車", reading="くるま", deck_name="OldDeck"))
        c2, _ = self.repo.save(CardDraft(expression="電車", reading="でんしゃ", deck_name="OldDeck"))

        res = self.client.post("/api/cards/bulk-deck", json={"card_ids": [c1.id, c2.id], "deck_name": "NewDeck"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["updated_count"], 2)
        self.assertEqual(data["deck_name"], "NewDeck")

        r1 = self.repo.get_by_id(c1.id)
        r2 = self.repo.get_by_id(c2.id)
        self.assertEqual(r1.deck_name, "NewDeck")
        self.assertEqual(r2.deck_name, "NewDeck")

    @patch("app.services.card_service.AnkiConnectService")
    def test_api_bulk_sync_success(self, MockAnki):
        mock_anki_inst = MagicMock(spec=AnkiConnectService)
        mock_anki_inst.is_connected.return_value = (True, None)
        mock_anki_inst.find_existing_note.return_value = None
        mock_anki_inst.add_note.side_effect = [20001, 20002]
        mock_anki_inst.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
        MockAnki.return_value = mock_anki_inst

        c1, _ = self.repo.save(CardDraft(expression="月", reading="つき", meaning="moon"))
        c2, _ = self.repo.save(CardDraft(expression="星", reading="ほし", meaning="star"))

        res = self.client.post("/api/cards/bulk-sync", json={"card_ids": [c1.id, c2.id]})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_eligible"], 2)
        self.assertEqual(data["synced_count"], 2)
        self.assertEqual(data["failed_count"], 0)
        self.assertIsNone(data["error"])
        self.assertEqual(len(data["results"]), 2)

        r1 = self.repo.get_by_id(c1.id)
        r2 = self.repo.get_by_id(c2.id)
        self.assertEqual(r1.sync_status, "synced")
        self.assertEqual(r1.anki_note_id, 20001)
        self.assertEqual(r2.sync_status, "synced")
        self.assertEqual(r2.anki_note_id, 20002)

    @patch("app.services.card_service.AnkiConnectService")
    def test_api_bulk_sync_anki_offline(self, MockAnki):
        mock_anki_inst = MagicMock(spec=AnkiConnectService)
        mock_anki_inst.is_connected.return_value = (False, "Connection refused")
        MockAnki.return_value = mock_anki_inst

        c1, _ = self.repo.save(CardDraft(expression="海", reading="うみ"))

        res = self.client.post("/api/cards/bulk-sync", json={"card_ids": [c1.id]})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_eligible"], 1)
        self.assertEqual(data["synced_count"], 0)
        self.assertEqual(data["failed_count"], 1)
        self.assertIn("Connection refused", data["error"])
