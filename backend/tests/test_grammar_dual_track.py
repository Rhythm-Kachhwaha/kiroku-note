from datetime import datetime, timezone
import pytest
from app.services.grammar_tracker import GrammarTrackerService
from app.services.grammar_mastery import compute_pipeline_status, calculate_modality_mastery


def test_exposure_logging_with_sentence_context_and_source(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")

    # Initially unseen
    initial = tracker.get_dual_track_status("てしまう")
    assert initial["pipeline_status"] == "unseen"
    assert initial["exposure"]["seen_count"] == 0

    # Log encounter 1 with exact sentence context & media source
    enc1 = tracker.record_encounter(
        pattern_key="てしまう",
        display="〜てしまう",
        sentence="宿題を忘れてしまった。",
        source="video",
        source_title="Anime Ep 1",
        video_timestamp_ms=45200,
        level="N4",
    )
    assert enc1["seen_count"] == 1
    assert enc1["pipeline_status"] == "encountered"

    # Log encounter 2 with different source
    enc2 = tracker.record_encounter(
        pattern_key="てしまう",
        display="〜てしまう",
        sentence="財布を落としてしまった。",
        source="book",
        source_title="Novel Vol 1",
        level="N4",
    )
    assert enc2["seen_count"] == 2
    assert enc2["pipeline_status"] == "encountered"

    status = tracker.get_dual_track_status("てしまう")
    assert status["pipeline_status"] == "encountered"
    assert status["exposure"]["seen_count"] == 2
    encounters = status["exposure"]["encounters"]
    assert len(encounters) == 2
    assert encounters[0]["sentence"] == "財布を落としてしまった。"
    assert encounters[0]["source"] == "book"
    assert encounters[1]["sentence"] == "宿題を忘れてしまった。"
    assert encounters[1]["source"] == "video"
    assert encounters[1]["video_timestamp_ms"] == 45200


def test_mastery_progression_across_three_proof_modalities(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")
    tracker.record_encounter(
        pattern_key="ば",
        display="〜ば",
        sentence="行けばわかる。",
        source="text",
        level="N4",
    )

    # 1. Spot in the wild drill
    res1 = tracker.record_drill_outcome(
        pattern_key="ば",
        modality="spot_in_wild",
        is_correct=True,
        user_answer="ば",
        expected_answer="ば",
        context_sentence="春になれば花が咲く。",
    )
    assert res1["mastery_score"] > 0.0
    assert res1["drill_count"] == 1
    assert res1["pipeline_status"] == "practicing"
    first_mastery = res1["mastery_score"]

    # 2. Conjugation & formation cloze
    res2 = tracker.record_drill_outcome(
        pattern_key="ば",
        modality="conjugation_cloze",
        is_correct=True,
        user_answer="食べれば",
        expected_answer="食べれば",
        context_sentence="これを[食べれば]元気になる。",
    )
    assert res2["mastery_score"] > first_mastery
    assert res2["drill_count"] == 2
    assert res2["pipeline_status"] == "practicing"
    second_mastery = res2["mastery_score"]

    # 3. Nuance battle
    res3 = tracker.record_drill_outcome(
        pattern_key="ば",
        modality="nuance_battle",
        is_correct=True,
        user_answer="ば",
        expected_answer="ば",
        context_sentence="ば vs たら vs なら difference drill",
    )
    assert res3["mastery_score"] > second_mastery
    assert res3["drill_count"] == 3

    # Check invalid modality raises ValueError
    with pytest.raises(ValueError):
        tracker.record_drill_outcome(
            pattern_key="ば",
            modality="invalid_drill",
            is_correct=True,
        )


def test_status_pipeline_transitions(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")
    key = "らしい"

    # Step 1: Unseen
    st0 = tracker.get_dual_track_status(key)
    assert st0["pipeline_status"] == "unseen"

    # Step 2: Encountered (Seen >= 1, 0% mastery)
    tracker.record_encounter(
        pattern_key=key,
        display="〜らしい",
        sentence="雨が降るらしい。",
        source="news",
        level="N4",
    )
    st1 = tracker.get_dual_track_status(key)
    assert st1["pipeline_status"] == "encountered"
    assert st1["exposure"]["seen_count"] == 1
    assert st1["mastery"]["mastery_score"] == 0.0

    # Step 3: Practicing (Initiated drills, 1% - 79% mastery)
    tracker.record_drill_outcome(
        pattern_key=key,
        modality="spot_in_wild",
        is_correct=True,
    )
    st2 = tracker.get_dual_track_status(key)
    assert st2["pipeline_status"] == "practicing"
    assert 0.0 < st2["mastery"]["mastery_score"] < 80.0

    # Step 4: Advance to Mastered (>= 80% mastery score across proof drills)
    for _ in range(8):
        tracker.record_drill_outcome(
            pattern_key=key,
            modality="nuance_battle",
            is_correct=True,
        )
    st3 = tracker.get_dual_track_status(key)
    assert st3["mastery"]["mastery_score"] >= 80.0
    assert st3["pipeline_status"] == "mastered"


def test_fsrs_decay_and_confidence_scoring(tmp_path):
    # Test calculate_modality_mastery decay logic directly
    now_past = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    now_future = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)  # 31 days later

    calc1 = calculate_modality_mastery(
        current_mastery=0.0,
        modality="conjugation_cloze",
        is_correct=True,
        now=now_past,
    )
    assert calc1["new_mastery"] > 0
    stability1 = calc1["new_stability"]

    # Future attempt with elapsed time demonstrates decay in retrievability
    calc2 = calculate_modality_mastery(
        current_mastery=calc1["new_mastery"],
        modality="conjugation_cloze",
        is_correct=True,
        current_stability=stability1,
        last_drilled_at=now_past.isoformat(),
        now=now_future,
    )
    assert calc2["retrievability"] < 1.0


def test_batch_dual_track_status(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")
    tracker.record_encounter("ておく", "〜ておく", "準備しておく。", "text", level="N4")
    tracker.record_encounter("てある", "〜てある", "窓が開けてある。", "text", level="N4")

    batch = tracker.get_batch_dual_track_status(["ておく", "てある", "未知"])
    assert len(batch) == 3
    assert batch[0]["pattern_key"] == "ておく"
    assert batch[0]["pipeline_status"] == "encountered"
    assert batch[2]["pattern_key"] == "未知"
    assert batch[2]["pipeline_status"] == "unseen"
