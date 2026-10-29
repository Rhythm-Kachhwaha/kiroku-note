import sqlite3

from app.services.grammar_tracker import GrammarTrackerService


def test_tracker_upserts_statuses_stats_and_cascade_delete(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")
    first = tracker.record_encounter(
        "てしまう", "〜てしまう", "食べてしまった。", "text", level="N4"
    )
    second = tracker.record_encounter(
        "てしまう", "〜てしまう", "忘れてしまった。", "text", level="N4"
    )
    assert first["seen_count"] == 1
    assert second["seen_count"] == 2
    assert tracker.update_point_status("てしまう", "known")["status"] == "known"
    stats = tracker.get_stats()
    assert stats["counts_by_level"]["N4"]["known"] == 1
    assert stats["coverage"]["N4"]["known"] == 1
    assert stats["seen_count_total"] == 2
    assert stats["recent_encounters"]

    with sqlite3.connect(tracker.db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM grammar_points WHERE pattern_key = ?", ("てしまう",))
        assert connection.execute(
            "SELECT count(*) FROM grammar_encounters WHERE pattern_key = ?", ("てしまう",)
        ).fetchone()[0] == 0


def test_tracker_points_search_and_pagination(tmp_path):
    tracker = GrammarTrackerService(tmp_path / "grammar.sqlite")
    for key in ("てしまう", "ておく", "らしい"):
        tracker.record_encounter(key, key, f"{key}。", "text", level="N4")
    assert len(tracker.get_points(search="て", limit=1)) == 1
    assert len(tracker.get_points(search="て", limit=100, offset=1)) == 1
