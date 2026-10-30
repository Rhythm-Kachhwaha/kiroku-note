"""
Practice Session Lifecycle & Persistence Service.
------------------------------------------------
Orchestrates practice session creation, deterministic candidate selection, item presentation,
answer grading, difficulty feedback capture, timing persistence, and lifecycle transitions.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import random
import sqlite3
from typing import Any, List, Optional

from app.study.media import MediaStore
from app.study.session.adaptive import (
    select_practice_candidates,
    update_question_adaptive_state,
)
from app.study.session.enums import (
    DifficultyRating,
    GradingStatus,
    SessionStatus,
    SessionType,
)
from app.study.session.grading import DeterministicGrader, GradingError
from app.study.session.models import (
    ChoicePresentation,
    DifficultySubmission,
    GradingResult,
    GroupContextPresentation,
    GroupPartPresentation,
    PracticeItemPresentation,
    PracticeSessionConfig,
    PracticeSessionState,
)
from app.study.tx import unit_of_work
from app.study.ulid import generate_ulid


MAX_QUESTION_TIME_MS = 1_800_000  # 30 minutes cap per question to prevent idle distortion


class SessionServiceError(Exception):
    """Base exception for session operations."""
    pass


class SessionNotFoundError(SessionServiceError):
    """Raised when the specified session does not exist."""
    pass


class SessionLifecycleError(SessionServiceError):
    """Raised when an operation is invalid for current session status."""
    pass


class AlreadyAnsweredError(SessionServiceError):
    """Raised when an attempt item has already received a graded response."""
    pass


class NoEligibleQuestionsError(SessionServiceError):
    """Raised when no eligible approved questions meet the practice criteria."""
    pass


class PracticeSessionService:
    """
    Manages the full lifecycle and persistence of practice sessions.
    """

    def __init__(self, conn: sqlite3.Connection, media_store: Optional[MediaStore] = None):
        self.conn = conn
        self.media_store = media_store or MediaStore()

    def create_session(self, config: PracticeSessionConfig) -> PracticeSessionState:
        """
        Create and persist a new practice session with deterministically ordered items.
        """
        with unit_of_work(self.conn):
            seed = config.seed if config.seed is not None else random.randint(1, 1_000_000_000)

            # 1. Select eligible candidate questions from the approved question bank
            candidates = select_practice_candidates(
                conn=self.conn,
                level=config.level,
                category=config.category,
                format_code=config.format_code,
                limit=config.question_count,
                seed=seed,
                verify_files=True,
                media_store=self.media_store,
            )

            if not candidates:
                raise NoEligibleQuestionsError(
                    f"No eligible questions found matching criteria: level={config.level}, "
                    f"category={config.category}, format={config.format_code}."
                )

            external_id = generate_ulid()
            now_iso = datetime.now(timezone.utc).isoformat()
            recipe_json = config.model_dump_json()

            # 2. Persist test_attempt
            cursor = self.conn.execute(
                """
                INSERT INTO test_attempt (
                    external_id,
                    session_type,
                    status,
                    level,
                    category,
                    format_code,
                    recipe_snapshot_json,
                    seed,
                    created_at,
                    started_at,
                    total_elapsed_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0);
                """,
                (
                    external_id,
                    config.session_type.value,
                    SessionStatus.CREATED.value,
                    config.level,
                    config.category,
                    config.format_code,
                    recipe_json,
                    seed,
                    now_iso,
                ),
            )
            attempt_id = cursor.lastrowid

            # 3. Persist attempt items and their choice ordering
            for pos, (q_id, rev_id) in enumerate(candidates, start=1):
                q_row = self.conn.execute(
                    "SELECT content_group_id, anchor_key FROM question WHERE id = ?;",
                    (q_id,),
                ).fetchone()

                group_id = q_row["content_group_id"]
                anchor_key = q_row["anchor_key"]
                group_rev_id = None
                if group_id is not None:
                    grp_row = self.conn.execute(
                        "SELECT current_revision_id FROM content_group WHERE id = ?;",
                        (group_id,),
                    ).fetchone()
                    if grp_row:
                        group_rev_id = grp_row["current_revision_id"]

                item_cursor = self.conn.execute(
                    """
                    INSERT INTO attempt_item (
                        attempt_id,
                        position,
                        question_id,
                        pinned_question_revision_id,
                        group_id,
                        pinned_group_revision_id,
                        anchor_key,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        attempt_id,
                        pos,
                        q_id,
                        rev_id,
                        group_id,
                        group_rev_id,
                        anchor_key,
                        now_iso,
                    ),
                )
                item_id = item_cursor.lastrowid

                # Pin choice presentation ordering
                choices = self.conn.execute(
                    """
                    SELECT id, ordinal
                    FROM revision_choice
                    WHERE question_revision_id = ?
                    ORDER BY ordinal ASC;
                    """,
                    (rev_id,),
                ).fetchall()

                for disp_pos, ch in enumerate(choices, start=1):
                    self.conn.execute(
                        """
                        INSERT INTO attempt_item_choice_order (
                            attempt_item_id,
                            choice_id,
                            display_position,
                            created_at
                        ) VALUES (?, ?, ?, ?);
                        """,
                        (item_id, ch["id"], disp_pos, now_iso),
                    )

            return self.get_session(attempt_id)

    def get_session(self, session_id_or_external_id: int | str) -> PracticeSessionState:
        """
        Retrieve persisted session state including all items and current progress.
        """
        row = self.conn.execute(
            """
            SELECT * FROM test_attempt
            WHERE id = ? OR external_id = ?;
            """,
            (
                session_id_or_external_id if isinstance(session_id_or_external_id, int) else -1,
                str(session_id_or_external_id),
            ),
        ).fetchone()

        if not row:
            raise SessionNotFoundError(f"Session '{session_id_or_external_id}' not found.")

        attempt_id = row["id"]

        # Fetch attempt items
        item_rows = self.conn.execute(
            """
            SELECT
                ai.id as attempt_item_id,
                ai.position,
                ai.question_id,
                ai.pinned_question_revision_id,
                ai.group_id,
                ai.pinned_group_revision_id,
                ai.presented_at,
                q.external_id as question_external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                r.selected_choice_id,
                r.is_correct,
                aif.difficulty_rating
            FROM attempt_item ai
            JOIN question q ON ai.question_id = q.id
            JOIN question_revision qr ON ai.pinned_question_revision_id = qr.id
            LEFT JOIN response r ON ai.id = r.attempt_item_id
            LEFT JOIN attempt_item_feedback aif ON ai.id = aif.attempt_item_id
            WHERE ai.attempt_id = ?
            ORDER BY ai.position ASC;
            """,
            (attempt_id,),
        ).fetchall()

        items: List[PracticeItemPresentation] = []
        answered_count = 0
        current_pos = 1

        for it in item_rows:
            # Choices ordered by pinned display position
            choice_rows = self.conn.execute(
                """
                SELECT
                    rc.id as choice_id,
                    rc.choice_key,
                    aico.display_position,
                    rc.label,
                    rc.text_markup,
                    rc.asset_id
                FROM attempt_item_choice_order aico
                JOIN revision_choice rc ON aico.choice_id = rc.id
                WHERE aico.attempt_item_id = ?
                ORDER BY aico.display_position ASC;
                """,
                (it["attempt_item_id"],),
            ).fetchall()

            choices = [
                ChoicePresentation(
                    choice_id=cr["choice_id"],
                    choice_key=cr["choice_key"],
                    display_position=cr["display_position"],
                    label=cr["label"],
                    mode="image" if cr["asset_id"] is not None else "text",
                    text_markup=cr["text_markup"],
                    asset_id=cr["asset_id"],
                )
                for cr in choice_rows
            ]

            # Context group (if any)
            group_ctx = None
            if it["group_id"] is not None and it["pinned_group_revision_id"] is not None:
                grp_row = self.conn.execute(
                    "SELECT id, kind FROM content_group WHERE id = ?;",
                    (it["group_id"],),
                ).fetchone()
                if grp_row:
                    part_rows = self.conn.execute(
                        """
                        SELECT ordinal, role, markup
                        FROM group_revision_part
                        WHERE group_revision_id = ?
                        ORDER BY ordinal ASC;
                        """,
                        (it["pinned_group_revision_id"],),
                    ).fetchall()
                    parts = [
                        GroupPartPresentation(
                            ordinal=pr["ordinal"],
                            role=pr["role"],
                            title="",
                            markup=pr["markup"],
                        )
                        for pr in part_rows
                    ]
                    group_ctx = GroupContextPresentation(
                        group_id=grp_row["id"],
                        group_kind=grp_row["kind"],
                        title="",
                        parts=parts,
                    )

            is_answered = (it["selected_choice_id"] is not None)
            if is_answered:
                answered_count += 1

            rating = DifficultyRating(it["difficulty_rating"]) if it["difficulty_rating"] else None

            items.append(
                PracticeItemPresentation(
                    attempt_item_id=it["attempt_item_id"],
                    position=it["position"],
                    question_id=it["question_id"],
                    external_id=it["question_external_id"],
                    level=it["level"],
                    category=it["category"],
                    format_code=it["format_code"],
                    prompt_markup=it["prompt_markup"],
                    choices=choices,
                    group_context=group_ctx,
                    presented_at=it["presented_at"],
                    is_answered=is_answered,
                    submitted_choice_id=it["selected_choice_id"],
                    is_correct=bool(it["is_correct"]) if is_answered else None,
                    difficulty_rating=rating,
                )
            )

        # Determine current active position
        for it in items:
            if not it.is_answered:
                current_pos = it.position
                break
        else:
            current_pos = len(items) if items else 1

        return PracticeSessionState(
            session_id=row["id"],
            external_id=row["external_id"],
            session_type=SessionType(row["session_type"]),
            status=SessionStatus(row["status"]),
            level=row["level"],
            category=row["category"],
            format_code=row["format_code"],
            total_questions=len(items),
            answered_count=answered_count,
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            total_elapsed_ms=row["total_elapsed_ms"],
            current_position=current_pos,
            items=items,
        )

    def present_item(self, session_id: int, position: int) -> PracticeItemPresentation:
        """
        Record presentation timestamp and return item presentation without revealing canonical answer.
        """
        with unit_of_work(self.conn):
            sess = self.get_session(session_id)
            if sess.status in (SessionStatus.COMPLETED, SessionStatus.ABANDONED):
                raise SessionLifecycleError(f"Cannot present item in a {sess.status.value} session.")

            now_iso = datetime.now(timezone.utc).isoformat()

            # If session is still in created status, activate it
            if sess.status == SessionStatus.CREATED:
                self.conn.execute(
                    """
                    UPDATE test_attempt
                    SET status = ?, started_at = COALESCE(started_at, ?), last_active_at = ?
                    WHERE id = ?;
                    """,
                    (SessionStatus.IN_PROGRESS.value, now_iso, now_iso, session_id),
                )

            target_item = None
            for item in sess.items:
                if item.position == position:
                    target_item = item
                    break

            if not target_item:
                raise SessionServiceError(f"Item position {position} not found in session {session_id}.")

            # If presented_at has not been set yet, record it
            if not target_item.presented_at:
                self.conn.execute(
                    "UPDATE attempt_item SET presented_at = ? WHERE id = ?;",
                    (now_iso, target_item.attempt_item_id),
                )
                target_item.presented_at = now_iso

            return target_item

    def submit_answer(
        self,
        session_id: int,
        attempt_item_id: int,
        selected_choice_id: int,
        time_spent_ms: int,
        difficulty_rating: Optional[DifficultyRating] = None,
    ) -> GradingResult:
        """
        Deterministically grade an answer submission, persist response, feedback, timing,
        and update adaptive repetition state.
        """
        with unit_of_work(self.conn):
            # 1. Validate session status
            sess_row = self.conn.execute(
                "SELECT id, status, total_elapsed_ms FROM test_attempt WHERE id = ?;",
                (session_id,),
            ).fetchone()

            if not sess_row:
                raise SessionNotFoundError(f"Session {session_id} not found.")

            current_status = SessionStatus(sess_row["status"])
            if current_status in (SessionStatus.COMPLETED, SessionStatus.ABANDONED):
                raise SessionLifecycleError(f"Cannot submit answer to a {current_status.value} session.")

            # 2. Timing validation
            if time_spent_ms < 0:
                raise SessionServiceError(f"Invalid negative time_spent_ms: {time_spent_ms}.")
            validated_time_ms = min(time_spent_ms, MAX_QUESTION_TIME_MS)

            # 3. Check for existing response
            existing_resp = self.conn.execute(
                "SELECT id FROM response WHERE attempt_item_id = ?;",
                (attempt_item_id,),
            ).fetchone()
            if existing_resp:
                raise AlreadyAnsweredError(f"Attempt item {attempt_item_id} has already been answered.")

            # 4. Activate session if in 'created' state
            now_iso = datetime.now(timezone.utc).isoformat()
            if current_status == SessionStatus.CREATED:
                self.conn.execute(
                    """
                    UPDATE test_attempt
                    SET status = ?, started_at = COALESCE(started_at, ?), last_active_at = ?
                    WHERE id = ?;
                    """,
                    (SessionStatus.IN_PROGRESS.value, now_iso, now_iso, session_id),
                )

            # 5. Deterministically grade submission
            grading_result = DeterministicGrader.grade_attempt(
                conn=self.conn,
                attempt_item_id=attempt_item_id,
                selected_choice_id=selected_choice_id,
                time_spent_ms=validated_time_ms,
                difficulty_rating=difficulty_rating,
            )

            # 6. Fetch pinned revision id and question id
            item_row = self.conn.execute(
                "SELECT question_id, pinned_question_revision_id FROM attempt_item WHERE id = ?;",
                (attempt_item_id,),
            ).fetchone()
            question_id = item_row["question_id"]
            pinned_rev_id = item_row["pinned_question_revision_id"]

            # Fetch submitted answer label/choice_key
            submitted_label_row = self.conn.execute(
                "SELECT choice_key FROM revision_choice WHERE id = ?;",
                (selected_choice_id,),
            ).fetchone()
            submitted_answer = submitted_label_row["choice_key"] if submitted_label_row else str(selected_choice_id)

            # 7. Persist into response table
            self.conn.execute(
                """
                INSERT INTO response (
                    attempt_item_id,
                    selected_choice_id,
                    pinned_question_revision_id,
                    is_correct,
                    grading_status,
                    submitted_answer,
                    canonical_choice_id,
                    time_spent_ms,
                    answered_at,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    attempt_item_id,
                    selected_choice_id,
                    pinned_rev_id,
                    1 if grading_result.is_correct else 0,
                    grading_result.grading_status.value,
                    submitted_answer,
                    grading_result.canonical_choice_id,
                    validated_time_ms,
                    now_iso,
                    now_iso,
                ),
            )

            # 8. Persist optional difficulty feedback
            if difficulty_rating is not None:
                self.conn.execute(
                    """
                    INSERT INTO attempt_item_feedback (
                        attempt_item_id,
                        difficulty_rating,
                        created_at
                    ) VALUES (?, ?, ?)
                    ON CONFLICT(attempt_item_id) DO UPDATE SET
                        difficulty_rating = excluded.difficulty_rating;
                    """,
                    (attempt_item_id, difficulty_rating.value, now_iso),
                )

            # 9. Update question adaptive repetition state
            update_question_adaptive_state(
                conn=self.conn,
                question_id=question_id,
                is_correct=grading_result.is_correct,
                difficulty_rating=difficulty_rating,
                session_id=session_id,
            )

            # 10. Update session timing and check completion
            new_total_elapsed = sess_row["total_elapsed_ms"] + validated_time_ms
            self.conn.execute(
                """
                UPDATE test_attempt
                SET total_elapsed_ms = ?, last_active_at = ?
                WHERE id = ?;
                """,
                (new_total_elapsed, now_iso, session_id),
            )

            # Check if all items in session are answered
            unanswered_row = self.conn.execute(
                """
                SELECT COUNT(*) as c
                FROM attempt_item ai
                LEFT JOIN response r ON ai.id = r.attempt_item_id
                WHERE ai.attempt_id = ? AND r.id IS NULL;
                """,
                (session_id,),
            ).fetchone()

            if unanswered_row["c"] == 0:
                self.conn.execute(
                    """
                    UPDATE test_attempt
                    SET status = ?, completed_at = ?
                    WHERE id = ?;
                    """,
                    (SessionStatus.COMPLETED.value, now_iso, session_id),
                )

            return grading_result

    def submit_feedback(
        self,
        session_id: int,
        attempt_item_id: int,
        difficulty_rating: DifficultyRating,
    ) -> None:
        """
        Submit or adjust difficulty rating after answering and update adaptive state.
        """
        with unit_of_work(self.conn):
            # Validate attempt item belongs to session and is answered
            row = self.conn.execute(
                """
                SELECT ai.question_id, r.is_correct
                FROM attempt_item ai
                JOIN response r ON ai.id = r.attempt_item_id
                WHERE ai.id = ? AND ai.attempt_id = ?;
                """,
                (attempt_item_id, session_id),
            ).fetchone()

            if not row:
                raise SessionServiceError(
                    f"Attempt item {attempt_item_id} in session {session_id} not found or not yet answered."
                )

            question_id = row["question_id"]
            is_correct = bool(row["is_correct"])
            now_iso = datetime.now(timezone.utc).isoformat()

            # Persist feedback
            self.conn.execute(
                """
                INSERT INTO attempt_item_feedback (
                    attempt_item_id,
                    difficulty_rating,
                    created_at
                ) VALUES (?, ?, ?)
                ON CONFLICT(attempt_item_id) DO UPDATE SET
                    difficulty_rating = excluded.difficulty_rating;
                """,
                (attempt_item_id, difficulty_rating.value, now_iso),
            )

            # Update adaptive repetition state with the new rating
            update_question_adaptive_state(
                conn=self.conn,
                question_id=question_id,
                is_correct=is_correct,
                difficulty_rating=difficulty_rating,
                session_id=session_id,
            )

    def complete_session(self, session_id: int) -> PracticeSessionState:
        """
        Explicitly transition an active session to completed status.
        """
        with unit_of_work(self.conn):
            sess = self.get_session(session_id)
            if sess.status in (SessionStatus.COMPLETED, SessionStatus.ABANDONED):
                return sess

            now_iso = datetime.now(timezone.utc).isoformat()
            self.conn.execute(
                """
                UPDATE test_attempt
                SET status = ?, completed_at = ?, last_active_at = ?
                WHERE id = ?;
                """,
                (SessionStatus.COMPLETED.value, now_iso, now_iso, session_id),
            )
            return self.get_session(session_id)

    def abandon_session(self, session_id: int) -> PracticeSessionState:
        """
        Explicitly transition an active session to abandoned status.
        """
        with unit_of_work(self.conn):
            sess = self.get_session(session_id)
            if sess.status == SessionStatus.COMPLETED:
                raise SessionLifecycleError("Cannot abandon an already completed session.")

            now_iso = datetime.now(timezone.utc).isoformat()
            self.conn.execute(
                """
                UPDATE test_attempt
                SET status = ?, last_active_at = ?
                WHERE id = ?;
                """,
                (SessionStatus.ABANDONED.value, now_iso, session_id),
            )
            return self.get_session(session_id)
