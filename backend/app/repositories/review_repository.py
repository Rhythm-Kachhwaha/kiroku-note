"""Repository for FSRS card scheduling, review logs, and deck settings."""
from __future__ import annotations

import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
import sqlite3

from app.db.connection import db_session, ensure_review_tables

DECK_SETTINGS_EXPLANATIONS: Dict[str, str] = {
    "new_cards_per_day": "How many brand new words to learn each day. Lower this if your daily reviews feel heavy.",
    "max_reviews_per_day": "The ceiling on how many review cards Kiroku will show you in a single day.",
    "desired_retention": "The percentage of cards you want to successfully recall (default: 90%). Higher means shorter intervals and more reviews; lower means longer intervals.",
    "easy_initial_cap_days": "Caps the very first interval when you press Easy on a brand new word (default: 6 days). Prevents unmastered words from vanishing for a month. Once graduated, intervals grow exponentially.",
    "max_interval_days": "The maximum number of days a card can be scheduled into the future (default: 365 days).",
    "learning_steps": "Time steps before a new card graduates to review status.",
    "relearning_steps": "Time steps when you forget a previously learned card.",
    "auto_sync_anki": "Automatically import existing Anki cards on launch and push reviews to Anki."
}

class ReviewRepository:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = db_path

    def _today_utc(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _now_utc(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _get_deck_settings_conn(self, conn: sqlite3.Connection, deck_name: str = "Default") -> Dict[str, Any]:
        ensure_review_tables(conn)
        row = conn.execute(
            "SELECT * FROM deck_settings WHERE deck_name = ?",
            (deck_name,)
        ).fetchone()
        if not row:
            now_str = self._now_utc()
            conn.execute(
                """
                INSERT INTO deck_settings (
                    deck_name, new_cards_per_day, max_reviews_per_day, desired_retention,
                    easy_initial_cap_days, max_interval_days, learning_steps, relearning_steps,
                    auto_sync_anki, extra_new_today, extra_reviews_today, updated_at
                ) VALUES (?, 20, 200, 0.90, 6, 365, '1m, 10m', '10m', 1, 0, 0, ?)
                """,
                (deck_name, now_str)
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM deck_settings WHERE deck_name = ?",
                (deck_name,)
            ).fetchone()

        res = dict(row)
        today = self._today_utc()
        if res.get("last_boost_date") != today and (res.get("extra_new_today", 0) > 0 or res.get("extra_reviews_today", 0) > 0):
            conn.execute(
                """
                UPDATE deck_settings
                SET extra_new_today = 0, extra_reviews_today = 0, last_boost_date = ?, updated_at = ?
                WHERE deck_name = ?
                """,
                (today, self._now_utc(), deck_name)
            )
            conn.commit()
            res["extra_new_today"] = 0
            res["extra_reviews_today"] = 0
            res["last_boost_date"] = today

        return res

    def get_deck_settings(self, deck_name: str = "Default") -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            return self._get_deck_settings_conn(conn, deck_name)

    def get_deck_settings_with_explanations(self, deck_name: str = "Default") -> Dict[str, Any]:
        settings = self.get_deck_settings(deck_name)
        return {
            "values": settings,
            "explanations": DECK_SETTINGS_EXPLANATIONS
        }

    def update_deck_settings(self, deck_name: str, settings: Dict[str, Any]) -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            self._get_deck_settings_conn(conn, deck_name)
            allowed_cols = {
                "new_cards_per_day", "max_reviews_per_day", "desired_retention",
                "easy_initial_cap_days", "max_interval_days", "learning_steps",
                "relearning_steps", "auto_sync_anki"
            }
            updates = []
            vals = []
            for k, v in settings.items():
                if k in allowed_cols:
                    updates.append(f"{k} = ?")
                    vals.append(v)
            if updates:
                updates.append("updated_at = ?")
                vals.append(self._now_utc())
                vals.append(deck_name)
                sql = f"UPDATE deck_settings SET {', '.join(updates)} WHERE deck_name = ?"
                conn.execute(sql, vals)
                conn.commit()

            return self._get_deck_settings_conn(conn, deck_name)

    def boost_limits_today(self, deck_name: str = "Default", add_new: int = 0, add_reviews: int = 0) -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            current = self._get_deck_settings_conn(conn, deck_name)
            today = self._today_utc()
            new_extra = max(0, current.get("extra_new_today", 0) + add_new)
            rev_extra = max(0, current.get("extra_reviews_today", 0) + add_reviews)
            now_str = self._now_utc()
            conn.execute(
                """
                UPDATE deck_settings
                SET extra_new_today = ?, extra_reviews_today = ?, last_boost_date = ?, updated_at = ?
                WHERE deck_name = ?
                """,
                (new_extra, rev_extra, today, now_str, deck_name)
            )
            conn.commit()
            return self._get_deck_settings_conn(conn, deck_name)

    def _get_or_create_fsrs_conn(self, conn: sqlite3.Connection, card_id: int) -> Dict[str, Any]:
        ensure_review_tables(conn)
        row = conn.execute(
            "SELECT * FROM card_fsrs WHERE card_id = ?",
            (card_id,)
        ).fetchone()
        if row:
            return dict(row)

        now_str = self._now_utc()
        conn.execute(
            """
            INSERT INTO card_fsrs (
                card_id, state, stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, last_review, due_date, sync_state, created_at, updated_at
            ) VALUES (?, 0, 0.0, 0.0, 0, 0, 0, 0, NULL, NULL, 'synced', ?, ?)
            """,
            (card_id, now_str, now_str)
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM card_fsrs WHERE card_id = ?",
            (card_id,)
        ).fetchone()
        return dict(row)

    def get_or_create_fsrs(self, card_id: int) -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            return self._get_or_create_fsrs_conn(conn, card_id)

    def update_card_fsrs(self, card_id: int, fsrs_data: Dict[str, Any]) -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            self._get_or_create_fsrs_conn(conn, card_id)
            allowed_cols = {
                "state", "stability", "difficulty", "elapsed_days",
                "scheduled_days", "reps", "lapses", "last_review",
                "due_date", "sync_state", "anki_card_id",
                "is_suspended", "buried_until"
            }
            updates = []
            vals = []
            for k, v in fsrs_data.items():
                if k in allowed_cols:
                    updates.append(f"{k} = ?")
                    vals.append(v)
            if updates:
                updates.append("updated_at = ?")
                vals.append(self._now_utc())
                vals.append(card_id)
                sql = f"UPDATE card_fsrs SET {', '.join(updates)} WHERE card_id = ?"
                conn.execute(sql, vals)
                conn.commit()

            row = conn.execute("SELECT * FROM card_fsrs WHERE card_id = ?", (card_id,)).fetchone()
            return dict(row) if row else {}

    def log_review(
        self,
        card_id: int,
        rating: int,
        state: int,
        scheduled_days: int,
        elapsed_days: int,
        duration_ms: Optional[int] = None,
        synced_to_anki: bool = False,
        last_fsrs_snapshot: Optional[str] = None
    ) -> int:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            now_str = self._now_utc()
            cur = conn.execute(
                """
                INSERT INTO review_logs (
                    card_id, rating, state, scheduled_days, elapsed_days,
                    reviewed_at, duration_ms, synced_to_anki, last_fsrs_snapshot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card_id, rating, state, scheduled_days, elapsed_days,
                    now_str, duration_ms, 1 if synced_to_anki else 0,
                    last_fsrs_snapshot
                )
            )
            conn.commit()
            return cur.lastrowid

    def get_due_cards(self, deck_name: str = "Default", limit: Optional[int] = None) -> List[Dict[str, Any]]:
        with db_session(self.db_path) as conn:
            settings = self._get_deck_settings_conn(conn, deck_name)
            today = self._today_utc()

            today_start = f"{today}T00:00:00"
            today_end = f"{today}T23:59:59"
            
            reviews_done = conn.execute(
                """
                SELECT COUNT(*) FROM review_logs l
                JOIN cards c ON l.card_id = c.id
                WHERE l.reviewed_at >= ? AND l.reviewed_at <= ? AND l.state != 0
                  AND (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (today_start, today_end, deck_name, deck_name, deck_name)
            ).fetchone()[0]

            new_done = conn.execute(
                """
                SELECT COUNT(*) FROM review_logs l
                JOIN cards c ON l.card_id = c.id
                WHERE l.reviewed_at >= ? AND l.reviewed_at <= ? AND l.state == 0
                  AND (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (today_start, today_end, deck_name, deck_name, deck_name)
            ).fetchone()[0]

            max_reviews = settings["max_reviews_per_day"] + settings.get("extra_reviews_today", 0)
            max_new = settings["new_cards_per_day"] + settings.get("extra_new_today", 0)

            remaining_reviews = max(0, max_reviews - reviews_done)
            remaining_new = max(0, max_new - new_done)

            learn_rows = conn.execute(
                """
                SELECT c.*, f.state as fsrs_state, f.stability, f.difficulty,
                       f.elapsed_days, f.scheduled_days, f.reps, f.lapses, f.due_date, f.anki_card_id,
                       COALESCE(f.is_suspended, 0) as is_suspended, f.buried_until
                FROM cards c
                JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND f.state IN (1, 3)
                  AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                  AND (f.buried_until IS NULL OR f.buried_until <= ?)
                ORDER BY f.updated_at ASC
                LIMIT 50
                """,
                (deck_name, deck_name, deck_name, today)
            ).fetchall()

            rev_rows = []
            if remaining_reviews > 0:
                rev_rows = conn.execute(
                    """
                    SELECT c.*, f.state as fsrs_state, f.stability, f.difficulty,
                           f.elapsed_days, f.scheduled_days, f.reps, f.lapses, f.due_date, f.anki_card_id,
                           COALESCE(f.is_suspended, 0) as is_suspended, f.buried_until
                    FROM cards c
                    JOIN card_fsrs f ON c.id = f.card_id
                    WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                      AND f.state = 2
                      AND (f.due_date IS NULL OR f.due_date <= ?)
                      AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                      AND (f.buried_until IS NULL OR f.buried_until <= ?)
                    ORDER BY f.due_date ASC, f.reps ASC
                    LIMIT ?
                    """,
                    (deck_name, deck_name, deck_name, today, today, remaining_reviews)
                ).fetchall()

            new_rows = []
            if remaining_new > 0:
                new_rows = conn.execute(
                    """
                    SELECT c.*, COALESCE(f.state, 0) as fsrs_state, COALESCE(f.stability, 0.0) as stability,
                           COALESCE(f.difficulty, 0.0) as difficulty, COALESCE(f.elapsed_days, 0) as elapsed_days,
                           COALESCE(f.scheduled_days, 0) as scheduled_days, COALESCE(f.reps, 0) as reps,
                           COALESCE(f.lapses, 0) as lapses, f.due_date, f.anki_card_id,
                           COALESCE(f.is_suspended, 0) as is_suspended, f.buried_until
                    FROM cards c
                    LEFT JOIN card_fsrs f ON c.id = f.card_id
                    WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                      AND (f.state IS NULL OR f.state = 0)
                      AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                      AND (f.buried_until IS NULL OR f.buried_until <= ?)
                    ORDER BY c.created_at ASC
                    LIMIT ?
                    """,
                    (deck_name, deck_name, deck_name, today, remaining_new)
                ).fetchall()

            cards = [dict(r) for r in learn_rows] + [dict(r) for r in rev_rows] + [dict(r) for r in new_rows]
            if limit is not None:
                cards = cards[:limit]
            return cards

    def get_review_stats(self, deck_name: str = "Default") -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            settings = self._get_deck_settings_conn(conn, deck_name)
            today = self._today_utc()

            total_cards = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (deck_name, deck_name, deck_name)
            ).fetchone()[0]

            today_start = f"{today}T00:00:00"
            today_end = f"{today}T23:59:59"

            reviews_done = conn.execute(
                """
                SELECT COUNT(*) FROM review_logs l
                JOIN cards c ON l.card_id = c.id
                WHERE l.reviewed_at >= ? AND l.reviewed_at <= ? AND l.state != 0
                  AND (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (today_start, today_end, deck_name, deck_name, deck_name)
            ).fetchone()[0]

            new_done = conn.execute(
                """
                SELECT COUNT(*) FROM review_logs l
                JOIN cards c ON l.card_id = c.id
                WHERE l.reviewed_at >= ? AND l.reviewed_at <= ? AND l.state == 0
                  AND (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (today_start, today_end, deck_name, deck_name, deck_name)
            ).fetchone()[0]

            learning_count = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND f.state IN (1, 3)
                  AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                  AND (f.buried_until IS NULL OR f.buried_until <= ?)
                """,
                (deck_name, deck_name, deck_name, today)
            ).fetchone()[0]

            reviews_due_count = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND f.state = 2
                  AND (f.due_date IS NULL OR f.due_date <= ?)
                  AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                  AND (f.buried_until IS NULL OR f.buried_until <= ?)
                """,
                (deck_name, deck_name, deck_name, today, today)
            ).fetchone()[0]

            new_total = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                LEFT JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND (f.state IS NULL OR f.state = 0)
                  AND (f.is_suspended IS NULL OR f.is_suspended = 0)
                  AND (f.buried_until IS NULL OR f.buried_until <= ?)
                """,
                (deck_name, deck_name, deck_name, today)
            ).fetchone()[0]

            buried_count = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND f.buried_until IS NOT NULL AND f.buried_until > ?
                """,
                (deck_name, deck_name, deck_name, today)
            ).fetchone()[0]

            suspended_count = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                JOIN card_fsrs f ON c.id = f.card_id
                WHERE (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                  AND f.is_suspended = 1
                """,
                (deck_name, deck_name, deck_name)
            ).fetchone()[0]

            new_limit = settings.get("new_cards_per_day", 20)
            remaining_new = max(0, min(new_total, new_limit - new_done))

            # Do not artificially clamp due_count to max_reviews in the stats display
            # Learners should see the real count of cards due today
            due_today = learning_count + reviews_due_count + remaining_new

            review_dates = conn.execute(
                """
                SELECT DISTINCT substr(reviewed_at, 1, 10) as rev_date
                FROM review_logs
                ORDER BY rev_date DESC
                """
            ).fetchall()
            
            streak = 0
            check_date = datetime.now(timezone.utc).date()
            dates_set = {r["rev_date"] for r in review_dates}
            
            if check_date.isoformat() not in dates_set:
                check_date = check_date - timedelta(days=1)
                
            while check_date.isoformat() in dates_set:
                streak += 1
                check_date = check_date - timedelta(days=1)

            dur_row = conn.execute(
                """
                SELECT SUM(duration_ms) FROM review_logs l
                JOIN cards c ON l.card_id = c.id
                WHERE l.reviewed_at >= ? AND l.reviewed_at <= ?
                  AND (? = 'All' OR c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '' OR c.deck_name = 'Default')))
                """,
                (today_start, today_end, deck_name, deck_name, deck_name)
            ).fetchone()
            studied_ms = dur_row[0] if dur_row and dur_row[0] else 0
            studied_sec = round(studied_ms / 1000.0, 2)
            total_studied = reviews_done + new_done
            sec_per_card = round(studied_sec / total_studied, 2) if total_studied > 0 else 0.0

            res = {
                "total_cards": total_cards,
                "cards_due_today": due_today,
                "learning_count": learning_count,
                "reviews_due_count": reviews_due_count,
                "new_cards_due_count": remaining_new,
                "new_count": remaining_new,
                "learn_count": learning_count,
                "due_count": reviews_due_count,
                "reviews_done_today": reviews_done,
                "new_done_today": new_done,
                "total_studied_today": total_studied,
                "studied_seconds_today": studied_sec,
                "seconds_per_card": sec_per_card,
                "streak_days": streak,
                "buried_count": buried_count,
                "suspended_count": suspended_count
            }

            try:
                from app.services.anki_connect import AnkiConnectService
                anki = AnkiConnectService()
                if anki.is_available():
                    astats = anki.get_deck_stats([deck_name])
                    if astats:
                        clean_deck = deck_name.strip().lower()
                        for s in astats.values():
                            s_name = str(s.get("name", "")).strip().lower()
                            if s_name == clean_deck:
                                res["new_count"] = s.get("new_count", res["new_count"])
                                res["learn_count"] = s.get("learn_count", res["learn_count"])
                                res["due_count"] = s.get("review_count", res["due_count"])
                                res["reviews_due_count"] = res["due_count"]
                                res["cards_due_today"] = res["learn_count"] + res["due_count"] + res["new_count"]
                                res["anki_total_in_deck"] = s.get("total_in_deck", 0)
                                break

                    # If total_studied_today is 0 in local DB, fetch from AnkiConnect
                    if res.get("total_studied_today", 0) == 0:
                        cids = anki._invoke("findCards", query=f'deck:"{deck_name}" rated:1')
                        if cids:
                            revs = anki._invoke("getReviewsOfCards", cards=cids)
                            cutoff_ms = (time.time() - 86400) * 1000
                            today_anki_revs = [
                                r for rlist in revs.values()
                                for r in rlist
                                if isinstance(r, dict) and r.get("id", 0) >= cutoff_ms
                            ]
                            if today_anki_revs:
                                a_count = len(today_anki_revs)
                                a_ms = sum(r.get("time", 0) for r in today_anki_revs)
                                a_sec = round(a_ms / 1000.0, 2)
                                res["total_studied_today"] = a_count
                                res["studied_seconds_today"] = a_sec
                                res["seconds_per_card"] = round(a_sec / a_count, 2) if a_count > 0 else 0.0
            except Exception:
                pass

            return res

    def bury_card(self, card_id: int) -> bool:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
            self._get_or_create_fsrs_conn(conn, card_id)
            conn.execute(
                "UPDATE card_fsrs SET buried_until = ?, updated_at = ? WHERE card_id = ?",
                (tomorrow, self._now_utc(), card_id)
            )
            conn.commit()
            return True

    def unbury_cards(self, deck_name: Optional[str] = None) -> int:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            now_str = self._now_utc()
            if not deck_name or deck_name == "All":
                cur = conn.execute(
                    "UPDATE card_fsrs SET buried_until = NULL, updated_at = ? WHERE buried_until IS NOT NULL",
                    (now_str,)
                )
            elif deck_name == "Default":
                cur = conn.execute(
                    """
                    UPDATE card_fsrs
                    SET buried_until = NULL, updated_at = ?
                    WHERE card_id IN (
                        SELECT c.id FROM cards c WHERE c.deck_name = 'Default' OR c.deck_name IS NULL OR c.deck_name = ''
                    ) AND buried_until IS NOT NULL
                    """,
                    (now_str,)
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE card_fsrs
                    SET buried_until = NULL, updated_at = ?
                    WHERE card_id IN (
                        SELECT c.id FROM cards c WHERE c.deck_name = ?
                    ) AND buried_until IS NOT NULL
                    """,
                    (now_str, deck_name)
                )
            conn.commit()
            return cur.rowcount

    def suspend_card(self, card_id: int) -> bool:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            self._get_or_create_fsrs_conn(conn, card_id)
            conn.execute(
                "UPDATE card_fsrs SET is_suspended = 1, updated_at = ? WHERE card_id = ?",
                (self._now_utc(), card_id)
            )
            conn.commit()
            return True

    def unsuspend_card(self, card_id: int) -> bool:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            self._get_or_create_fsrs_conn(conn, card_id)
            conn.execute(
                "UPDATE card_fsrs SET is_suspended = 0, updated_at = ? WHERE card_id = ?",
                (self._now_utc(), card_id)
            )
            conn.commit()
            return True

    def undo_last_review(self) -> Optional[Dict[str, Any]]:
        import json
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            log = conn.execute(
                "SELECT * FROM review_logs ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if not log:
                return None
            
            log_dict = dict(log)
            card_id = log_dict["card_id"]
            log_id = log_dict["id"]
            snapshot_str = log_dict.get("last_fsrs_snapshot")
            
            if snapshot_str:
                try:
                    prev_fsrs = json.loads(snapshot_str)
                    conn.execute(
                        """
                        UPDATE card_fsrs
                        SET state = ?, stability = ?, difficulty = ?, elapsed_days = ?,
                            scheduled_days = ?, reps = ?, lapses = ?, last_review = ?,
                            due_date = ?, updated_at = ?
                        WHERE card_id = ?
                        """,
                        (
                            prev_fsrs.get("state", 0),
                            prev_fsrs.get("stability", 0.0),
                            prev_fsrs.get("difficulty", 0.0),
                            prev_fsrs.get("elapsed_days", 0),
                            prev_fsrs.get("scheduled_days", 0),
                            prev_fsrs.get("reps", 0),
                            prev_fsrs.get("lapses", 0),
                            prev_fsrs.get("last_review"),
                            prev_fsrs.get("due_date"),
                            self._now_utc(),
                            card_id
                        )
                    )
                except Exception:
                    pass
            else:
                conn.execute(
                    "UPDATE card_fsrs SET state = ?, updated_at = ? WHERE card_id = ?",
                    (log_dict["state"], self._now_utc(), card_id)
                )
                
            conn.execute("DELETE FROM review_logs WHERE id = ?", (log_id,))
            conn.commit()
            return {"status": "ok", "card_id": card_id, "log_id": log_id}

    def create_deck(self, deck_name: str) -> Dict[str, Any]:
        with db_session(self.db_path) as conn:
            return self._get_deck_settings_conn(conn, deck_name)

    def get_available_decks(self) -> List[str]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            decks = set()
            rows = conn.execute(
                "SELECT DISTINCT deck_name FROM cards WHERE deck_name IS NOT NULL AND deck_name != ''"
            ).fetchall()
            for r in rows:
                if r[0]:
                    decks.add(r[0])

            settings_rows = conn.execute(
                "SELECT deck_name FROM deck_settings WHERE deck_name IS NOT NULL AND deck_name != ''"
            ).fetchall()
            for r in settings_rows:
                d = r[0]
                if d and d != "Default":
                    decks.add(d)

            has_local_default = conn.execute(
                "SELECT 1 FROM cards WHERE deck_name = 'Default' LIMIT 1"
            ).fetchone() is not None

        anki_has_default_cards = False
        try:
            from app.services.anki_connect import AnkiConnectService
            anki = AnkiConnectService()
            if anki.is_available():
                anki_decks = anki.list_decks()
                for d in anki_decks:
                    if d and d != "Default":
                        decks.add(d)
                    elif d == "Default":
                        def_stats = anki.get_deck_stats(["Default"])
                        if def_stats:
                            for s in def_stats.values():
                                if s.get("total_in_deck", 0) > 0:
                                    anki_has_default_cards = True
        except Exception:
            pass

        if has_local_default or anki_has_default_cards:
            decks.add("Default")

        if not decks:
            decks.add("Default")

        return sorted(list(decks))

    def get_cards_without_fsrs(self) -> List[Dict[str, Any]]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            rows = conn.execute(
                """
                SELECT c.id, c.expression, c.reading, c.anki_note_id, f.anki_card_id, f.state
                FROM cards c
                LEFT JOIN card_fsrs f ON c.id = f.card_id
                WHERE f.card_id IS NULL OR f.anki_card_id IS NULL
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def init_fsrs_from_anki(
        self,
        card_id: int,
        anki_card_id: int,
        reps: int,
        lapses: int,
        interval: int,
        due_timestamp: Optional[int] = None
    ) -> None:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            now_str = self._now_utc()

            existing = conn.execute(
                "SELECT reps, sync_state FROM card_fsrs WHERE card_id = ?",
                (card_id,)
            ).fetchone()
            has_unsynced_logs = conn.execute(
                "SELECT 1 FROM review_logs WHERE card_id = ? AND synced_to_anki = 0 LIMIT 1",
                (card_id,)
            ).fetchone() is not None

            if existing and (
                int(existing["reps"] or 0) > 0
                or existing["sync_state"] == "pending_anki"
                or has_unsynced_logs
            ):
                # Preserve local Kiroku review progress; only attach the Anki card link.
                conn.execute(
                    "UPDATE card_fsrs SET anki_card_id = ?, updated_at = ? WHERE card_id = ?",
                    (anki_card_id, now_str, card_id)
                )
                conn.commit()
                return

            due_date = None
            if due_timestamp and due_timestamp > 1_000_000_000:
                due_date = datetime.fromtimestamp(due_timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
            elif due_timestamp is not None and reps > 0:
                # Anki integer day index or review card due flag:
                # If reps > 0 and card was imported with due set, default to today
                due_date = self._today_utc()
            elif interval > 0:
                due_date = (datetime.now(timezone.utc) + timedelta(days=interval)).strftime("%Y-%m-%d")

            state = 2 if reps > 0 else 0
            stability = max(1.0, float(interval)) if interval > 0 else 0.0

            conn.execute(
                """
                INSERT INTO card_fsrs (
                    card_id, anki_card_id, state, stability, difficulty,
                    elapsed_days, scheduled_days, reps, lapses, due_date,
                    sync_state, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 5.0, ?, ?, ?, ?, ?, 'synced', ?, ?)
                ON CONFLICT(card_id) DO UPDATE SET
                    anki_card_id = excluded.anki_card_id,
                    state = excluded.state,
                    stability = excluded.stability,
                    scheduled_days = excluded.scheduled_days,
                    reps = excluded.reps,
                    lapses = excluded.lapses,
                    due_date = excluded.due_date,
                    sync_state = 'synced',
                    updated_at = excluded.updated_at
                """,
                (
                    card_id, anki_card_id, state, stability, interval, interval,
                    reps, lapses, due_date, now_str, now_str
                )
            )
            conn.commit()

    def has_pending_anki_reviews(self) -> bool:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            row = conn.execute(
                "SELECT 1 FROM review_logs WHERE synced_to_anki = 0 LIMIT 1"
            ).fetchone()
            return row is not None

    def is_review_log_synced(self, log_id: int) -> bool:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            row = conn.execute(
                "SELECT synced_to_anki FROM review_logs WHERE id = ?",
                (log_id,)
            ).fetchone()
            return bool(row and int(row["synced_to_anki"] or 0) == 1)

    def get_card_anki_identity(self, card_id: int) -> Optional[Dict[str, Any]]:
        with db_session(self.db_path) as conn:
            row = conn.execute(
                "SELECT id, expression, reading, deck_name, anki_note_id FROM cards WHERE id = ?",
                (card_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_pending_anki_card_ids(self) -> set[int]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            log_rows = conn.execute(
                "SELECT DISTINCT card_id FROM review_logs WHERE synced_to_anki = 0"
            ).fetchall()
            fsrs_rows = conn.execute(
                "SELECT card_id FROM card_fsrs WHERE sync_state = 'pending_anki'"
            ).fetchall()
            pending_ids = {int(r["card_id"]) for r in log_rows if r["card_id"] is not None}
            pending_ids.update(int(r["card_id"]) for r in fsrs_rows if r["card_id"] is not None)
            return pending_ids

    def get_pending_anki_reviews(self) -> List[Dict[str, Any]]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            rows = conn.execute(
                """
                SELECT l.id as log_id, l.card_id, l.rating, l.reviewed_at,
                       f.anki_card_id, c.anki_note_id, c.expression, c.reading, c.deck_name
                FROM review_logs l
                LEFT JOIN card_fsrs f ON l.card_id = f.card_id
                LEFT JOIN cards c ON l.card_id = c.id
                WHERE l.synced_to_anki = 0
                ORDER BY l.reviewed_at ASC, l.id ASC
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def mark_review_synced(self, log_id: Optional[int] = None, card_id: Optional[int] = None) -> None:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            if log_id is not None:
                conn.execute("UPDATE review_logs SET synced_to_anki = 1 WHERE id = ?", (log_id,))
            if card_id is not None:
                still_pending = conn.execute(
                    "SELECT 1 FROM review_logs WHERE card_id = ? AND synced_to_anki = 0 LIMIT 1",
                    (card_id,)
                ).fetchone()
                new_state = "pending_anki" if still_pending else "synced"
                conn.execute(
                    "UPDATE card_fsrs SET sync_state = ?, updated_at = ? WHERE card_id = ?",
                    (new_state, self._now_utc(), card_id)
                )
            conn.commit()

    def get_all_linked_anki_cards(self, deck_name: Optional[str] = None) -> List[Dict[str, Any]]:
        with db_session(self.db_path) as conn:
            ensure_review_tables(conn)
            if not deck_name or deck_name == "All":
                rows = conn.execute(
                    """
                    SELECT c.id, c.deck_name, f.anki_card_id, f.reps, f.lapses,
                           f.scheduled_days, f.last_review, f.due_date, f.is_suspended
                    FROM cards c
                    JOIN card_fsrs f ON c.id = f.card_id
                    WHERE f.anki_card_id IS NOT NULL
                    """
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT c.id, c.deck_name, f.anki_card_id, f.reps, f.lapses,
                           f.scheduled_days, f.last_review, f.due_date, f.is_suspended
                    FROM cards c
                    JOIN card_fsrs f ON c.id = f.card_id
                    WHERE f.anki_card_id IS NOT NULL AND (c.deck_name = ? OR (? = 'Default' AND (c.deck_name IS NULL OR c.deck_name = '')))
                    """,
                    (deck_name, deck_name)
                ).fetchall()
            return [dict(r) for r in rows]
