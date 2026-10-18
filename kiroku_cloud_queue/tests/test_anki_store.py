"""
test_anki_store.py -- Unit tests for Anki mirror and study storage methods.
Tests SqliteQueueStore and (conditionally) PostgresQueueStore.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
import pytest

from queue_store import SqliteQueueStore, BaseQueueStore


def _sample_card(card_id: int, expression: str = "日本語", **kwargs) -> dict:
    base = {
        "card_id": card_id,
        "note_id": 1000 + card_id,
        "deck_name": "Japanese::Vocab",
        "model_name": "Kiroku Note",
        "expression": expression,
        "reading": "にほんご",
        "meaning": "Japanese language",
        "sentence": "日本語を勉強します。",
        "sentence_meaning": "I study Japanese.",
        "jlpt_level": "N3",
        "state": "young",
        "queue_code": 2,
        "interval_days": 10,
        "reps": 5,
        "lapses": 1,
        "again_count_10": 1,
        "reviews_10": 5,
        "again_rate_10": 0.2,
        "avg_time_ms": 4200,
        "difficulty_score": 45.0,
        "difficulty_label": "normal",
        "is_leech": False,
        "fsrs_difficulty": None,
        "fsrs_stability": None,
        "fsrs_retrievability": None,
        "due_in_days": 3,
        "created_at": "2026-01-01T00:00:00Z",
        "first_review_at": "2026-01-02T00:00:00Z",
        "last_review_at": "2026-01-10T00:00:00Z",
        "mod_at": "2026-01-10T00:00:00Z",
        "synced_at": "2026-01-10T12:00:00Z",
    }
    base.update(kwargs)
    return base


def _sample_daily(day: str = "2026-01-10", **kwargs) -> dict:
    base = {
        "day": day,
        "reviews": 25,
        "again": 2,
        "hard": 3,
        "good": 18,
        "easy": 2,
        "time_ms": 120000,
        "true_retention_num": 18,
        "true_retention_den": 20,
        "mature_retention_num": 8,
        "mature_retention_den": 9,
        "new_cards_added": 5,
        "total_cards": 100,
        "n_new": 10,
        "n_learning": 5,
        "n_young": 35,
        "n_mature": 50,
        "n_suspended": 0,
        "synced_at": "2026-01-10T12:00:00Z",
    }
    base.update(kwargs)
    return base


@pytest.fixture
def sqlite_store(tmp_path) -> SqliteQueueStore:
    db_file = str(tmp_path / "test_anki_queue.db")
    store = SqliteQueueStore(db_path=db_file)
    yield store


def test_sqlite_upsert_and_get_card(sqlite_store: SqliteQueueStore):
    card1 = _sample_card(101, expression="食べる", meaning="to eat")
    inserted = sqlite_store.upsert_anki_cards([card1])
    assert inserted == 1

    fetched = sqlite_store.get_anki_card(101)
    assert fetched is not None
    assert fetched["card_id"] == 101
    assert fetched["expression"] == "食べる"
    assert fetched["meaning"] == "to eat"
    assert fetched["difficulty_score"] == 45.0
    assert fetched["is_leech"] is False

    # Update on conflict
    card1_updated = _sample_card(101, expression="食べる", meaning="to eat (updated)", reps=6)
    inserted2 = sqlite_store.upsert_anki_cards([card1_updated])
    assert inserted2 == 1
    fetched2 = sqlite_store.get_anki_card(101)
    assert fetched2["meaning"] == "to eat (updated)"
    assert fetched2["reps"] == 6


def test_sqlite_upsert_empty(sqlite_store: SqliteQueueStore):
    assert sqlite_store.upsert_anki_cards([]) == 0
    assert sqlite_store.upsert_anki_daily([]) == 0


def test_sqlite_reconcile_and_study_cascade(sqlite_store: SqliteQueueStore):
    cards = [
        _sample_card(1, expression="一"),
        _sample_card(2, expression="二"),
        _sample_card(3, expression="三"),
    ]
    sqlite_store.upsert_anki_cards(cards)
    assert sqlite_store.query_anki_cards()[1] == 3

    # Add study state for card 3
    review_res = sqlite_store.record_study_review(card_id=3, rating=3)
    assert review_res is not None

    # Reconcile keeping only 1 and 2
    deleted = sqlite_store.reconcile_anki_cards([1, 2])
    assert deleted == 1

    items, total = sqlite_store.query_anki_cards()
    assert total == 2
    ids = [c["card_id"] for c in items]
    assert 3 not in ids
    assert 1 in ids and 2 in ids

    # Check that orphaned study state for card 3 was cleaned
    summary = sqlite_store.get_study_summary()
    assert summary["hardest_cloud_cards"] == []


def test_sqlite_query_filters_and_like_escaping(sqlite_store: SqliteQueueStore):
    cards = [
        _sample_card(1, expression="100%満足", meaning="100% satisfied", jlpt_level="N2", state="mature"),
        _sample_card(2, expression="テスト_1", meaning="test underscore", jlpt_level="N3", state="young"),
        _sample_card(3, expression="普通", meaning="regular", jlpt_level="N4", state="young"),
    ]
    sqlite_store.upsert_anki_cards(cards)

    # Literal % search
    items, total = sqlite_store.query_anki_cards(filters={"q": "100%"})
    assert total == 1
    assert items[0]["card_id"] == 1

    # Literal _ search
    items, total = sqlite_store.query_anki_cards(filters={"q": "テスト_"})
    assert total == 1
    assert items[0]["card_id"] == 2

    # JLPT filter
    items, total = sqlite_store.query_anki_cards(filters={"jlpt": "N3"})
    assert total == 1
    assert items[0]["card_id"] == 2

    # State filter
    items, total = sqlite_store.query_anki_cards(filters={"state": "mature"})
    assert total == 1
    assert items[0]["card_id"] == 1


def test_sqlite_sort_whitelist_and_rejection(sqlite_store: SqliteQueueStore):
    card1 = _sample_card(1, difficulty_score=80.0, lapses=5)
    card2 = _sample_card(2, difficulty_score=20.0, lapses=1)
    sqlite_store.upsert_anki_cards([card1, card2])

    items, total = sqlite_store.query_anki_cards(sort="difficulty", dir="asc")
    assert items[0]["card_id"] == 2
    assert items[1]["card_id"] == 1

    items, total = sqlite_store.query_anki_cards(sort="difficulty", dir="desc")
    assert items[0]["card_id"] == 1
    assert items[1]["card_id"] == 2

    # Invalid sort column must raise ValueError
    with pytest.raises(ValueError, match="Invalid sort column"):
        sqlite_store.query_anki_cards(sort="drop_table_users")


def test_sqlite_pagination(sqlite_store: SqliteQueueStore):
    cards = [_sample_card(i, expression=f"単語{i}", created_at=f"2026-01-{i:02d}T00:00:00Z") for i in range(1, 11)]
    sqlite_store.upsert_anki_cards(cards)

    items, total = sqlite_store.query_anki_cards(limit=4, offset=0, sort="created", dir="asc")
    assert total == 10
    assert len(items) == 4
    assert items[0]["card_id"] == 1

    items_page2, _ = sqlite_store.query_anki_cards(limit=4, offset=4, sort="created", dir="asc")
    assert len(items_page2) == 4
    assert items_page2[0]["card_id"] == 5


def test_sqlite_daily_and_stats_overview(sqlite_store: SqliteQueueStore):
    # Empty overview returns valid empty structures
    empty_overview = sqlite_store.get_stats_overview()
    assert "card_growth" in empty_overview
    assert "state_breakdown" in empty_overview
    assert "true_retention" in empty_overview
    assert "answer_buttons" in empty_overview
    assert "due_forecast" in empty_overview
    assert "difficulty_distribution" in empty_overview
    assert "weak_words" in empty_overview
    assert "jlpt_coverage" in empty_overview

    today = datetime.now().date()
    d1 = (today - timedelta(days=2)).isoformat()
    d2 = (today - timedelta(days=1)).isoformat()
    days = [
        _sample_daily(d1, total_cards=50, n_mature=20, n_young=20, n_learning=5, n_new=5),
        _sample_daily(d2, total_cards=55, n_mature=22, n_young=23, n_learning=5, n_new=5),
    ]
    sqlite_store.upsert_anki_daily(days)

    cards = [
        _sample_card(1, expression="困難", difficulty_score=85.0, difficulty_label="leech", is_leech=True, due_in_days=0),
        _sample_card(2, expression="簡単", difficulty_score=15.0, difficulty_label="easy", is_leech=False, due_in_days=5),
    ]
    sqlite_store.upsert_anki_cards(cards)

    overview = sqlite_store.get_stats_overview(range_key="30d")
    assert len(overview["card_growth"]) == 2
    assert len(overview["state_breakdown"]) == 2
    assert len(overview["weak_words"]) == 2
    assert overview["weak_words"][0]["card_id"] == 1  # higher difficulty first


def test_sqlite_meta_and_status(sqlite_store: SqliteQueueStore):
    status_empty = sqlite_store.get_anki_status()
    assert status_empty["card_count"] == 0
    assert status_empty["synced_at"] is None

    sqlite_store.set_anki_meta("last_mirror_sync_at", "2026-01-10T12:00:00Z")
    sqlite_store.set_anki_meta("last_full_reconcile_at", "2026-01-10T11:00:00Z")
    sqlite_store.upsert_anki_cards([_sample_card(1)])

    status = sqlite_store.get_anki_status()
    assert status["card_count"] == 1
    assert status["synced_at"] == "2026-01-10T12:00:00Z"
    assert status["last_reconcile_at"] == "2026-01-10T11:00:00Z"


def test_sqlite_study_leitner_lifecycle(sqlite_store: SqliteQueueStore):
    card = _sample_card(1, difficulty_score=75.0, difficulty_label="hard")
    sqlite_store.upsert_anki_cards([card])

    # Initial session fetch
    session_cards = sqlite_store.get_study_session(mode="weakest", limit=10)
    assert len(session_cards) == 1
    assert session_cards[0]["card_id"] == 1

    # Rate Good (3): moves to box 2
    res = sqlite_store.record_study_review(card_id=1, rating=3, time_ms=3000, session_id="s1")
    assert res["box"] == 2
    assert res["streak"] == 1
    assert res["times_seen"] == 1

    # Rate Good again: moves to box 3
    res2 = sqlite_store.record_study_review(card_id=1, rating=3, time_ms=2500, session_id="s1")
    assert res2["box"] == 3
    assert res2["streak"] == 2

    # Rate Again (1): drops back to box 1
    res3 = sqlite_store.record_study_review(card_id=1, rating=1, time_ms=4000, session_id="s1")
    assert res3["box"] == 1
    assert res3["streak"] == 0
    assert res3["again_count"] == 1

    # Idempotent double tap with review_uuid
    res4 = sqlite_store.record_study_review(card_id=1, rating=1, review_uuid="uuid-dup-test")
    res5 = sqlite_store.record_study_review(card_id=1, rating=1, review_uuid="uuid-dup-test")
    assert res4["box"] == res5["box"]
    assert res4["times_seen"] == res5["times_seen"]

    summary = sqlite_store.get_study_summary()
    assert summary["practiced_today"] >= 1
    assert summary["box_distribution"]["box_1"] == 1


def test_postgres_store_skipped_or_run():
    test_pg_url = os.getenv("TEST_DATABASE_URL")
    if not test_pg_url:
        pytest.skip("TEST_DATABASE_URL not set; skipping PostgresQueueStore live integration test.")
    from postgres_store import PostgresQueueStore
    pg_store = PostgresQueueStore(test_pg_url)
    try:
        pg_store.init_db()
        card = _sample_card(999, expression="テストPG")
        assert pg_store.upsert_anki_cards([card]) == 1
        fetched = pg_store.get_anki_card(999)
        assert fetched is not None
        assert fetched["expression"] == "テストPG"
        assert pg_store.reconcile_anki_cards([]) >= 1
    finally:
        pg_store.close()
