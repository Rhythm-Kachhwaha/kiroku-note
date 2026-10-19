"""
test_server_dictionary.py -- Unit and integration tests for POST /api/dictionary/lookup.
"""
import os
import sys
from pathlib import Path
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ["SUBMIT_TOKEN"] = "test-submit-token-123"
os.environ["WORKER_TOKEN"] = "test-worker-token-456"
os.environ["KIROKU_DICT_SQLITE"] = str(REPO_ROOT / "kiroku_dict.sqlite")

from fastapi.testclient import TestClient
import server


class ServerDictionaryLookupTests(unittest.TestCase):
    def setUp(self):
        self.submit_token = "test-submit-token-123"
        self.worker_token = "test-worker-token-456"
        os.environ["SUBMIT_TOKEN"] = self.submit_token
        os.environ["WORKER_TOKEN"] = self.worker_token
        os.environ["KIROKU_DICT_SQLITE"] = str(REPO_ROOT / "kiroku_dict.sqlite")
        self.client = TestClient(server.app, raise_server_exceptions=False)

    def test_lookup_unauthenticated_returns_401(self):
        resp = self.client.post("/api/dictionary/lookup", json={"text": "食べる"})
        self.assertEqual(resp.status_code, 401)

    def test_lookup_empty_text_returns_400(self):
        resp = self.client.post(
            "/api/dictionary/lookup",
            json={"text": "   "},
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_lookup_success_with_submit_token(self):
        if not os.path.exists(os.environ["KIROKU_DICT_SQLITE"]):
            self.skipTest("kiroku_dict.sqlite not found")

        resp = self.client.post(
            "/api/dictionary/lookup",
            json={"text": "食べる"},
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("match", data)
        match = data["match"]
        self.assertEqual(match["expression"], "食べる")
        self.assertEqual(match["reading"], "たべる")
        self.assertGreater(len(match["senses"]), 0)
        self.assertGreater(len(match["kanji_entries"]), 0)
        self.assertEqual(match["kanji_entries"][0]["character"], "食")

    def test_lookup_success_with_worker_token(self):
        if not os.path.exists(os.environ["KIROKU_DICT_SQLITE"]):
            self.skipTest("kiroku_dict.sqlite not found")

        resp = self.client.post(
            "/api/dictionary/lookup",
            json={"text": "「食べた」"},
            headers={"Authorization": f"Bearer {self.worker_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["match"]["expression"], "食べる")

    def test_lookup_contractions(self):
        if not os.path.exists(os.environ["KIROKU_DICT_SQLITE"]):
            self.skipTest("kiroku_dict.sqlite not found")

        resp = self.client.post(
            "/api/dictionary/lookup",
            json={"text": "食べちゃった"},
            headers={"Authorization": f"Bearer {self.submit_token}"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["match"]["expression"], "食べる")
