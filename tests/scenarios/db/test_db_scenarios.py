"""
Hardening scenarios for db module.
Tests boundary contracts of backend/app/db/connection.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import pytest

from app.db.connection import (
    db_session,
    ensure_cloud_sync_tables,
    get_db_connection,
    init_db,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_s01_fresh_db_bootstrap(tmp_path: Path):
    """S01: Fresh DB bootstrap creates all core tables, indexes, and default deck_settings."""
    db_file = tmp_path / "fresh.db"
    assert not db_file.exists()

    init_db(db_file)
    assert db_file.exists()

    with db_session(db_file) as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        expected_tables = {
            "cards",
            "known_words",
            "grammar_points",
            "grammar_encounters",
            "grammar_drill_results",
            "unresolved_tokens",
            "word_states",
            "word_encounters",
            "word_categories",
            "vocab_practice_results",
            "word_sets",
            "word_set_items",
            "study_burst_sessions",
            "study_burst_attempts",
            "user_kanji_compounds",
            "card_fsrs",
            "review_logs",
            "deck_settings",
            "card_cloud_sync",
            "deleted_cards",
            "cloud_sync_meta",
        }
        missing = expected_tables - tables
        assert not missing, f"Missing expected tables: {missing}"

        # Default deck_settings row must be seeded
        row = conn.execute(
            "SELECT * FROM deck_settings WHERE deck_name = 'Default'"
        ).fetchone()
        assert row is not None
        assert row["new_cards_per_day"] == 20
        assert row["desired_retention"] == 0.90


def test_s02_idempotent_init(tmp_path: Path):
    """S02: Calling init_db multiple times preserves data and does not duplicate schema."""
    db_file = tmp_path / "idempotent.db"
    init_db(db_file)

    now = _iso_now()
    with db_session(db_file) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("猫", "ねこ", "猫", "ねこ", "default", now, now),
        )
        conn.commit()

    # Second init_db run
    init_db(db_file)

    with db_session(db_file) as conn:
        card = conn.execute("SELECT * FROM cards WHERE expression = '猫'").fetchone()
        assert card is not None
        assert card["reading"] == "ねこ"

        # Check table count does not duplicate
        tables = conn.execute(
            "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='cards'"
        ).fetchone()
        assert tables["cnt"] == 1


def test_s03_transaction_rollback(tmp_path: Path):
    """S03: Exception inside db_session triggers rollback of all uncommitted writes."""
    db_file = tmp_path / "rollback.db"
    init_db(db_file)

    now = _iso_now()
    with pytest.raises(RuntimeError, match="simulated failure"):
        with db_session(db_file) as conn:
            conn.execute(
                """
                INSERT INTO known_words (word, created_at)
                VALUES (?, ?)
                """,
                ("犬", now),
            )
            raise RuntimeError("simulated failure")

    with db_session(db_file) as conn:
        row = conn.execute("SELECT * FROM known_words WHERE word = '犬'").fetchone()
        assert row is None, "Row should have been rolled back"


def test_s04_foreign_keys_and_cascades(tmp_path: Path):
    """S04: Foreign keys reject invalid parents and cascade on parent deletion."""
    db_file = tmp_path / "fk.db"
    init_db(db_file)

    now = _iso_now()
    # Inserting child with invalid foreign key card_id must fail
    with pytest.raises(sqlite3.IntegrityError):
        with db_session(db_file) as conn:
            conn.execute(
                """
                INSERT INTO card_fsrs (card_id, state, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (99999, 0, now, now),
            )

    # Insert valid card and dependent child rows
    card_id: int
    with db_session(db_file) as conn:
        cur = conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("食べる", "たべる", "食べる", "たべる", "default", now, now),
        )
        card_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO card_fsrs (card_id, state, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (card_id, 1, now, now),
        )
        conn.execute(
            """
            INSERT INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
            VALUES (?, ?, ?)
            """,
            (card_id, "op_123", now),
        )
        conn.commit()

    # Verify children exist
    with db_session(db_file) as conn:
        assert conn.execute("SELECT * FROM card_fsrs WHERE card_id = ?", (card_id,)).fetchone() is not None
        assert conn.execute("SELECT * FROM card_cloud_sync WHERE card_id = ?", (card_id,)).fetchone() is not None

        # Delete parent card
        conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        conn.commit()

        # Children must be automatically deleted by cascade
        assert conn.execute("SELECT * FROM card_fsrs WHERE card_id = ?", (card_id,)).fetchone() is None
        assert conn.execute("SELECT * FROM card_cloud_sync WHERE card_id = ?", (card_id,)).fetchone() is None


