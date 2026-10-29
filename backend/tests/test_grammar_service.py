from pathlib import Path

from app.services.grammar_service import GrammarService


class OfflineProvider:
    def tokenize_with_inflection(self, text):
        raise RuntimeError("offline")

    def discover_available_dictionaries(self):
        return []

    def check_availability(self):
        return False


def test_isolated_word_has_no_grammar():
    result = GrammarService(provider=OfflineProvider(), db_path=":memory:").analyze("わけ")
    assert result["points"] == []


def test_sentence_uses_literal_fallback_when_offline():
    result = GrammarService(provider=OfflineProvider(), db_path=":memory:").analyze(
        "宿題を忘れてしまった。"
    )
    assert result["is_limited_offline"] is True
    assert any(point["pattern_key"] == "てしまう" for point in result["points"])
