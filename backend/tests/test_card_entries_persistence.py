"""TDD tests for Step 1: Persisting structured dictionary entries in SaveCardRequest."""
import json
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest, SaveCardResponse
from app.services.card_service import CardService


class TestCardEntriesPersistence(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_persistence.db"
        self.original_env = os.environ.get("KIROKU_DB_PATH")
        os.environ["KIROKU_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repository = CardRepository(self.db_path)
        self.service = CardService(card_repository=self.repository)
        self.client = TestClient(app)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["KIROKU_DB_PATH"] = self.original_env
        else:
            os.environ.pop("KIROKU_DB_PATH", None)
        self.temp_dir.cleanup()

    # 1. SaveCardRequest schema tests
    def test_save_card_request_default_entries(self):
        req = SaveCardRequest(expression="猫")
        self.assertEqual(req.entries, [])

    def test_save_card_request_accepts_entries(self):
        sample_entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "term": "猫",
                "reading": "ねこ",
                "senses": [{"index": 1, "glosses": ["cat"]}],
            }
        ]
        req = SaveCardRequest(expression="猫", entries=sample_entries)
        self.assertEqual(req.entries, sample_entries)

    # 2. CardService.save_card persists provided entries to SQLite meanings_json
    def test_save_card_persists_entries_to_sqlite(self):
        sample_entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "term": "食べる",
                "reading": "たべる",
                "senses": [
                    {"index": 1, "glosses": ["to eat"], "parts_of_speech": ["v1", "vt"]},
                    {"index": 2, "glosses": ["to live on"], "parts_of_speech": ["v1"]},
                ],
            }
        ]
        req = SaveCardRequest(
            expression="食べる",
            reading="たべる",
            meaning="1. to eat\n2. to live on",
            entries=sample_entries,
        )
        saved = self.service.save_card(req)
        self.assertEqual(saved.expression, "食べる")
        self.assertEqual(saved.entries, sample_entries)

        # Inspect raw SQLite record
        record = self.repository.get_by_id(saved.id)
        self.assertIsNotNone(record)
        self.assertEqual(record.entries, sample_entries)
        raw_json = json.loads(record.meanings_json)
        self.assertEqual(raw_json, sample_entries)

    # 3. CardDetail response returns structured entries when loaded
    def test_get_card_returns_persisted_entries(self):
        sample_entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "term": "映画",
                "reading": "えいが",
                "pitches": [{"position": 0, "pattern_name": "heiban"}],
                "frequencies": [{"dictionary": "BCCWJ", "rank": 320}],
                "senses": [{"index": 1, "glosses": ["movie", "film"]}],
            }
        ]
        req = SaveCardRequest(
            expression="映画",
            reading="えいが",
            meaning="movie, film",
            entries=sample_entries,
        )
        saved = self.service.save_card(req)

        detail = self.service.get_card(saved.id)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.entries, sample_entries)

    # 4. Updating an existing card preserves or updates entries
    def test_update_card_preserves_entries_when_omitted(self):
        sample_entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "term": "本",
                "reading": "ほん",
                "senses": [{"index": 1, "glosses": ["book"]}],
            }
        ]
        req = SaveCardRequest(expression="本", reading="ほん", entries=sample_entries)
        saved = self.service.save_card(req)

        # Now update card without entries
        update_req = SaveCardRequest(
            id=saved.id,
            expression="本",
            reading="ほん",
            meaning="book / volume",
            # entries omitted -> defaults to []
        )
        updated = self.service.save_card(update_req)
        self.assertEqual(updated.meaning, "book / volume")

        # Must preserve the previously persisted entries, not wipe them
        record = self.repository.get_by_id(saved.id)
        self.assertEqual(record.entries, sample_entries)

    def test_update_card_updates_entries_when_provided(self):
        initial_entries = [{"dictionary": "OldDict", "senses": [{"glosses": ["old"]}]}]
        req = SaveCardRequest(expression="犬", reading="いぬ", entries=initial_entries)
        saved = self.service.save_card(req)

        new_entries = [{"dictionary": "NewDict", "senses": [{"glosses": ["dog"]}]}]
        update_req = SaveCardRequest(
            id=saved.id,
            expression="犬",
            reading="いぬ",
            entries=new_entries,
        )
        updated = self.service.save_card(update_req)
        self.assertEqual(updated.entries, new_entries)

        record = self.repository.get_by_id(saved.id)
        self.assertEqual(record.entries, new_entries)

    # 5. Backward compatibility: empty meanings_json in SQLite
    def test_legacy_card_with_empty_meanings_json(self):
        draft = CardDraft(
            expression="水",
            reading="みず",
            meaning="water",
            entries=[],
        )
        record, _, _, _ = self.repository.save_or_update(draft)
        self.assertEqual(record.meanings_json, "[]")
        self.assertEqual(record.entries, [])

        loaded = self.service.get_card(record.id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.entries, [])

    # 6. REST API integration: POST /api/cards/save and GET /api/cards/{id}
    def test_api_save_and_get_card_entries(self):
        sample_entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "term": "空",
                "reading": "そら",
                "senses": [{"index": 1, "glosses": ["sky"]}],
            }
        ]
        res = self.client.post(
            "/api/cards/save",
            json={
                "expression": "空",
                "reading": "そら",
                "meaning": "sky",
                "entries": sample_entries,
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["expression"], "空")
        self.assertEqual(data["entries"], sample_entries)

        # GET /api/cards/{id}
        card_id = data["id"]
        res_get = self.client.get(f"/api/cards/{card_id}")
        self.assertEqual(res_get.status_code, 200)
        get_data = res_get.json()
        self.assertEqual(get_data["entries"], sample_entries)


if __name__ == "__main__":
    unittest.main()
