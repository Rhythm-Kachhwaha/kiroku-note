"""
test_anki_mirror_compute.py -- Unit tests for pure computation functions in anki_mirror.py:
  - clean_field
  - map_fields
  - classify_state
  - compute_difficulty
  - build_daily_series
  - compute_due_days
"""
from __future__ import annotations

from datetime import datetime, timezone
import pytest

from anki_mirror import (
    DIFFICULTY_CONSTANTS,
    build_daily_series,
    classify_state,
    clean_field,
    compute_difficulty,
    compute_due_days,
    map_fields,
)


# ---------------------------------------------------------------------------
# clean_field tests
# ---------------------------------------------------------------------------

def test_clean_field_html_and_entities():
    raw = "<b>日本語</b>&nbsp;&amp;&nbsp;<i>英語</i>"
    cleaned = clean_field(raw)
    assert cleaned == "日本語 & 英語"


def test_clean_field_sound_tag():
    raw = "[sound:audio_12345.mp3] こんにちは [sound:bell.wav]"
    cleaned = clean_field(raw)
    assert cleaned == "こんにちは"


def test_clean_field_line_breaks():
    raw = "第一行<br>第二行<div>第三行</div><p>第四行</p>"
    cleaned = clean_field(raw)
    assert cleaned == "第一行\n第二行\n第三行\n第四行"


def test_clean_field_furigana_ruby_brackets():
    raw = "私[わたし]は日本語[にほんご]を勉強[べんきょう]します。"
    # With ruby brackets stripped
    cleaned = clean_field(raw, strip_ruby_brackets=True)
    assert cleaned == "私は日本語を勉強します。"

    # Without ruby brackets stripped
    preserved = clean_field(raw, strip_ruby_brackets=False)
    assert "私[わたし]" in preserved


def test_clean_field_length_cap():
    long_text = "あ" * 600
    capped = clean_field(long_text, max_len=500)
    assert len(capped) == 500
    assert capped == "あ" * 500


def test_clean_field_none_and_empty():
    assert clean_field(None) == ""
    assert clean_field("") == ""
    assert clean_field("   ") == ""


# ---------------------------------------------------------------------------
# map_fields tests
# ---------------------------------------------------------------------------

def test_map_fields_kiroku_note_type():
    fields = {
        "Expression": {"value": "約束"},
        "Reading": {"value": "やくそく"},
        "Meaning": {"value": "promise; appointment"},
        "Sentence": {"value": "明日の約束を忘れないで。"},
        "SentenceMeaning": {"value": "Don't forget tomorrow's appointment."},
    }
    mapped = map_fields(fields)
    assert mapped["expression"] == "約束"
    assert mapped["reading"] == "やくそく"
    assert mapped["meaning"] == "promise; appointment"
    assert mapped["sentence"] == "明日の約束を忘れないで。"
    assert mapped["sentence_meaning"] == "Don't forget tomorrow's appointment."


def test_map_fields_front_back_card():
    fields = {
        "Front": {"value": "猫"},
        "Back": {"value": "cat [sound:cat.mp3]"},
    }
    mapped = map_fields(fields)
    assert mapped["expression"] == "猫"
    assert mapped["meaning"] == "cat"
    assert mapped["reading"] == ""
    assert mapped["sentence"] == ""


def test_map_fields_unmapped_fallback():
    fields = {
        "MysteryField1": {"value": "桜"},
        "MysteryField2": {"value": "cherry blossom"},
    }
    mapped = map_fields(fields)
    # Expression takes first field as fallback
    assert mapped["expression"] == "桜"
    assert mapped["reading"] == ""


# ---------------------------------------------------------------------------
# classify_state tests
# ---------------------------------------------------------------------------

def test_classify_state_suspended_precedence():
    # Suspended queue code (-1) overrides review state
    card_info = {"queue": -1, "type": 2, "interval": 50}
    assert classify_state(card_info) == "suspended"


def test_classify_state_buried_precedence():
    card_info = {"queue": -2, "type": 2, "interval": 100}
    assert classify_state(card_info) == "buried"
    card_info_sched = {"queue": -3, "type": 2, "interval": 100}
    assert classify_state(card_info_sched) == "buried"


def test_classify_state_lifecycle_types():
    assert classify_state({"queue": 0, "type": 0}) == "new"
    assert classify_state({"queue": 1, "type": 1}) == "learning"
    assert classify_state({"queue": 2, "type": 2, "interval": 10}) == "young"
    assert classify_state({"queue": 2, "type": 2, "interval": 21}) == "mature"
    assert classify_state({"queue": 2, "type": 2, "interval": 90}) == "mature"
    assert classify_state({"queue": 3, "type": 3}) == "relearning"


# ---------------------------------------------------------------------------
# compute_difficulty tests
# ---------------------------------------------------------------------------

def test_compute_difficulty_new_card():
    card_info = {"reps": 0, "lapses": 0, "interval": 0}
    score, label = compute_difficulty(card_info, [])
    assert score is None
    assert label == "new"


def test_compute_difficulty_monotonicity_with_lapses():
    # As lapses increase, difficulty score must not decrease
    c1 = {"reps": 10, "lapses": 1, "interval": 30}
    c2 = {"reps": 10, "lapses": 3, "interval": 30}
    c3 = {"reps": 10, "lapses": 6, "interval": 30}
    s1, _ = compute_difficulty(c1, [])
    s2, _ = compute_difficulty(c2, [])
    s3, _ = compute_difficulty(c3, [])
    assert s1 is not None and s2 is not None and s3 is not None
    assert s1 <= s2 <= s3


