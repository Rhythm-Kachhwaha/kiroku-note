"""
Link Video Session data models and state tracking.
"""
from __future__ import annotations

from datetime import datetime, timezone
import sqlite3
import time
from typing import Any, Dict, List, Optional

from app.db.connection import get_db_connection


SESSION_STAT_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS link_session_stat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    watch_seconds REAL NOT NULL DEFAULT 0.0,
    lines_seen INTEGER NOT NULL DEFAULT 0,
    words_mined INTEGER NOT NULL DEFAULT 0,
    gap_words_seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    series TEXT,
    episode_key TEXT
);
"""


def init_session_stat_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Ensure the link_session_stat table exists and has additive columns."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        conn.executescript(SESSION_STAT_SCHEMA_SQL)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(link_session_stat)")
        cols = [r[1] for r in cur.fetchall()]
        if "series" not in cols:
            conn.execute("ALTER TABLE link_session_stat ADD COLUMN series TEXT")
        if "episode_key" not in cols:
            conn.execute("ALTER TABLE link_session_stat ADD COLUMN episode_key TEXT")
        conn.commit()
    finally:
        if close_after:
            conn.close()


def save_session_stat(
    session_id: str = "",
    site: str = "",
    title: str = "",
    watch_seconds: float = 0.0,
    lines_seen: int = 0,
    words_mined: int = 0,
    gap_words_seen: int = 0,
    created_at: Optional[str] = None,
    series: Optional[str] = None,
    episode_key: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    """Persist session stat to link_session_stat."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        init_session_stat_db(conn)
        ts = created_at or datetime.now(timezone.utc).isoformat()
        cur = conn.execute(
            """
            INSERT INTO link_session_stat (
                session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, created_at, series, episode_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(session_id),
                str(site),
                str(title),
                float(watch_seconds),
                int(lines_seen),
                int(words_mined),
                int(gap_words_seen),
                ts,
                str(series) if series is not None else None,
                str(episode_key) if episode_key is not None else None,
            ),
        )
        conn.commit()
        stat_id = cur.lastrowid
        return {
            "id": stat_id,
            "session_id": str(session_id),
            "site": str(site),
            "title": str(title),
            "watch_seconds": float(watch_seconds),
            "lines_seen": int(lines_seen),
            "words_mined": int(words_mined),
            "gap_words_seen": int(gap_words_seen),
            "created_at": ts,
            "series": series,
            "episode_key": episode_key,
        }
    finally:
        if close_after:
            conn.close()


def list_session_stats(limit: int = 50, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    """Query recent session stats up to limit."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        init_session_stat_db(conn)
        cur = conn.execute(
            """
            SELECT id, session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, created_at, series, episode_key
            FROM link_session_stat
            ORDER BY id DESC
            LIMIT ?
            """,
            (max(1, min(limit, 500)),),
        )
        rows = cur.fetchall()
        return [
            {
                "id": row["id"] if isinstance(row, sqlite3.Row) else row[0],
                "session_id": row["session_id"] if isinstance(row, sqlite3.Row) else row[1],
                "site": row["site"] if isinstance(row, sqlite3.Row) else row[2],
                "title": row["title"] if isinstance(row, sqlite3.Row) else row[3],
                "watch_seconds": row["watch_seconds"] if isinstance(row, sqlite3.Row) else row[4],
                "lines_seen": row["lines_seen"] if isinstance(row, sqlite3.Row) else row[5],
                "words_mined": row["words_mined"] if isinstance(row, sqlite3.Row) else row[6],
                "gap_words_seen": row["gap_words_seen"] if isinstance(row, sqlite3.Row) else row[7],
                "created_at": row["created_at"] if isinstance(row, sqlite3.Row) else row[8],
                "series": row["series"] if isinstance(row, sqlite3.Row) else (row[9] if len(row) > 9 else None),
                "episode_key": row["episode_key"] if isinstance(row, sqlite3.Row) else (row[10] if len(row) > 10 else None),
            }
            for row in rows
        ]
    finally:
        if close_after:
            conn.close()


