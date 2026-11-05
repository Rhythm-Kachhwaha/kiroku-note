"""Tests for selection identify without Yomitan."""
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock

from app.services.dictionary_provider import (
    DictionaryTermNotFoundError,
    LocalDictionaryProvider,
    resolve_dictionary_db_path,
)
from app.services.yomitan import (
    IdentifiedTerm,
    YomitanResponseError,
    YomitanService,
)
from kiroku_dictionary.lookup import TermDefinition, TermHeadwordGroup


class DictionaryIdentifyTests(unittest.TestCase):
    def setUp(self):
        self.db_path = resolve_dictionary_db_path()
        self.provider = LocalDictionaryProvider(db_path=self.db_path)

    def test_gohan_resolves_to_single_headword_not_split(self):
        """ご飯 must resolve directly to single headword 'ご飯' and reading 'ごはん'."""
        if not os.path.exists(self.provider._db_path):
            self.skipTest("kiroku_dict.sqlite not found")

        term = self.provider.identify("ご飯")
        self.assertEqual(term.expression, "ご飯")
        self.assertEqual(term.reading, "ごはん")

    def test_sentence_like_selection_identifies_headword(self):
        """Phrase '学校に行きました' must identify '学校' without Yomitan error."""
        if not os.path.exists(self.provider._db_path):
            self.skipTest("kiroku_dict.sqlite not found")

        term = self.provider.identify("学校に行きました")
        self.assertEqual(term.expression, "学校")
        self.assertEqual(term.reading, "がっこう")

    def test_selection_with_punctuation_and_newlines(self):
        """Sentences with Japanese punctuation or newlines identify correctly."""
        if not os.path.exists(self.provider._db_path):
            self.skipTest("kiroku_dict.sqlite not found")

        term1 = self.provider.identify("「学校に行きました」")
        self.assertEqual(term1.expression, "学校")

        term2 = self.provider.identify("私は日本語を勉強しています。\n毎日練習します。")
        self.assertEqual(term2.expression, "私")

    def test_single_kana_word_with_no_entry_falls_back_to_raw_text(self):
        """Single kana word without dictionary entry retains raw text fallback."""
        term = self.provider.identify("ぽぽぽ")
        self.assertEqual(term.expression, "ぽぽぽ")
        self.assertEqual(term.reading, "ぽぽぽ")

    def test_kanji_selection_with_no_hit_raises_typed_dict_term_not_found(self):
        """Unknown kanji term without hit raises DictionaryTermNotFoundError with code DICT_TERM_NOT_FOUND."""
        with self.assertRaises(DictionaryTermNotFoundError) as ctx:
            self.provider.identify("龘龘龘龘")

        exc = ctx.exception
        self.assertEqual(exc.code, "DICT_TERM_NOT_FOUND")

    def test_empty_selection_raises_error(self):
        """Empty or whitespace-only input raises YomitanResponseError."""
        with self.assertRaises(YomitanResponseError):
            self.provider.identify("")
        with self.assertRaises(YomitanResponseError):
            self.provider.identify("   \n\t  ")

    def test_monkeypatched_engine_particle_skip(self):
        """When selection starts with a particle, identify prefers the content token."""
        mock_engine = MagicMock()
        # Word lookup for whole phrase misses
        # Scan on phrase returns particle 'に'
        mock_engine.lookup_terms.side_effect = [
            [],  # word lookup on 'に学校' misses
            [TermHeadwordGroup(term="に", reading="に", source="に", is_deinflected=False, reasons=(), score=100.0)],  # scan returns particle
            [TermHeadwordGroup(term="学校", reading="がっこう", source="学校", is_deinflected=False, reasons=(), score=500.0)],  # token lookup on 学校
        ]

        provider = LocalDictionaryProvider(db_path=self.db_path)
        provider._engine = mock_engine

        term = provider.identify("に学校")
        self.assertEqual(term.expression, "学校")
        self.assertEqual(term.reading, "がっこう")


if __name__ == "__main__":
    unittest.main()
