import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.services.word_state_service import WordStateService


class VocabInventoryApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_vocab_inventory.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.client = TestClient(app)

        # Populate a few word states and a card
        self.ws_service = WordStateService(self.db_path)
        self.ws_service.set_user_word_state(expression="猫", reading="ねこ", state="known")
        self.ws_service.set_user_word_state(expression="食べる", reading="たべる", state="learning")
        self.ws_service.set_user_word_state(expression="本", reading="ほん", state="ignored")

        card_repo = CardRepository(self.db_path)
        card_repo.save(
            CardDraft(
                expression="猫",
                reading="ねこ",
                meaning="cat",
                jlpt_level="N5",
                deck_name="Default",
            )
        )

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_get_vocab_inventory_all(self):
        resp = self.client.get("/api/vocab/inventory", params={"include_reference": False})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(data["total"], 3)
        expressions = [item["expression"] for item in data["items"]]
        self.assertIn("猫", expressions)
        self.assertIn("食べる", expressions)
        self.assertIn("本", expressions)
        self.assertIn("counts_by_state", data)
        self.assertEqual(data["counts_by_state"]["known"], 1)
        self.assertEqual(data["counts_by_state"]["learning"], 1)

    def test_get_vocab_inventory_filter_state(self):
        resp = self.client.get(
            "/api/vocab/inventory",
            params={"state": "known", "include_reference": False},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["expression"], "猫")
        self.assertEqual(data["items"][0]["is_mined"], True)

    def test_bulk_set_word_state(self):
        resp = self.client.post(
            "/api/vocab/inventory/bulk-state",
            json={"expressions": ["食べる", "本"], "state": "known"},
        )
        self.assertEqual(resp.status_code, 200)
        result = resp.json()
        self.assertTrue(result["ok"])
        self.assertEqual(result["updated"], 2)

        # Verify state in inventory
        inv_resp = self.client.get(
            "/api/vocab/inventory",
            params={"state": "known", "include_reference": False},
        )
        data = inv_resp.json()
        self.assertEqual(data["total"], 3)
