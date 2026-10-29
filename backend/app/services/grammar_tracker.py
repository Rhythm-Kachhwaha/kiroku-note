"""Persistence boundary for explicit grammar learning encounters."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.connection import db_session, init_db


class GrammarTrackerService:
    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path
        init_db(db_path)

    def record_encounter(
        self, pattern_key: str, display: str, sentence: str, source: str,
        source_title: str | None = None, video_timestamp_ms: int | None = None,
        level: str | None = None, card_id: int | None = None,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with db_session(self.db_path) as conn:
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = ?", (pattern_key,)).fetchone()
            if row:
                conn.execute(
                    """UPDATE grammar_points SET seen_count=seen_count+1,last_seen_at=?,
                       display=COALESCE(NULLIF(?, ''), display), level=COALESCE(?, level),
                       card_id=COALESCE(?, card_id) WHERE pattern_key=?""",
                    (now, display, level, card_id, pattern_key),
                )
            else:
                conn.execute(
                    """INSERT INTO grammar_points
                       (pattern_key,display,level,first_seen_at,last_seen_at,card_id)
                       VALUES (?,?,?,?,?,?)""",
                    (pattern_key, display, level, now, now, card_id),
                )
            conn.execute(
                """INSERT INTO grammar_encounters
                   (pattern_key,sentence,source,source_title,video_timestamp_ms,created_at)
                   VALUES (?,?,?,?,?,?)""",
                (pattern_key, sentence, source, source_title, video_timestamp_ms, now),
            )
            if card_id is not None:
                conn.execute(
                    "UPDATE grammar_points SET status='learning', card_id=? WHERE pattern_key=? AND status='new'",
                    (card_id, pattern_key),
                )
            conn.commit()
            result = conn.execute("SELECT * FROM grammar_points WHERE pattern_key=?", (pattern_key,)).fetchone()
            return dict(result)

    def get_points(self, status: str | None = None, level: str | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []
        if status:
            clauses.append("status = ?"); params.append(status)
        if level:
            clauses.append("level = ?"); params.append(level)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        with db_session(self.db_path) as conn:
            return [dict(row) for row in conn.execute(
                f"SELECT * FROM grammar_points{where} ORDER BY seen_count DESC, last_seen_at DESC", params
            ).fetchall()]

    def update_point_status(self, pattern_key: str, status: str) -> dict[str, Any] | None:
        if status not in {"new", "known", "learning", "ignored"}:
            raise ValueError("status must be one of new, known, learning, ignored")
        with db_session(self.db_path) as conn:
            conn.execute("UPDATE grammar_points SET status=? WHERE pattern_key=?", (status, pattern_key))
            conn.commit()
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key=?", (pattern_key,)).fetchone()
            return dict(row) if row else None

    def get_point_encounters(self, pattern_key: str) -> list[dict[str, Any]]:
        with db_session(self.db_path) as conn:
            return [dict(row) for row in conn.execute(
                "SELECT * FROM grammar_encounters WHERE pattern_key=? ORDER BY created_at DESC", (pattern_key,)
            ).fetchall()]
