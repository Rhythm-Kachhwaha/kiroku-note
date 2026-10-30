"""
JLPT Examination Lifecycle & Session Persistence Service.
--------------------------------------------------------
Orchestrates exam creation, blueprint verification, section boundaries,
countdown deadlines, draft answer selection, mark-for-review tracking,
response grading, and immutable result snapshotting.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import random
import sqlite3
from typing import Any, List, Optional, Set, Tuple

from app.study.exam.blueprint import (
    DEFAULT_BLUEPRINT_VERSION,
    get_blueprint_from_db_or_default,
    get_official_blueprint,
    save_blueprint_to_db,
)
from app.study.exam.enums import (
    ExamSectionStatus,
    PassFailAssessment,
    ReadinessStatus,
)
from app.study.exam.models import (
    ExamBlueprint,
    ExamItemPresentation,
    ExamReadinessReport,
    ExamResult,
    ExamSectionState,
    ExamSessionState,
)
from app.study.exam.scoring import ProvisionalRawScoringModel, ScoringModel
from app.study.exam.validator import ExamReadinessValidator
from app.study.media import MediaStore
from app.study.session.enums import DifficultyRating, SessionStatus, SessionType
from app.study.session.grading import DeterministicGrader
from app.study.session.models import (
    ChoicePresentation,
    GroupContextPresentation,
    GroupPartPresentation,
    PracticeSessionConfig,
    PracticeSessionState,
)
from app.study.session.service import (
    PracticeSessionService,
    SessionLifecycleError,
    SessionNotFoundError,
)
from app.study.tx import unit_of_work
from app.study.ulid import generate_ulid


class ExamServiceError(Exception):
    """Base exception for examination service errors."""
    pass


class ExamReadinessError(ExamServiceError):
    """Raised when question bank cannot fulfill blueprint requirements."""
    def __init__(self, report: ExamReadinessReport):
        self.report = report
        super().__init__(f"Exam generation blocked for level {report.level}: {len(report.blocked_reasons)} unmet requirements.")


class ExamSectionClosedError(ExamServiceError):
    """Raised when an action is attempted on an expired or completed section."""
    pass


class ExamSectionSequenceError(ExamServiceError):
    """Raised when attempting to access sections out of strict examination order."""
    pass


class ExamSessionService:
    """
    Manages the persistent lifecycle of JLPT examination simulations.
    """

    def __init__(
        self,
        conn: sqlite3.Connection,
        media_store: Optional[MediaStore] = None,
        scoring_model: Optional[ScoringModel] = None,
    ):
        self.conn = conn
        self.media_store = media_store
        self.scoring_model = scoring_model or ProvisionalRawScoringModel()

    # -------------------------------------------------------------------------
    # 1. Exam Generation & Diagnostic Practice
    # -------------------------------------------------------------------------

    def create_examination(
        self,
        blueprint_or_level: ExamBlueprint | str,
        seed: Optional[int] = None,
        version: Optional[str] = None,
    ) -> ExamSessionState:
        """
        Generate and persist a complete JLPT examination matching the blueprint.
        Strictly blocks generation if the question bank is incomplete.
        """
        with unit_of_work(self.conn):
            # Resolve blueprint
            if isinstance(blueprint_or_level, ExamBlueprint):
                blueprint = blueprint_or_level
            else:
                blueprint = get_blueprint_from_db_or_default(self.conn, blueprint_or_level, version)

            # 1. Validate bank readiness against blueprint
            readiness_report = ExamReadinessValidator.validate_readiness(
                conn=self.conn,
                blueprint=blueprint,
                media_store=self.media_store,
                verify_files=True,
            )
            if not readiness_report.is_ready:
                raise ExamReadinessError(readiness_report)

            actual_seed = seed if seed is not None else random.randint(1, 1_000_000_000)
            rng = random.Random(actual_seed)
            now_iso = datetime.now(timezone.utc).isoformat()
            external_id = generate_ulid()

            # Save blueprint to ledger if not present
            save_blueprint_to_db(self.conn, blueprint)

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
                ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 0);
                """,
                (
                    external_id,
                    SessionType.EXAM.value,
                    SessionStatus.CREATED.value,
                    blueprint.level,
                    blueprint.model_dump_json(),
                    actual_seed,
                    now_iso,
                ),
            )
            attempt_id = cursor.lastrowid

            # 3. Create test sections and select questions deterministically
            used_question_ids: Set[int] = set()
            overall_position = 1

            for sec_bp in blueprint.test_sections:
                allocated_sec = sec_bp.time_limit_minutes * 60

                sec_cursor = self.conn.execute(
                    """
                    INSERT INTO exam_section_attempt (
                        attempt_id,
                        section_code,
                        block_order,
                        label,
                        status,
                        allocated_time_seconds,
                        remaining_time_seconds,
                        started_at,
                        deadline_at,
                        paused_at,
                        completed_at,
                        total_elapsed_ms,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?);
                    """,
                    (
                        attempt_id,
                        sec_bp.section_code,
                        sec_bp.block_order,
                        sec_bp.label,
                        ExamSectionStatus.PENDING.value,
                        allocated_sec,
                        allocated_sec,
                        now_iso,
                    ),
                )
                sec_attempt_id = sec_cursor.lastrowid

                # Select questions for each quota in this section
                for quota in sec_bp.item_quotas:
                    eligible = ExamReadinessValidator.get_eligible_questions_for_format(
                        conn=self.conn,
                        level=blueprint.level,
                        format_code=quota.format_code,
                        media_store=self.media_store,
                        verify_files=True,
                    )
                    # Deduplicate against questions already placed in this exam
                    available_unclaimed = [item for item in eligible if item[0] not in used_question_ids]
                    # Deterministic shuffle using seed
                    rng.shuffle(available_unclaimed)
                    selected = available_unclaimed[:quota.target_count]

                    for q_id, rev_id in selected:
                        used_question_ids.add(q_id)

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

                        # Persist attempt item
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
                                overall_position,
                                q_id,
                                rev_id,
                                group_id,
                                group_rev_id,
                                anchor_key,
                                now_iso,
                            ),
                        )
                        attempt_item_id = item_cursor.lastrowid

                        # Pin choice display ordering
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
                                (attempt_item_id, ch["id"], disp_pos, now_iso),
                            )

                        # Persist initial exam item state linking item to this section
                        self.conn.execute(
                            """
                            INSERT INTO exam_item_state (
                                attempt_item_id,
                                section_attempt_id,
                                selected_choice_id,
                                is_marked_for_review,
                                time_spent_ms,
                                updated_at
                            ) VALUES (?, ?, NULL, 0, 0, ?);
                            """,
                            (attempt_item_id, sec_attempt_id, now_iso),
                        )

                        overall_position += 1

            return self.peek_state(attempt_id)

    def create_diagnostic_practice(
        self,
        level: str,
        question_count: int = 15,
        seed: Optional[int] = None,
    ) -> PracticeSessionState:
        """
        Create a separate diagnostic practice session from available questions.
        Explicitly runs in practice mode and never generates official pass/fail verdicts.
        """
        practice_service = PracticeSessionService(self.conn)
        config = PracticeSessionConfig(
            level=level,
            question_count=question_count,
            seed=seed,
            session_type=SessionType.PRACTICE,
        )
        return practice_service.create_session(config)

    # -------------------------------------------------------------------------
    # 2. Examination Runtime State & Timer Sync
    # -------------------------------------------------------------------------

    def peek_state(self, session_id_or_external_id: int | str) -> ExamSessionState:
        """
        Pure read operation retrieving persisted exam state without writing to SQLite.

        Calculates remaining time from the stored deadline in memory.
        Safe to call repeatedly while UI polls.
        """
        # Fetch attempt record
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
            raise SessionNotFoundError(f"Exam session '{session_id_or_external_id}' not found.")

        attempt_id = row["id"]
        external_id = row["external_id"]
        level = row["level"]
        status = row["status"]
        blueprint_json = row["recipe_snapshot_json"] or "{}"
        blueprint_data = json.loads(blueprint_json)
        bp_version = blueprint_data.get("version", DEFAULT_BLUEPRINT_VERSION)

        now = datetime.now(timezone.utc)

        # Fetch sections
        sec_rows = self.conn.execute(
            """
            SELECT * FROM exam_section_attempt
            WHERE attempt_id = ?
            ORDER BY block_order ASC;
            """,
            (attempt_id,),
        ).fetchall()

        sections: List[ExamSectionState] = []
        active_block_order = 1

        for s_row in sec_rows:
            sec_id = s_row["id"]
            sec_status = ExamSectionStatus(s_row["status"])
            rem_sec = s_row["remaining_time_seconds"]
            started_at = s_row["started_at"]
            deadline_at = s_row["deadline_at"]
            paused_at = s_row["paused_at"]
            completed_at = s_row["completed_at"]
            elapsed_ms = s_row["total_elapsed_ms"]

            # Pure read calculation: compute remaining seconds from stored deadline in memory
            if sec_status == ExamSectionStatus.IN_PROGRESS and deadline_at:
                dl_dt = datetime.fromisoformat(deadline_at)
                if dl_dt.tzinfo is None:
                    dl_dt = dl_dt.replace(tzinfo=timezone.utc)
                rem_sec = max(0, int((dl_dt - now).total_seconds()))

            sections.append(
                ExamSectionState(
                    section_id=sec_id,
                    section_code=s_row["section_code"],
                    block_order=s_row["block_order"],
                    label=s_row["label"],
                    status=sec_status,
                    allocated_time_seconds=s_row["allocated_time_seconds"],
                    remaining_time_seconds=rem_sec,
                    started_at=started_at,
                    deadline_at=deadline_at,
                    paused_at=paused_at,
                    completed_at=completed_at,
                    total_elapsed_ms=elapsed_ms,
                )
            )

        # Determine active section order
        for s in sections:
            if s.status in (ExamSectionStatus.IN_PROGRESS, ExamSectionStatus.PAUSED, ExamSectionStatus.PENDING):
                active_block_order = s.block_order
                break
        else:
            active_block_order = len(sections) if sections else 1

        # Fetch items and draft state
        item_rows = self.conn.execute(
            """
            SELECT
                ai.id as attempt_item_id,
                ai.position,
                esa.section_code,
                esa.block_order,
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
                eis.selected_choice_id,
                eis.is_marked_for_review,
                r.is_correct,
                ra.choice_id as canonical_choice_id,
                rc_can.choice_key as canonical_choice_key,
                ra.rationale_markup
            FROM attempt_item ai
            JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
            JOIN exam_section_attempt esa ON eis.section_attempt_id = esa.id
            JOIN question q ON ai.question_id = q.id
            JOIN question_revision qr ON ai.pinned_question_revision_id = qr.id
            LEFT JOIN response r ON ai.id = r.attempt_item_id
            LEFT JOIN revision_answer ra ON ai.pinned_question_revision_id = ra.question_revision_id
            LEFT JOIN revision_choice rc_can ON ra.choice_id = rc_can.id
            WHERE ai.attempt_id = ?
            ORDER BY ai.position ASC;
            """,
            (attempt_id,),
        ).fetchall()

        items: List[ExamItemPresentation] = []
        answered_count = 0
        marked_count = 0
        is_exam_completed = (status == SessionStatus.COMPLETED.value)

        for it in item_rows:
            # Pinned choice presentations
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

            # Content group (if any)
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
            if it["is_marked_for_review"]:
                marked_count += 1

            # Only reveal canonical answers and correctness once exam is completed
            post_is_correct = bool(it["is_correct"]) if (is_exam_completed and is_answered and it["is_correct"] is not None) else None
            post_canonical_id = it["canonical_choice_id"] if is_exam_completed else None
            post_canonical_key = it["canonical_choice_key"] if is_exam_completed else None
            post_rationale = (it["rationale_markup"] or "") if is_exam_completed else None

            items.append(
                ExamItemPresentation(
                    attempt_item_id=it["attempt_item_id"],
                    position=it["position"],
                    section_code=it["section_code"],
                    block_order=it["block_order"],
                    question_id=it["question_id"],
                    external_id=it["question_external_id"],
                    level=it["level"],
                    category=it["category"],
                    format_code=it["format_code"],
                    prompt_markup=it["prompt_markup"],
                    choices=choices,
                    group_context=group_ctx,
                    presented_at=it["presented_at"],
                    is_marked_for_review=bool(it["is_marked_for_review"]),
                    is_answered=is_answered,
                    selected_choice_id=it["selected_choice_id"],
                    is_correct=post_is_correct,
                    canonical_choice_id=post_canonical_id,
                    canonical_choice_key=post_canonical_key,
                    rationale_markup=post_rationale,
                )
            )

        return ExamSessionState(
            session_id=attempt_id,
            external_id=external_id,
            level=level,
            status=status,
            blueprint_version=bp_version,
            total_questions=len(items),
            answered_count=answered_count,
            marked_count=marked_count,
            active_section_order=active_block_order,
            sections=sections,
            current_section_items=items,
        )

    def settle_timers(self, session_id_or_external_id: int | str) -> list[int]:
        """
        Check for expired section timers and perform state transitions and response grading.

        This operation is atomic, idempotent, and thread-safe:
        - Executes inside a unit of work.
        - Uses conditional SQL updates so concurrent executions cannot settle the same section twice.
        - Only performs response grading if it successfully claims and transitions an expired section.
        - Avoids duplicate response commits and integrity errors.
        - Automatically finalizes and scores the exam once all sections are finished.
        Returns a list of section IDs settled as expired by this call.
        """
        with unit_of_work(self.conn):
            # Fetch attempt record
            row = self.conn.execute(
                """
                SELECT id, status, recipe_snapshot_json FROM test_attempt
                WHERE id = ? OR external_id = ?;
                """,
                (
                    session_id_or_external_id if isinstance(session_id_or_external_id, int) else -1,
                    str(session_id_or_external_id),
                ),
            ).fetchone()

            if not row:
                raise SessionNotFoundError(f"Exam session '{session_id_or_external_id}' not found.")

            attempt_id = row["id"]
            current_status = row["status"]
            blueprint_json = row["recipe_snapshot_json"] or "{}"

            # If already completed or abandoned, no timer settlement needed
            if current_status in (SessionStatus.COMPLETED.value, SessionStatus.ABANDONED.value):
                return []

            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()

            # Find candidate in-progress sections with active deadline
            sec_rows = self.conn.execute(
                """
                SELECT id, allocated_time_seconds, deadline_at
                FROM exam_section_attempt
                WHERE attempt_id = ? AND status = ? AND deadline_at IS NOT NULL
                ORDER BY block_order ASC;
                """,
                (attempt_id, ExamSectionStatus.IN_PROGRESS.value),
            ).fetchall()

            settled_sec_ids: list[int] = []

            for s_row in sec_rows:
                sec_id = s_row["id"]
                deadline_at = s_row["deadline_at"]
                dl_dt = datetime.fromisoformat(deadline_at)
                if dl_dt.tzinfo is None:
                    dl_dt = dl_dt.replace(tzinfo=timezone.utc)

                if now >= dl_dt:
                    elapsed_ms = s_row["allocated_time_seconds"] * 1000
                    # Conditional atomic claim: transition status ONLY IF status is still 'in_progress'
                    cursor = self.conn.execute(
                        """
                        UPDATE exam_section_attempt
                        SET status = ?, remaining_time_seconds = 0, completed_at = ?, total_elapsed_ms = ?, deadline_at = NULL
                        WHERE id = ? AND status = ?;
                        """,
                        (
                            ExamSectionStatus.EXPIRED.value,
                            deadline_at,
                            elapsed_ms,
                            sec_id,
                            ExamSectionStatus.IN_PROGRESS.value,
                        ),
                    )
                    if cursor.rowcount == 1:
                        settled_sec_ids.append(sec_id)
                        # Grade answered items for expired section ONLY because we successfully claimed it
                        self._commit_section_responses(sec_id)

            # Check if all sections finished and attempt not yet marked completed
            unfinished_row = self.conn.execute(
                """
                SELECT COUNT(*) as unfinished_count
                FROM exam_section_attempt
                WHERE attempt_id = ? AND status NOT IN (?, ?);
                """,
                (
                    attempt_id,
                    ExamSectionStatus.COMPLETED.value,
                    ExamSectionStatus.EXPIRED.value,
                ),
            ).fetchone()

            if unfinished_row["unfinished_count"] == 0:
                # Conditional atomic claim on attempt completion
                cursor = self.conn.execute(
                    """
                    UPDATE test_attempt
                    SET status = ?, completed_at = ?, last_active_at = ?
                    WHERE id = ? AND status != ?;
                    """,
                    (
                        SessionStatus.COMPLETED.value,
                        now_iso,
                        now_iso,
                        attempt_id,
                        SessionStatus.COMPLETED.value,
                    ),
                )
                if cursor.rowcount == 1:
                    # Finalize exam and persist snapshot (idempotent check)
                    snap_exists = self.conn.execute(
                        "SELECT 1 FROM exam_result_snapshot WHERE attempt_id = ?;",
                        (attempt_id,),
                    ).fetchone()
                    if not snap_exists:
                        blueprint_data = json.loads(blueprint_json)
                        self._finalize_and_score_exam(attempt_id, blueprint_data, is_complete=True)

            return settled_sec_ids

    def get_exam_state(self, session_id_or_external_id: int | str) -> ExamSessionState:
        """
        Retrieve persisted exam state after settling any expired section timers.

        Note: This method settles overdue timers before reading state.
        For pure read-only access (e.g. UI polling) that never writes to SQLite,
        use peek_state() instead.
        """
        self.settle_timers(session_id_or_external_id)
        return self.peek_state(session_id_or_external_id)

    # -------------------------------------------------------------------------
    # 3. Section Lifecycle Controls (Start, Pause, Resume, Submit)
    # -------------------------------------------------------------------------

    def start_section(self, session_id: int, block_order: int) -> ExamSessionState:
        """
        Activate and begin countdown timer for a specific section.
        """
        with unit_of_work(self.conn):
            self.settle_timers(session_id)
            sess = self.peek_state(session_id)
            if sess.status == SessionStatus.COMPLETED.value:
                raise SessionLifecycleError("Cannot start section in a completed exam.")

            # Find target section
            target_sec = next((s for s in sess.sections if s.block_order == block_order), None)
            if not target_sec:
                raise ExamServiceError(f"Section block {block_order} not found in exam {session_id}.")

            if target_sec.status in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                raise ExamSectionClosedError(f"Section block {block_order} is already {target_sec.status.value}.")

            # Enforce prerequisite sections are completed/expired
            for s in sess.sections:
                if s.block_order < block_order and s.status not in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                    raise ExamSectionSequenceError(f"Cannot start section {block_order} before section {s.block_order} completes.")

            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            deadline_dt = datetime.fromtimestamp(now.timestamp() + target_sec.remaining_time_seconds, tz=timezone.utc)
            deadline_iso = deadline_dt.isoformat()

            # Update test_attempt to in_progress if still created
            self.conn.execute(
                """
                UPDATE test_attempt
                SET status = ?, started_at = COALESCE(started_at, ?), last_active_at = ?
                WHERE id = ? AND status = ?;
                """,
                (SessionStatus.IN_PROGRESS.value, now_iso, now_iso, session_id, SessionStatus.CREATED.value),
            )

            # Start section timer
            self.conn.execute(
                """
                UPDATE exam_section_attempt
                SET status = ?, started_at = COALESCE(started_at, ?), deadline_at = ?, paused_at = NULL
                WHERE id = ?;
                """,
                (ExamSectionStatus.IN_PROGRESS.value, now_iso, deadline_iso, target_sec.section_id),
            )

            return self.peek_state(session_id)

    def pause_section(self, session_id: int, block_order: int) -> ExamSessionState:
        """
        Pause an in-progress section, freezing remaining time.
        """
        with unit_of_work(self.conn):
            self.settle_timers(session_id)
            sess = self.peek_state(session_id)
            target_sec = next((s for s in sess.sections if s.block_order == block_order), None)
            if not target_sec:
                raise ExamServiceError(f"Section block {block_order} not found in exam {session_id}.")

            if target_sec.status != ExamSectionStatus.IN_PROGRESS:
                raise ExamServiceError(f"Cannot pause section in status '{target_sec.status.value}'.")

            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()

            # Calculate exact remaining seconds
            remaining_seconds = target_sec.remaining_time_seconds
            if target_sec.deadline_at:
                dl_dt = datetime.fromisoformat(target_sec.deadline_at)
                if dl_dt.tzinfo is None:
                    dl_dt = dl_dt.replace(tzinfo=timezone.utc)
                remaining_seconds = max(0, int((dl_dt - now).total_seconds()))

            self.conn.execute(
                """
                UPDATE exam_section_attempt
                SET status = ?, remaining_time_seconds = ?, paused_at = ?, deadline_at = NULL
                WHERE id = ?;
                """,
                (ExamSectionStatus.PAUSED.value, remaining_seconds, now_iso, target_sec.section_id),
            )
            return self.peek_state(session_id)

    def resume_section(self, session_id: int, block_order: int) -> ExamSessionState:
        """
        Resume a paused section with a newly computed wall-clock deadline.
        """
        with unit_of_work(self.conn):
            self.settle_timers(session_id)
            sess = self.peek_state(session_id)
            target_sec = next((s for s in sess.sections if s.block_order == block_order), None)
            if not target_sec:
                raise ExamServiceError(f"Section block {block_order} not found in exam {session_id}.")

            if target_sec.status != ExamSectionStatus.PAUSED:
                raise ExamServiceError(f"Cannot resume section in status '{target_sec.status.value}'.")

            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()
            deadline_dt = datetime.fromtimestamp(now.timestamp() + target_sec.remaining_time_seconds, tz=timezone.utc)
            deadline_iso = deadline_dt.isoformat()

            self.conn.execute(
                """
                UPDATE exam_section_attempt
                SET status = ?, deadline_at = ?, paused_at = NULL
                WHERE id = ?;
                """,
                (ExamSectionStatus.IN_PROGRESS.value, deadline_iso, target_sec.section_id),
            )
            return self.peek_state(session_id)

    def submit_section(self, session_id: int, block_order: int) -> ExamSessionState:
        """
        Explicitly close and submit a section. Locks choices and records immutable graded responses.
        """
        with unit_of_work(self.conn):
            self.settle_timers(session_id)
            sess = self.peek_state(session_id)
            target_sec = next((s for s in sess.sections if s.block_order == block_order), None)
            if not target_sec:
                raise ExamServiceError(f"Section block {block_order} not found in exam {session_id}.")

            if target_sec.status in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                return sess

            now_iso = datetime.now(timezone.utc).isoformat()
            elapsed_ms = (target_sec.allocated_time_seconds - target_sec.remaining_time_seconds) * 1000

            # Atomic conditional transition to COMPLETED
            cursor = self.conn.execute(
                """
                UPDATE exam_section_attempt
                SET status = ?, completed_at = ?, total_elapsed_ms = ?, deadline_at = NULL
                WHERE id = ? AND status IN (?, ?);
                """,
                (
                    ExamSectionStatus.COMPLETED.value,
                    now_iso,
                    elapsed_ms,
                    target_sec.section_id,
                    ExamSectionStatus.IN_PROGRESS.value,
                    ExamSectionStatus.PAUSED.value,
                ),
            )

            # Commit responses for answered questions in this section only if claimed
            if cursor.rowcount > 0:
                self._commit_section_responses(target_sec.section_id)

            # Auto-finalize exam if all sections are now finished
            unfinished_row = self.conn.execute(
                """
                SELECT COUNT(*) as unfinished_count
                FROM exam_section_attempt
                WHERE attempt_id = ? AND status NOT IN (?, ?);
                """,
                (
                    session_id,
                    ExamSectionStatus.COMPLETED.value,
                    ExamSectionStatus.EXPIRED.value,
                ),
            ).fetchone()

            if unfinished_row["unfinished_count"] == 0:
                att_row = self.conn.execute(
                    "SELECT status, recipe_snapshot_json FROM test_attempt WHERE id = ?;",
                    (session_id,),
                ).fetchone()
                if att_row and att_row["status"] != SessionStatus.COMPLETED.value:
                    cursor = self.conn.execute(
                        """
                        UPDATE test_attempt
                        SET status = ?, completed_at = ?, last_active_at = ?
                        WHERE id = ? AND status != ?;
                        """,
                        (SessionStatus.COMPLETED.value, now_iso, now_iso, session_id, SessionStatus.COMPLETED.value),
                    )
                    if cursor.rowcount == 1:
                        snap_exists = self.conn.execute(
                            "SELECT 1 FROM exam_result_snapshot WHERE attempt_id = ?;",
                            (session_id,),
                        ).fetchone()
                        if not snap_exists:
                            blueprint_data = json.loads(att_row["recipe_snapshot_json"] or "{}")
                            self._finalize_and_score_exam(session_id, blueprint_data, is_complete=True)

            return self.peek_state(session_id)

    # -------------------------------------------------------------------------
    # 4. In-Exam Interactions (Select Choice, Mark for Review)
    # -------------------------------------------------------------------------

    def select_choice(
        self,
        session_id: int,
        attempt_item_id: int,
        selected_choice_id: int,
        time_spent_ms: int = 0,
    ) -> None:
        """
        Select or change an answer choice during an active section.
        Raises ExamSectionClosedError if the section is completed or expired.
        """
        with unit_of_work(self.conn):
            # Ensure overdue timers are settled first
            self.settle_timers(session_id)

            row = self.conn.execute(
                """
                SELECT
                    ai.attempt_id,
                    ai.pinned_question_revision_id,
                    esa.status as section_status
                FROM attempt_item ai
                JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
                JOIN exam_section_attempt esa ON eis.section_attempt_id = esa.id
                WHERE ai.id = ? AND ai.attempt_id = ?;
                """,
                (attempt_item_id, session_id),
            ).fetchone()

            if not row:
                raise SessionNotFoundError(f"Attempt item {attempt_item_id} not found in exam {session_id}.")

            sec_status = ExamSectionStatus(row["section_status"])
            if sec_status in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                raise ExamSectionClosedError(f"Cannot select answer: section is {sec_status.value}.")

            if sec_status != ExamSectionStatus.IN_PROGRESS:
                raise ExamServiceError(f"Cannot select answer: section is in status '{sec_status.value}'. Must be in progress.")

            # Validate that selected_choice_id belongs to the pinned revision
            ch_row = self.conn.execute(
                "SELECT id FROM revision_choice WHERE id = ? AND question_revision_id = ?;",
                (selected_choice_id, row["pinned_question_revision_id"]),
            ).fetchone()
            if not ch_row:
                raise ValueError(f"Choice {selected_choice_id} does not belong to revision {row['pinned_question_revision_id']}.")

            now_iso = datetime.now(timezone.utc).isoformat()
            self.conn.execute(
                """
                UPDATE exam_item_state
                SET selected_choice_id = ?,
                    time_spent_ms = time_spent_ms + ?,
                    last_action_at = ?,
                    updated_at = ?
                WHERE attempt_item_id = ?;
                """,
                (selected_choice_id, max(0, time_spent_ms), now_iso, now_iso, attempt_item_id),
            )

    def toggle_review_flag(
        self,
        session_id: int,
        attempt_item_id: int,
        is_marked: bool,
    ) -> None:
        """
        Mark or unmark a question for review during an active section.
        """
        with unit_of_work(self.conn):
            # Ensure overdue timers are settled first
            self.settle_timers(session_id)

            row = self.conn.execute(
                """
                SELECT esa.status as section_status
                FROM attempt_item ai
                JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
                JOIN exam_section_attempt esa ON eis.section_attempt_id = esa.id
                WHERE ai.id = ? AND ai.attempt_id = ?;
                """,
                (attempt_item_id, session_id),
            ).fetchone()

            if not row:
                raise SessionNotFoundError(f"Attempt item {attempt_item_id} not found in exam {session_id}.")

            sec_status = ExamSectionStatus(row["section_status"])
            if sec_status in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                raise ExamSectionClosedError(f"Cannot toggle review flag: section is {sec_status.value}.")

            now_iso = datetime.now(timezone.utc).isoformat()
            self.conn.execute(
                """
                UPDATE exam_item_state
                SET is_marked_for_review = ?, updated_at = ?
                WHERE attempt_item_id = ?;
                """,
                (1 if is_marked else 0, now_iso, attempt_item_id),
            )

    # -------------------------------------------------------------------------
    # 5. Exam Finalization, Grading & Immutable Snapshotting
    # -------------------------------------------------------------------------

    def complete_exam(self, session_id: int) -> ExamResult:
        """
        Explicitly finalize the examination, closing open sections, grading responses,
        and generating the immutable result snapshot.
        """
        with unit_of_work(self.conn):
            self.settle_timers(session_id)
            sess = self.peek_state(session_id)
            if sess.status == SessionStatus.COMPLETED.value:
                return self.get_exam_result(session_id)

            # Close all open sections
            now_iso = datetime.now(timezone.utc).isoformat()
            for s in sess.sections:
                if s.status not in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED):
                    cursor = self.conn.execute(
                        """
                        UPDATE exam_section_attempt
                        SET status = ?, completed_at = ?, deadline_at = NULL
                        WHERE id = ? AND status NOT IN (?, ?);
                        """,
                        (
                            ExamSectionStatus.COMPLETED.value,
                            now_iso,
                            s.section_id,
                            ExamSectionStatus.COMPLETED.value,
                            ExamSectionStatus.EXPIRED.value,
                        ),
                    )
                    if cursor.rowcount > 0:
                        self._commit_section_responses(s.section_id)

            # Fetch blueprint
            att_row = self.conn.execute(
                "SELECT recipe_snapshot_json FROM test_attempt WHERE id = ?;",
                (session_id,),
            ).fetchone()
            blueprint_data = json.loads(att_row["recipe_snapshot_json"] or "{}")

            # Determine completeness: were all sections taken and finished?
            is_complete = all(
                s.status in (ExamSectionStatus.COMPLETED, ExamSectionStatus.EXPIRED)
                for s in sess.sections
            )

            # Idempotency check before finalization
            snap_exists = self.conn.execute(
                "SELECT 1 FROM exam_result_snapshot WHERE attempt_id = ?;",
                (session_id,),
            ).fetchone()
            if snap_exists:
                return self.get_exam_result(session_id)

            result = self._finalize_and_score_exam(session_id, blueprint_data, is_complete=is_complete)
            return result

    def get_exam_result(self, session_id: int) -> ExamResult:
        """
        Retrieve persisted immutable examination result snapshot.
        """
        row = self.conn.execute(
            "SELECT result_json FROM exam_result_snapshot WHERE attempt_id = ?;",
            (session_id,),
        ).fetchone()
        if not row:
            raise ExamServiceError(f"No completed exam result snapshot found for session {session_id}.")

        data = json.loads(row["result_json"])
        return ExamResult.model_validate(data)

    # -------------------------------------------------------------------------
    # Internal Helpers
    # -------------------------------------------------------------------------

    def _commit_section_responses(self, section_attempt_id: int) -> None:
        """
        Grade and persist responses for all answered items in a section.
        Unanswered items remain without rows in the response table.
        """
        items = self.conn.execute(
            """
            SELECT
                eis.attempt_item_id,
                eis.selected_choice_id,
                eis.time_spent_ms,
                ai.pinned_question_revision_id,
                r.id as existing_response_id
            FROM exam_item_state eis
            JOIN attempt_item ai ON eis.attempt_item_id = ai.id
            LEFT JOIN response r ON eis.attempt_item_id = r.attempt_item_id
            WHERE eis.section_attempt_id = ?;
            """,
            (section_attempt_id,),
        ).fetchall()

        now_iso = datetime.now(timezone.utc).isoformat()

        for it in items:
            if it["existing_response_id"] is not None:
                continue
            if it["selected_choice_id"] is None:
                # Question was unanswered; preserve as unanswered
                continue

            item_id = it["attempt_item_id"]
            selected_choice_id = it["selected_choice_id"]
            time_spent = it["time_spent_ms"]
            pinned_rev_id = it["pinned_question_revision_id"]

            grading = DeterministicGrader.grade_attempt(
                conn=self.conn,
                attempt_item_id=item_id,
                selected_choice_id=selected_choice_id,
                time_spent_ms=time_spent,
            )

            # Retrieve choice label
            ch_row = self.conn.execute(
                "SELECT choice_key FROM revision_choice WHERE id = ?;",
                (selected_choice_id,),
            ).fetchone()
            sub_ans = ch_row["choice_key"] if ch_row else str(selected_choice_id)

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
                    item_id,
                    selected_choice_id,
                    pinned_rev_id,
                    1 if grading.is_correct else 0,
                    grading.grading_status.value,
                    sub_ans,
                    grading.canonical_choice_id,
                    time_spent,
                    now_iso,
                    now_iso,
                ),
            )

    def _finalize_and_score_exam(
        self,
        attempt_id: int,
        blueprint_data: dict[str, Any],
        is_complete: bool,
    ) -> ExamResult:
        """
        Execute scoring model, persist immutable result snapshot, and update test_attempt.
        """
        snap_exists = self.conn.execute(
            "SELECT 1 FROM exam_result_snapshot WHERE attempt_id = ?;",
            (attempt_id,),
        ).fetchone()
        if snap_exists:
            return self.get_exam_result(attempt_id)

        now_iso = datetime.now(timezone.utc).isoformat()
        blueprint = ExamBlueprint.model_validate(blueprint_data)

        # Update test_attempt status to completed
        self.conn.execute(
            """
            UPDATE test_attempt
            SET status = ?, completed_at = ?, last_active_at = ?
            WHERE id = ?;
            """,
            (SessionStatus.COMPLETED.value, now_iso, now_iso, attempt_id),
        )

        # Calculate scores
        exam_result = self.scoring_model.calculate_scores(
            conn=self.conn,
            attempt_id=attempt_id,
            blueprint=blueprint,
            is_complete=is_complete,
        )

        # Store immutable snapshot
        result_json = exam_result.model_dump_json()
        self.conn.execute(
            """
            INSERT INTO exam_result_snapshot (
                attempt_id,
                blueprint_level,
                blueprint_version,
                scoring_algorithm_version,
                is_complete,
                total_questions,
                raw_correct,
                raw_incorrect,
                raw_unanswered,
                raw_accuracy,
                estimated_total_score,
                overall_pass_threshold,
                passed_overall,
                passed_sectional,
                passed_overall_estimate,
                readiness_assessment,
                result_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                attempt_id,
                exam_result.level,
                exam_result.blueprint_version,
                exam_result.scoring_algorithm_version,
                1 if exam_result.is_complete else 0,
                exam_result.total_questions,
                exam_result.raw_correct,
                exam_result.raw_incorrect,
                exam_result.raw_unanswered,
                exam_result.raw_accuracy,
                exam_result.estimated_total_score,
                exam_result.overall_pass_threshold,
                1 if exam_result.passed_overall else 0,
                1 if exam_result.passed_sectional else 0,
                1 if exam_result.passed_overall_estimate else 0,
                exam_result.readiness_assessment.value,
                result_json,
                now_iso,
            ),
        )

        return exam_result
