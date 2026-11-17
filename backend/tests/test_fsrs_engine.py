import pytest
from app.services.fsrs_engine import FSRSEngine, Rating, CardState

def test_initial_review_caps_easy_adaptably():
    engine = FSRSEngine(easy_initial_cap_days=6, desired_retention=0.90)

    # New card (reps=0) rated Easy -> capped at 6d
    easy_new = engine.schedule(
        rating=Rating.EASY,
        stability=0.0,
        difficulty=0.0,
        reps=0,
        lapses=0,
        elapsed_days=0,
        state=CardState.NEW
    )
    assert easy_new.scheduled_days == 6
    assert easy_new.interval_label == "6d"
    assert easy_new.next_state == CardState.REVIEW
    assert easy_new.reps == 1

def test_initial_review_caps_easy_with_custom_days():
    engine = FSRSEngine(easy_initial_cap_days=8, desired_retention=0.90)

    easy_new = engine.schedule(
        rating=Rating.EASY,
        stability=0.0,
        difficulty=0.0,
        reps=0,
        lapses=0,
        elapsed_days=0,
        state=CardState.NEW
    )
    assert easy_new.scheduled_days == 8
    assert easy_new.interval_label == "8d"

def test_subsequent_easy_review_scales_naturally_without_cap():
    engine = FSRSEngine(easy_initial_cap_days=6, desired_retention=0.90)

    # Graduated card (reps=1, stability=6.0, elapsed=6) rated Easy again
    easy_second = engine.schedule(
        rating=Rating.EASY,
        stability=6.0,
        difficulty=3.0,
        reps=1,
        lapses=0,
        elapsed_days=6,
        state=CardState.REVIEW
    )
    # Must NOT be restricted to 6 days; must grow exponentially (e.g., > 10 days)
    assert easy_second.scheduled_days > 10
    assert easy_second.reps == 2

def test_initial_review_ratings_intervals():
    engine = FSRSEngine(easy_initial_cap_days=6, desired_retention=0.90)

    again = engine.schedule(rating=Rating.AGAIN, stability=0.0, difficulty=0.0, reps=0, lapses=0, elapsed_days=0, state=CardState.NEW)
    assert again.scheduled_days == 0
    assert again.interval_label == "<10m"
    assert again.next_state == CardState.LEARNING

    hard = engine.schedule(rating=Rating.HARD, stability=0.0, difficulty=0.0, reps=0, lapses=0, elapsed_days=0, state=CardState.NEW)
    assert hard.scheduled_days == 1
    assert hard.interval_label == "1d"
    assert hard.next_state == CardState.REVIEW

    good = engine.schedule(rating=Rating.GOOD, stability=0.0, difficulty=0.0, reps=0, lapses=0, elapsed_days=0, state=CardState.NEW)
    assert good.scheduled_days == 3
    assert good.interval_label == "3d"
    assert good.next_state == CardState.REVIEW

def test_lapse_increments_lapses_and_lowers_stability():
    engine = FSRSEngine(easy_initial_cap_days=6, desired_retention=0.90)

    res = engine.schedule(
        rating=Rating.AGAIN,
        stability=10.0,
        difficulty=5.0,
        reps=3,
        lapses=0,
        elapsed_days=10,
        state=CardState.REVIEW
    )
    assert res.lapses == 1
    assert res.next_state == CardState.RELEARNING
    assert res.scheduled_days == 0
    assert res.interval_label == "<10m"
    assert res.stability < 10.0

def test_get_preview_intervals():
    engine = FSRSEngine(easy_initial_cap_days=6, desired_retention=0.90)
    intervals = engine.get_intervals_preview(stability=0.0, difficulty=0.0, reps=0, lapses=0, elapsed_days=0, state=CardState.NEW)
    assert intervals["again"] == "<10m"
    assert intervals["hard"] == "1d"
    assert intervals["good"] == "3d"
    assert intervals["easy"] == "6d"
