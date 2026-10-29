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


def test_punctuation_free_sentence_uses_literal_fallback_but_short_word_does_not():
    service = GrammarService(provider=OfflineProvider(), db_path=":memory:")
    result = service.analyze("宿題を忘れてしまった")
    assert any(point["pattern_key"] == "てしまう" for point in result["points"])
    assert service.analyze("わけ")["points"] == []


def test_cached_results_are_refiltered_for_requested_learner_level(tmp_path):
    service = GrammarService(provider=OfflineProvider(), db_path=tmp_path / "grammar.sqlite")
    broad = service.analyze("宿題を忘れてしまった。", learner_level="N1")
    assert any(point["level"] == "N4" for point in broad["points"])

    narrow = service.analyze("宿題を忘れてしまった。", learner_level="N5")
    assert narrow["cached"] is True
    assert narrow["points"] == []
    assert narrow["learner_level"] == "N5"
