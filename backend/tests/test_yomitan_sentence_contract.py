import json
from pathlib import Path
import unittest

from app.services.yomitan import YomitanResponseError, YomitanService


FIXTURE = Path(__file__).parent / "fixtures" / "yomitan_sentence_tokenize_fixture.json"


class YomitanSentenceContractTests(unittest.TestCase):
    def test_fixture_has_sentence_tokens_and_inflection_facts(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        tokens = fixture["tokens"]
        self.assertEqual("昨日彼に無理やり納豆を食べさせられなかった。", fixture["sentence"])
        token = next(token for token in tokens if any(
            source["originalText"] == "食べさせられなかった"
            for headword in token["headwords"] for source in headword["sources"]
        ))
        headword = token["headwords"][0]
        source = headword["sources"][0]
        self.assertEqual("食べさせられなかった", source["originalText"])
        self.assertEqual("食べる", source["deinflectedText"])
        self.assertEqual(
            ["使役", "受身", "否定", "過去"],
            fixture["inflectionCandidates"]["食べさせられなかった"][0],
        )
        self.assertIn("食べてしまった", fixture["inflectionCandidates"])
        self.assertTrue(fixture["inflectionCandidates"]["食べてしまった"])

    def test_normalizer_preserves_all_tokens_and_source_fields(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        raw_tokens = []
        for token in fixture["tokens"]:
            raw_token = dict(token)
            raw_token["headwords"] = [token["headwords"]]
            raw_tokens.append(raw_token)
        raw = [{"content": [raw_tokens]}]
        normalized = YomitanService.normalize_tokenize_tokens(raw)
        self.assertEqual([token["text"] for token in normalized], [token["text"] for token in fixture["tokens"]])
        token = next(token for token in normalized if token["text"] == "食")
        self.assertEqual(token["headwords"][0]["sources"][0]["deinflectedText"], "食べる")

    def test_normalizer_rejects_empty_token_content(self):
        with self.assertRaises(YomitanResponseError):
            YomitanService.normalize_tokenize_tokens([])
