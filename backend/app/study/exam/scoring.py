"""
Modular JLPT Examination Scoring & Pass/Fail Evaluation Engine.
---------------------------------------------------------------
Computes section-level score estimates, aggregated total estimates,
and official JLPT pass/fail threshold assessments.

Strictly preserves raw accuracy and transparently explains provisional
linear scaling while explicitly disclaiming official IRT calibration.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Protocol

from app.study.exam.enums import PassFailAssessment, ThresholdStatus
from app.study.exam.models import (
    ExamBlueprint,
    ExamResult,
    ScoringSectionResult,
)


class ScoringModel(Protocol):
    """Protocol for modular, versioned examination scoring models."""
    algorithm_version: str

    def calculate_scores(
        self,
        conn: sqlite3.Connection,
        attempt_id: int,
        blueprint: ExamBlueprint,
        is_complete: bool,
    ) -> ExamResult:
        ...


class ProvisionalRawScoringModel:
    """
    Transparent provisional scoring engine based on uncalibrated raw section accuracy.
    Scales independent scoring sections linearly to official maximum score boundaries.
    """

    algorithm_version: str = "provisional_proportional_v1"

    def calculate_scores(
        self,
        conn: sqlite3.Connection,
        attempt_id: int,
        blueprint: ExamBlueprint,
        is_complete: bool,
    ) -> ExamResult:
        """
        Deterministically calculate section scores, total estimated score, and pass/fail status.
        """
        # Fetch attempt metadata
        att_row = conn.execute(
            "SELECT external_id, completed_at FROM test_attempt WHERE id = ?;",
            (attempt_id,),
        ).fetchone()
        if not att_row:
            raise ValueError(f"Attempt id {attempt_id} not found.")

        external_id = att_row["external_id"]
        completed_at = att_row["completed_at"] or ""

        # Fetch all attempt items with question metadata and response correctness
        item_rows = conn.execute(
            """
            SELECT
                ai.id as attempt_item_id,
                q.category,
                q.format_code,
                r.id as response_id,
                r.is_correct
            FROM attempt_item ai
            JOIN question q ON ai.question_id = q.id
            LEFT JOIN response r ON ai.id = r.attempt_item_id
            WHERE ai.attempt_id = ?
            ORDER BY ai.position ASC;
            """,
            (attempt_id,),
        ).fetchall()

        total_questions = len(item_rows)
        raw_correct = 0
        raw_incorrect = 0
        raw_unanswered = 0

        for r in item_rows:
            if r["response_id"] is None:
                raw_unanswered += 1
            elif r["is_correct"] == 1:
                raw_correct += 1
            else:
                raw_incorrect += 1

        overall_raw_accuracy = (
            round((raw_correct / total_questions) * 100.0, 2)
            if total_questions > 0
            else 0.0
        )

        # Process each official scoring section independently
        scoring_section_results: List[ScoringSectionResult] = []
        for s_bp in blueprint.scoring_sections:
            sec_categories = set(s_bp.categories)

            # Filter items belonging to categories for this scoring section
            matched_items = [
                it for it in item_rows if it["category"] in sec_categories
            ]
            sec_total = len(matched_items)
            sec_correct = sum(
                1 for it in matched_items if it["response_id"] is not None and it["is_correct"] == 1
            )
            sec_incorrect = sum(
                1 for it in matched_items if it["response_id"] is not None and it["is_correct"] == 0
            )
            sec_unanswered = sum(
                1 for it in matched_items if it["response_id"] is None
            )

            sec_accuracy = (
                round((sec_correct / sec_total) * 100.0, 2) if sec_total > 0 else 0.0
            )

            # Calculate estimated section score via proportional scaling
            if sec_total > 0:
                raw_fraction = sec_correct / sec_total
                estimated_score = min(s_bp.max_score, max(0, round(raw_fraction * s_bp.max_score)))
            else:
                estimated_score = 0

            passed_threshold = (estimated_score >= s_bp.pass_threshold)
            threshold_status = (
                ThresholdStatus.ABOVE_ESTIMATED_THRESHOLD
                if passed_threshold
                else ThresholdStatus.BELOW_ESTIMATED_THRESHOLD
            )

            explanation = (
                f"Provisional estimation via raw accuracy: {sec_correct}/{sec_total} items correct "
                f"({sec_accuracy:.1f}%) scaled to the official {s_bp.max_score}-point section maximum. "
                f"Official pass threshold: {s_bp.pass_threshold}/{s_bp.max_score} points. "
                f"Note: Official JLPT scores use proprietary unreleased Item Response Theory (IRT) equating."
            )

            scoring_section_results.append(
                ScoringSectionResult(
                    code=s_bp.code,
                    label=s_bp.label,
                    max_score=s_bp.max_score,
                    pass_threshold=s_bp.pass_threshold,
                    total_questions=sec_total,
                    correct_count=sec_correct,
                    incorrect_count=sec_incorrect,
                    unanswered_count=sec_unanswered,
                    raw_accuracy=sec_accuracy,
                    estimated_score=estimated_score,
                    passed_threshold=passed_threshold,
                    threshold_status=threshold_status,
                    calculation_explanation=explanation,
                )
            )

        # Total estimated score
        estimated_total_score = sum(s.estimated_score for s in scoring_section_results)
        passed_overall = (estimated_total_score >= blueprint.overall_pass_threshold)
        passed_sectional = all(s.passed_threshold for s in scoring_section_results)

        # Official JLPT threshold rule:
        # Learner MUST complete all required sections, reach overall pass mark, AND reach all sectional minimums.
        if not is_complete:
            passed_overall_estimate = False
            readiness_assessment = PassFailAssessment.INCOMPLETE
        else:
            passed_overall_estimate = passed_overall and passed_sectional
            readiness_assessment = (
                PassFailAssessment.PASSED_ESTIMATE
                if passed_overall_estimate
                else PassFailAssessment.FAILED_ESTIMATE
            )

        result_labels = {
            "score_title": "Estimated JLPT-style score",
            "readiness_title": "Estimated pass likelihood/readiness",
            "threshold_comparison": (
                "Above estimated threshold"
                if passed_overall_estimate
                else "Below estimated threshold"
            ),
            "disclaimer": (
                "This is a provisional estimate for study feedback only, not an official JLPT score. "
                "Kiroku cannot guarantee real examination outcomes."
            ),
        }

        return ExamResult(
            session_id=attempt_id,
            external_id=external_id,
            level=blueprint.level,
            blueprint_version=blueprint.version,
            scoring_algorithm_version=self.algorithm_version,
            is_complete=is_complete,
            total_questions=total_questions,
            raw_correct=raw_correct,
            raw_incorrect=raw_incorrect,
            raw_unanswered=raw_unanswered,
            raw_accuracy=overall_raw_accuracy,
            scoring_sections=scoring_section_results,
            estimated_total_score=estimated_total_score,
            overall_max_score=blueprint.overall_max_score,
            overall_pass_threshold=blueprint.overall_pass_threshold,
            passed_overall=passed_overall,
            passed_sectional=passed_sectional,
            passed_overall_estimate=passed_overall_estimate,
            readiness_assessment=readiness_assessment,
            result_labels=result_labels,
            completed_at=completed_at,
        )
