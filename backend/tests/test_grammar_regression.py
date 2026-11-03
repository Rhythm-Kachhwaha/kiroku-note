import json
from pathlib import Path

from app.services.grammar_matcher import GrammarMatcher


class _Reference:
    def __init__(self):
        data_path = Path(__file__).parents[1] / "app" / "data" / "master_grammar_dataset.json"
        self.points = json.loads(data_path.read_text(encoding="utf-8"))

    def get_points(self):
        return self.points


def test_grammar_regression_sentences():
    cases_path = Path(__file__).parent / "data" / "grammar_regression.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    matcher = GrammarMatcher(_Reference())

    assert len(cases) >= 40
    for case in cases:
        keys = {span.pattern_key for span in matcher.match_sentence([], case["sentence"])}
        assert set(case["expected"]) <= keys, (case["sentence"], keys)
