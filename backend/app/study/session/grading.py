"""
Deterministic Grader for Study Question Formats.
-------------------------------------------------
Evaluates objective JLPT question responses deterministically without AI/LLM intervention.
Strictly validates submitted choices against pinned revision choices and canonical answer records.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Optional

from app.study.session.enums import DifficultyRating, GradingStatus
from app.study.session.models import GradingResult


class GradingError(Exception):
    """Base exception for grading failures."""
    pass


class InvalidChoiceError(GradingError):
    """Raised when submitted choice does not exist or does not belong to the pinned revision."""
    pass


class MissingAnswerKeyError(GradingError):
    """Raised when question revision lacks an authoritative canonical answer."""
    pass


class UnsupportedGraderError(GradingError):
    """Raised when question format specifies an unimplemented grading strategy."""
    pass


class DeterministicGrader:
    """
    Deterministic answer evaluator for official JLPT question formats.
    """

    SUPPORTED_GRADERS = frozenset({"single_choice"})

    @classmethod
    def grade_attempt(
        cls,
        conn: sqlite3.Connection,
        attempt_item_id: int,
        selected_choice_id: int,
        time_spent_ms: int,
        difficulty_rating: Optional[DifficultyRating] = None,
    ) -> GradingResult:
        """
        Deterministically grade an answer submission for an attempt item.

        Args:
            conn: Active SQLite connection within a transaction.
            attempt_item_id: Internal primary key of the attempt_item.
            selected_choice_id: The learner-selected revision_choice id.
            time_spent_ms: Validated active duration spent on this item.
            difficulty_rating: Optional immediate difficulty feedback.

        Returns:
            GradingResult with correctness, canonical references, and rationale.

        Raises:
            GradingError: If validation fails or grading cannot proceed deterministically.
        """
        # 1. Fetch attempt item and format/grader information
        row = conn.execute(
            """
            SELECT
                ai.id as attempt_item_id,
                ai.pinned_question_revision_id,
                ai.question_id,
                q.format_code,
                f.grader_type
            FROM attempt_item ai
            JOIN question q ON ai.question_id = q.id
            JOIN format f ON q.format_code = f.code
            WHERE ai.id = ?;
            """,
            (attempt_item_id,),
        ).fetchone()

        if not row:
            raise GradingError(f"Attempt item {attempt_item_id} not found.")

        item_id = row["attempt_item_id"]
        pinned_rev_id = row["pinned_question_revision_id"]
        grader_type = row["grader_type"]

        if grader_type not in cls.SUPPORTED_GRADERS:
            raise UnsupportedGraderError(
                f"Grader type '{grader_type}' for format '{row['format_code']}' is not supported."
            )

        # 2. Validate selected choice belongs to this pinned revision
        choice_row = conn.execute(
            """
            SELECT id, choice_key, ordinal, label
            FROM revision_choice
            WHERE id = ? AND question_revision_id = ?;
            """,
            (selected_choice_id, pinned_rev_id),
        ).fetchone()

        if not choice_row:
            raise InvalidChoiceError(
                f"Selected choice id {selected_choice_id} does not exist or does not belong to question revision {pinned_rev_id}."
            )

        # 3. Retrieve authoritative canonical answer
        ans_row = conn.execute(
            """
            SELECT
                ra.choice_id as canonical_choice_id,
                rc.choice_key as canonical_choice_key,
                ra.rationale_markup
            FROM revision_answer ra
            JOIN revision_choice rc ON ra.choice_id = rc.id
            WHERE ra.question_revision_id = ?;
            """,
            (pinned_rev_id,),
        ).fetchone()

        if not ans_row or ans_row["canonical_choice_id"] is None:
            raise MissingAnswerKeyError(
                f"Authoritative canonical answer missing for question revision {pinned_rev_id}."
            )

        canonical_choice_id = ans_row["canonical_choice_id"]
        canonical_choice_key = ans_row["canonical_choice_key"]
        rationale_markup = ans_row["rationale_markup"] or ""

        # 4. Deterministic comparison
        is_correct = (selected_choice_id == canonical_choice_id)

        return GradingResult(
            attempt_item_id=item_id,
            is_correct=is_correct,
            selected_choice_id=selected_choice_id,
            canonical_choice_id=canonical_choice_id,
            canonical_choice_key=canonical_choice_key,
            rationale_markup=rationale_markup,
            time_spent_ms=time_spent_ms,
            difficulty_rating=difficulty_rating,
            grading_status=GradingStatus.GRADED,
        )

