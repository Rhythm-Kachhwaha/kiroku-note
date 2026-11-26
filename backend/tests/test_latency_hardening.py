from pathlib import Path
from unittest.mock import MagicMock

from app.repositories.card_repository import CardDraft, CardRepository
from app.services.jlpt_reference import JlptReferenceService
from app.services.kanji_service import KanjiService
from app.study.grammar_roadmap import GrammarRoadmapService


def test_jlpt_reference_precomputed_categories_cleaned_examples_and_memoized():
    svc = JlptReferenceService()
    n4_first = svc.get_words_by_level("N4", limit=5000)
    n4_second = svc.get_words_by_level("N4", limit=5000)

    assert n4_first is n4_second
    assert len(n4_first) > 0

    kou = next((w for w in n4_first if w["expression"] == "こう"), None)
    assert kou is not None
    assert "adverb:adv" in kou.get("categories", [])
    assert "行こう" not in (kou.get("example_sentence") or "")
    assert svc.get_meaning_for_word("もっと") != ""
    assert svc.get_meaning_for_word("行く") != ""


def test_card_repository_filters_test_fixture_words(tmp_path: Path):
    db_path = tmp_path / "cards_filter.sqlite"
    repo = CardRepository(db_path=db_path)
    for expr in ("word_29", "word_2", "test_sample", "mock_item", "食べる"):
        repo.save(
            CardDraft(
                expression=expr,
                reading="",
                meaning="meaning",
                deck_name="Default",
                model_name="Basic",
            )
        )

    cards = repo.list_cards(limit=50)
    expressions = [c.expression for c in cards]
    assert expressions == ["食べる"]


def test_kanji_service_browse_and_study_list_memoized():
    svc = KanjiService()
    b1 = svc.browse(level="N5", limit=10, offset=0)
    b2 = svc.browse(level="N5", limit=10, offset=0)
    assert b1 is b2
    assert len(b1["kanji"]) == 10

    s1 = svc.get_study_list(level="N5", limit=10, offset=0)
    s2 = svc.get_study_list(level="N5", limit=10, offset=0)
    assert len(s1["items"]) == 10
    assert s1["items"][0]["character"] == s2["items"][0]["character"]
    assert ("N5", 10, 0) in svc._study_list_base_cache


def test_grammar_roadmap_ref_point_memoized():
    mock_ref = MagicMock()
    mock_ref.get_point_by_key.return_value = {"pattern_display": "〜ている", "level": "N5", "meaning_short": "ongoing"}
    mock_tracker = MagicMock()
    mock_tracker.get_dual_track_status.return_value = None

    roadmap = GrammarRoadmapService(reference_service=mock_ref, tracker_service=mock_tracker)
    p1 = roadmap._enrich_point_dual_track("te_iru")
    p2 = roadmap._enrich_point_dual_track("te_iru")

    assert p1["display"] == "〜ている"
    assert p2["display"] == "〜ている"
    mock_ref.get_point_by_key.assert_called_once_with("te_iru")
