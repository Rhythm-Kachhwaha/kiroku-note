"""
test_dictionary_lookup.py -- Tests for kiroku_dictionary lookup, headword grouping, and latency.
"""
from pathlib import Path
import sys
import time
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kiroku_dictionary import DictionaryEngine, lookup_kanji, lookup_terms

DB_PATH = str(REPO_ROOT / "kiroku_dict.sqlite")


@unittest.skipUnless(Path(DB_PATH).exists(), "kiroku_dict.sqlite must be built for lookup tests")
class DictionaryLookupLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = DictionaryEngine(DB_PATH)
        # Warm up connection
        cls.engine.lookup_terms("テスト")

    def test_exact_kanji_lookup(self):
        """Looking up 食べる should return 食べる as primary result."""
        results = self.engine.lookup_terms("食べる", max_results=5)
        self.assertGreater(len(results), 0)
        top = results[0]
        self.assertEqual(top.term, "食べる")
        self.assertEqual(top.reading, "たべる")
        self.assertFalse(top.is_deinflected)
        self.assertGreater(len(top.definitions), 0)

    def test_deinflected_lookup(self):
        """Looking up 食べた should deinflect to 食べる."""
        results = self.engine.lookup_terms("食べた", max_results=5)
        terms = [r.term for r in results]
        self.assertIn("食べる", terms)

        # 飲んじゃった -> 飲む
        results_nomu = self.engine.lookup_terms("飲んじゃった", max_results=5)
        terms_nomu = [r.term for r in results_nomu]
        self.assertIn("飲む", terms_nomu)

        # 行かなかった -> 行く
        results_iku = self.engine.lookup_terms("行かなかった", max_results=5)
        terms_iku = [r.term for r in results_iku]
        self.assertIn("行く", terms_iku)

    def test_kana_only_reading_lookup(self):
        """Looking up たべる (kana) should match 食べる on reading."""
        results = self.engine.lookup_terms("たべる", max_results=5)
        terms = [r.term for r in results]
        self.assertIn("食べる", terms)

    def test_ambiguous_homophones(self):
        """
        Ambiguous input test:
        Testing kana with many homophones (こうえん, かんじ, はし) and requiring
        common headwords to appear in top results.
        """
        # こうえん -> 公園 (park), 講演 (lecture), etc.
        kouen_results = self.engine.lookup_terms("こうえん", max_results=10)
        kouen_terms = [r.term for r in kouen_results]
        self.assertIn("公園", kouen_terms, f"Expected 公園 in {kouen_terms}")

        # かんじ -> 漢字 (kanji), 感じ (feeling), etc.
        kanji_results = self.engine.lookup_terms("かんじ", max_results=10)
        kanji_terms = [r.term for r in kanji_results]
        self.assertIn("漢字", kanji_terms, f"Expected 漢字 in {kanji_terms}")
        self.assertIn("感じ", kanji_terms, f"Expected 感じ in {kanji_terms}")

        # はし -> 橋 (bridge), 箸 (chopsticks), 端 (edge), etc.
        hashi_results = self.engine.lookup_terms("はし", max_results=10)
        hashi_terms = [r.term for r in hashi_results]
        self.assertTrue(
            "橋" in hashi_terms or "箸" in hashi_terms or "端" in hashi_terms,
            f"Expected common hashi in {hashi_terms}",
        )

    def test_kanji_character_lookup(self):
        """Lookup character breakdown for kanji in text."""
        k_results = self.engine.lookup_kanji("日本食")
        self.assertEqual(len(k_results), 3)
        chars = [k.character for k in k_results]
        self.assertEqual(chars, ["日", "本", "食"])

        shoku = next(k for k in k_results if k.character == "食")
        self.assertIn("ショク", shoku.onyomi)
        self.assertIn("eat", [m.lower() for m in shoku.meanings])
        self.assertIn("strokes", shoku.stats)

    def test_lookup_latency_budget(self):
        """
        Performance requirement:
        Target p95 < 30 ms per lookup on local SQLite after warm-up.
        """
        queries = [
            "食べる", "食べた", "食べさせられた", "行かない", "泳いで",
            "話したい", "飲んじゃった", "本", "猫", "車",
            "こうえん", "かんじ", "はし", "しなかった", "高すぎる",
            "美しい", "早く", "よかった", "できない", "勉強する",
        ]

        latencies_ms: list[float] = []

        # Run 5 iterations over the queries (100 total lookups)
        for _ in range(5):
            for q in queries:
                t0 = time.perf_counter()
                self.engine.lookup_terms(q, max_results=10)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                latencies_ms.append(elapsed_ms)

        latencies_ms.sort()
        p50 = latencies_ms[int(len(latencies_ms) * 0.50)]
        p95 = latencies_ms[int(len(latencies_ms) * 0.95)]
        p99 = latencies_ms[int(len(latencies_ms) * 0.99)]

        print(f"\n[Performance Benchmark on 100 Lookups]")
        print(f"  p50 : {p50:.2f} ms")
        print(f"  p95 : {p95:.2f} ms (Target < 30 ms)")
        print(f"  p99 : {p99:.2f} ms")
        print(f"  max : {latencies_ms[-1]:.2f} ms")

        self.assertLess(
            p95,
            30.0,
            f"p95 latency ({p95:.2f} ms) exceeded performance budget of 30 ms!",
        )
    def test_lookup_terms_safe_on_none_and_invalid_types(self):
        """None, empty strings, and non-strings should safely return empty list without raising."""
        self.assertEqual(self.engine.lookup_terms(None), [])
        self.assertEqual(self.engine.lookup_terms(""), [])
        self.assertEqual(self.engine.lookup_terms(12345), [])
        self.assertEqual(self.engine.lookup_kanji(None), [])
        self.assertEqual(self.engine.lookup_kanji(""), [])
        self.assertEqual(self.engine.lookup_kanji(12345), [])


if __name__ == "__main__":
    unittest.main()
