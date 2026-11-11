"""SQLite database connection and schema initialization."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from typing import Any, Iterator, Sequence

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
CREATE TABLE IF NOT EXISTS unresolved_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    surface TEXT NOT NULL,
    reading TEXT NOT NULL DEFAULT '',
    normalized_form TEXT NOT NULL DEFAULT '',
    proposed_lemma TEXT NOT NULL DEFAULT '',
    sentence TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unresolved_tokens_created
    ON unresolved_tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unresolved_tokens_surface
    ON unresolved_tokens(surface, proposed_lemma);
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
                # Best-effort cleanup; the original connection error is raised below.
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


def migrate_canonical_grammar_keys(conn: sqlite3.Connection) -> int:
    """Migrate legacy combined pattern keys (e.g. 'てしまう / ちゃう') to canonical first alternative."""
    try:
        rows = conn.execute("SELECT * FROM grammar_points WHERE pattern_key LIKE '%/%'").fetchall()
    except sqlite3.DatabaseError:
        return 0
    if not rows:
        return 0
    migrated_count = 0
    status_ranks = {"known": 3, "learning": 2, "new": 1, "ignored": 0}
    for row in rows:
        old_key = row["pattern_key"]
        canonical_key = old_key.split("/")[0].strip()
        if not canonical_key or canonical_key == old_key:
            continue
        existing_canonical = conn.execute(
            "SELECT * FROM grammar_points WHERE pattern_key = ?", (canonical_key,)
        ).fetchone()
        if existing_canonical:
            old_rank = status_ranks.get(row["status"], 1)
            cur_rank = status_ranks.get(existing_canonical["status"], 1)
            merged_status = row["status"] if old_rank > cur_rank else existing_canonical["status"]
            merged_count = existing_canonical["seen_count"] + row["seen_count"]
            first_seen = min(existing_canonical["first_seen_at"], row["first_seen_at"])
            last_seen = max(existing_canonical["last_seen_at"], row["last_seen_at"])
            card_id = existing_canonical["card_id"] or row["card_id"]
            conn.execute(
                """UPDATE grammar_points SET status=?, seen_count=?, first_seen_at=?, last_seen_at=?, card_id=?
                   WHERE pattern_key=?""",
                (merged_status, merged_count, first_seen, last_seen, card_id, canonical_key),
            )
        else:
            conn.execute(
                """INSERT INTO grammar_points (pattern_key, display, level, status, seen_count, first_seen_at, last_seen_at, card_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    canonical_key,
                    row["display"],
                    row["level"],
                    row["status"],
                    row["seen_count"],
                    row["first_seen_at"],
                    row["last_seen_at"],
                    row["card_id"],
                ),
            )
        conn.execute(
            "UPDATE grammar_encounters SET pattern_key = ? WHERE pattern_key = ?",
            (canonical_key, old_key),
        )
        conn.execute("DELETE FROM grammar_points WHERE pattern_key = ?", (old_key,))
        migrated_count += 1
    try:
        orphan_encounters = conn.execute(
            "SELECT DISTINCT pattern_key FROM grammar_encounters WHERE pattern_key LIKE '%/%'"
        ).fetchall()
        for enc in orphan_encounters:
            old_k = enc["pattern_key"]
            canon = old_k.split("/")[0].strip()
            if canon and canon != old_k:
                conn.execute(
                    "UPDATE grammar_encounters SET pattern_key = ? WHERE pattern_key = ?",
                    (canon, old_k),
                )
    except sqlite3.DatabaseError:
        pass
    conn.commit()
    return migrated_count


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
        conn.execute("DROP TABLE IF EXISTS extension_token")
        migrate_canonical_grammar_keys(conn)
        conn.commit()


_UNRESOLVED_TOKENS_DDL = """
CREATE TABLE IF NOT EXISTS unresolved_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    surface TEXT NOT NULL,
    reading TEXT NOT NULL DEFAULT '',
    normalized_form TEXT NOT NULL DEFAULT '',
    proposed_lemma TEXT NOT NULL DEFAULT '',
    sentence TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unresolved_tokens_created
    ON unresolved_tokens(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unresolved_tokens_surface
    ON unresolved_tokens(surface, proposed_lemma);
"""


