import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository


class CardsFiltersTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_cards_filters.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.client = TestClient(app)

        # Seed test cards with various jlpt_levels and source_types
        self.repo.save(
            CardDraft(
                expression="猫",
                reading="ねこ",
                meaning="cat",
                jlpt_level="N5",
                source_type="subtitle",
                deck_name="Default",
            )
        )
        self.repo.save(
            CardDraft(
                expression="犬",
                reading="いぬ",
                meaning="dog",
                jlpt_level="N5",
                source_type="quick_add",
                deck_name="Default",
            )
        )
        self.repo.save(
            CardDraft(
                expression="勉強",
                reading="べんきょう",
                meaning="study",
                jlpt_level="N4",
                source_type="subtitle",
                deck_name="Default",
            )
        )
        self.repo.save(
            CardDraft(
                expression="経済",
                reading="けいざい",
                meaning="economy",
                jlpt_level="N2",
                source_type="vocab_gap",
                deck_name="Default",
            )
        )

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    def test_filter_by_jlpt_level(self):
        resp = self.client.get("/api/cards", params={"jlpt_level": "N5"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 2)
        expressions = [c["expression"] for c in data["cards"]]
        self.assertIn("猫", expressions)
        self.assertIn("犬", expressions)

    def test_filter_by_source_type(self):
        resp = self.client.get("/api/cards", params={"source_type": "subtitle"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 2)
        expressions = [c["expression"] for c in data["cards"]]
        self.assertIn("猫", expressions)
        self.assertIn("勉強", expressions)

    def test_filter_by_both_level_and_source(self):
        resp = self.client.get(
            "/api/cards",
            params={"jlpt_level": "N4", "source_type": "subtitle"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["cards"][0]["expression"], "勉強")

    def test_filter_export_by_level_and_source(self):
        resp = self.client.get(
            "/api/cards/export",
            params={"jlpt_level": "N2", "source_type": "vocab_gap"},
        )
        self.assertEqual(resp.status_code, 200)
        text = resp.text
        self.assertIn("経済", text)
        self.assertNotIn("猫", text)
