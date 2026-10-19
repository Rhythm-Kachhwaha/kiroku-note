"""Tests for DictionaryProvider seam and integration with YomitanService."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from app.services.dictionary_provider import (
    DictionaryProvider,
    LocalDictionaryProvider,
    YomitanHttpProvider,
    resolve_dictionary_db_path,
)
from app.services.yomitan import (
    EnrichedTerm,
    IdentifiedTerm,
    YomitanResponseError,
    YomitanService,
    YomitanUnavailableError,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LOCAL_DB_PATH = str(REPO_ROOT / "kiroku_dict.sqlite")


class DictionaryProviderTests(unittest.TestCase):
    def test_default_backend_is_yomitan(self):
        with patch.dict(os.environ, {}, clear=False):
            if "DICTIONARY_BACKEND" in os.environ:
                del os.environ["DICTIONARY_BACKEND"]
            service = YomitanService()
            self.assertEqual(service.backend_name, "yomitan")
            self.assertIsInstance(service._provider, YomitanHttpProvider)

    def test_unknown_backend_raises_value_error(self):
        with self.assertRaises(ValueError) as ctx:
            YomitanService(backend="nonexistent_backend")
        self.assertIn("Unknown DICTIONARY_BACKEND", str(ctx.exception))

    def test_local_backend_missing_db_raises_unavailable(self):
        fake_db = str(REPO_ROOT / "nonexistent_dict_db_file.sqlite")
        provider = LocalDictionaryProvider(db_path=fake_db)
        self.assertFalse(provider.check_availability())
        self.assertEqual(provider.discover_available_dictionaries(), [])
        with self.assertRaises(YomitanUnavailableError) as ctx:
            provider.identify("食べる")
        self.assertIn("Local dictionary database not found", str(ctx.exception))

    def test_local_provider_direct(self):
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")

        provider = LocalDictionaryProvider(db_path=LOCAL_DB_PATH)
        self.assertTrue(provider.check_availability())

        dicts = provider.discover_available_dictionaries()
        self.assertTrue(len(dicts) >= 1)

        # Identify
        term = provider.identify("食べる")
        self.assertEqual(term.expression, "食べる")
        self.assertEqual(term.reading, "たべる")

        # Fetch term payload
        payload = provider.fetch_term_payload("食べる")
        self.assertIn("dictionaryEntries", payload)
        self.assertGreater(len(payload["dictionaryEntries"]), 0)

        # Fetch kanji payload
        kanji_payload = provider.fetch_kanji_payload("食")
        self.assertIsInstance(kanji_payload, list)
        self.assertGreater(len(kanji_payload), 0)

    def test_yomitan_service_with_local_backend(self):
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")

        service = YomitanService(backend="local", local_db_path=LOCAL_DB_PATH)
        self.assertEqual(service.backend_name, "local")
        self.assertTrue(service.check_availability())

        # Identify
        identified = service.identify("食べた")
        self.assertEqual(identified.expression, "食べる")
        self.assertEqual(identified.reading, "たべる")

        # Enrich
        enriched = service.enrich(identified)
        self.assertIsInstance(enriched, EnrichedTerm)
        self.assertEqual(enriched.expression, "食べる")
        self.assertEqual(enriched.reading, "たべる")
        self.assertGreater(len(enriched.entries), 0)

        # Ensure senses and definitions are parsed
        primary = enriched.entries[0]
        self.assertGreater(len(primary.senses), 0)
        self.assertTrue(any(len(s.glosses) > 0 for s in primary.senses))

        # Check verb metadata parsed by existing parser
        self.assertIsNotNone(enriched.verb_metadata)
        self.assertTrue(enriched.verb_metadata.is_verb)
        self.assertEqual(enriched.verb_metadata.verb_type, "ichidan")

        # Check kanji entries
        self.assertGreater(len(enriched.kanji_entries), 0)
        self.assertEqual(enriched.kanji_entries[0].character, "食")

    def test_auto_backend_falls_back_to_local_when_yomitan_offline(self):
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")

        # Port 59999 is guaranteed offline
        offline_endpoint = "http://127.0.0.1:59999"
        service = YomitanService(
            endpoint=offline_endpoint,
            timeout_seconds=0.2,
            backend="auto",
            local_db_path=LOCAL_DB_PATH,
        )
        self.assertEqual(service.backend_name, "auto")
        # In auto mode, check_availability should return True because local db is ready
        self.assertTrue(service.check_availability())

        # Identify should fall back to local
        identified = service.identify("本")
        self.assertEqual(identified.expression, "本")
        self.assertEqual(identified.reading, "ほん")

        # Enrich should fall back to local
        enriched = service.enrich(identified)
        self.assertEqual(enriched.expression, "本")
        self.assertGreater(len(enriched.entries), 0)

    def test_local_backend_sentence_guard(self):
        """Sentence input without Yomitan should guide user to type word/phrase."""
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")

        service = YomitanService(backend="local", local_db_path=LOCAL_DB_PATH)
        with self.assertRaises(YomitanResponseError) as ctx:
            service.identify("私は日本語を勉強しています。")
        self.assertIn("Full-sentence tokenization requires Yomitan", str(ctx.exception))

    def test_resolve_dictionary_db_path_explicit(self):
        custom = Path("C:/custom/path/dict.sqlite")
        resolved = resolve_dictionary_db_path(custom)
        self.assertEqual(resolved, custom)

    def test_resolve_dictionary_db_path_env_var(self):
        with patch.dict(os.environ, {"KIROKU_DICT_SQLITE": "C:/env/dict.sqlite"}):
            resolved = resolve_dictionary_db_path()
            self.assertEqual(resolved, Path("C:/env/dict.sqlite"))

    def test_resolve_dictionary_db_path_finds_default(self):
        resolved = resolve_dictionary_db_path()
        self.assertIsInstance(resolved, Path)
        self.assertTrue(str(resolved).endswith("kiroku_dict.sqlite"))
