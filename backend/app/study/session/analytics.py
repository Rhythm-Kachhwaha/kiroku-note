"""
Learning Analytics & History Service.
-------------------------------------
Extracts empirical learning performance, difficulty trends, and accuracy metrics
from persisted study sessions, responses, and adaptive states.
"""
from __future__ import annotations

import sqlite3
from typing import List

from app.study.session.models import (
    AccuracyByGroup,
    LearningSummary,
    QuestionAnalyticsItem,
    RecentSessionItem,
)


class PracticeAnalyticsService:
    """
    Computes accurate, lightweight learning analytics directly from local study persistence.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get_learning_summary(self) -> LearningSummary:
        """
        Compute high-level learning summary metrics across all sessions and responses.
        """
        # Session counts
        sess_rows = self.conn.execute(
            """
            SELECT
                COUNT(*) as total_sessions,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_sessions,
                SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) as abandoned_sessions,
                SUM(CASE WHEN status IN ('created', 'in_progress') THEN 1 ELSE 0 END) as in_progress_sessions
            FROM test_attempt;
            """
        ).fetchone()

        total_sessions = sess_rows["total_sessions"] or 0
        completed_sessions = sess_rows["completed_sessions"] or 0
        abandoned_sessions = sess_rows["abandoned_sessions"] or 0
        in_progress_sessions = sess_rows["in_progress_sessions"] or 0

        # Response counts and accuracy
        resp_rows = self.conn.execute(
            """
            SELECT
                COUNT(*) as total_attempted,
                SUM(is_correct) as total_correct,
                SUM(time_spent_ms) as total_time_spent_ms
            FROM response;
            """
        ).fetchone()

        total_attempted = resp_rows["total_attempted"] or 0
        total_correct = resp_rows["total_correct"] or 0
        total_time_spent = resp_rows["total_time_spent_ms"] or 0

        accuracy = round((total_correct / total_attempted * 100.0), 2) if total_attempted > 0 else 0.0
        avg_time = round(total_time_spent / total_attempted, 1) if total_attempted > 0 else 0.0

        return LearningSummary(
            total_sessions=total_sessions,
            completed_sessions=completed_sessions,
            abandoned_sessions=abandoned_sessions,
            in_progress_sessions=in_progress_sessions,
            total_questions_attempted=total_attempted,
            total_correct=total_correct,
            overall_accuracy=accuracy,
            total_time_spent_ms=total_time_spent,
            average_time_per_question_ms=avg_time,
        )

    def get_accuracy_by_level(self) -> List[AccuracyByGroup]:
        """
        Compute accuracy breakdown grouped by JLPT level (N1–N5).
        """
        rows = self.conn.execute(
            """
            SELECT
                q.level as group_name,
                COUNT(r.id) as attempted,
                SUM(r.is_correct) as correct
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            GROUP BY q.level
            ORDER BY q.level DESC;
            """
        ).fetchall()

        results: List[AccuracyByGroup] = []
        for r in rows:
            att = r["attempted"] or 0
            cor = r["correct"] or 0
            acc = round((cor / att * 100.0), 2) if att > 0 else 0.0
            results.append(
                AccuracyByGroup(
                    group_name=r["group_name"],
                    attempted=att,
                    correct=cor,
                    accuracy=acc,
                )
            )
        return results

    def get_accuracy_by_family(self) -> List[AccuracyByGroup]:
        """
        Compute accuracy breakdown grouped by question format/category.
        """
        rows = self.conn.execute(
            """
            SELECT
                q.format_code as group_name,
                COUNT(r.id) as attempted,
                SUM(r.is_correct) as correct
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            GROUP BY q.format_code
            ORDER BY attempted DESC;
            """
        ).fetchall()

        results: List[AccuracyByGroup] = []
        for r in rows:
            att = r["attempted"] or 0
            cor = r["correct"] or 0
            acc = round((cor / att * 100.0), 2) if att > 0 else 0.0
            results.append(
                AccuracyByGroup(
                    group_name=r["group_name"],
                    attempted=att,
                    correct=cor,
                    accuracy=acc,
                )
            )
        return results

    def get_trouble_questions(self, limit: int = 10) -> List[QuestionAnalyticsItem]:
        """
        Retrieve questions repeatedly answered incorrectly, ordered by error count DESC.
        """
        rows = self.conn.execute(
            """
            SELECT
                q.id as question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                COUNT(r.id) as attempts_count,
                SUM(r.is_correct) as correct_count,
                SUM(CASE WHEN r.is_correct = 0 THEN 1 ELSE 0 END) as incorrect_count,
                qas.consecutive_correct_easy,
                qas.last_rating,
                qas.last_is_correct,
                qas.last_attempted_at,
                COALESCE(qas.priority_score, 100.0) as priority_score
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            JOIN attempt_item ai ON q.id = ai.question_id
            JOIN response r ON ai.id = r.attempt_item_id
            LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
            GROUP BY q.id
            HAVING incorrect_count > 0
            ORDER BY incorrect_count DESC, attempts_count DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()

        results: List[QuestionAnalyticsItem] = []
        for r in rows:
            att = r["attempts_count"] or 0
            cor = r["correct_count"] or 0
            acc = round((cor / att * 100.0), 2) if att > 0 else 0.0
            results.append(
                QuestionAnalyticsItem(
                    question_id=r["question_id"],
                    external_id=r["external_id"],
                    level=r["level"],
                    category=r["category"],
                    format_code=r["format_code"],
                    prompt_markup=r["prompt_markup"],
                    attempts_count=att,
                    correct_count=cor,
                    accuracy=acc,
                    consecutive_correct_easy=r["consecutive_correct_easy"] or 0,
                    last_rating=r["last_rating"],
                    last_is_correct=bool(r["last_is_correct"]) if r["last_is_correct"] is not None else None,
                    last_attempted_at=r["last_attempted_at"],
                    priority_score=r["priority_score"],
                )
            )
        return results

    def get_mastered_questions(self, limit: int = 10) -> List[QuestionAnalyticsItem]:
        """
        Retrieve questions consistently answered correctly and rated Easy twice (consecutive_correct_easy >= 2).
        """
        rows = self.conn.execute(
            """
            SELECT
                q.id as question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                qas.total_attempts as attempts_count,
                qas.total_correct as correct_count,
                qas.consecutive_correct_easy,
                qas.last_rating,
                qas.last_is_correct,
                qas.last_attempted_at,
                qas.priority_score
            FROM question_adaptive_state qas
            JOIN question q ON qas.question_id = q.id
            JOIN question_revision qr ON q.current_revision_id = qr.id
            WHERE qas.consecutive_correct_easy >= 2
            ORDER BY qas.consecutive_correct_easy DESC, qas.total_correct DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()

        results: List[QuestionAnalyticsItem] = []
        for r in rows:
            att = r["attempts_count"] or 0
            cor = r["correct_count"] or 0
            acc = round((cor / att * 100.0), 2) if att > 0 else 0.0
            results.append(
                QuestionAnalyticsItem(
                    question_id=r["question_id"],
                    external_id=r["external_id"],
                    level=r["level"],
                    category=r["category"],
                    format_code=r["format_code"],
                    prompt_markup=r["prompt_markup"],
                    attempts_count=att,
                    correct_count=cor,
                    accuracy=acc,
                    consecutive_correct_easy=r["consecutive_correct_easy"],
                    last_rating=r["last_rating"],
                    last_is_correct=bool(r["last_is_correct"]) if r["last_is_correct"] is not None else None,
                    last_attempted_at=r["last_attempted_at"],
                    priority_score=r["priority_score"],
                )
            )
        return results

    def get_recent_activity(self, limit: int = 10) -> List[RecentSessionItem]:
        """
        Retrieve recent practice sessions with their questions, answers, accuracy, and elapsed time.
        """
        rows = self.conn.execute(
            """
            SELECT
                ta.id as session_id,
                ta.external_id,
                ta.session_type,
                ta.status,
                ta.level,
                ta.category,
                ta.total_elapsed_ms,
                ta.created_at,
                ta.completed_at,
                COUNT(ai.id) as total_questions,
                COUNT(r.id) as answered_count,
                SUM(COALESCE(r.is_correct, 0)) as correct_count
            FROM test_attempt ta
            LEFT JOIN attempt_item ai ON ta.id = ai.attempt_id
            LEFT JOIN response r ON ai.id = r.attempt_item_id
            GROUP BY ta.id
            ORDER BY ta.id DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()

        results: List[RecentSessionItem] = []
        for r in rows:
            ans = r["answered_count"] or 0
            cor = r["correct_count"] or 0
            acc = round((cor / ans * 100.0), 2) if ans > 0 else 0.0
            results.append(
                RecentSessionItem(
                    session_id=r["session_id"],
                    external_id=r["external_id"],
                    session_type=r["session_type"],
                    status=r["status"],
                    level=r["level"],
                    category=r["category"],
                    total_questions=r["total_questions"] or 0,
                    answered_count=ans,
                    correct_count=cor,
                    accuracy=acc,
                    total_elapsed_ms=r["total_elapsed_ms"] or 0,
                    created_at=r["created_at"],
                    completed_at=r["completed_at"],
                )
            )
        return results
