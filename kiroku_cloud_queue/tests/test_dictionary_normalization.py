import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from kiroku_dictionary import DictionaryEngine, lookup_terms
from kiroku_dictionary.normalizer import (
    CrossReference,
    DictionarySense,
    extract_senses_from_glossary,
    format_normalized_entry,
    synthesize_default_meaning,
)
from server import batch_get_jlpt_levels


class TestDictionaryNormalization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_candidates = [
            "kiroku_dict.sqlite",
            "../kiroku_dict.sqlite",
            "../../kiroku_dict.sqlite",
            "kiroku_cloud_queue/kiroku_dict.sqlite",
        ]
        cls.db_path = next((p for p in db_candidates if os.path.exists(p)), None)
        if cls.db_path:
            cls.engine = DictionaryEngine(cls.db_path)
        else:
            cls.engine = None

    def setUp(self):
        if not self.engine:
            self.skipTest("kiroku_dict.sqlite not found for testing")

    def test_word_mode_no_prefix_junk(self):
        # Searching "食べる" in word mode should not include prefix "食"
        res_word = self.engine.lookup_terms("食べる", mode="word")
        terms_word = [g.term for g in res_word]
        self.assertIn("食べる", terms_word)
        self.assertNotIn("食", terms_word)

        # Searching "ありがとう" in word mode should not return 蟻 or 尼
        res_arigato = self.engine.lookup_terms("ありがとう", mode="word")
        terms_arigato = [g.term for g in res_arigato]
        self.assertNotIn("蟻", terms_arigato)
        self.assertNotIn("尼", terms_arigato)

    def test_scan_mode_includes_prefixes(self):
        # Scan mode checks substrings down to length 1
        res_scan = self.engine.lookup_terms("食べる", mode="scan")
        terms_scan = [g.term for g in res_scan]
        self.assertIn("食べる", terms_scan)
        self.assertIn("食", terms_scan)

    def test_real_parts_of_speech_not_def_tags(self):
        # "行く" should have real parts of speech like "5-dan", "intransitive", NOT ['★', 'priority']
        res = self.engine.lookup_terms("行く", mode="word")
        self.assertTrue(len(res) > 0)
        norm = format_normalized_entry(res[0])
        pos = norm["parts_of_speech"]
        self.assertTrue(len(pos) > 0)
        self.assertNotIn("★", pos)
        self.assertNotIn("priority", pos)
        self.assertTrue(any("5-dan" in p.lower() or "intransitive" in p.lower() for p in pos))

    def test_structured_senses_and_xrefs(self):
        res = self.engine.lookup_terms("行く", mode="word")
        self.assertTrue(len(res) > 0)
        norm = format_normalized_entry(res[0])
        senses = norm["senses"]
        self.assertTrue(len(senses) > 0)
        
        # Check sense fields
        s0 = senses[0]
        self.assertIn("group_index", s0)
        self.assertIn("pos", s0)
        self.assertIn("glosses", s0)
        self.assertIn("notes", s0)
        self.assertIn("xrefs", s0)
        self.assertTrue(len(s0["glosses"]) > 0)
        self.assertEqual(s0["glosses"][0], "to go")

        # Sense 0 has xref to 来る
        xrefs = s0["xrefs"]
        self.assertTrue(len(xrefs) > 0)
        self.assertEqual(xrefs[0]["target_term"], "来る")
        self.assertIn("くる", xrefs[0]["target_reading"] or "")

    def test_synthesize_default_meaning_excludes_vulgar_slang(self):
        res = self.engine.lookup_terms("行く", mode="word")
        norm = format_normalized_entry(res[0])
        default_m = norm["default_meaning"]
        # Default meaning should not contain vulgar/sexual sense 11 ("to have an orgasm")
        self.assertNotIn("orgasm", default_m.lower())
        self.assertNotIn("cum", default_m.lower())
        self.assertNotIn("hallucination", default_m.lower())
        self.assertIn("to go", default_m.lower())

    def test_batch_get_jlpt_levels(self):
        levels = batch_get_jlpt_levels(["食べる", "行く", "飲む", "勉強"])
        if levels:
            self.assertEqual(levels.get("食べる"), "N5")
            self.assertEqual(levels.get("行く"), "N5")
            self.assertEqual(levels.get("飲む"), "N5")

    def test_parity_between_yomitan_and_cloud_normalizer(self):
        # H4 parity test: verify that local YomitanService and cloud format_normalized_entry
        # give identical structured terms, readings, and first gloss for a fixed word list
        from kiroku_dictionary.yomitan_payload import format_term_entries_payload
        from app.services.yomitan import YomitanService

        words = ["行く", "食べる", "飲む", "学校"]
        for w in words:
            term_groups = self.engine.lookup_terms(w, mode="word")
            self.assertTrue(len(term_groups) > 0)
            cloud_norm = format_normalized_entry(term_groups[0])

            yomitan_payload = format_term_entries_payload(term_groups)
            yomitan_entries = YomitanService.normalize_term_entries_response(yomitan_payload)
            self.assertTrue(len(yomitan_entries) > 0)
            local_entry = yomitan_entries[0]

            self.assertEqual(cloud_norm["expression"], local_entry.term)
            self.assertEqual(cloud_norm["reading"], local_entry.reading)
            self.assertEqual(cloud_norm["parts_of_speech"], local_entry.parts_of_speech)
            self.assertEqual(cloud_norm["senses"][0]["glosses"], local_entry.senses[0].glosses)


if __name__ == "__main__":
    unittest.main()
