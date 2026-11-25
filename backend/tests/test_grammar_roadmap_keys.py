import pytest
from app.study.grammar_roadmap import ROADMAP_CHAPTERS, CONCEPTUAL_HUBS
from app.services.grammar_reference import GrammarReferenceService
from app.services.grammar_tracker import GrammarTrackerService


def test_roadmap_chapters_keys_exist_in_reference():
    ref = GrammarReferenceService()
    for ch in ROADMAP_CHAPTERS:
        for key in ch["pattern_keys"]:
            point = ref.get_point_by_key(key)
            assert point is not None, f"Chapter '{ch['chapter_id']}' has unrecognized pattern key: '{key}'"


def test_roadmap_conceptual_hubs_keys_exist_in_reference():
    ref = GrammarReferenceService()
    for hub in CONCEPTUAL_HUBS:
        for key in hub["pattern_keys"]:
            point = ref.get_point_by_key(key)
            assert point is not None, f"Hub '{hub['hub_id']}' has unrecognized pattern key: '{key}'"


def test_tracker_rejects_unknown_pattern_key(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    with pytest.raises(ValueError, match="Unknown grammar pattern key"):
        tracker.update_point_status("completely_invalid_key_12345", "learning")


def test_tracker_accepts_valid_canonical_key(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    result = tracker.update_point_status("だ", "known")
    assert result is not None
    assert result["pattern_key"] == "だ"
    assert result["status"] == "known"
    assert result["level"] == "N5"


def test_roadmap_has_no_duplicate_points_per_group():
    from app.study.grammar_roadmap import GrammarRoadmapService

    svc = GrammarRoadmapService()
    for ch in svc.get_roadmap_flow()["chapters"]:
        displays = [p["display"] for p in ch["points"]]
        assert len(displays) == len(set(displays)), f"Duplicate points in {ch['chapter_id']}: {displays}"

    for hub in svc.get_conceptual_hubs()["hubs"]:
        displays = [p["display"] for p in hub["points"]]
        assert len(displays) == len(set(displays)), f"Duplicate points in {hub['hub_id']}: {displays}"


def test_dual_track_status_reflects_manual_status(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    tracker.update_point_status("だ", "learning")
    learning_stat = tracker.get_dual_track_status("だ")
    assert learning_stat["status"] == "learning"
    assert learning_stat["pipeline_status"] == "encountered"

    tracker.update_point_status("だ", "known")
    known_stat = tracker.get_dual_track_status("だ")
    assert known_stat["status"] == "known"
    assert known_stat["pipeline_status"] == "mastered"
    assert known_stat["mastery"]["mastery_score"] == 100.0

