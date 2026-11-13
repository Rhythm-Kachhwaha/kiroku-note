"""Persistence boundary for explicit grammar learning encounters and dual-track mastery."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db.connection import db_session, init_db
from .grammar_reference import GrammarReferenceService
from .grammar_mastery import (
    compute_pipeline_status,
    calculate_modality_mastery,
    VALID_MODALITIES,
)


class GrammarTrackerService:
    def __init__(self, db_path: Path | str | None = None):
        self.db_path = db_path
        init_db(db_path)

    def migrate_legacy_keys(self) -> int:
        from app.db.connection import migrate_canonical_grammar_keys
        with db_session(self.db_path) as conn:
            return migrate_canonical_grammar_keys(conn)

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
            res_dict = dict(result)
            res_dict["pipeline_status"] = compute_pipeline_status(
                res_dict.get("seen_count", 0),
                res_dict.get("mastery_score", 0.0),
                res_dict.get("drill_count", 0),
            )
            return res_dict

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
            rows = [dict(row) for row in conn.execute(
                f"SELECT * FROM grammar_points{where} ORDER BY seen_count DESC, last_seen_at DESC "
                f"LIMIT ? OFFSET ?", (*params, limit, offset)
            ).fetchall()]
            for r in rows:
                r["pipeline_status"] = compute_pipeline_status(
                    r.get("seen_count", 0),
                    r.get("mastery_score", 0.0),
                    r.get("drill_count", 0),
                )
            return rows

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
                ref = GrammarReferenceService().get_point_by_key(pattern_key)
                if not ref:
                    raise ValueError(f"Unknown grammar pattern key: {pattern_key}")
                now = datetime.now(timezone.utc).isoformat()
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
            rows = conn.execute("SELECT pattern_key, status, seen_count, mastery_score, drill_count FROM grammar_points").fetchall()
            tracked = {
                r["pattern_key"]: {
                    "status": r["status"],
                    "seen_count": r["seen_count"],
                    "mastery_score": r["mastery_score"],
                    "drill_count": r["drill_count"],
                }
                for r in rows
            }

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
                "mastery_score": user_state.get("mastery_score", 0.0),
                "drill_count": user_state.get("drill_count", 0),
                "pipeline_status": compute_pipeline_status(
                    user_state.get("seen_count", 0),
                    user_state.get("mastery_score", 0.0),
                    user_state.get("drill_count", 0),
                ),
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

    def record_drill_outcome(
        self,
        pattern_key: str,
        modality: str,
        is_correct: bool,
        user_answer: str = "",
        expected_answer: str = "",
        context_sentence: str = "",
    ) -> dict[str, Any]:
        """Record outcome of a grammar drill across the 3 proof modalities and update mastery score."""
        if modality not in VALID_MODALITIES:
            raise ValueError(f"Invalid modality '{modality}'. Expected one of {sorted(VALID_MODALITIES)}")

        now_iso = datetime.now(timezone.utc).isoformat()
        with db_session(self.db_path) as conn:
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = ?", (pattern_key,)).fetchone()
            if not row:
                # Concept wasn't recorded yet; seed it
                ref = GrammarReferenceService().get_point_by_key(pattern_key)
                display = (ref.get("pattern_display") or ref.get("display") if ref else pattern_key) or pattern_key
                level = ref.get("level") if ref else None
                conn.execute(
                    """INSERT INTO grammar_points
                       (pattern_key, display, level, status, seen_count, first_seen_at, last_seen_at,
                        mastery_score, drill_count, stability, difficulty)
                       VALUES (?, ?, ?, 'learning', 0, ?, ?, 0.0, 0, 0.0, 5.0)""",
                    (pattern_key, display, level, now_iso, now_iso),
                )
                row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = ?", (pattern_key,)).fetchone()

            current_mastery = float(row["mastery_score"] or 0.0)
            current_stability = float(row["stability"] or 0.0)
            current_diff = float(row["difficulty"] or 5.0)
            last_drilled = row["last_drilled_at"]

            calc = calculate_modality_mastery(
                current_mastery=current_mastery,
                modality=modality,
                is_correct=is_correct,
                current_stability=current_stability,
                current_difficulty=current_diff,
                last_drilled_at=last_drilled,
            )

            new_mastery = calc["new_mastery"]
            score_delta = calc["score_delta"]
            new_stability = calc["new_stability"]
            new_diff = calc["new_difficulty"]

            new_drill_count = int(row["drill_count"] or 0) + 1

            # Determine updated status: if status was 'new', transition to 'learning' (or 'known' if >= 80%)
            cur_status = row["status"]
            if new_mastery >= 80.0:
                new_status = "known"
            elif cur_status == "new":
                new_status = "learning"
            else:
                new_status = cur_status

            conn.execute(
                """UPDATE grammar_points
                   SET mastery_score = ?,
                       drill_count = ?,
                       stability = ?,
                       difficulty = ?,
                       last_drilled_at = ?,
                       status = ?
                   WHERE pattern_key = ?""",
                (new_mastery, new_drill_count, new_stability, new_diff, now_iso, new_status, pattern_key),
            )

            conn.execute(
                """INSERT INTO grammar_drill_results
                   (pattern_key, modality, is_correct, user_answer, expected_answer,
                    context_sentence, score_delta, new_mastery, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    pattern_key,
                    modality,
                    1 if is_correct else 0,
                    user_answer,
                    expected_answer,
                    context_sentence,
                    score_delta,
                    new_mastery,
                    now_iso,
                ),
            )
            conn.commit()

            updated = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = ?", (pattern_key,)).fetchone()
            res = dict(updated)
            res["pipeline_status"] = compute_pipeline_status(
                res.get("seen_count", 0),
                res.get("mastery_score", 0.0),
                res.get("drill_count", 0),
            )
            res["calculation"] = calc
            return res

    def get_dual_track_status(self, pattern_key: str) -> dict[str, Any] | None:
        """Fetch complete exposure vs mastery dual-track metrics for a single grammar pattern."""
        with db_session(self.db_path) as conn:
            row = conn.execute("SELECT * FROM grammar_points WHERE pattern_key = ?", (pattern_key,)).fetchone()
            if not row:
                return {
                    "pattern_key": pattern_key,
                    "seen_count": 0,
                    "mastery_score": 0.0,
                    "drill_count": 0,
                    "pipeline_status": "unseen",
                    "exposure": {
                        "seen_count": 0,
                        "first_seen_at": None,
                        "last_seen_at": None,
                        "encounters": [],
                    },
                    "mastery": {
                        "mastery_score": 0.0,
                        "drill_count": 0,
                        "last_drilled_at": None,
                        "stability": 0.0,
                        "difficulty": 5.0,
                        "drills": [],
                    },
                }

            point_dict = dict(row)
            encounters = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM grammar_encounters WHERE pattern_key = ? ORDER BY created_at DESC, id DESC",
                    (pattern_key,),
                ).fetchall()
            ]
            drills = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM grammar_drill_results WHERE pattern_key = ? ORDER BY created_at DESC, id DESC",
                    (pattern_key,),
                ).fetchall()
            ]

            p_status = compute_pipeline_status(
                point_dict.get("seen_count", 0),
                point_dict.get("mastery_score", 0.0),
                point_dict.get("drill_count", 0),
            )

            return {
                "pattern_key": pattern_key,
                "display": point_dict.get("display", ""),
                "level": point_dict.get("level"),
                "status": point_dict.get("status", "new"),
                "pipeline_status": p_status,
                "exposure": {
                    "seen_count": point_dict.get("seen_count", 0),
                    "first_seen_at": point_dict.get("first_seen_at"),
                    "last_seen_at": point_dict.get("last_seen_at"),
                    "encounters": encounters,
                },
                "mastery": {
                    "mastery_score": point_dict.get("mastery_score", 0.0),
                    "drill_count": point_dict.get("drill_count", 0),
                    "last_drilled_at": point_dict.get("last_drilled_at"),
                    "stability": point_dict.get("stability", 0.0),
                    "difficulty": point_dict.get("difficulty", 5.0),
                    "drills": drills,
                },
            }

    def get_batch_dual_track_status(self, pattern_keys: list[str]) -> list[dict[str, Any]]:
        """Fetch dual-track status for a batch of pattern keys."""
        if not pattern_keys:
            return []
        res = []
        for key in pattern_keys:
            stat = self.get_dual_track_status(key)
            if stat:
                res.append(stat)
        return res

