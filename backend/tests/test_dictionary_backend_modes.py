"""Tests for dictionary backend modes, local-first default, and health reporting."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.config import (
    get_dictionary_backend,
    is_yomitan_secondary_enabled,
    save_stored_app_config,
)
from app.db.connection import init_db
from app.main import app
from app.services.dictionary_provider import (
    DictionaryDatabaseMissingError,
    LocalDictionaryProvider,
    get_dictionary_db_info,
)
from app.services.yomitan import (
    DictionaryEntry,
    EnrichedTerm,
    IdentifiedTerm,
    Sense,
    YomitanService,
    YomitanUnavailableError,
)


class DictionaryBackendModesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.db_path = self.data_dir / "kiroku_test.db"
        init_db(self.db_path)

        self._orig_env = dict(os.environ)
        os.environ["KIROKU_DATA_DIR"] = str(self.data_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        # Clear dictionary backend env vars to test defaults
        os.environ.pop("DICTIONARY_BACKEND", None)
        os.environ.pop("KIROKU_DICTIONARY_BACKEND", None)
        os.environ.pop("KIROKU_YOMITAN_SECONDARY", None)
        os.environ.pop("KIROKU_DICT_SQLITE", None)

        self.client = TestClient(app)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._orig_env)
        self.temp_dir.cleanup()

    def test_default_backend_is_local(self):
        """Default dictionary backend must be 'local' with Yomitan secondary off."""
        self.assertEqual(get_dictionary_backend(), "local")
        self.assertFalse(is_yomitan_secondary_enabled())
        service = YomitanService()
        self.assertEqual(service.backend_name, "local")
        self.assertFalse(service.yomitan_secondary_enabled)

    def test_backend_modes_resolution(self):
        """All supported backend modes resolve correctly, including 'auto' alias."""
        os.environ["DICTIONARY_BACKEND"] = "local+yomitan"
        self.assertEqual(get_dictionary_backend(), "local+yomitan")
        self.assertTrue(is_yomitan_secondary_enabled())
        svc = YomitanService()
        self.assertEqual(svc.backend_name, "local+yomitan")
        self.assertTrue(svc.yomitan_secondary_enabled)

        os.environ["DICTIONARY_BACKEND"] = "auto"
        self.assertEqual(get_dictionary_backend(), "auto")
        self.assertTrue(is_yomitan_secondary_enabled())
        svc_auto = YomitanService()
        self.assertEqual(svc_auto.backend_name, "auto")

        os.environ["DICTIONARY_BACKEND"] = "yomitan"
        self.assertEqual(get_dictionary_backend(), "yomitan")
        svc_yomi = YomitanService()
        self.assertEqual(svc_yomi.backend_name, "yomitan")

    def test_persisted_yomitan_secondary_setting(self):
        """Persisted setting dictionary.yomitan_secondary in app_config is honored."""
        save_stored_app_config(
            {"dictionary": {"yomitan_secondary": True}},
            env=os.environ,
        )
        self.assertTrue(is_yomitan_secondary_enabled())
        svc = YomitanService(backend="local")
        self.assertTrue(svc.yomitan_secondary_enabled)

    def test_missing_db_raises_actionable_error_code(self):
        """Missing local DB raises DictionaryDatabaseMissingError with code DICT_DB_MISSING and actionable guidance."""
        non_existent = str(self.data_dir / "does_not_exist.sqlite")
        provider = LocalDictionaryProvider(db_path=non_existent)
        with self.assertRaises(DictionaryDatabaseMissingError) as ctx:
            provider._get_engine()

        exc = ctx.exception
        self.assertEqual(exc.code, "DICT_DB_MISSING")
        self.assertIn("Run provisioning in Settings > Dictionary", str(exc))

    def test_capture_endpoint_returns_503_with_dict_db_missing_when_db_absent(self):
        """POST /api/capture returns HTTP 503 with code DICT_DB_MISSING when local DB is missing."""
        os.environ["KIROKU_DICT_SQLITE"] = str(self.data_dir / "absent.sqlite")
        from app.api.system import clear_health_cache
        clear_health_cache()

        res = self.client.post("/api/capture", json={"text": "食べる", "auto_save": False})
        self.assertEqual(res.status_code, 503)
        data = res.json()
        detail = data.get("detail", {})
        if isinstance(detail, dict):
            self.assertEqual(detail.get("code"), "DICT_DB_MISSING")
            self.assertIn("Run provisioning in Settings > Dictionary", detail.get("message", ""))
        else:
            self.assertIn("Run provisioning in Settings > Dictionary", str(detail))

    def test_health_reports_dictionary_object_and_legacy_yomitan_key(self):
        """Health endpoint includes dictionary structure with all 7 keys and legacy yomitan flag."""
        from app.api.system import clear_health_cache
        clear_health_cache()

        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertIn("yomitan", body)
        self.assertIn("dictionary", body)
        d = body["dictionary"]
        self.assertIsNotNone(d)
        for key in [
            "backend",
            "db_present",
            "db_path",
            "jitendex",
            "kanjidic",
            "yomitan_secondary",
            "yomitan_reachable",
        ]:
            self.assertIn(key, d)

    def test_yomitan_unreachable_in_local_plus_yomitan_never_raises_to_user(self):
        """In local+yomitan mode, Yomitan connection failure must never fail capture."""
        fake_local_provider = MagicMock()
        fake_local_provider.identify.return_value = IdentifiedTerm("本", "ほん", "本", "本")
        fake_local_provider.fetch_term_payload.return_value = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "本", "reading": "ほん"}],
                    "definitions": [
                        {
                            "dictionary": "Jitendex",
                            "headwordIndices": [0],
                            "entries": ["book"],
                        }
                    ],
                }
            ]
        }
        fake_local_provider.fetch_kanji_payload.return_value = []
        fake_local_provider.check_availability.return_value = True

        service = YomitanService(
            backend="local+yomitan",
            endpoint="http://127.0.0.1:99999",  # unreachable endpoint
            timeout_seconds=0.1,
            yomitan_secondary=True,
        )
        service._local_provider = fake_local_provider

        # Check availability does not fail
        self.assertTrue(service.check_availability())

        # Identify does not fail
        term = service.identify("本")
        self.assertEqual(term.expression, "本")

        # Enrich succeeds and does not raise Yomitan error
        enriched = service.enrich(term)
        self.assertEqual(enriched.expression, "本")
        self.assertTrue(len(enriched.entries) >= 1)
        self.assertIsNone(enriched.dictionary_error)


if __name__ == "__main__":
    unittest.main()