def test_s05_composite_uniqueness(tmp_path: Path):
    """S05: Composite uniqueness on cards prevents duplicate identity inserts."""
    db_file = tmp_path / "unique.db"
    init_db(db_file)

    now = _iso_now()
    with db_session(db_file) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("本", "ほん", "本", "ほん", "default", now, now),
        )
        conn.commit()

    # Attempting to insert duplicate identity must fail
    with pytest.raises(sqlite3.IntegrityError):
        with db_session(db_file) as conn:
            conn.execute(
                """
                INSERT INTO cards (
                    expression, reading, normalized_expression, normalized_reading,
                    normalized_deck_name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("本", "ほん", "本", "ほん", "default", now, now),
            )


def test_s06_connection_pragmas(tmp_path: Path):
    """S06: get_db_connection configures foreign keys, WAL mode, busy timeout, and Row factory."""
    db_file = tmp_path / "pragmas.db"
    conn = get_db_connection(db_file)
    try:
        fk = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
        assert fk == 1, "Foreign keys must be enabled"

        journal = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert journal.lower() == "wal", "Journal mode must be WAL"

        timeout = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert timeout == 10000, "Busy timeout must be 10000ms"

        # Check row factory gives dict-accessible keys
        row = conn.execute("SELECT 1 AS test_col, 'val' AS test_name;").fetchone()
        assert row["test_col"] == 1
        assert row["test_name"] == "val"
    finally:
        conn.close()


def test_s07_unicode_and_emoji_roundtrip(tmp_path: Path):
    """S07: Multi-byte Japanese characters and emojis round-trip without corruption."""
    db_file = tmp_path / "unicode.db"
    init_db(db_file)

    now = _iso_now()
    complex_expression = "桜 🍵 🇯🇵 🌸 食べる「美味しい！」"
    complex_meaning = "Cherry blossoms & tea & flag: delicious ✨ 素晴らしい"

    with db_session(db_file) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, meaning, normalized_expression,
                normalized_reading, normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                complex_expression,
                "さくら",
                complex_meaning,
                complex_expression,
                "さくら",
                "default",
                now,
                now,
            ),
        )
        conn.commit()

    with db_session(db_file) as conn:
        row = conn.execute(
            "SELECT expression, meaning FROM cards WHERE reading = 'さくら'"
        ).fetchone()
        assert row is not None
        assert row["expression"] == complex_expression
        assert row["meaning"] == complex_meaning


def test_s08_interrupted_sync_recovery(tmp_path: Path):
    """S08: Cards left in 'syncing' status are recovered to 'pending' on init_db."""
    db_file = tmp_path / "recovery.db"
    init_db(db_file)

    now = _iso_now()
    with db_session(db_file) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, sync_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'syncing', ?, ?)
            """,
            ("走る", "はしる", "走る", "はしる", "default", now, now),
        )
        conn.commit()

    # Verify status is currently 'syncing'
    with db_session(db_file) as conn:
        row = conn.execute("SELECT sync_status FROM cards WHERE expression = '走る'").fetchone()
        assert row["sync_status"] == "syncing"

    # Re-run init_db to simulate app restart after crash/interruption
    init_db(db_file)

    with db_session(db_file) as conn:
        row = conn.execute("SELECT sync_status FROM cards WHERE expression = '走る'").fetchone()
        assert row["sync_status"] == "pending", "Interrupted sync status must be recovered to pending"


def test_s09_concurrent_readers_writers_wal(tmp_path: Path):
    """S09: WAL mode enables concurrent readers without locking out during write transactions."""
    db_file = tmp_path / "concurrent.db"
    init_db(db_file)

    now = _iso_now()
    writer = get_db_connection(db_file)
    reader = get_db_connection(db_file)

    try:
        # Initial read from reader
        count_before = reader.execute("SELECT count(*) as cnt FROM cards;").fetchone()["cnt"]
        assert count_before == 0

        # Writer starts transaction and inserts a row without commit
        writer.execute("BEGIN IMMEDIATE;")
        writer.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("空", "そら", "空", "そら", "default", now, now),
        )

        # Reader reads concurrently without blocking
        count_during = reader.execute("SELECT count(*) as cnt FROM cards;").fetchone()["cnt"]
        assert count_during == 0, "Reader should read snapshot isolation before writer commit"

        # Writer commits
        writer.commit()

        # Reader now sees the committed row
        count_after = reader.execute("SELECT count(*) as cnt FROM cards;").fetchone()["cnt"]
        assert count_after == 1
    finally:
        writer.close()
        reader.close()


def test_s10_corrupted_file_handling(tmp_path: Path):
    """S10: Corrupted SQLite database files raise a descriptive RuntimeError."""
    corrupt_file = tmp_path / "corrupted.db"
    # Write invalid header bytes
    corrupt_file.write_bytes(b"NOT A SQLITE DATABASE FILE GARBAGE HEADER 1234567890")

    with pytest.raises(RuntimeError) as exc_info:
        get_db_connection(corrupt_file)

    msg = str(exc_info.value).lower()
    assert "failed to initialize sqlite connection" in msg or "corrupted" in msg


def test_s11_db_session_autocommit_on_clean_exit(tmp_path: Path):
    """S11: db_session automatically commits uncommitted writes on clean exit."""
    db_file = tmp_path / "autocommit.db"
    init_db(db_file)

    now = _iso_now()
    # Execute write WITHOUT explicit conn.commit()
    with db_session(db_file) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("約束", "やくそく", "約束", "やくそく", "default", now, now),
        )
        # Note: intentionally NO conn.commit() here

    # Verify with independent connection that write persisted
    reader = get_db_connection(db_file)
    try:
        row = reader.execute("SELECT * FROM cards WHERE expression = '約束'").fetchone()
        assert row is not None, "Data lost: db_session must automatically commit on clean exit"
        assert row["reading"] == "やくそく"
    finally:
        reader.close()


def test_s12_ensure_cloud_sync_tables_on_empty_db():
    """S12: ensure_cloud_sync_tables executes safely on a standalone connection without crashing."""
    conn = sqlite3.connect(":memory:")
    try:
        # Calling ensure_cloud_sync_tables before cards table exists should not crash
        ensure_cloud_sync_tables(conn)
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "card_cloud_sync" in tables
        assert "deleted_cards" in tables
        assert "cloud_sync_meta" in tables
    finally:
        conn.close()


