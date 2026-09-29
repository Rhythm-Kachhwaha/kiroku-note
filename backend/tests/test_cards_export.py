import csv
import io
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository


class CardsExportAndHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_cards_export.db"
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

    def test_health_endpoint(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("version", data)
        self.assertTrue(data["db"])
        self.assertIsInstance(data["yomitan"], bool)
        self.assertIsInstance(data["ankiconnect"], bool)
        self.assertIsInstance(data["ocr"], bool)

    def test_export_empty(self):
        resp = self.client.get("/api/cards/export")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/csv", resp.headers["content-type"])
        reader = list(csv.reader(io.StringIO(resp.text)))
        self.assertEqual(len(reader), 1)
        self.assertEqual(reader[0], ["expression", "reading", "meaning", "jlpt_level", "deck", "sync_status", "created_at"])

    def test_export_full_cards(self):
        self.repo.save(CardDraft(expression="食べる", reading="たべる", meaning="to eat", deck_name="Anime", jlpt_level="N5"))
        self.repo.save(CardDraft(expression="飲む", reading="のむ", meaning="to drink", deck_name="Anime", jlpt_level="N4"))

        resp = self.client.get("/api/cards/export")
        self.assertEqual(resp.status_code, 200)
        reader = list(csv.reader(io.StringIO(resp.text)))
        self.assertEqual(len(reader), 3)  # header + 2 rows
        self.assertEqual(reader[0], ["expression", "reading", "meaning", "jlpt_level", "deck", "sync_status", "created_at"])

        expressions = [r[0] for r in reader[1:]]
        self.assertIn("飲む", expressions)
        self.assertIn("食べる", expressions)

    def test_export_filtered_by_deck(self):
        self.repo.save(CardDraft(expression="食べる", reading="たべる", meaning="to eat", deck_name="DeckA"))
        self.repo.save(CardDraft(expression="飲む", reading="のむ", meaning="to drink", deck_name="DeckB"))

        resp = self.client.get("/api/cards/export?deck=DeckA")
        self.assertEqual(resp.status_code, 200)
        reader = list(csv.reader(io.StringIO(resp.text)))
        self.assertEqual(len(reader), 2)  # header + 1 row
        self.assertEqual(reader[1][0], "食べる")
        self.assertEqual(reader[1][4], "DeckA")

    def test_export_filtered_by_status(self):
        card1, _ = self.repo.save(CardDraft(expression="食べる", reading="たべる", meaning="to eat", deck_name="DeckA"))
        self.repo.save(CardDraft(expression="飲む", reading="のむ", meaning="to drink", deck_name="DeckA"))
        self.repo.mark_synced(card1.id, anki_note_id=12345)

        resp = self.client.get("/api/cards/export?status=synced")
        self.assertEqual(resp.status_code, 200)
        reader = list(csv.reader(io.StringIO(resp.text)))
        self.assertEqual(len(reader), 2)
        self.assertEqual(reader[1][0], "食べる")
        self.assertEqual(reader[1][5], "synced")