def ensure_unresolved_tokens_table(conn: sqlite3.Connection) -> None:
    """Safely ensure the unresolved_tokens table exists on an open connection."""
    conn.executescript(_UNRESOLVED_TOKENS_DDL)


def record_unresolved_token(
    surface: str,
    *,
    reading: str = "",
    normalized_form: str = "",
    proposed_lemma: str = "",
    sentence: str = "",
    source: str = "",
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
) -> int | None:
    """Persist a single OOV/unresolved token entry and return its row id."""
    clean_surface = (surface or "").strip()
    if not clean_surface:
        return None
    now_utc = datetime.now(timezone.utc).isoformat()
    params = (
        clean_surface,
        str(reading or ""),
        str(normalized_form or ""),
        str(proposed_lemma or ""),
        str(sentence or ""),
        str(source or ""),
        now_utc,
    )
    if conn is not None:
        ensure_unresolved_tokens_table(conn)
        cur = conn.execute(
            """
            INSERT INTO unresolved_tokens (
                surface, reading, normalized_form, proposed_lemma, sentence, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            params,
        )
        conn.commit()
        return cur.lastrowid

    with db_session(db_path) as session_conn:
        ensure_unresolved_tokens_table(session_conn)
        cur = session_conn.execute(
            """
            INSERT INTO unresolved_tokens (
                surface, reading, normalized_form, proposed_lemma, sentence, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            params,
        )
        session_conn.commit()
        return cur.lastrowid


def record_unresolved_tokens(
    tokens: Sequence[Any],
    *,
    sentence: str = "",
    source: str = "",
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Batch-persist unresolved Morpheme or dict entries and return inserted count."""
    now_utc = datetime.now(timezone.utc).isoformat()
    rows: list[tuple[str, str, str, str, str, str, str]] = []
    for tok in tokens:
        if isinstance(tok, dict):
            surface = str(tok.get("surface") or "").strip()
            reading = str(tok.get("reading") or "")
            normalized_form = str(tok.get("normalized_form") or tok.get("normalized") or "")
            proposed_lemma = str(tok.get("proposed_lemma") or tok.get("lemma") or "")
        else:
            surface = str(getattr(tok, "surface", "") or "").strip()
            reading = str(getattr(tok, "reading", "") or "")
            normalized_form = str(getattr(tok, "normalized", "") or "")
            proposed_lemma = str(getattr(tok, "lemma", "") or "")
        if not surface:
            continue
        rows.append((surface, reading, normalized_form, proposed_lemma, str(sentence or ""), str(source or ""), now_utc))

    if not rows:
        return 0

    sql = """
        INSERT INTO unresolved_tokens (
            surface, reading, normalized_form, proposed_lemma, sentence, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """
    if conn is not None:
        ensure_unresolved_tokens_table(conn)
        conn.executemany(sql, rows)
        conn.commit()
        return len(rows)

    with db_session(db_path) as session_conn:
        ensure_unresolved_tokens_table(session_conn)
        session_conn.executemany(sql, rows)
        session_conn.commit()
        return len(rows)


def list_unresolved_tokens(
    *,
    limit: int = 100,
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Return recent unresolved_tokens entries ordered newest-first."""
    sql = """
        SELECT id, surface, reading, normalized_form, proposed_lemma, sentence, source, created_at
        FROM unresolved_tokens
        ORDER BY id DESC
        LIMIT ?
    """
    if conn is not None:
        ensure_unresolved_tokens_table(conn)
        rows = conn.execute(sql, (limit,)).fetchall()
        return [dict(row) for row in rows]

    with db_session(db_path) as session_conn:
        ensure_unresolved_tokens_table(session_conn)
        rows = session_conn.execute(sql, (limit,)).fetchall()
        return [dict(row) for row in rows]
