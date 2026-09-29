"""Tests for GET /api/cards/stats endpoint and CardRepository stats aggregation (T3-F)."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import db_session, init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository


class CardsStatsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_cards_stats.db"
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

    def test_stats_empty_database(self):
        """Verify stats aggregation on a completely empty database."""
        stats = self.repo.get_stats()
        self.assertEqual(stats["total"], 0)
        self.assertEqual(stats["today"], 0)
        self.assertEqual(stats["this_week"], 0)
        self.assertEqual(
            stats["sync_ratio"],
            {"synced": 0, "pending": 0, "failed": 0, "total": 0},
        )
        self.assertEqual(
            stats["jlpt_breakdown"],
            {"N5": 0, "N4": 0, "N3": 0, "N2": 0, "N1": 0, "Unknown": 0},
        )
        self.assertEqual(stats["top_decks"], [])

    def test_stats_single_deck_and_sync_ratios(self):
        """Verify stats with cards in a single deck having varying sync statuses."""
        c1, _ = self.repo.save(
            CardDraft(expression="食べる", reading="たべる", meaning="to eat", deck_name="Mining")
        )
        c2, _ = self.repo.save(
            CardDraft(expression="飲む", reading="のむ", meaning="to drink", deck_name="Mining")
        )
        c3, _ = self.repo.save(
            CardDraft(expression="走る", reading="はしる", meaning="to run", deck_name="Mining")
        )

        self.repo.mark_synced(c1.id, anki_note_id=101)
        self.repo.mark_failed(c2.id, error_message="Anki error")

        stats = self.repo.get_stats()
        self.assertEqual(stats["total"], 3)
        self.assertEqual(stats["today"], 3)
        self.assertEqual(stats["this_week"], 3)
        self.assertEqual(stats["sync_ratio"]["synced"], 1)
        self.assertEqual(stats["sync_ratio"]["failed"], 1)
        self.assertEqual(stats["sync_ratio"]["pending"], 1)
        self.assertEqual(stats["sync_ratio"]["total"], 3)

        self.assertEqual(len(stats["top_decks"]), 1)
        self.assertEqual(stats["top_decks"][0]["deck_name"], "Mining")
        self.assertEqual(stats["top_decks"][0]["count"], 3)

    def test_stats_multi_deck_top3_limit(self):
        """Verify top_decks returns only the top 3 decks ranked by count descending."""
        for i in range(5):
            self.repo.save(CardDraft(expression=f"語A{i}", reading="ご", deck_name="DeckA"))
        for i in range(3):
            self.repo.save(CardDraft(expression=f"語B{i}", reading="ご", deck_name="DeckB"))
        for i in range(2):
            self.repo.save(CardDraft(expression=f"語C{i}", reading="ご", deck_name="DeckC"))
        self.repo.save(CardDraft(expression="語D", reading="ご", deck_name="DeckD"))

        stats = self.repo.get_stats()
        self.assertEqual(stats["total"], 11)
        top = stats["top_decks"]
        self.assertEqual(len(top), 3)
        self.assertEqual(top[0]["deck_name"], "DeckA")
        self.assertEqual(top[0]["count"], 5)
        self.assertEqual(top[1]["deck_name"], "DeckB")
        self.assertEqual(top[1]["count"], 3)
        self.assertEqual(top[2]["deck_name"], "DeckC")
        self.assertEqual(top[2]["count"], 2)

    def test_stats_jlpt_distribution(self):
        """Verify JLPT level breakdown across N5..N1 and Unknown cards."""
        self.repo.save(CardDraft(expression="犬", reading="いぬ", jlpt_level="N5"))
        self.repo.save(CardDraft(expression="猫", reading="ねこ", jlpt_level="N4"))
        self.repo.save(CardDraft(expression="映画", reading="えいが", jlpt_level="N3"))
        self.repo.save(CardDraft(expression="政治", reading="せいじ", jlpt_level="N2"))
        self.repo.save(CardDraft(expression="曖昧", reading="あいまい", jlpt_level="N1"))

        # Card with JLPT in dictionary entry tags
        self.repo.save(
            CardDraft(
                expression="試験",
                reading="しけん",
                entries=[{"tags": ["jlpt-n3"]}],
            )
        )

        # Card with JLPT in kanji entries stats
        self.repo.save(
            CardDraft(
                expression="書く",
                reading="かく",
                kanji_entries=[{"stats": {"jlpt": "N4"}}],
            )
        )

        # Card with unknown JLPT (no match)
        self.repo.save(CardDraft(expression="xyz123", reading="xyz", jlpt_level=None))

        stats = self.repo.get_stats()
        breakdown = stats["jlpt_breakdown"]
        self.assertEqual(breakdown["N5"], 1)
        self.assertEqual(breakdown["N4"], 2)  # 猫 + 書く
        self.assertEqual(breakdown["N3"], 2)  # 映画 + 試験
        self.assertEqual(breakdown["N2"], 1)
        self.assertEqual(breakdown["N1"], 1)
        self.assertEqual(breakdown["Unknown"], 1)
        self.assertEqual(sum(breakdown.values()), 8)

    def test_stats_timeframe_history(self):
        """Verify today, this_week, and total counts for older cards."""
        now = datetime.now(timezone.utc)
        today_iso = now.isoformat()
        four_days_ago_iso = (now - timedelta(days=4)).isoformat()
        twenty_days_ago_iso = (now - timedelta(days=20)).isoformat()

        with db_session(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO cards (
                    expression, reading, deck_name, normalized_expression, normalized_reading, normalized_deck_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("今日", "きょう", "Default", "今日", "きょう", "default", today_iso, today_iso),
            )
            conn.execute(
                """
                INSERT INTO cards (
                    expression, reading, deck_name, normalized_expression, normalized_reading, normalized_deck_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("先週", "せんしゅう", "Default", "先週", "せんしゅう", "default", four_days_ago_iso, four_days_ago_iso),
            )
            conn.execute(
                """
                INSERT INTO cards (
                    expression, reading, deck_name, normalized_expression, normalized_reading, normalized_deck_name,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("昔", "むかし", "Default", "昔", "むかし", "default", twenty_days_ago_iso, twenty_days_ago_iso),
            )
            conn.commit()

        stats = self.repo.get_stats()
        self.assertEqual(stats["total"], 3)
        self.assertEqual(stats["today"], 1)
        self.assertEqual(stats["this_week"], 2)

    def test_api_cards_stats_endpoint(self):
        """Verify GET /api/cards/stats endpoint through TestClient."""
        self.repo.save(CardDraft(expression="食べる", reading="たべる", deck_name="DeckA", jlpt_level="N5"))
        self.repo.save(CardDraft(expression="飲む", reading="のむ", deck_name="DeckB", jlpt_level="N4"))

        resp = self.client.get("/api/cards/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertEqual(data["total"], 2)
        self.assertEqual(data["today"], 2)
        self.assertEqual(data["this_week"], 2)
        self.assertIn("timeframe", data)
        self.assertEqual(data["timeframe"]["total"], 2)
        self.assertIn("sync_ratio", data)
        self.assertEqual(data["sync_ratio"]["pending"], 2)
        self.assertIn("jlpt_breakdown", data)
        self.assertEqual(data["jlpt_breakdown"]["N5"], 1)
        self.assertEqual(data["jlpt_breakdown"]["N4"], 1)
        self.assertIn("top_decks", data)
        self.assertEqual(len(data["top_decks"]), 2)
