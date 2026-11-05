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


def test_tracker_migrates_combined_keys_idempotently(tmp_path):
    db_file = tmp_path / "grammar.sqlite"
    tracker = GrammarTrackerService(db_file)

    # Insert legacy combined rows
    with sqlite3.connect(db_file) as conn:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute(
            """INSERT INTO grammar_points (pattern_key, display, level, status, seen_count, first_seen_at, last_seen_at)
               VALUES ('てしまう / ちゃう', '〜てしまう / 〜ちゃう', 'N4', 'learning', 3, '2026-01-01T00:00:00', '2026-01-02T00:00:00')"""
        )
        conn.execute(
            """INSERT INTO grammar_encounters (pattern_key, sentence, source, created_at)
               VALUES ('てしまう / ちゃう', '忘れてしまう。', 'text', '2026-01-01T00:00:00')"""
        )
        conn.commit()

    # Run migration
    migrated = tracker.migrate_legacy_keys()
    assert migrated == 1

    with sqlite3.connect(db_file) as conn:
        old_point = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = 'てしまう / ちゃう'").fetchone()
        assert old_point is None, "Old combined key should be removed"

        canonical = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = 'てしまう'").fetchone()
        assert canonical is not None, "Canonical key should exist"
        assert canonical[3] == "learning"  # status
        assert canonical[4] == 3  # seen_count

        encounters = conn.execute("SELECT * FROM grammar_encounters WHERE pattern_key = 'てしまう'").fetchall()
        assert len(encounters) == 1
        assert encounters[0][2] == "忘れてしまう。"

    # Idempotent second run
    migrated_again = tracker.migrate_legacy_keys()
    assert migrated_again == 0
