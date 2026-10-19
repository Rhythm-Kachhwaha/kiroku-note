import concurrent.futures
import os
from pathlib import Path
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kiroku_dictionary import DictionaryEngine, deinflect
LOCAL_DB_PATH = str(REPO_ROOT / "kiroku_dict.sqlite")


class DictionaryHardeningTests(unittest.TestCase):
    def test_bracket_and_punctuation_sanitization(self):
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")
        engine = DictionaryEngine(LOCAL_DB_PATH)
        for dirty, clean in [
            ("「食べる」", "食べる"),
            ("『見る』", "見る"),
            ("（猫）", "猫"),
            ("【本】", "本"),
            ("〈行く〉", "行く"),
            ("《本》", "本"),
            ("〔走る〕", "走る"),
            ("“犬”", "犬"),
            ("‘日’", "日"),
            ("　食べる　", "食べる"),
        ]:
            res = engine.lookup_terms(dirty, max_results=1)
            self.assertTrue(len(res) > 0, f"Failed on {dirty}")
            self.assertEqual(res[0].term, clean, f"Expected {clean} for input {dirty}, got {res[0].term}")

    def test_colloquial_contractions_and_honorifics(self):
        # 食べちゃう / 食べちゃった -> 食べる
        cands_chau = list(deinflect("食べちゃった"))
        self.assertTrue(any(c.term == "食べる" for c in cands_chau), "Failed 食べちゃった -> 食べる")

        # 買っとく -> 買う
        cands_toku = list(deinflect("買っとく"))
        self.assertTrue(any(c.term == "買う" for c in cands_toku), "Failed 買っとく -> 買う")

        # 見てる -> 見る
        cands_teru = list(deinflect("見てる"))
        self.assertTrue(any(c.term == "見る" for c in cands_teru), "Failed 見てる -> 見る")

        # 行かなきゃ -> 行く
        cands_nakya = list(deinflect("行かなきゃ"))
        self.assertTrue(any(c.term == "行く" for c in cands_nakya), "Failed 行かなきゃ -> 行く")

    def test_multi_threaded_concurrency(self):
        if not os.path.exists(LOCAL_DB_PATH):
            self.skipTest("kiroku_dict.sqlite not found")
        engine = DictionaryEngine(LOCAL_DB_PATH)
        words = ["食べる", "走る", "猫", "本", "勉強", "見る", "行く", "書く"] * 10

        def do_lookup(w):
            res = engine.lookup_terms(w, max_results=2)
            return len(res)

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
            results = list(executor.map(do_lookup, words))

        self.assertEqual(len(results), len(words))
        self.assertTrue(all(r > 0 for r in results))
