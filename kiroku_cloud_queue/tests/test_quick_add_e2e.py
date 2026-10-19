"""
test_quick_add_e2e.py -- End-to-end integration test for Cloud Quick Add.
Verifies:
  1. POST /api/dictionary/lookup enriches a search term using local dictionary
  2. POST /submit enqueues the enriched card payload into the persistent queue
  3. GET /recent and GET /pending contain the newly enqueued card with all enriched fields
"""
import os
import sys
from pathlib import Path
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient
import server
from queue_store import SqliteQueueStore
import tempfile


class QuickAddEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "test_queue.db"
        self.submit_token = "e2e-submit-token-777"
        self.worker_token = "e2e-worker-token-888"

        os.environ["SUBMIT_TOKEN"] = self.submit_token
        os.environ["WORKER_TOKEN"] = self.worker_token
        os.environ["KIROKU_DICT_SQLITE"] = str(REPO_ROOT / "kiroku_dict.sqlite")

        server.store = SqliteQueueStore(db_path=self.db_path)
        self.client = TestClient(server.app, raise_server_exceptions=True)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_quick_add_flow_end_to_end(self):
        if not os.path.exists(os.environ["KIROKU_DICT_SQLITE"]):
            self.skipTest("kiroku_dict.sqlite not found")

        # Step 1: User types romaji converted to kana: "たべる" -> POST /api/dictionary/lookup
        lookup_resp = self.client.post(
            "/api/dictionary/lookup",
            json={"text": "たべる", "max_results": 5},
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = lookup_resp.json()
        self.assertEqual(lookup_data["status"], "ok")
        self.assertIn("match", lookup_data)

        match = lookup_data["match"]
        self.assertEqual(match["expression"], "食べる")
        self.assertEqual(match["reading"], "たべる")
        self.assertGreater(len(match["meanings"]), 0)

        # Step 2: User confirms draft and clicks "Add to Cloud Queue" -> POST /submit
        card_payload = {
            "expression": match["expression"],
            "reading": match["reading"],
            "meaning": "; ".join(match["meanings"][:2]),
            "sentence": "毎日野菜を食べる。",
            "sentence_meaning": "I eat vegetables every day.",
            "deck_name": "N3 vocabs",
            "tags": ["kiroku-note", "quick-add"],
            "source_title": "Cloud Quick Add",
            "jlpt_level": match.get("jlpt_level") or "N5",
        }

        submit_resp = self.client.post(
            "/submit",
            json=card_payload,
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(submit_resp.status_code, 200)
        submit_data = submit_resp.json()
        self.assertEqual(submit_data["status"], "queued")
        self.assertIn("id", submit_data)

        # Step 3: Verify the card is visible in GET /recent (Dashboard Queue tab)
        recent_resp = self.client.get(
            "/recent",
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(recent_resp.status_code, 200)
        recent_data = recent_resp.json()
        self.assertEqual(recent_data["status"], "ok")
        recent_cards = recent_data["items"]
        self.assertEqual(len(recent_cards), 1)
        self.assertEqual(recent_cards[0]["expression"], "食べる")
        self.assertEqual(recent_cards[0]["reading"], "たべる")
        self.assertEqual(recent_cards[0]["deck_name"], "N3 vocabs")

        # Step 4: Verify the local worker can claim it via GET /pending
        pending_resp = self.client.get(
            "/pending",
            headers={"Authorization": f"Bearer {self.worker_token}"},
        )
        self.assertEqual(pending_resp.status_code, 200)
        pending_data = pending_resp.json()
        self.assertEqual(pending_data["status"], "ok")
        pending_jobs = pending_data["items"]
        self.assertEqual(len(pending_jobs), 1)
        self.assertEqual(pending_jobs[0]["card"]["expression"], "食べる")
        self.assertEqual(pending_jobs[0]["card"]["reading"], "たべる")
        self.assertEqual(pending_jobs[0]["card"]["deck_name"], "N3 vocabs")
