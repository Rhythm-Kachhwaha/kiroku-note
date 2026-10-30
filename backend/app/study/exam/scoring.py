"""
Modular JLPT Examination Scoring & Pass/Fail Evaluation Engine.
---------------------------------------------------------------
Computes section-level score estimates, aggregated total estimates,
and official JLPT pass/fail threshold assessments.

Strictly preserves raw accuracy and transparently explains provisional
linear scaling while explicitly disclaiming official IRT calibration.
"""
from __future__ import annotations

import math
import sqlite3
from typing import Any, Dict, List, Protocol, Tuple

from app.study.exam.enums import PassFailAssessment, ThresholdStatus
from app.study.exam.models import (
    ExamBlueprint,
    ExamResult,
    ScoringSectionResult,
)


def wilson_score_interval(successes: int, trials: int, confidence: float = 0.95) -> Tuple[float, float]:
    """
    Calculate the Wilson score confidence interval for a binomial proportion.
    Handles small samples and boundary conditions (k=0, k=n) gracefully without
    collapsing variance or producing impossible bounds outside [0, 1].
    """
    if trials <= 0:
        return 0.0, 0.0

    # Two-tailed standard normal critical values
    if confidence == 0.99:
        z = 2.575829
    elif confidence == 0.90:
        z = 1.644854
    else:
        # Default 95%
        z = 1.959964

    n = float(trials)
    p_hat = float(successes) / n

    z2 = z * z
    denom = 1.0 + (z2 / n)
    center = (p_hat + (z2 / (2.0 * n))) / denom
    half_width = (z / denom) * math.sqrt((p_hat * (1.0 - p_hat) / n) + (z2 / (4.0 * n * n)))

    lower = max(0.0, center - half_width)
    upper = min(1.0, center + half_width)

    if successes == 0:
        lower = 0.0
    if successes == trials:
        upper = 1.0

    return round(lower, 4), round(upper, 4)


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


class ProvisionalBandScoringModel:
    """
    Uncertainty-aware provisional scoring model based on Wilson score confidence bands.
    Computes statistical upper and lower score bands and evaluates JLPT passing likelihood:
    - Likely Pass: lower score band meets or exceeds overall and sectional thresholds.
    - Unlikely Pass: upper score band fails overall or sectional thresholds.
    - Borderline: score band spans the threshold boundary.
    """

    algorithm_version: str = "provisional_band_v2"

    def __init__(self, confidence: float = 0.95):
        self.confidence = confidence

    def calculate_scores(
        self,
        conn: sqlite3.Connection,
        attempt_id: int,
        blueprint: ExamBlueprint,
        is_complete: bool,
    ) -> ExamResult:
        """
        Deterministically calculate section score intervals, total score bands,
        and honest pass/fail interpretations (likely_pass, borderline, unlikely_pass).
        """
        att_row = conn.execute(
            "SELECT external_id, completed_at FROM test_attempt WHERE id = ?;",
            (attempt_id,),
        ).fetchone()
        if not att_row:
            raise ValueError(f"Attempt id {attempt_id} not found.")

        external_id = att_row["external_id"]
        completed_at = att_row["completed_at"] or ""

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

        scoring_section_results: List[ScoringSectionResult] = []
        for s_bp in blueprint.scoring_sections:
            sec_categories = set(s_bp.categories)
            matched_items = [it for it in item_rows if it["category"] in sec_categories]
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

            # Compute Wilson score confidence interval
            p_lower, p_upper = wilson_score_interval(sec_correct, sec_total, confidence=self.confidence)
            sec_score_lower = min(s_bp.max_score, max(0, round(p_lower * s_bp.max_score)))
            sec_score_upper = min(s_bp.max_score, max(0, round(p_upper * s_bp.max_score)))

            # Point estimate (proportional)
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
                f"Provisional estimation via Wilson 95% score band: {sec_correct}/{sec_total} items correct "
                f"({sec_accuracy:.1f}%). "
                f"Estimated score: {estimated_score}/{s_bp.max_score} (95% CI: {sec_score_lower}–{sec_score_upper}). "
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
                    estimated_score_lower=sec_score_lower,
                    estimated_score_upper=sec_score_upper,
                )
            )

        # Aggregated total estimates
        estimated_total_score = sum(s.estimated_score for s in scoring_section_results)
        total_score_lower = sum(s.estimated_score_lower or 0 for s in scoring_section_results)
        total_score_upper = sum(s.estimated_score_upper or 0 for s in scoring_section_results)
        total_score_lower = max(0, min(blueprint.overall_max_score, total_score_lower))
        total_score_upper = max(0, min(blueprint.overall_max_score, total_score_upper))

        passed_overall = (estimated_total_score >= blueprint.overall_pass_threshold)
        passed_sectional = all(s.passed_threshold for s in scoring_section_results)

        # Sectional threshold checks across bands
        all_sections_lower_passed = all(
            (s.estimated_score_lower or 0) >= s.pass_threshold for s in scoring_section_results
        )
        any_section_upper_failed = any(
            (s.estimated_score_upper or 0) < s.pass_threshold for s in scoring_section_results
        )

        if not is_complete:
            passed_overall_estimate = False
            readiness_assessment = PassFailAssessment.INCOMPLETE
            interpretation = "incomplete"
            interpretation_label = "Incomplete"
        else:
            # Band interpretation
            if total_score_lower >= blueprint.overall_pass_threshold and all_sections_lower_passed:
                interpretation = "likely_pass"
                interpretation_label = "Likely Pass"
                passed_overall_estimate = True
                readiness_assessment = PassFailAssessment.PASSED_ESTIMATE
            elif total_score_upper < blueprint.overall_pass_threshold or any_section_upper_failed:
                interpretation = "unlikely_pass"
                interpretation_label = "Unlikely Pass"
                passed_overall_estimate = False
                readiness_assessment = PassFailAssessment.FAILED_ESTIMATE
            else:
                interpretation = "borderline"
                interpretation_label = "Borderline"
                passed_overall_estimate = passed_overall and passed_sectional
                readiness_assessment = (
                    PassFailAssessment.PASSED_ESTIMATE
                    if passed_overall_estimate
                    else PassFailAssessment.FAILED_ESTIMATE
                )

        result_labels = {
            "score_title": "Estimated JLPT-style score band",
            "readiness_title": "Estimated pass readiness (95% CI)",
            "score_range": f"{total_score_lower}–{total_score_upper} / {blueprint.overall_max_score}",
            "score_band_lower": str(total_score_lower),
            "score_band_upper": str(total_score_upper),
            "interpretation": interpretation,
            "interpretation_label": interpretation_label,
            "threshold_comparison": f"{interpretation_label} ({total_score_lower}–{total_score_upper} pts)",
            "confidence_level": f"{int(self.confidence * 100)}%",
            "disclaimer": (
                "This is an uncertainty-aware provisional estimate for study feedback only, not an official JLPT score or guarantee. "
                "Real JLPT examinations apply scaled scores via proprietary Item Response Theory (IRT)."
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
            estimated_score_lower=total_score_lower,
            estimated_score_upper=total_score_upper,
            overall_max_score=blueprint.overall_max_score,
            overall_pass_threshold=blueprint.overall_pass_threshold,
            passed_overall=passed_overall,
            passed_sectional=passed_sectional,
            passed_overall_estimate=passed_overall_estimate,
            readiness_assessment=readiness_assessment,
            result_labels=result_labels,
            completed_at=completed_at,
            interpretation=interpretation,
        )
