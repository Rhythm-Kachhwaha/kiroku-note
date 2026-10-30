"""
Authoritative Blueprint Readiness Validator for JLPT Examinations.
-----------------------------------------------------------------
Validates question bank inventory, format compatibility, eligibility status,
and listening media integrity against a versioned examination blueprint.
Guarantees that an incomplete bank strictly blocks full exam generation.
"""
from __future__ import annotations

import sqlite3
from typing import List, Optional, Set, Tuple

from app.study.eligibility import evaluate_eligibility
from app.study.exam.enums import ReadinessStatus
from app.study.exam.models import (
    ExamBlueprint,
    ExamReadinessReport,
    FormatReadiness,
    SectionReadiness,
)
from app.study.formats import FORMAT_REGISTRY
from app.study.media import MediaStore


class ExamReadinessValidator:
    """
    Evaluates whether the approved question bank satisfies all structural,
    format, level, and media constraints of an examination blueprint.
    """

    @classmethod
    def get_eligible_questions_for_format(
        cls,
        conn: sqlite3.Connection,
        level: str,
        format_code: str,
        media_store: Optional[MediaStore] = None,
        verify_files: bool = True,
    ) -> List[Tuple[int, int]]:
        """
        Fetch all active, approved, and strictly eligible questions for (level, format_code).

        Returns:
            List of (question_id, current_revision_id) tuples.
        """
        cursor = conn.execute(
            """
            SELECT id, current_revision_id
            FROM question
            WHERE level = ?
              AND format_code = ?
              AND status = 'active'
              AND current_revision_id IS NOT NULL
            ORDER BY id ASC;
            """,
            (level, format_code),
        )
        candidates = cursor.fetchall()

        eligible: List[Tuple[int, int]] = []
        for row in candidates:
            q_id = row["id"]
            rev_id = row["current_revision_id"]

            is_eligible, reasons = evaluate_eligibility(
                question_or_id=q_id,
                conn=conn,
                verify_files=verify_files,
                media_store=media_store,
            )
            if is_eligible:
                eligible.append((q_id, rev_id))

        return eligible

    @classmethod
    def validate_readiness(
        cls,
        conn: sqlite3.Connection,
        blueprint: ExamBlueprint,
        media_store: Optional[MediaStore] = None,
        verify_files: bool = True,
    ) -> ExamReadinessReport:
        """
        Deterministically validate question-bank readiness against an exam blueprint.
        """
        sections_readiness: List[SectionReadiness] = []
        blocked_reasons: List[str] = []
        total_required = 0
        total_available = 0
        all_sections_satisfied = True

        # Track global question deduplication
        seen_question_ids: Set[int] = set()

        for sec in blueprint.test_sections:
            format_reports: List[FormatReadiness] = []
            sec_required = 0
            sec_available = 0
            sec_satisfied = True

            for quota in sec.item_quotas:
                fmt_code = quota.format_code
                target = quota.target_count
                sec_required += target

                # 1. Level compatibility check against format registry
                fmt_meta = FORMAT_REGISTRY.get(fmt_code)
                if not fmt_meta:
                    sec_satisfied = False
                    all_sections_satisfied = False
                    blocked_reasons.append(f"Format code '{fmt_code}' is not registered in FORMAT_REGISTRY.")
                    continue

                if blueprint.level not in fmt_meta.allowed_levels:
                    sec_satisfied = False
                    all_sections_satisfied = False
                    blocked_reasons.append(
                        f"Format '{fmt_code}' is invalid for level {blueprint.level} (allowed: {sorted(fmt_meta.allowed_levels)})."
                    )
                    continue

                # 2. Retrieve eligible questions from question bank
                eligible_items = cls.get_eligible_questions_for_format(
                    conn=conn,
                    level=blueprint.level,
                    format_code=fmt_code,
                    media_store=media_store,
                    verify_files=verify_files,
                )

                # Count eligible questions not yet claimed by another quota
                unclaimed_eligible = [item for item in eligible_items if item[0] not in seen_question_ids]
                avail_count = len(unclaimed_eligible)
                sec_available += avail_count

                is_quota_satisfied = (avail_count >= target)
                missing = max(0, target - avail_count)

                if not is_quota_satisfied:
                    sec_satisfied = False
                    all_sections_satisfied = False
                    reason = (
                        f"Section '{sec.label}' ({sec.section_code}): Format '{fmt_code}' requires {target} "
                        f"questions but only {avail_count} eligible questions are available ({missing} missing)."
                    )
                    blocked_reasons.append(reason)

                # Reserve question IDs for this quota up to target
                for q_id, _ in unclaimed_eligible[:target]:
                    seen_question_ids.add(q_id)

                format_reports.append(
                    FormatReadiness(
                        format_code=fmt_code,
                        category=fmt_meta.category,
                        required_count=target,
                        available_count=avail_count,
                        is_satisfied=is_quota_satisfied,
                        missing_count=missing,
                    )
                )

            total_required += sec_required
            total_available += sec_available

            sections_readiness.append(
                SectionReadiness(
                    section_code=sec.section_code,
                    label=sec.label,
                    block_order=sec.block_order,
                    required_count=sec_required,
                    available_count=sec_available,
                    is_satisfied=sec_satisfied,
                    formats=format_reports,
                )
            )

        status = ReadinessStatus.READY if all_sections_satisfied else ReadinessStatus.INCOMPLETE_BANK

        return ExamReadinessReport(
            level=blueprint.level,
            blueprint_version=blueprint.version,
            is_ready=all_sections_satisfied,
            status=status,
            total_required=total_required,
            total_available=total_available,
            sections=sections_readiness,
            blocked_reasons=blocked_reasons,
        )
