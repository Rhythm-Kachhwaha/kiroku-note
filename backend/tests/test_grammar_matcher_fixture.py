"""Verification of grammar sentences fixture and morph matcher behavior."""
import json
from pathlib import Path

import pytest

from app.services.grammar_matcher import GrammarMatcher, MatchedGrammarSpan


def _load_fixtures():
    path = Path(__file__).parent / "fixtures" / "grammar_sentences.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _load_fixtures(), ids=lambda c: c["sentence"])
def test_grammar_sentences_fixture(case):
    if case.get("xfail_slice13"):
        pytest.xfail("Requires Slice 13 grammar dataset additions/updates")

    sentence = case["sentence"]
    matcher = GrammarMatcher()
    matches = matcher.match_sentence([], sentence)

    for expected in case.get("expected", []):
        key = expected["pattern_key"]
        alts = expected.get("alt_keys", [])
        expected_keys = [key] + alts
        matched = next((m for m in matches if m.pattern_key in expected_keys), None)
        assert matched is not None, f"Expected {key} in {sentence}, got {[m.pattern_key for m in matches]}"
        assert matched.text == expected["text"], f"Expected span text {expected['text']!r}, got {matched.text!r}"

    matched_keys = {m.pattern_key for m in matches}
    for forbidden in case.get("forbidden", []):
        assert forbidden not in matched_keys, f"Forbidden key {forbidden} matched in {sentence}"


class _MockReference:
    def __init__(self, points):
        self.points = points

    def get_points(self):
        return self.points


def test_morph_matcher_evaluation_and_predicate_chain_extension():
    # Test morph matcher type on morpheme sequence
    # E.g. sequence for N3 ことにする: [動詞, 名詞(こと), 助詞(に), 動詞(する)]
    morph_point = {
        "pattern_key": "ことにする",
        "pattern_display": "〜ことにする",
        "level": "N3",
        "meaning_short": "decide to",
        "english_breakdown": "decide to do",
        "matcher": {
            "type": "morph",
            "sequence": [
                {"surface": "こと"},
                {"surface": "に"},
                {"lemma": "する"},
            ],
            "extend_predicate": True,
        },
    }
    matcher = GrammarMatcher(_MockReference([morph_point]))
    sentence = "毎日走ることにした。"
    # Morphemes for 毎日走ることにした:
    # 毎日 (noun, 0..2), 走る (verb, 2..4), こと (noun, 4..6), に (particle, 6..7), し (verb する, 7..8), た (aux, 8..9)
    tokens = [
        {"text": "毎日", "surface": "毎日", "pos": "名詞", "start": 0, "end": 2},
        {"text": "走る", "surface": "走る", "pos": "動詞", "start": 2, "end": 4},
        {"text": "こと", "surface": "こと", "pos": "名詞", "start": 4, "end": 6},
        {"text": "に", "surface": "に", "pos": "助詞", "start": 6, "end": 7},
        {"text": "し", "surface": "し", "lemma": "する", "pos": "動詞", "start": 7, "end": 8},
        {"text": "た", "surface": "た", "pos": "助動詞", "start": 8, "end": 9},
    ]
    spans = matcher.match_sentence(tokens, sentence)
    assert len(spans) == 1
    assert spans[0].pattern_key == "ことにする"
    assert spans[0].text == "走ることにし"

