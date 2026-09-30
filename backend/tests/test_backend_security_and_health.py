"""
Session 2 — Backend Core Fixes & Security Hardening Tests
---------------------------------------------------------
Verifies:
  1. Origin null is blocked from CORS / state-changing requests.
  2. Untrusted origins (https://evil.com) receive 403 on state-changing methods.
  3. Trusted origins (chrome-extension://*, http://localhost:*, http://127.0.0.1:*) succeed.
  4. Requests with no Origin header (curl, local scripts) succeed.
  5. Host header validation prevents DNS rebinding (evil.com returns 403).
  6. /api/health returns cached response within TTL without re-querying services.
  7. /api/cards/export query parameter ?status=synced correctly filters without shadowing fastapi.status.
  8. Bulk endpoints enforce typed integer IDs (list[int]).
"""

import time
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app, clear_health_cache
from app.repositories.card_repository import CardDraft, CardRepository
import tempfile
from pathlib import Path
import os


class BackendSecurityAndHealthTests(unittest.TestCase):
    def setUp(self):
        clear_health_cache()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_sec_health.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        clear_health_cache()
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    # ── 1. ORIGIN NULL & CORS SECURITY ───────────────────────────────────────

    def test_options_origin_null_not_allowed(self):
        """Preflight OPTIONS with Origin: null must not return Access-Control-Allow-Origin: null."""
        resp = self.client.options(
            "/api/cards/sync-all",
            headers={
                "Origin": "null",
                "Access-Control-Request-Method": "POST",
            },
        )
        allowed_origin = resp.headers.get("access-control-allow-origin")
        self.assertNotEqual(allowed_origin, "null")

    def test_state_changing_origin_null_forbidden(self):
        """State-changing POST with Origin: null must return 403 Forbidden."""
        resp = self.client.post(
            "/api/cards/sync-all",
            headers={"Origin": "null"},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Forbidden", resp.json().get("detail", ""))

    def test_state_changing_untrusted_origin_forbidden(self):
        """State-changing POST with Origin: https://evil.com must return 403 Forbidden."""
        resp = self.client.post(
            "/api/cards/sync-all",
            headers={"Origin": "https://evil.com"},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Forbidden", resp.json().get("detail", ""))

    def test_state_changing_allowed_chrome_extension_origin(self):
        """State-changing POST with chrome-extension:// origin must be allowed."""
        resp = self.client.post(
            "/api/cards/sync-all",
            headers={"Origin": "chrome-extension://abcdefghijklmnop"},
        )
        self.assertNotEqual(resp.status_code, 403)

    def test_state_changing_allowed_local_origin(self):
        """State-changing POST with local origin must be allowed."""
        resp = self.client.post(
            "/api/cards/sync-all",
            headers={"Origin": "http://127.0.0.1:21828"},
        )
        self.assertNotEqual(resp.status_code, 403)

    def test_state_changing_no_origin_header_allowed(self):
        """Requests without Origin header (CLI / curl / internal) must be allowed."""
        resp = self.client.post("/api/cards/sync-all")
        self.assertNotEqual(resp.status_code, 403)

    # ── 2. HOST HEADER VALIDATION (DNS REBINDING) ───────────────────────────

    def test_invalid_host_header_forbidden(self):
        """Requests with hostile Host header must return 403 Forbidden."""
        resp = self.client.get(
            "/api/health",
            headers={"Host": "attacker.com"},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Invalid Host", resp.json().get("detail", ""))

    def test_valid_host_headers_allowed(self):
        """Requests with localhost or 127.0.0.1 Host headers must be allowed."""
        for valid_host in ["localhost", "localhost:21828", "127.0.0.1:21828", "127.0.0.1"]:
            clear_health_cache()
            resp = self.client.get(
                "/api/health",
                headers={"Host": valid_host},
            )
            self.assertEqual(resp.status_code, 200, f"Host {valid_host} should be allowed")

    # ── 3. HEALTH CHECK CACHE ────────────────────────────────────────────────

    @patch("app.main.YomitanService")
    def test_health_check_in_process_cache(self, mock_yomitan_cls):
        mock_yomitan_inst = MagicMock()
        mock_yomitan_inst.check_availability.return_value = True
        mock_yomitan_cls.return_value = mock_yomitan_inst

        clear_health_cache()

        # First call hits YomitanService
        resp1 = self.client.get("/api/health")
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(mock_yomitan_cls.call_count, 1)

        # Immediate second call should be cached (call_count remains 1)
        resp2 = self.client.get("/api/health")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(mock_yomitan_cls.call_count, 1)
        self.assertEqual(resp1.json(), resp2.json())

    # ── 4. CSV EXPORT STATUS ALIAS ───────────────────────────────────────────

    def test_csv_export_status_filter_alias(self):
        """Verifies ?status=synced alias works without colliding with fastapi.status."""
        c1, _ = self.repo.save(CardDraft(expression="本", reading="ほん", meaning="book"))
        c2, _ = self.repo.save(CardDraft(expression="水", reading="みず", meaning="water"))
        self.repo.mark_synced(c1.id, anki_note_id=999)

        resp = self.client.get("/api/cards/export?status=synced")
        self.assertEqual(resp.status_code, 200)
        content = resp.text
        self.assertIn("本", content)
        self.assertNotIn("水", content)

    # ── 5. BULK ENDPOINT TYPED INTEGER IDS ───────────────────────────────────

    def test_bulk_delete_rejects_invalid_string_ids(self):
        """Bulk delete payload with non-integer string IDs should be rejected with 422."""
        resp = self.client.request(
            "DELETE",
            "/api/cards/bulk",
            json={"card_ids": ["invalid_id_abc"]},
        )
        self.assertEqual(resp.status_code, 422)

    def test_bulk_delete_accepts_valid_integers(self):
        """Bulk delete payload with valid integers succeeds."""
        c1, _ = self.repo.save(CardDraft(expression="猫", reading="ねこ"))
        resp = self.client.request(
            "DELETE",
            "/api/cards/bulk",
            json={"card_ids": [c1.id]},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["deleted_count"], 1)


if __name__ == "__main__":
    unittest.main()
