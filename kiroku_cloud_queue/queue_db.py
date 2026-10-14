"""
queue_db.py -- SQLite-backed queue for offline MCP card buffering.

Cards are written here when Kiroku is unreachable in local development.
The database file (mcp.db) lives inside kiroku_cloud_queue/ and is completely
separate from Kiroku's kiroku.db and the production queue store in cloud_queue.db.

Note on divergent schema vs queue_store.py:
  - queue_db.py uses INTEGER AUTOINCREMENT primary keys in `mcp.db` (local dev adapter).
  - queue_store.py uses UUID primary keys, idempotency keys, and leases in `cloud_queue.db` / Postgres.
  These two database files are intentionally isolated and must never point to the same file.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

# Always use a path local to this module, not the Kiroku data directory.
_DEFAULT_DB_PATH = Path(__file__).parent / "mcp.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS queued_cards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    expression TEXT    NOT NULL,
    reading    TEXT    NOT NULL DEFAULT '',
    meaning    TEXT    NOT NULL DEFAULT '',
    sentence   TEXT    NOT NULL DEFAULT '',
    deck_name  TEXT    NOT NULL DEFAULT 'N3 vocabs',
    status     TEXT    NOT NULL DEFAULT 'pending',
    error      TEXT    NOT NULL DEFAULT '',
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_status ON queued_cards (status);
"""

MAX_ATTEMPTS = 10  # give up after this many consecutive failures


@contextmanager
def _conn(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    path = Path(db_path) if db_path else _DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    try:
        yield conn
    finally:
        conn.close()


def init_queue(db_path: Path | str | None = None) -> None:
    """Initialise the queue schema. Safe to call multiple times."""
    with _conn(db_path) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def enqueue(
    expression: str,
    reading: str,
    meaning: str,
    sentence: str,
    deck_name: str = "N3 vocabs",
    db_path: Path | str | None = None,
) -> int:
    """
    Insert a new pending card, or return existing row ID if already pending (idempotency).
    """
    now = datetime.now(timezone.utc).isoformat()
    with _conn(db_path) as conn:
        existing = conn.execute(
            """
            SELECT id FROM queued_cards
            WHERE expression = ? AND reading = ? AND deck_name = ? AND status = 'pending'
            LIMIT 1
            """,
            (expression, reading, deck_name),
        ).fetchone()
        if existing:
            return int(existing["id"])

        cur = conn.execute(
            """
            INSERT INTO queued_cards
                (expression, reading, meaning, sentence, deck_name,
                 status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (expression, reading, meaning, sentence, deck_name, now, now),
        )
        conn.commit()
        return cur.lastrowid  # type: ignore[return-value]


def list_pending(
    limit: int = 50,
    db_path: Path | str | None = None,
) -> list[dict]:
    """Return pending cards that have not exceeded MAX_ATTEMPTS."""
    with _conn(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM queued_cards
            WHERE status = 'pending' AND attempts < ?
            ORDER BY id ASC
            LIMIT ?
            """,
            (MAX_ATTEMPTS, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_sent(row_id: int, db_path: Path | str | None = None) -> None:
    """Mark a queued card as successfully delivered."""
    now = datetime.now(timezone.utc).isoformat()
    with _conn(db_path) as conn:
        conn.execute(
            "UPDATE queued_cards SET status='sent', updated_at=? WHERE id=?",
            (now, row_id),
        )
        conn.commit()


def mark_failed(row_id: int, error: str, db_path: Path | str | None = None) -> None:
    """
    Increment attempt counter and record error message.
    Transitions status to 'failed' if attempts reach MAX_ATTEMPTS.
    """
    now = datetime.now(timezone.utc).isoformat()
    with _conn(db_path) as conn:
        row = conn.execute(
            "SELECT attempts FROM queued_cards WHERE id = ?",
            (row_id,),
        ).fetchone()
        current_attempts = row["attempts"] if row else 0
        new_attempts = current_attempts + 1
        new_status = "failed" if new_attempts >= MAX_ATTEMPTS else "pending"

        conn.execute(
            """
            UPDATE queued_cards
            SET attempts = ?,
                status   = ?,
                error    = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (new_attempts, new_status, error[:500], now, row_id),
        )
        conn.commit()



def queue_stats(db_path: Path | str | None = None) -> dict:
    """Return counts by status for diagnostics."""
    with _conn(db_path) as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM queued_cards GROUP BY status"
        ).fetchall()
    return {r["status"]: r["n"] for r in rows}
