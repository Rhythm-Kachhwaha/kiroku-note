"""SQLite database connection and schema initialization."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Iterator

from app.config import get_db_path

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expression TEXT NOT NULL,
    reading TEXT NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',
    hint TEXT NOT NULL DEFAULT '',
    example_sentence TEXT NOT NULL DEFAULT '',
    example_translation TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    audio TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    deinflected_text TEXT NOT NULL DEFAULT '',
    deck_name TEXT NOT NULL DEFAULT 'Default',
    model_name TEXT NOT NULL DEFAULT '',
    normalized_expression TEXT NOT NULL,
    normalized_reading TEXT NOT NULL,
    normalized_deck_name TEXT NOT NULL,
    meanings_json TEXT NOT NULL DEFAULT '[]',
    examples_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'saved',
    sync_status TEXT NOT NULL DEFAULT 'pending',
    anki_note_id INTEGER DEFAULT NULL,
    sync_error TEXT NOT NULL DEFAULT '',
    synced_at TEXT DEFAULT NULL,
    source_type TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    card_kind TEXT NOT NULL DEFAULT 'vocab',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(normalized_expression, normalized_reading, normalized_deck_name)
);

CREATE INDEX IF NOT EXISTS idx_cards_duplicate_identity
ON cards (normalized_expression, normalized_reading, normalized_deck_name);

CREATE TABLE IF NOT EXISTS known_words (
    word TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_known_words_created ON known_words (created_at);
CREATE TABLE IF NOT EXISTS grammar_cache (
    sentence_hash TEXT NOT NULL,
    index_version TEXT NOT NULL,
    grammar_dict_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sentence_hash, index_version, grammar_dict_hash)
);
CREATE TABLE IF NOT EXISTS grammar_points (
    pattern_key TEXT PRIMARY KEY,
    display TEXT NOT NULL,
    level TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    seen_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    card_id INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_grammar_points_status_level
    ON grammar_points(status, level, seen_count DESC);
CREATE TABLE IF NOT EXISTS grammar_encounters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_key TEXT NOT NULL,
    sentence TEXT NOT NULL,
    source TEXT NOT NULL,
    source_title TEXT,
    video_timestamp_ms INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(pattern_key) REFERENCES grammar_points(pattern_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_grammar_encounters_pattern
    ON grammar_encounters(pattern_key, created_at DESC);
"""



def get_db_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Create and configure a SQLite connection."""
    target_path = Path(db_path) if db_path is not None else get_db_path()
    if target_path != Path(":memory:"):
        target_path.parent.mkdir(parents=True, exist_ok=True)

    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(target_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        return conn
    except sqlite3.DatabaseError as err:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        raise RuntimeError(
            f"Failed to initialize SQLite connection to '{target_path}': {err}. "
            f"The database file may be corrupted or invalid."
        ) from err


@contextmanager
def db_session(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    """Context manager that ensures the SQLite connection is closed on exit."""
    conn = get_db_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()


def init_db(db_path: Path | str | None = None) -> None:
    """Initialize the SQLite database schema, run migrations, and recover interrupted syncs."""
    with db_session(db_path) as conn:
        conn.executescript(SCHEMA_SQL)
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(cards)").fetchall()]
        new_cols = [
            ("meaning", "TEXT NOT NULL DEFAULT ''"),
            ("hint", "TEXT NOT NULL DEFAULT ''"),
            ("example_sentence", "TEXT NOT NULL DEFAULT ''"),
            ("example_translation", "TEXT NOT NULL DEFAULT ''"),
            ("image", "TEXT NOT NULL DEFAULT ''"),
            ("audio", "TEXT NOT NULL DEFAULT ''"),
            ("tags", "TEXT NOT NULL DEFAULT ''"),
            ("notes", "TEXT NOT NULL DEFAULT ''"),
            ("model_name", "TEXT NOT NULL DEFAULT ''"),
            ("sync_status", "TEXT NOT NULL DEFAULT 'pending'"),
            ("anki_note_id", "INTEGER DEFAULT NULL"),
            ("sync_error", "TEXT NOT NULL DEFAULT ''"),
            ("synced_at", "TEXT DEFAULT NULL"),
            ("source_type", "TEXT NOT NULL DEFAULT ''"),
            ("source_url", "TEXT NOT NULL DEFAULT ''"),
            ("card_kind", "TEXT NOT NULL DEFAULT 'vocab'"),
        ]
        for col_name, col_def in new_cols:
            if col_name not in columns:
                conn.execute(f"ALTER TABLE cards ADD COLUMN {col_name} {col_def}")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cards_grammar_identity "
            "ON cards (expression, deck_name) WHERE card_kind = 'grammar'"
        )

        # Recover cards left stuck in 'syncing' state from a previously interrupted process
        conn.execute("UPDATE cards SET sync_status = 'pending' WHERE sync_status = 'syncing'")
        conn.commit()
