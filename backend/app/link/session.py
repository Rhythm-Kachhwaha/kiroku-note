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
    created_at TEXT NOT NULL
);
"""


def init_session_stat_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Ensure the link_session_stat table exists."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        conn.executescript(SESSION_STAT_SCHEMA_SQL)
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
                session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            SELECT id, session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, created_at
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
            }
            for row in rows
        ]
    finally:
        if close_after:
            conn.close()


class LinkVideoSession:
    """Represents an active video playback tab attached from the extension."""

    def __init__(
        self,
        tab: int,
        site: str,
        title: str,
        duration: float,
        drm: bool = False,
        ext_sid: str = "",
        frame: int = 0,
    ):
        self.tab = tab
        self.frame = frame
        self.site = site
        self.title = title
        self.duration = duration
        self.drm = drm
        self.ext_sid = ext_sid
        self.last_state: Optional[Dict[str, Any]] = None
        self.last_cue_list: Optional[Dict[str, Any]] = None
        self.cue_chunks: Dict[str, Dict[int, Dict[str, Any]]] = {}
        self.last_active_cue: Optional[Dict[str, Any]] = None
        self.last_sub_status: Optional[Dict[str, Any]] = None
        self.created_at = time.time()
        self.updated_at = time.time()

    def update_attach(
        self, site: str, title: str, duration: float, drm: bool = False, ext_sid: str = ""
    ) -> None:
        self.site = site
        self.title = title
        self.duration = duration
        self.drm = drm
        if ext_sid:
            self.ext_sid = ext_sid
        self.updated_at = time.time()

    def update_state(self, state: Dict[str, Any]) -> None:
        self.last_state = state
        self.updated_at = time.time()

    def update_cues(self, cue_list: Dict[str, Any]) -> None:
        self.last_cue_list = cue_list
        hash_val = cue_list.get("hash", "")
        parts = cue_list.get("parts")
        part = cue_list.get("part")
        if hash_val and parts and parts > 1 and part:
            if len(self.cue_chunks) >= 5 and hash_val not in self.cue_chunks:
                oldest_hash = next(iter(self.cue_chunks))
                self.cue_chunks.pop(oldest_hash, None)
            self.cue_chunks.setdefault(hash_val, {})[part] = cue_list
        self.updated_at = time.time()

    def get_all_cue_payloads(self) -> List[Dict[str, Any]]:
        """Returns all cue list payloads for the active cue hash, in chunk order."""
        if not self.last_cue_list:
            return []
        hash_val = self.last_cue_list.get("hash", "")
        if hash_val and hash_val in self.cue_chunks:
            chunks = self.cue_chunks[hash_val]
            return [chunks[p] for p in sorted(chunks.keys())]
        return [self.last_cue_list]

    def update_active_cue(self, cue: Dict[str, Any]) -> None:
        self.last_active_cue = cue
        self.updated_at = time.time()

    def update_sub_status(self, status: Dict[str, Any]) -> None:
        self.last_sub_status = status
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tab": self.tab,
            "frame": self.frame,
            "site": self.site,
            "title": self.title,
            "duration": self.duration,
            "drm": self.drm,
        }
