"""
JLPT Examination Timing & Diagnostic Analytics Service.
-------------------------------------------------------
Computes deep diagnostic analytics from examination sessions:
section pacing, time spent per format, slow question types,
outlier high-time questions, weak scoring areas, and expiry-caused omissions.
"""
from __future__ import annotations

import sqlite3
from typing import List

from app.study.exam.enums import ExamSectionStatus
from app.study.exam.models import (
    ExamAnalytics,
    FormatPerformanceDetail,
    SectionTimingDetail,
)
from app.study.session.service import SessionNotFoundError


class ExamAnalyticsService:
    """
    Computes fine-grained timing, pacing, and diagnostic analytics for examinations.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def get_exam_analytics(self, session_id: int) -> ExamAnalytics:
        """
        Compute comprehensive examination analytics for a completed or in-progress exam.
        """
        att_row = self.conn.execute(
            "SELECT id, level, total_elapsed_ms FROM test_attempt WHERE id = ?;",
            (session_id,),
        ).fetchone()

        if not att_row:
            raise SessionNotFoundError(f"Exam attempt {session_id} not found.")

        level = att_row["level"] or "N5"

        # 1. Fetch section-level timing and progress
        sec_rows = self.conn.execute(
            """
            SELECT
                esa.id as section_id,
                esa.section_code,
                esa.block_order,
                esa.allocated_time_seconds,
                esa.remaining_time_seconds,
                esa.total_elapsed_ms,
                esa.status
            FROM exam_section_attempt esa
            WHERE esa.attempt_id = ?
            ORDER BY esa.block_order ASC;
            """,
            (session_id,),
        ).fetchall()

        section_details: List[SectionTimingDetail] = []
        total_time_ms = 0
        total_questions = 0
        total_answered = 0
        total_unanswered = 0
        total_marked = 0
        time_expired_unanswered = 0

        for s in sec_rows:
            sec_id = s["section_id"]
            sec_elapsed = s["total_elapsed_ms"]
            total_time_ms += sec_elapsed

            # Fetch items belonging to this section
            items = self.conn.execute(
                """
                SELECT
                    ai.id as attempt_item_id,
                    ai.position,
                    eis.is_marked_for_review,
                    eis.time_spent_ms,
                    eis.selected_choice_id,
                    r.is_correct
                FROM attempt_item ai
                JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
                LEFT JOIN response r ON ai.id = r.attempt_item_id
                WHERE eis.section_attempt_id = ?
                ORDER BY ai.position ASC;
                """,
                (sec_id,),
            ).fetchall()

            q_count = len(items)
            ans_count = sum(1 for it in items if it["selected_choice_id"] is not None)
            unans_count = q_count - ans_count
            mark_count = sum(1 for it in items if it["is_marked_for_review"] == 1)
            correct_count = sum(1 for it in items if it["is_correct"] == 1)

            acc = round((correct_count / q_count) * 100.0, 2) if q_count > 0 else 0.0

            if s["status"] == ExamSectionStatus.EXPIRED.value:
                time_expired_unanswered += unans_count

            total_questions += q_count
            total_answered += ans_count
            total_unanswered += unans_count
            total_marked += mark_count

            section_details.append(
                SectionTimingDetail(
                    section_code=s["section_code"],
                    block_order=s["block_order"],
                    allocated_seconds=s["allocated_time_seconds"],
                    remaining_seconds=s["remaining_time_seconds"],
                    elapsed_ms=sec_elapsed,
                    questions_count=q_count,
                    answered_count=ans_count,
                    unanswered_count=unans_count,
                    marked_count=mark_count,
                    accuracy=acc,
                )
            )

        # 2. Format breakdown
        fmt_rows = self.conn.execute(
            """
            SELECT
                q.format_code,
                q.category,
                COUNT(ai.id) as total_items,
                SUM(CASE WHEN r.is_correct = 1 THEN 1 ELSE 0 END) as correct_items,
                SUM(COALESCE(eis.time_spent_ms, 0)) as total_time_ms
            FROM attempt_item ai
            JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
            JOIN question q ON ai.question_id = q.id
            LEFT JOIN response r ON ai.id = r.attempt_item_id
            WHERE ai.attempt_id = ?
            GROUP BY q.format_code, q.category
            ORDER BY q.category, q.format_code;
            """,
            (session_id,),
        ).fetchall()

        format_details: List[FormatPerformanceDetail] = []
        overall_avg_time_ms = (
            (total_time_ms / total_questions) if total_questions > 0 else 0.0
        )

        for f in fmt_rows:
            f_tot = f["total_items"] or 0
            f_cor = f["correct_items"] or 0
            f_time = f["total_time_ms"] or 0
            f_acc = round((f_cor / f_tot) * 100.0, 2) if f_tot > 0 else 0.0
            f_avg_time = round(f_time / f_tot, 1) if f_tot > 0 else 0.0

            format_details.append(
                FormatPerformanceDetail(
                    format_code=f["format_code"],
                    category=f["category"],
                    total_items=f_tot,
                    correct_items=f_cor,
                    accuracy=f_acc,
                    total_time_ms=f_time,
                    avg_time_ms_per_question=f_avg_time,
                )
            )

        # 3. Identify slow formats: formats with avg time > 1.5x average or > 90 seconds (90,000 ms)
        slow_threshold_ms = max(60_000.0, overall_avg_time_ms * 1.5)
        slow_formats = [
            f.format_code for f in format_details if f.avg_time_ms_per_question > slow_threshold_ms
        ]

        # 4. Identify high-time individual questions: spent > 120,000 ms (2 minutes)
        high_time_rows = self.conn.execute(
            """
            SELECT ai.position
            FROM attempt_item ai
            JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
            WHERE ai.attempt_id = ? AND eis.time_spent_ms > 120000
            ORDER BY ai.position ASC;
            """,
            (session_id,),
        ).fetchall()
        high_time_questions = [r["position"] for r in high_time_rows]

        # 5. Identify weak sections and weak formats (accuracy < 50.0%)
        weak_sections = [
            s.section_code for s in section_details if s.accuracy < 50.0
        ]
        weak_formats = [
            f.format_code for f in format_details if f.accuracy < 50.0
        ]

        return ExamAnalytics(
            session_id=session_id,
            level=level,
            total_elapsed_ms=total_time_ms,
            total_questions=total_questions,
            answered_count=total_answered,
            unanswered_count=total_unanswered,
            marked_count=total_marked,
            section_timings=section_details,
            format_performance=format_details,
            slow_formats=slow_formats,
            high_time_questions=high_time_questions,
            weak_sections=weak_sections,
            weak_formats=weak_formats,
            time_expired_unanswered_count=time_expired_unanswered,
        )
