"""Anti-grind burst session orchestration and rolling weekly consistency."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any

from app.db.connection import db_session, ensure_study_modes_tables, init_db
from app.services.kanji_service import KanjiService
from app.services.study_modes.scramble import (
    grade_scramble_answer,
    public_scramble_item,
    select_scramble_candidates,
)
from app.services.study_modes.shadowing import (
    grade_shadowing_answer,
    public_shadowing_item,
    select_shadowing_candidates,
)

ALLOWED_BURST_SIZES: frozenset[int] = frozenset({5, 10})
ALLOWED_MODES: frozenset[str] = frozenset({"sentence_scramble", "audio_shadowing"})


def validate_burst_size(target_count: Any) -> int:
    """Strictly enforce anti-grind 5 or 10 item burst size."""
    if isinstance(target_count, bool) or not isinstance(target_count, int):
        raise ValueError("Burst session target_count must be an integer (5 or 10).")
    if target_count not in ALLOWED_BURST_SIZES:
        raise ValueError(f"Burst session size must be 5 or 10 (got {target_count}).")
    return target_count


def validate_mode(mode: Any) -> str:
    clean = str(mode or "").strip().lower()
    if clean not in ALLOWED_MODES:
        raise ValueError(f"Unsupported study mode '{mode}'. Expected 'sentence_scramble' or 'audio_shadowing'.")
    return clean


def _public_item_for_mode(mode: str, item: dict[str, Any], *, revealed: bool = False, answered: bool = False) -> dict[str, Any]:
    if mode == "sentence_scramble":
        return public_scramble_item(item, answered=answered)
    return public_shadowing_item(item, revealed=revealed, answered=answered)


def _extract_prompt_and_expected(mode: str, item: dict[str, Any]) -> tuple[str, str]:
    if mode == "sentence_scramble":
        return (str(item.get("source_sentence") or item.get("canonical_sentence") or ""), str(item.get("canonical_sentence") or ""))
    return (str(item.get("transcript") or ""), "got_it")


class StudyModesService:
    """Service managing anti-grind burst sessions and rolling 7-day consistency in kiroku.db."""

    def __init__(
        self,
        db_path: Path | str | None = None,
        *,
        kanji_service: KanjiService | None = None,
        initialize: bool = True,
    ):
        self._db_path = db_path
        self._kanji_service = kanji_service
        if initialize:
            init_db(self._db_path)

    def _ensure_tables(self, conn: sqlite3.Connection) -> None:
        ensure_study_modes_tables(conn)

    def start_session(self, mode: str, target_count: int = 5) -> dict[str, Any]:
        """Start a 5- or 10-item burst session from real captured data."""
        clean_mode = validate_mode(mode)
        clean_count = validate_burst_size(target_count)

        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            if clean_mode == "sentence_scramble":
                items = select_scramble_candidates(conn, limit=clean_count)
            else:
                items = select_shadowing_candidates(conn, limit=clean_count, kanji_service=self._kanji_service)

            if not items:
                return {
                    "session_id": None,
                    "mode": clean_mode,
                    "target_count": clean_count,
                    "status": "empty",
                    "correct_count": 0,
                    "total_count": 0,
                    "created_at": None,
                    "completed_at": None,
                    "items": [],
                    "attempts": [],
                    "message": "No captured cards or sentences available yet. Capture cards first to start a burst.",
                }

            now_utc = datetime.now(timezone.utc).isoformat()
            items_json = json.dumps(items, ensure_ascii=False)
            cur = conn.execute(
                """
                INSERT INTO study_burst_sessions (
                    mode, target_count, status, correct_count, total_count, items_json, created_at
                ) VALUES (?, ?, 'active', 0, ?, ?, ?)
                """,
                (clean_mode, clean_count, len(items), items_json, now_utc),
            )
            conn.commit()
            session_id = int(cur.lastrowid)

        return {
            "session_id": session_id,
            "mode": clean_mode,
            "target_count": clean_count,
            "status": "active",
            "correct_count": 0,
            "total_count": len(items),
            "created_at": now_utc,
            "completed_at": None,
            "items": [_public_item_for_mode(clean_mode, it) for it in items],
            "attempts": [],
        }

    def _load_session_row(self, conn: sqlite3.Connection, session_id: int) -> tuple[sqlite3.Row, list[dict[str, Any]], list[dict[str, Any]]]:
        row = conn.execute(
            "SELECT * FROM study_burst_sessions WHERE id = ?",
            (int(session_id),),
        ).fetchone()
        if row is None:
            raise LookupError(f"Study burst session {session_id} not found.")
        try:
            items = json.loads(row["items_json"] or "[]")
        except json.JSONDecodeError:
            items = []
        attempts_rows = conn.execute(
            """
            SELECT id, session_id, item_index, source_card_id, prompt_text, expected_answer, user_answer, is_correct, answered_at
            FROM study_burst_attempts
            WHERE session_id = ?
            ORDER BY item_index ASC, id ASC
            """,
            (int(session_id),),
        ).fetchall()
        attempts = [dict(r) for r in attempts_rows]
        return row, items, attempts

    def get_session(self, session_id: int) -> dict[str, Any]:
        """Retrieve session state, public items, and recorded attempts."""
        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            row, items, attempts = self._load_session_row(conn, session_id)
            answered_indices = {int(a["item_index"]) for a in attempts}
            mode = str(row["mode"])
            public_items = [
                _public_item_for_mode(
                    mode,
                    it,
                    revealed=(int(it["item_index"]) in answered_indices),
                    answered=(int(it["item_index"]) in answered_indices),
                )
                for it in items
            ]
            return {
                "session_id": int(row["id"]),
                "mode": mode,
                "target_count": int(row["target_count"]),
                "status": str(row["status"]),
                "correct_count": int(row["correct_count"]),
                "total_count": int(row["total_count"]),
                "created_at": row["created_at"],
                "completed_at": row["completed_at"],
                "items": public_items,
                "attempts": attempts,
            }

    def reveal_item(self, session_id: int, item_index: int) -> dict[str, Any]:
        """Reveal transcript, reading, gloss, and kanji breakdown for an active item."""
        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            row, items, _ = self._load_session_row(conn, session_id)
            if item_index < 0 or item_index >= len(items):
                raise ValueError(f"Item index {item_index} is out of range for session {session_id}.")
            item = items[item_index]
            mode = str(row["mode"])
            if mode == "audio_shadowing":
                return public_shadowing_item(item, revealed=True)
            return {
                "item_index": item_index,
                "mode": mode,
                "revealed": True,
                "english_gloss": item.get("english_gloss") or "",
            }

    def submit_answer(self, session_id: int, item_index: int, user_answer: Any) -> dict[str, Any]:
        """Grade and persist an answer for a burst item."""
        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            row, items, attempts = self._load_session_row(conn, session_id)
            if item_index < 0 or item_index >= len(items):
                raise ValueError(f"Item index {item_index} is out of range for session {session_id}.")

            mode = str(row["mode"])
            item = items[item_index]
            if mode == "sentence_scramble":
                result = grade_scramble_answer(item, user_answer)
                serialized_answer = json.dumps(result["submitted_order"], ensure_ascii=False) if result["submitted_order"] else str(user_answer)
            else:
                result = grade_shadowing_answer(item, user_answer)
                serialized_answer = str(result["self_grade"])

            existing = next((a for a in attempts if int(a["item_index"]) == item_index), None)
            if existing is None:
                prompt_text, expected_answer = _extract_prompt_and_expected(mode, item)
                now_utc = datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO study_burst_attempts (
                        session_id, item_index, source_card_id, prompt_text, expected_answer, user_answer, is_correct, answered_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(session_id),
                        item_index,
                        item.get("source_card_id"),
                        prompt_text,
                        expected_answer,
                        serialized_answer,
                        1 if result["is_correct"] else 0,
                        now_utc,
                    ),
                )
                agg = conn.execute(
                    "SELECT COALESCE(SUM(is_correct), 0) AS correct_sum FROM study_burst_attempts WHERE session_id = ?",
                    (int(session_id),),
                ).fetchone()
                correct_count = int(agg["correct_sum"]) if agg else 0
                conn.execute(
                    "UPDATE study_burst_sessions SET correct_count = ? WHERE id = ?",
                    (correct_count, int(session_id)),
                )
                conn.commit()
            else:
                correct_count = int(row["correct_count"])

            return {
                "session_id": int(session_id),
                "item_index": item_index,
                "mode": mode,
                "correct_count": correct_count,
                "total_count": int(row["total_count"]),
                **result,
            }

    def complete_session(self, session_id: int) -> dict[str, Any]:
        """Complete a burst session and return summary plus rolling weekly consistency."""
        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            row, _, attempts = self._load_session_row(conn, session_id)
            now_utc = row["completed_at"] or datetime.now(timezone.utc).isoformat()

            agg = conn.execute(
                "SELECT COUNT(*) AS attempted, COALESCE(SUM(is_correct), 0) AS correct_sum FROM study_burst_attempts WHERE session_id = ?",
                (int(session_id),),
            ).fetchone()
            correct_count = int(agg["correct_sum"]) if agg else int(row["correct_count"])
            attempted_count = int(agg["attempted"]) if agg else len(attempts)
            total_count = int(row["total_count"])

            if row["status"] != "completed":
                conn.execute(
                    """
                    UPDATE study_burst_sessions
                    SET status = 'completed', correct_count = ?, completed_at = ?
                    WHERE id = ?
                    """,
                    (correct_count, now_utc, int(session_id)),
                )
                conn.commit()

        denominator = attempted_count if attempted_count > 0 else total_count
        accuracy_percent = round((correct_count / denominator) * 100) if denominator > 0 else 0
        consistency = self.get_weekly_consistency()
        return {
            "session_id": int(session_id),
            "mode": str(row["mode"]),
            "target_count": int(row["target_count"]),
            "status": "completed",
            "correct_count": correct_count,
            "attempted_count": attempted_count,
            "total_count": total_count,
            "accuracy_percent": accuracy_percent,
            "completed_at": now_utc,
            "consistency": consistency,
        }

    def get_weekly_consistency(self, *, reference_date: date | None = None) -> dict[str, Any]:
        """Compute rolling 7-day consistency without punitive daily streak resets."""
        end_day = reference_date or datetime.now(timezone.utc).date()
        start_day = end_day - timedelta(days=6)
        day_keys = [(start_day + timedelta(days=offset)).isoformat() for offset in range(7)]
        buckets: dict[str, dict[str, Any]] = {
            day_key: {
                "date": day_key,
                "sessions_completed": 0,
                "items_reviewed": 0,
            }
            for day_key in day_keys
        }

        with db_session(self._db_path) as conn:
            self._ensure_tables(conn)
            rows = conn.execute(
                """
                SELECT
                    substr(s.completed_at, 1, 10) AS day_key,
                    COUNT(DISTINCT s.id) AS sessions_completed,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN COALESCE(a.attempt_cnt, 0) > 0 THEN a.attempt_cnt
                                ELSE s.total_count
                            END
                        ),
                        0
                    ) AS items_reviewed
                FROM study_burst_sessions s
                LEFT JOIN (
                    SELECT session_id, COUNT(*) AS attempt_cnt
                    FROM study_burst_attempts
                    GROUP BY session_id
                ) a ON a.session_id = s.id
                WHERE s.status = 'completed'
                  AND s.completed_at IS NOT NULL
                  AND substr(s.completed_at, 1, 10) >= ?
                  AND substr(s.completed_at, 1, 10) <= ?
                GROUP BY day_key
                """,
                (day_keys[0], day_keys[-1]),
            ).fetchall()

        for row in rows:
            key = str(row["day_key"] or "")
            if key in buckets:
                buckets[key]["sessions_completed"] = int(row["sessions_completed"] or 0)
                buckets[key]["items_reviewed"] = int(row["items_reviewed"] or 0)

        days = [buckets[k] for k in day_keys]
        active_days = sum(1 for d in days if d["sessions_completed"] > 0)
        total_bursts_7d = sum(d["sessions_completed"] for d in days)
        total_items_7d = sum(d["items_reviewed"] for d in days)

        return {
            "days": days,
            "active_days": active_days,
            "window_days": 7,
            "total_bursts_7d": total_bursts_7d,
            "total_items_7d": total_items_7d,
        }
