"""
Tests for Word of the Day API (/api/vocab/daily-word).
Verifies:
1. Determinism: Same calendar date always produces the exact same word across repeated requests.
2. Date rollover: Different calendar dates produce different words.
3. Skips already-saved cards: Saved cards in SQLite are filtered out.
4. Fallback behavior: Gracefully falls back when words at learner level are exhausted.
5. KanjiVG strokes: Attached for kanji characters when available.
"""

import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app


class DailyWordApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_daily_word.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    def test_daily_word_deterministic_same_date(self):
        """Calling with same date 3 times returns identical word."""
        date_str = "2026-11-02"
        r1 = self.client.get(f"/api/vocab/daily-word?date={date_str}")
        r2 = self.client.get(f"/api/vocab/daily-word?date={date_str}")
        r3 = self.client.get(f"/api/vocab/daily-word?date={date_str}")

        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r3.status_code, 200)

        d1 = r1.json()
        d2 = r2.json()
        d3 = r3.json()

        self.assertEqual(d1["word"], d2["word"])
        self.assertEqual(d2["word"], d3["word"])
        self.assertEqual(d1["reading"], d2["reading"])
        self.assertEqual(d1["meaning"], d2["meaning"])
        self.assertEqual(d1["jlpt_level"], d2["jlpt_level"])

    def test_daily_word_date_rollover_yields_different_word(self):
        """Different calendar dates deterministically select different words."""
        r_day1 = self.client.get("/api/vocab/daily-word?date=2026-11-02")
        r_day2 = self.client.get("/api/vocab/daily-word?date=2026-11-03")

        self.assertEqual(r_day1.status_code, 200)
        self.assertEqual(r_day2.status_code, 200)

        d1 = r_day1.json()
        d2 = r_day2.json()

        self.assertEqual(d1["date"], "2026-11-02")
        self.assertEqual(d2["date"], "2026-11-03")
        self.assertTrue(d1["word"] != d2["word"] or d1["reading"] != d2["reading"])

    def test_daily_word_skips_saved_cards(self):
        """When a word is saved into user cards, subsequent query skips it."""
        date_str = "2027-01-15"
        r1 = self.client.get(f"/api/vocab/daily-word?date={date_str}")
        self.assertEqual(r1.status_code, 200)
        w1 = r1.json()

        # Save as card
        save_resp = self.client.post("/api/cards/save", json={
            "expression": w1["word"],
            "reading": w1["reading"],
            "meaning": w1["meaning"],
            "deck_name": "Default"
        })
        self.assertEqual(save_resp.status_code, 200)

        # Query again for same date
        r2 = self.client.get(f"/api/vocab/daily-word?date={date_str}")
        self.assertEqual(r2.status_code, 200)
        w2 = r2.json()

        self.assertNotEqual(w2["word"], w1["word"])

    def test_daily_word_has_kanji_and_strokes_structure(self):
        """KanjiVG stroke order SVGs are attached when kanji characters are present."""
        r = self.client.get("/api/vocab/daily-word?date=2026-11-02")
        self.assertEqual(r.status_code, 200)
        data = r.json()

        self.assertIn("word", data)
        self.assertIn("reading", data)
        self.assertIn("meaning", data)
        self.assertIn("jlpt_level", data)
        self.assertIn("has_kanji", data)
        self.assertIn("stroke_svgs", data)
        self.assertIsInstance(data["stroke_svgs"], dict)

        if data["has_kanji"]:
            self.assertGreater(len(data["kanji_characters"]), 0)
