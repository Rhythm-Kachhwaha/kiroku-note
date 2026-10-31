"""Persistence boundary for explicit grammar learning encounters."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.connection import db_session, init_db
from .grammar_reference import GrammarReferenceService


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

    def get_points(
        self, status: str | None = None, level: str | None = None,
        search: str | None = None, limit: int = 50, offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses, params = [], []
        if status:
            clauses.append("status = ?"); params.append(status)
        if level:
            clauses.append("level = ?"); params.append(level)
        if search:
            clauses.append("(pattern_key LIKE ? OR display LIKE ?)")
            needle = f"%{search.strip()}%"
            params.extend([needle, needle])
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))
        with db_session(self.db_path) as conn:
            return [dict(row) for row in conn.execute(
                f"SELECT * FROM grammar_points{where} ORDER BY seen_count DESC, last_seen_at DESC "
                f"LIMIT ? OFFSET ?", (*params, limit, offset)
            ).fetchall()]

    def get_stats(self, recent_limit: int = 20) -> dict[str, Any]:
        reference = GrammarReferenceService()
        totals = {level: 0 for level in ("N5", "N4", "N3", "N2", "N1")}
        for point in reference.get_points():
            level = point.get("level")
            if level in totals:
                totals[level] += 1
        with db_session(self.db_path) as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM grammar_points")]
            encounters = [
                dict(row) for row in conn.execute(
                    "SELECT * FROM grammar_encounters ORDER BY created_at DESC LIMIT ?",
                    (max(1, min(int(recent_limit), 100)),),
                )
            ]
        counts: dict[str, dict[str, int]] = {
            level: {"new": 0, "learning": 0, "known": 0, "ignored": 0}
            for level in totals
        }
        for row in rows:
            if row["level"] in counts and row["status"] in counts[row["level"]]:
                counts[row["level"]][row["status"]] += 1
        coverage = {
            level: {"known": counts[level]["known"], "total": total}
            for level, total in totals.items()
        }
        most_seen = sorted(
            (row for row in rows if row["status"] != "learning"),
            key=lambda row: (-row["seen_count"], row["pattern_key"]),
        )[:10]
        return {
            "counts_by_level": counts,
            "seen_count_total": sum(row["seen_count"] for row in rows),
            "coverage": coverage,
            "most_seen_not_learning": most_seen,
            "recent_encounters": encounters,
        }

    def update_point_status(self, pattern_key: str, status: str) -> dict[str, Any] | None:
        if status not in {"new", "known", "learning", "ignored"}:
            raise ValueError("status must be one of new, known, learning, ignored")
        with db_session(self.db_path) as conn:
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key=?", (pattern_key,)).fetchone()
            if row:
                conn.execute("UPDATE grammar_points SET status=? WHERE pattern_key=?", (status, pattern_key))
            else:
                now = datetime.now(timezone.utc).isoformat()
                ref = GrammarReferenceService().get_point_by_key(pattern_key)
                display = (ref.get("pattern_display") or ref.get("display") if ref else pattern_key) or pattern_key
                level = ref.get("level") if ref else None
                conn.execute(
                    """INSERT INTO grammar_points
                       (pattern_key, display, level, status, seen_count, first_seen_at, last_seen_at)
                       VALUES (?, ?, ?, ?, 0, ?, ?)""",
                    (pattern_key, display, level, status, now, now),
                )
            conn.commit()
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key=?", (pattern_key,)).fetchone()
            return dict(row) if row else None

    def get_syllabus(
        self,
        level: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        reference = GrammarReferenceService()
        all_points = reference.get_points()

        with db_session(self.db_path) as conn:
            rows = conn.execute("SELECT pattern_key, status, seen_count FROM grammar_points").fetchall()
            tracked = {r["pattern_key"]: {"status": r["status"], "seen_count": r["seen_count"]} for r in rows}

        filtered = []
        target_level = level.upper() if level else None
        target_search = search.strip().lower() if search else None

        for pt in all_points:
            pt_level = (pt.get("level") or "").upper()
            if target_level and pt_level != target_level:
                continue

            pt_key = pt.get("pattern_key") or ""
            pt_display = pt.get("pattern_display") or pt.get("display") or ""
            pt_meaning = pt.get("meaning_short") or pt.get("english_breakdown") or ""

            if target_search:
                if (
                    target_search not in pt_key.lower()
                    and target_search not in pt_display.lower()
                    and target_search not in pt_meaning.lower()
                ):
                    continue

            user_state = tracked.get(pt_key, {})
            filtered.append({
                "concept_id": pt.get("concept_id"),
                "pattern_key": pt_key,
                "pattern_display": pt_display,
                "level": pt.get("level"),
                "meaning_short": pt.get("meaning_short"),
                "english_breakdown": pt.get("english_breakdown"),
                "formation": pt.get("formation"),
                "examples": pt.get("examples") or [],
                "status": user_state.get("status", "new"),
                "seen_count": user_state.get("seen_count", 0),
            })

        total = len(filtered)
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))
        paged = filtered[offset : offset + limit]

        return {"points": paged, "total": total}

    def get_point_encounters(self, pattern_key: str) -> list[dict[str, Any]]:
        with db_session(self.db_path) as conn:
            return [dict(row) for row in conn.execute(
                "SELECT * FROM grammar_encounters WHERE pattern_key=? ORDER BY created_at DESC", (pattern_key,)
            ).fetchall()]
