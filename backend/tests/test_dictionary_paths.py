"""Tests for unified dictionary DB path resolver and singleton service factory."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.dictionary_provider import resolve_dictionary_db_path
from app.services.kanji_service import resolve_kanji_dict_path
from app.services.yomitan import (
    IdentifiedTerm,
    YomitanService,
    get_dictionary_service,
    reset_dictionary_service,
)
from kiroku_dictionary.paths import resolve_db_path


class DictionaryPathsAndFactoryTests(unittest.TestCase):
    def setUp(self):
        reset_dictionary_service()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.db_path = self.data_dir / "kiroku_test.db"
        init_db(self.db_path)

        self._orig_env = dict(os.environ)
        os.environ["KIROKU_DATA_DIR"] = str(self.data_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        os.environ.pop("KIROKU_DICT_SQLITE", None)

        self.client = TestClient(app)

    def tearDown(self):
        reset_dictionary_service()
        os.environ.clear()
        os.environ.update(self._orig_env)
        self.temp_dir.cleanup()

    def test_both_callers_resolve_identical_db_path(self):
        """resolve_dictionary_db_path and resolve_kanji_dict_path must return identical paths."""
        path1 = resolve_dictionary_db_path()
        path2 = resolve_kanji_dict_path()
        self.assertEqual(path1, path2)

        # Also when custom env var is set
        custom_target = str(self.data_dir / "custom_dict.sqlite")
        os.environ["KIROKU_DICT_SQLITE"] = custom_target
        self.assertEqual(resolve_dictionary_db_path(), Path(custom_target))
        self.assertEqual(resolve_kanji_dict_path(), Path(custom_target))
        self.assertEqual(resolve_db_path(), Path(custom_target))

    def test_resolver_priority_order(self):
        """Resolver priority: explicit argument > env var > candidate files."""
        arg_path = self.data_dir / "explicit.sqlite"
        env_path = self.data_dir / "env.sqlite"
        os.environ["KIROKU_DICT_SQLITE"] = str(env_path)

        # Explicit argument overrides env
        self.assertEqual(resolve_db_path(arg_path), arg_path)
        # Without argument, env path wins
        self.assertEqual(resolve_db_path(), env_path)

    def test_factory_returns_same_instance(self):
        """get_dictionary_service returns the cached singleton across repeated calls."""
        svc1 = get_dictionary_service()
        svc2 = get_dictionary_service()
        self.assertIs(svc1, svc2)

    def test_reset_dictionary_service_creates_fresh_instance(self):
        """reset_dictionary_service invalidates cache so next call gets a new instance."""
        svc1 = get_dictionary_service()
        reset_dictionary_service()
        svc2 = get_dictionary_service()
        self.assertIsNot(svc1, svc2)

    def test_capture_endpoint_reuses_service_without_per_request_construction(self):
        """Consecutive /api/capture calls must reuse get_dictionary_service without re-instantiation."""
        # Provision fake service into singleton
        fake_svc = MagicMock(spec=YomitanService)
        fake_svc.backend_name = "local"
        fake_svc.yomitan_secondary_enabled = False
        fake_svc.identify.return_value = IdentifiedTerm("本", "ほん", "本", "本")
        from app.services.yomitan import DictionaryEntry, EnrichedTerm, Sense
        fake_svc.enrich.return_value = EnrichedTerm(
            expression="本",
            reading="ほん",
            source_text="本",
            deinflected_text="本",
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    term="本",
                    reading="ほん",
                    parts_of_speech=["noun"],
                    tags=[],
                    senses=[Sense(glosses=["book"])],
                )
            ],
        )

        with patch("app.services.yomitan.YomitanService", side_effect=AssertionError("YomitanService should not be constructed per request")):
            with patch("app.services.yomitan._dictionary_service_instance", fake_svc):
                res1 = self.client.post("/api/capture", json={"text": "本", "auto_save": False})
                res2 = self.client.post("/api/capture", json={"text": "本", "auto_save": False})
                self.assertEqual(res1.status_code, 200)
                self.assertEqual(res2.status_code, 200)


if __name__ == "__main__":
    unittest.main()