def test_compute_difficulty_monotonicity_with_again_rate():
    # As recent again rate increases, score must not decrease
    card = {"reps": 10, "lapses": 2, "interval": 20}
    revs_good = [{"type": 1, "ease": 3, "time": 2000} for _ in range(5)]
    revs_mixed = [{"type": 1, "ease": 1, "time": 2000}] + [{"type": 1, "ease": 3, "time": 2000} for _ in range(4)]
    revs_again = [{"type": 1, "ease": 1, "time": 2000} for _ in range(5)]

    s_good, _ = compute_difficulty(card, revs_good)
    s_mixed, _ = compute_difficulty(card, revs_mixed)
    s_again, _ = compute_difficulty(card, revs_again)

    assert s_good <= s_mixed <= s_again


def test_compute_difficulty_leech_label():
    # Threshold is 8 lapses
    card_leech = {"reps": 15, "lapses": 8, "interval": 5}
    score, label = compute_difficulty(card_leech, [])
    assert label == "leech"

    # Or explicit tag:leech
    card_tagged = {"reps": 5, "lapses": 2, "interval": 10, "is_leech": True}
    score2, label2 = compute_difficulty(card_tagged, [])
    assert label2 == "leech"


def test_compute_difficulty_solid_label():
    # Low score (<10) and interval >= 21
    card_solid = {"reps": 20, "lapses": 0, "interval": 120}
    revs_good = [{"type": 1, "ease": 4, "time": 1000} for _ in range(10)]
    score, label = compute_difficulty(card_solid, revs_good)
    assert score is not None and score < 10.0
    assert label == "solid"


def test_compute_difficulty_fsrs_blend():
    card = {"reps": 10, "lapses": 2, "interval": 15, "fsrs_difficulty": 8.0}
    score, label = compute_difficulty(card, [])
    assert score is not None
    assert 0.0 <= score <= 100.0


# ---------------------------------------------------------------------------
# compute_due_days tests
# ---------------------------------------------------------------------------

def test_compute_due_days_mapping():
    due_map = {101: 0, 102: 5, 103: -1}
    assert compute_due_days(101, due_map) == 0
    assert compute_due_days(102, due_map) == 5
    assert compute_due_days(103, due_map) == -1
    assert compute_due_days(999, due_map) is None


# ---------------------------------------------------------------------------
# build_daily_series hand-computed fixture test
# ---------------------------------------------------------------------------

def test_build_daily_series_hand_computed():
    # Rollover hour is 4 am.
    # 2026-01-01 02:00 UTC with 4am rollover -> belongs to 2025-12-31
    # 2026-01-01 12:00 UTC with 4am rollover -> belongs to 2026-01-01
    dt_birth = int(datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)
    cards = [{"card_id": dt_birth}]

    reviews = [
        # Review on 2026-01-01 14:00 (type=0 learn, ivl=-60, button=3)
        {
            "id": int(datetime(2026, 1, 1, 14, 0, tzinfo=timezone.utc).timestamp() * 1000),
            "cardId": dt_birth,
            "type": 0,
            "ivl": -60,
            "lastIvl": 0,
            "ease": 3,
            "time": 2500,
        },
        # Review on 2026-01-02 10:00 (type=1 review, ivl=5 young, button=3)
        {
            "id": int(datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc).timestamp() * 1000),
            "cardId": dt_birth,
            "type": 1,
            "ivl": 5,
            "lastIvl": 1,
            "ease": 3,
            "time": 3000,
        },
        # Cram review on 2026-01-02 12:00 (type=3 cram -> ignored for retention math)
        {
            "id": int(datetime(2026, 1, 2, 12, 0, tzinfo=timezone.utc).timestamp() * 1000),
            "cardId": dt_birth,
            "type": 3,
            "ivl": 5,
            "lastIvl": 5,
            "ease": 1,
            "time": 1000,
        },
        # Review on 2026-01-07 10:00 (type=1 review, ivl=25 mature, button=3)
        {
            "id": int(datetime(2026, 1, 7, 10, 0, tzinfo=timezone.utc).timestamp() * 1000),
            "cardId": dt_birth,
            "type": 1,
            "ivl": 25,
            "lastIvl": 5,
            "ease": 3,
            "time": 2000,
        },
    ]

    series = build_daily_series(cards, reviews, rollover_hour=4)
    assert len(series) >= 7

    by_day = {entry["day"]: entry for entry in series}

    # Day 1 (2026-01-01)
    d1 = by_day["2026-01-01"]
    assert d1["new_cards_added"] == 1
    assert d1["total_cards"] == 1
    assert d1["reviews"] == 1
    # Type 0 does not count towards true retention
    assert d1["true_retention_den"] == 0
    # Negative ivl means learning
    assert d1["n_learning"] == 1

    # Day 2 (2026-01-02)
    d2 = by_day["2026-01-02"]
    assert d2["reviews"] == 2  # 1 review + 1 cram
    # Only type == 1 counted for retention (the 1 review), cram (type=3) ignored
    assert d2["true_retention_den"] == 1
    assert d2["true_retention_num"] == 1
    assert d2["n_young"] == 1  # ivl 5 is young (< 21)

    # Day 7 (2026-01-07)
    d7 = by_day["2026-01-07"]
    assert d7["n_mature"] == 1  # ivl 25 is mature (>= 21)
    assert d7["true_retention_den"] == 1
    assert d7["true_retention_num"] == 1
    # lastIvl was 5 (< 21), so mature_retention_den is 0
    assert d7["mature_retention_den"] == 0
