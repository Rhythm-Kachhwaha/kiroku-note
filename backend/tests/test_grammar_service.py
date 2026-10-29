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


def test_cache_entries_are_isolated_by_learner_level(tmp_path):
    service = GrammarService(provider=OfflineProvider(), db_path=tmp_path / "grammar.sqlite")
    broad = service.analyze("宿題を忘れてしまった。", learner_level="N1")
    assert any(point["level"] == "N4" for point in broad["points"])

    narrow = service.analyze("宿題を忘れてしまった。", learner_level="N5")
    assert narrow["cached"] is False
    assert narrow["points"] == []
    assert narrow["learner_level"] == "N5"


def test_cached_narrow_results_do_not_hide_points_from_broader_level(tmp_path):
    service = GrammarService(provider=OfflineProvider(), db_path=tmp_path / "grammar.sqlite")
    narrow = service.analyze("宿題を忘れてしまった。", learner_level="N5")
    assert narrow["points"] == []

    broad = service.analyze("宿題を忘れてしまった。", learner_level="N1")
    assert broad["cached"] is False
    assert any(point["level"] == "N4" for point in broad["points"])


def test_analysis_options_change_output_and_cache_key(tmp_path):
    class TokenProvider(OfflineProvider):
        supports_sentence_tokenization = True

        def tokenize_with_inflection(self, text):
            return [{"text": char} for char in text]

    service = GrammarService(provider=TokenProvider(), db_path=tmp_path / "grammar.sqlite")
    sentence = "学校に行く。"
    hidden = service.analyze(sentence, show_basic_particles=False)
    shown = service.analyze(sentence, show_basic_particles=True)
    assert not any(point["pattern_key"] == "に" for point in hidden["points"])
    assert any(point["pattern_key"] == "に" for point in shown["points"])
    all_levels = service.analyze("宿題を忘れてしまった。", learner_level="N5", show_below_level=False)
    assert all_levels["points"]
    assert all_levels["cached"] is False


def test_hide_known_excludes_tracked_points(tmp_path):
    from app.services.grammar_tracker import GrammarTrackerService

    database = tmp_path / "grammar.sqlite"
    tracker = GrammarTrackerService(database)
    tracker.record_encounter("てしまう", "〜てしまう", "食べてしまった。", "text", level="N4")
    tracker.update_point_status("てしまう", "known")
    service = GrammarService(provider=OfflineProvider(), db_path=database)
    result = service.analyze("食べてしまった。", hide_known=True)
    assert not any(point["pattern_key"] == "てしまう" for point in result["points"])


def test_designated_dictionary_notes_are_bounded_and_fail_soft(tmp_path):
    class DictionaryProvider(OfflineProvider):
        calls = 0

        def check_availability(self):
            return True

        def scan_term_entries(self, term):
            self.calls += 1
            return [{
                "dictionary": "Grammar Notes",
                "definitions": [{"glosses": ["<b>safe note</b>"]}],
            }]

    provider = DictionaryProvider()
    service = GrammarService(provider=provider, db_path=tmp_path / "grammar.sqlite")
    result = service.analyze("食べてしまった。", designated_dictionary="Grammar Notes")
    note = next(point["dictionary_notes"][0] for point in result["points"] if point["dictionary_notes"])
    assert note == {"dictionary": "Grammar Notes", "text": "safe note"}
    assert provider.calls == 1

    class FailingProvider(DictionaryProvider):
        def scan_term_entries(self, term):
            raise TimeoutError("slow")

    failed = GrammarService(
        provider=FailingProvider(), db_path=tmp_path / "failed.sqlite"
    ).analyze("食べてしまった。", designated_dictionary="Grammar Notes")
    assert failed["points"]
    assert all("dictionary_notes" not in point for point in failed["points"])
