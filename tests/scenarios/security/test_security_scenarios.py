"""
Hardening Scenario Suite: security module
------------------------------------------
Validates all 14 security invariants:
  S01: SecretStore encryption at rest
  S02: SecretStore atomic persistence
  S03: SecretStore corrupt file recovery
  S04: SecretStore input validation and deletion
  S05: Host header validation and DNS rebinding defense
  S06: State-changing request origin enforcement
  S07: Extension origin allowlist enforcement
  S08: Preflight CORS reflection prevention
  S09: Study API constant-time bearer authentication
  S10: Study API token sanitization
  S11: Study API authentication rate limiting
  S12: Path traversal defense on media endpoints
  S13: Typed ID validation on bulk endpoints
  S14: Secret leakage prevention in diagnostics
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest

from fastapi.testclient import TestClient

from app.api.study.auth import (
    MAX_FAILED_ATTEMPTS,
    _check_rate_limit,
    _record_failed_attempt,
    _sanitize_token,
    get_study_api_token,
    reset_rate_limits,
    set_study_api_token,
    verify_study_auth,
)
from app.api.study.errors import StudyAPIError
from app.db.connection import init_db
from app.main import app, clear_health_cache
from app.repositories.card_repository import CardDraft, CardRepository
from app.services.media_storage import MediaStorageService
from app.services.operational_diagnostics import (
    get_operational_failure_counts,
    record_operational_failure,
    reset_operational_failure_counts,
)
from app.services.secret_store import (
    InMemorySecretStore,
    SecretStore,
    WindowsDPAPISecretStore,
    get_secret_store,
    reset_secret_store,
)


class SecurityHardeningScenarioTests(unittest.TestCase):
    def setUp(self):
        clear_health_cache()
        reset_operational_failure_counts()
        reset_rate_limits()
        reset_secret_store()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "sec_test.db"
        self.secrets_path = self.temp_path / ".secrets.enc"

        self.orig_anki_db = os.environ.get("ANKIMINER_DB_PATH")
        self.orig_kiroku_db = os.environ.get("KIROKU_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        os.environ["KIROKU_DB_PATH"] = str(self.db_path)

        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)
        self.client = TestClient(app)

    def tearDown(self):
        clear_health_cache()
        reset_operational_failure_counts()
        reset_rate_limits()
        reset_secret_store()
        if self.orig_anki_db is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.orig_anki_db
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        if self.orig_kiroku_db is not None:
            os.environ["KIROKU_DB_PATH"] = self.orig_kiroku_db
        else:
            os.environ.pop("KIROKU_DB_PATH", None)
        self.temp_dir.cleanup()

    # ── S01: SecretStore encryption at rest ─────────────────────────────────
    def test_s01_secret_store_encryption_at_rest(self):
        """SecretStore encrypts sensitive values so raw plaintext never appears in file."""
        store = WindowsDPAPISecretStore(secrets_path=self.secrets_path)
        raw_key = "sk-super-secret-production-key-12345"
        store.set_secret("llm_api_key", raw_key)

        self.assertTrue(self.secrets_path.is_file())
        raw_file_bytes = self.secrets_path.read_bytes()

        # The raw secret string must NEVER be present as plaintext in the file
        self.assertNotIn(raw_key.encode("utf-8"), raw_file_bytes)
        # Decrypted retrieval matches original secret
        self.assertEqual(store.get_secret("llm_api_key"), raw_key)

    # ── S02: SecretStore atomic persistence ─────────────────────────────────
    def test_s02_secret_store_atomic_persistence(self):
        """SecretStore uses atomic replacement preventing leftover temp files."""
        store = WindowsDPAPISecretStore(secrets_path=self.secrets_path)
        store.set_secret("key1", "val1")
        store.set_secret("key2", "val2")

        # Verify no .tmp files left in secrets directory
        tmp_files = list(self.secrets_path.parent.glob("*.tmp"))
        self.assertEqual(tmp_files, [])
        self.assertEqual(store.get_secret("key1"), "val1")
        self.assertEqual(store.get_secret("key2"), "val2")

    # ── S03: SecretStore corrupt file recovery ───────────────────────────────
    def test_s03_secret_store_corrupt_file_recovery(self):
        """Corrupted ciphertext in secrets file is handled gracefully without crashing."""
        self.secrets_path.write_bytes(b"CORRUPTED_CIPHERTEXT_NOT_DPAPI")
        store = WindowsDPAPISecretStore(secrets_path=self.secrets_path)

        # Must not raise an unhandled exception; returns empty / None
        self.assertIsNone(store.get_secret("any_key"))
        self.assertFalse(store.has_secret("any_key"))

        # Writing new secret replaces corrupted file safely
        store.set_secret("fresh_key", "fresh_val")
        self.assertEqual(store.get_secret("fresh_key"), "fresh_val")

    # ── S04: SecretStore input validation and deletion ──────────────────────
    def test_s04_secret_store_input_validation_and_deletion(self):
        """Non-string/empty key or secret raises ValueError; delete returns boolean."""
        store = WindowsDPAPISecretStore(secrets_path=self.secrets_path)
        with self.assertRaises(ValueError):
            store.set_secret("", "secret")
        with self.assertRaises(ValueError):
            store.set_secret("key", "")
        with self.assertRaises(ValueError):
            store.set_secret(123, "secret")  # type: ignore

        store.set_secret("valid_key", "valid_secret")
        self.assertTrue(store.has_secret("valid_key"))
        self.assertTrue(store.delete_secret("valid_key"))
        self.assertFalse(store.has_secret("valid_key"))
        self.assertFalse(store.delete_secret("nonexistent_key"))

    # ── S05: Host header validation and DNS rebinding defense ────────────────
    def test_s05_host_header_validation_and_dns_rebinding_defense(self):
        """Host headers from unauthorized external origins are rejected with 403."""
        # Untrusted host returns 403 Forbidden
        evil_resp = self.client.get("/api/health", headers={"Host": "evil.com"})
        self.assertEqual(evil_resp.status_code, 403)
        self.assertIn("Invalid Host header", evil_resp.text)

        # Loopback / localhost succeeds
        ok_resp = self.client.get("/api/health", headers={"Host": "localhost:21828"})
        self.assertEqual(ok_resp.status_code, 200)

    # ── S06: State-changing request origin enforcement ───────────────────────
    def test_s06_state_changing_origin_enforcement(self):
        """Origin null and untrusted external origins receive 403 on state changes."""
        null_resp = self.client.post("/api/cards/sync-all", headers={"Origin": "null"})
        self.assertEqual(null_resp.status_code, 403)

        evil_resp = self.client.post("/api/cards/sync-all", headers={"Origin": "https://evil.com"})
        self.assertEqual(evil_resp.status_code, 403)

        # Requests without Origin header (local CLI / desktop process) pass origin check
        no_origin_resp = self.client.post("/api/cards/sync-all")
        self.assertIn(no_origin_resp.status_code, (200, 502, 503))

    # ── S07: Extension origin allowlist enforcement ──────────────────────────
    def test_s07_extension_origin_allowlist_enforcement(self):
        """Only allowlisted extension IDs are accepted; rogue extension IDs receive 403."""
        # Official extension ID
        good_origin = "chrome-extension://chnnchfpjephcpgamfkjnfobfnjabika"
        good_resp = self.client.post("/api/cards/sync-all", headers={"Origin": good_origin})
        self.assertIn(good_resp.status_code, (200, 502, 503))

        # Rogue unauthorized extension ID
        bad_origin = "chrome-extension://maliciousrogueextensionid12345678"
        bad_resp = self.client.post("/api/cards/sync-all", headers={"Origin": bad_origin})
        self.assertEqual(bad_resp.status_code, 403)

    # ── S08: Preflight CORS reflection prevention ────────────────────────────
    def test_s08_preflight_cors_reflection_prevention(self):
        """OPTIONS preflight for untrusted origin does not reflect origin or *."""
        resp = self.client.options(
            "/api/cards/sync-all",
            headers={
                "Origin": "https://malicious-site.example",
                "Access-Control-Request-Method": "POST",
            },
        )
        allowed = resp.headers.get("access-control-allow-origin")
        self.assertNotEqual(allowed, "https://malicious-site.example")
        self.assertNotEqual(allowed, "*")

    # ── S09: Study API constant-time bearer authentication ───────────────────
    def test_s09_study_api_bearer_authentication(self):
        """Study API requires valid bearer token; rejects missing or invalid token with 401."""
        token = "test-study-secret-token-abcdef12345"
        set_study_api_token(token)

        # Valid token succeeds
        valid_resp = self.client.get(
            "/api/study/v1/diagnostics",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(valid_resp.status_code, 200)

        # Missing token returns 401
        missing_resp = self.client.get("/api/study/v1/diagnostics")
        self.assertEqual(missing_resp.status_code, 401)
        self.assertEqual(missing_resp.json()["error"]["code"], "UNAUTHORIZED")

        # Invalid token returns 401
        invalid_resp = self.client.get(
            "/api/study/v1/diagnostics",
            headers={"Authorization": "Bearer forged-token"},
        )
        self.assertEqual(invalid_resp.status_code, 401)
        self.assertEqual(invalid_resp.json()["error"]["code"], "UNAUTHORIZED")

    # ── S10: Study API token sanitization ────────────────────────────────────
    def test_s10_study_api_token_sanitization(self):
        """Tokens containing whitespace, newlines, or tabs are rejected."""
        self.assertIsNone(_sanitize_token("token\nwith\nnewline"))
        self.assertIsNone(_sanitize_token("token with space"))
        self.assertIsNone(_sanitize_token("token\twith\ttab"))
        self.assertIsNone(_sanitize_token("   "))
        self.assertEqual(_sanitize_token("  valid-token-123  "), "valid-token-123")

    # ── S11: Study API authentication rate limiting ──────────────────────────
    def test_s11_study_api_authentication_rate_limiting(self):
        """Exceeding MAX_FAILED_ATTEMPTS locks out client IP for the window."""
        client_ip = "192.168.1.100"
        reset_rate_limits()

        # First attempts are allowed
        for _ in range(MAX_FAILED_ATTEMPTS - 1):
            _record_failed_attempt(client_ip)
        self.assertTrue(_check_rate_limit(client_ip))

        # Exceeding threshold blocks client
        _record_failed_attempt(client_ip)
        self.assertFalse(_check_rate_limit(client_ip))

    # ── S12: Path traversal defense on media endpoints ───────────────────────
    def test_s12_path_traversal_defense_on_media_endpoints(self):
        """Media requests containing ../ or path traversal return 404."""
        resp = self.client.get("/api/media/../../windows/win.ini")
        self.assertEqual(resp.status_code, 404)

        resp2 = self.client.get("/api/media/..%2f..%2fetc%2fpasswd")
        self.assertEqual(resp2.status_code, 404)

        storage = MediaStorageService()
        self.assertIsNone(storage.get_media_path("../../secret.txt"))
        self.assertIsNone(storage.get_media_path("..\\secret.txt"))

    # ── S13: Typed ID validation on bulk endpoints ───────────────────────────
    def test_s13_typed_id_validation_on_bulk_endpoints(self):
        """Bulk endpoints enforce typed integer IDs, rejecting string injection payloads with 422."""
        resp = self.client.request(
            "DELETE",
            "/api/cards/bulk",
            json={"card_ids": ["1 OR 1=1; DROP TABLE cards;--"]},
        )
        self.assertEqual(resp.status_code, 422)

        resp2 = self.client.request(
            "DELETE",
            "/api/cards/bulk",
            json={"card_ids": ["not_a_number"]},
        )
        self.assertEqual(resp2.status_code, 422)

        # Valid integer array works
        c, _ = self.repo.save(CardDraft(expression="本", reading="ほん"))
        resp3 = self.client.request(
            "DELETE",
            "/api/cards/bulk",
            json={"card_ids": [c.id]},
        )
        self.assertEqual(resp3.status_code, 200)
        self.assertEqual(resp3.json()["deleted_count"], 1)

    # ── S14: Secret leakage prevention in diagnostics ────────────────────────
    def test_s14_secret_leakage_prevention_in_diagnostics(self):
        """SecretStore string representations and health checks never leak raw secrets."""
        store = WindowsDPAPISecretStore(secrets_path=self.secrets_path)
        raw_secret = "super-secret-token-xyz-987"
        store.set_secret("test_key", raw_secret)

        # String representation of store must not leak secrets
        store_repr = repr(store)
        self.assertNotIn(raw_secret, store_repr)

        # Health endpoint must not contain secret values
        health_resp = self.client.get("/api/health")
        self.assertEqual(health_resp.status_code, 200)
        self.assertNotIn(raw_secret, health_resp.text)


if __name__ == "__main__":
    unittest.main()
