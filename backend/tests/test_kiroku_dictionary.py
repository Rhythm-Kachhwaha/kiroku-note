"""
test_kiroku_dictionary.py -- Tests for kiroku_dictionary standalone importer, schema, and regression guards.
"""
import ast
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import zipfile

# Ensure root repository is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kiroku_dictionary.importer import build_database, import_dictionary_zip
from kiroku_dictionary.schema import (
    compress_content,
    decompress_content,
    katakana_to_hiragana,
    normalize_text,
)


def _create_synthetic_jitendex_zip(path: str) -> None:
    """Create a minimal valid Jitendex Yomitan zip archive."""
    with zipfile.ZipFile(path, "w") as zf:
        index_json = {
            "title": "Synthetic Jitendex",
            "revision": "synthetic.2026.1",
            "format": 3,
            "version": 3,
            "description": "Synthetic test dictionary",
            "author": "Test Author",
        }
        zf.writestr("index.json", json.dumps(index_json))

        tag_bank = [
            ["v1", "partOfSpeech", -1, "Ichidan verb", 0],
            ["n", "partOfSpeech", -1, "Noun", 0],
        ]
        zf.writestr("tag_bank_1.json", json.dumps(tag_bank))

        term_bank = [
            [
                "食べる",
                "たべる",
                "v1",
                "v1",
                100,
                [
                    {
                        "type": "structured-content",
                        "content": [
                            {
                                "tag": "span",
                                "data": {"content": "glossary"},
                                "content": "to eat",
                            }
                        ],
                    }
                ],
                1001,
                "common",
            ],
            [
                "猫",
                "ねこ",
                "n",
                "",
                80,
                ["cat", "feline"],
                1002,
                "common",
            ],
            [
                "走る",
                "はしる",
                "v5r",
                "v5r",
                90,
                ["to run"],
                1003,
                "common",
            ],
        ]
        zf.writestr("term_bank_1.json", json.dumps(term_bank))


def _create_synthetic_kanjidic_zip(path: str) -> None:
    """Create a minimal valid KANJIDIC Yomitan zip archive."""
    with zipfile.ZipFile(path, "w") as zf:
        index_json = {
            "title": "Synthetic KANJIDIC",
            "revision": "synthetic.kanjidic.1",
            "format": 3,
        }
        zf.writestr("index.json", json.dumps(index_json))

        tag_bank = [
            ["jouyou", "misc", 0, "regular-use kanji", 0],
        ]
        zf.writestr("tag_bank_1.json", json.dumps(tag_bank))

        kanji_bank = [
            [
                "食",
                "ショク ジキ",
                "た.べる く.らう",
                "jouyou",
                ["eat", "food"],
                {"grade": 2, "strokes": 9, "jlpt": 4},
            ],
            [
                "猫",
                "ビョウ",
                "ねこ",
                "jinmeiyou",
                ["cat"],
                {"grade": 8, "strokes": 11},
            ],
        ]
        zf.writestr("kanji_bank_1.json", json.dumps(kanji_bank))


class KirokuDictionaryImporterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)
        self.jitendex_zip = str(self.dir_path / "jitendex_test.zip")
        self.kanjidic_zip = str(self.dir_path / "kanjidic_test.zip")
        self.output_db = str(self.dir_path / "test_kiroku_dict.sqlite")

        _create_synthetic_jitendex_zip(self.jitendex_zip)
        _create_synthetic_kanjidic_zip(self.kanjidic_zip)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_text_normalization(self):
        """Test Unicode NFKC and Katakana -> Hiragana folding."""
        self.assertEqual(katakana_to_hiragana("タベル"), "たべる")
        self.assertEqual(katakana_to_hiragana("ラーメン"), "らーめん")
        self.assertEqual(normalize_text(" 食べる "), "食べる")
        self.assertEqual(normalize_text(" タベル "), "たべる")
        self.assertEqual(normalize_text("ﾊﾟｿｺﾝ"), "ぱそこん")  # half-width katakana
        self.assertEqual(normalize_text("ＡＢＣ"), "abc")      # full-width ascii

    def test_compression_roundtrip(self):
        """Test zlib compression and lossless decompression of complex structured data."""
        payload = [
            {"type": "structured-content", "content": [{"tag": "span", "content": "example"}]},
            "string meaning",
            {"nested": [1, 2, 3]},
        ]
        blob = compress_content(payload)
        self.assertIsInstance(blob, bytes)
        decompressed = decompress_content(blob)
        self.assertEqual(decompressed, payload)

    def test_build_database_and_schema(self):
        """Test end-to-end synthetic dictionary build into SQLite."""
        result = build_database(
            jitendex_path=self.jitendex_zip,
            kanjidic_path=self.kanjidic_zip,
            output_db_path=self.output_db,
        )

        self.assertTrue(os.path.exists(self.output_db))
        self.assertEqual(result["jitendex"]["terms"], 3)
        self.assertEqual(result["kanjidic"]["kanji"], 2)

        # Inspect SQLite contents
        conn = sqlite3.connect(self.output_db)
        try:
            # Meta table checks
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM meta")
            meta_dict = dict(cur.fetchall())
            self.assertEqual(meta_dict.get("jitendex_title"), "Synthetic Jitendex")
            self.assertEqual(meta_dict.get("jitendex_revision"), "synthetic.2026.1")
            self.assertEqual(meta_dict.get("kanjidic_title"), "Synthetic KANJIDIC")
            self.assertEqual(meta_dict.get("kanjidic_revision"), "synthetic.kanjidic.1")

            # Terms table checks
            cur.execute("SELECT term, reading, norm_term, norm_reading, rules, score, content_blob FROM terms WHERE term = '食べる'")
            row = cur.fetchone()
            self.assertIsNotNone(row)
            term, reading, norm_term, norm_reading, rules, score, blob = row
            self.assertEqual(term, "食べる")
            self.assertEqual(reading, "たべる")
            self.assertEqual(norm_term, "食べる")
            self.assertEqual(norm_reading, "たべる")
            self.assertEqual(rules, "v1")
            self.assertEqual(score, 100.0)

            # Decompress structured content
            glossary = decompress_content(blob)
            self.assertEqual(glossary[0]["type"], "structured-content")
            self.assertEqual(glossary[0]["content"][0]["content"], "to eat")

            # Kanji table checks
            cur.execute("SELECT character, onyomi, kunyomi, stats_json, meanings_json FROM kanji WHERE character = '食'")
            k_row = cur.fetchone()
            self.assertIsNotNone(k_row)
            char, onyomi, kunyomi, stats_json, meanings_json = k_row
            self.assertEqual(char, "食")
            self.assertEqual(onyomi, "ショク ジキ")
            self.assertEqual(kunyomi, "た.べる く.らう")
            stats = json.loads(stats_json)
            self.assertEqual(stats.get("grade"), 2)
            meanings = json.loads(meanings_json)
            self.assertEqual(meanings, ["eat", "food"])

            # Verify indexes exist
            cur.execute("SELECT name FROM sqlite_master WHERE type='index'")
            indexes = {r[0] for r in cur.fetchall()}
            self.assertIn("idx_terms_term", indexes)
            self.assertIn("idx_terms_reading", indexes)
            self.assertIn("idx_terms_norm_reading", indexes)
        finally:
            conn.close()

    def test_idempotent_rebuild(self):
        """Building twice to the same output path should cleanly overwrite and succeed."""
        res1 = build_database(self.jitendex_zip, self.kanjidic_zip, self.output_db)
        res2 = build_database(self.jitendex_zip, self.kanjidic_zip, self.output_db)
        self.assertEqual(res1["jitendex"]["terms"], res2["jitendex"]["terms"])
        self.assertEqual(res1["kanjidic"]["kanji"], res2["kanjidic"]["kanji"])
        self.assertTrue(os.path.exists(self.output_db))


class KirokuDictionaryRegressionGuardTests(unittest.TestCase):
    """
    Hard Constraint #4 & #5 Regression Guard:
    Verify that kiroku_dictionary imports standard library ONLY.
    No imports from backend/app or third-party packages allowed.
    """

    ALLOWED_MODULES = {
        "__future__",
        "argparse",
        "ast",
        "dataclasses",
        "datetime",
        "enum",
        "functools",
        "itertools",
        "json",
        "logging",
        "math",
        "os",
        "pathlib",
        "re",
        "sqlite3",
        "sys",
        "threading",
        "time",
        "typing",
        "unicodedata",
        "urllib",
        "zipfile",
        "zlib",
        # Internal relative or self package imports:
        "kiroku_dictionary",
        "schema",
        "importer",
        "build",
        "deinflect",
        "lookup",
        "yomitan_payload",
    }

    def test_no_forbidden_or_third_party_imports(self):
        pkg_dir = REPO_ROOT / "kiroku_dictionary"
        self.assertTrue(pkg_dir.is_dir(), f"{pkg_dir} must exist")

        py_files = list(pkg_dir.glob("*.py"))
        self.assertGreater(len(py_files), 0, "Must have Python files in kiroku_dictionary")

        for py_file in py_files:
            with open(py_file, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=str(py_file))

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        top_module = alias.name.split(".")[0]
                        self.assertIn(
                            top_module,
                            self.ALLOWED_MODULES,
                            f"Illegal import '{alias.name}' in {py_file.name}. Stdlib only, no backend/app or 3rd-party dependencies!",
                        )
                elif isinstance(node, ast.ImportFrom):
                    if node.level and node.level > 0:
                        # Relative import within package is fine
                        continue
                    if node.module:
                        top_module = node.module.split(".")[0]
                        self.assertIn(
                            top_module,
                            self.ALLOWED_MODULES,
                            f"Illegal import-from '{node.module}' in {py_file.name}. Stdlib only, no backend/app or 3rd-party dependencies!",
                        )


if __name__ == "__main__":
    unittest.main()
