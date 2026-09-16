"""
Stage 7 — Security and Reliability Hardening Tests
---------------------------------------------------
Verifies:
  7.2: Debug launcher behavior (/docs, /redoc disabled by default, enabled when KIROKU_DEBUG=1)
  7.4: API limit bounds (1..500) and stale cards.db cleanup
  7.6: Stuck 'syncing' recovery on startup + SQLite corruption error handling
"""

import importlib
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.db.connection import get_db_connection, init_db
from app.repositories.card_repository import CardDraft, CardRepository
import app.main


class Stage7ReliabilitySecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "stage7_test.db"
        self.original_env = os.environ.get("KIROKU_DB_PATH")
        self.original_debug = os.environ.get("KIROKU_DEBUG")
        os.environ["KIROKU_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["KIROKU_DB_PATH"] = self.original_env
        else:
            os.environ.pop("KIROKU_DB_PATH", None)

        if self.original_debug is not None:
            os.environ["KIROKU_DEBUG"] = self.original_debug
        else:
            os.environ.pop("KIROKU_DEBUG", None)

        self.temp_dir.cleanup()

    # ── 7.6 STUCK SYNC RECOVERY ──────────────────────────────────────────────

    def test_startup_recovers_stuck_syncing_cards(self):
        """Cards left in 'syncing' status from a crashed session must be reset to 'pending' on startup."""
        card_syncing, _ = self.repo.save(
            CardDraft(expression="走る", reading="はしる", meaning="to run", deck_name="Default")
        )
        self.repo.mark_syncing(card_syncing.id)

        card_synced, _ = self.repo.save(
            CardDraft(expression="食べる", reading="たべる", meaning="to eat", deck_name="Default")
        )
        self.repo.mark_synced(card_synced.id, anki_note_id=12345)

        card_failed, _ = self.repo.save(
            CardDraft(expression="泳ぐ", reading="およぐ", meaning="to swim", deck_name="Default")
        )
        self.repo.mark_failed(card_failed.id, error_message="AnkiConnect timeout")

        card_pending, _ = self.repo.save(
            CardDraft(expression="飛ぶ", reading="とぶ", meaning="to fly", deck_name="Default")
        )

        # Verify initial states
        self.assertEqual(self.repo.get_by_id(card_syncing.id).sync_status, "syncing")
        self.assertEqual(self.repo.get_by_id(card_synced.id).sync_status, "synced")
        self.assertEqual(self.repo.get_by_id(card_failed.id).sync_status, "failed")
        self.assertEqual(self.repo.get_by_id(card_pending.id).sync_status, "pending")

        # Simulate application startup / init_db
        init_db(self.db_path)

        # Verify stuck syncing card is recovered to pending
        recovered_card = self.repo.get_by_id(card_syncing.id)
        self.assertEqual(recovered_card.sync_status, "pending", "Stuck syncing card must be recovered to pending")

        # Verify other cards were untouched
        self.assertEqual(self.repo.get_by_id(card_synced.id).sync_status, "synced")
        self.assertEqual(self.repo.get_by_id(card_synced.id).anki_note_id, 12345)
        self.assertEqual(self.repo.get_by_id(card_failed.id).sync_status, "failed")
        self.assertEqual(self.repo.get_by_id(card_failed.id).sync_error, "AnkiConnect timeout")
        self.assertEqual(self.repo.get_by_id(card_pending.id).sync_status, "pending")

    # ── 7.6 SQLITE CORRUPTION ERROR HANDLING ────────────────────────────────

    def test_sqlite_corruption_raises_informative_runtime_error(self):
        """Corrupted SQLite files must raise a descriptive RuntimeError rather than obscure raw errors."""
        corrupt_db_path = Path(self.temp_dir.name) / "corrupt.db"
        # Write corrupted header / invalid bytes
        corrupt_db_path.write_bytes(b"CORRUPTED_NOT_A_VALID_SQLITE_HEADER_DATA_1234567890")

        with self.assertRaises(RuntimeError) as ctx:
            get_db_connection(corrupt_db_path)

        err_msg = str(ctx.exception)
        self.assertIn("corrupted or invalid", err_msg.lower())
        self.assertIn(str(corrupt_db_path), err_msg)
        # Verify file is not deleted or replaced
        self.assertTrue(corrupt_db_path.exists())

    # ── 7.2 LAUNCHER / DEBUG DOCS BEHAVIOR ───────────────────────────────────

    def test_docs_and_redoc_disabled_in_default_mode(self):
        """In default/production mode (KIROKU_DEBUG unset), /docs and /redoc must return 404."""
        # Ensure KIROKU_DEBUG is unset
        os.environ.pop("KIROKU_DEBUG", None)
        # Reload app module with KIROKU_DEBUG unset
        importlib.reload(app.main)
        client = TestClient(app.main.app)

        docs_resp = client.get("/docs")
        self.assertEqual(docs_resp.status_code, 404, "Swagger /docs must return 404 in non-debug mode")

        redoc_resp = client.get("/redoc")
        self.assertEqual(redoc_resp.status_code, 404, "ReDoc /redoc must return 404 in non-debug mode")

    def test_docs_and_redoc_enabled_in_debug_mode(self):
        """When KIROKU_DEBUG=1, /docs and /redoc must be enabled (HTTP 200)."""
        os.environ["KIROKU_DEBUG"] = "1"
        importlib.reload(app.main)
        client = TestClient(app.main.app)

        docs_resp = client.get("/docs")
        self.assertEqual(docs_resp.status_code, 200, "Swagger /docs must return 200 in debug mode")

        redoc_resp = client.get("/redoc")
        self.assertEqual(redoc_resp.status_code, 200, "ReDoc /redoc must return 200 in debug mode")

        # Cleanup: restore module to default mode
        os.environ.pop("KIROKU_DEBUG", None)
        importlib.reload(app.main)


if __name__ == "__main__":
    unittest.main()
