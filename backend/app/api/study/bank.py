"""
Study Bank & Exam Readiness Router.
-----------------------------------
Implements:
- GET /bank/summary?level=
- GET /exam/readiness
- GET /exam/blueprints/{level}
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, status

from app.api.study.deps import get_media_store, get_study_db
from app.api.study.errors import StudyBadRequestError, StudyNotFoundError, map_domain_exception
from app.api.study.schemas import (
    BankSummaryResponse,
    FormatSummaryItem,
    LevelSummaryItem,
)
from app.study.exam.blueprint import get_blueprint_from_db_or_default, get_official_blueprint
from app.study.exam.validator import ExamReadinessValidator
from app.study.formats import FORMAT_REGISTRY
from app.study.media import MediaStore

bank_router = APIRouter(tags=["study-bank"])


@bank_router.get("/bank/summary", response_model=BankSummaryResponse)
def get_bank_summary(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$", description="Optional JLPT level filter (N1-N5)"),
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> BankSummaryResponse:
    """
    Retrieve question bank counts, active counts, and eligible question breakdown
    by format and level.
    """
    try:
        # Total questions & active questions
        base_query = "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM question"
        params: List[Any] = []
        if level:
            base_query += " WHERE level = ?"
            params.append(level)

        row = conn.execute(base_query, tuple(params)).fetchone()
        total_questions = row["total"] or 0
        active_questions = row["active"] or 0

        # Query all active questions with eligibility view
        elig_query = """
            SELECT
                vqe.question_id,
                vqe.level,
                vqe.category,
                vqe.format_code,
                vqe.question_status,
                CASE WHEN (
                    vqe.question_status = 'active'
                    AND vqe.has_current_revision = 1
                    AND vqe.validation_status = 'valid'
                    AND vqe.has_answer = 1
                    AND vqe.missing_required_assets_count = 0
                    AND vqe.group_inconsistent = 0
                    AND vqe.has_answer_conflict = 0
                ) THEN 1 ELSE 0 END AS is_eligible
            FROM v_question_eligibility vqe
        """
        if level:
            elig_query += " WHERE vqe.level = ?"

        elig_rows = conn.execute(elig_query, tuple(params)).fetchall()

        eligible_questions = sum(1 for r in elig_rows if r["is_eligible"] == 1)

        # Build nested summary per level and format
        target_levels = [level] if level else ["N5", "N4", "N3", "N2", "N1"]
        levels_dict: Dict[str, LevelSummaryItem] = {}

        for lvl in target_levels:
            lvl_rows = [r for r in elig_rows if r["level"] == lvl]
            lvl_total = len(lvl_rows)
            lvl_eligible = sum(1 for r in lvl_rows if r["is_eligible"] == 1)

            # Group by format
            format_counts: Dict[str, Dict[str, Any]] = {}
            for r in lvl_rows:
                fc = r["format_code"]
                if fc not in format_counts:
                    format_counts[fc] = {
                        "category": r["category"],
                        "total": 0,
                        "eligible": 0,
                    }
                format_counts[fc]["total"] += 1
                if r["is_eligible"] == 1:
                    format_counts[fc]["eligible"] += 1

            format_items = [
                FormatSummaryItem(
                    format_code=fc,
                    category=data["category"],
                    total_count=data["total"],
                    eligible_count=data["eligible"],
                )
                for fc, data in sorted(format_counts.items())
            ]

            levels_dict[lvl] = LevelSummaryItem(
                level=lvl,
                total_count=lvl_total,
                eligible_count=lvl_eligible,
                formats=format_items,
            )

        return BankSummaryResponse(
            total_questions=total_questions,
            active_questions=active_questions,
            eligible_questions=eligible_questions,
            levels=levels_dict,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/exam/readiness")
def get_exam_readiness(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$", description="JLPT Level (N1-N5)"),
    version: Optional[str] = Query(default=None, description="Blueprint version"),
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> Any:
    """
    Evaluate bank readiness against official or saved examination blueprints.
    Returns readiness deficits and format availability.
    """
    try:
        levels_to_check = [level] if level else ["N5", "N4", "N3", "N2", "N1"]
        reports = {}

        for lvl in levels_to_check:
            blueprint = get_blueprint_from_db_or_default(conn, lvl, version=version)
            report = ExamReadinessValidator.validate_readiness(
                conn=conn,
                blueprint=blueprint,
                media_store=media_store,
                verify_files=True,
            )
            reports[lvl] = report.model_dump()

        if level:
            return reports[level]
        return reports
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/exam/blueprints/{level}")
def get_exam_blueprint(
    level: str,
    version: Optional[str] = Query(default=None, description="Optional blueprint version"),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> Dict[str, Any]:
    """
    Retrieve the versioned examination blueprint for a JLPT level.
    """
    clean_level = level.upper().strip()
    if clean_level not in ("N1", "N2", "N3", "N4", "N5"):
        raise StudyBadRequestError(
            message=f"Invalid JLPT level '{level}'. Must be one of N1, N2, N3, N4, N5.",
            code="INVALID_LEVEL",
        )

    try:
        blueprint = get_blueprint_from_db_or_default(conn, clean_level, version=version)
        return blueprint.model_dump()
    except KeyError:
        raise StudyNotFoundError(
            message=f"No official blueprint found for level {clean_level}.",
            code="BLUEPRINT_NOT_FOUND",
        )
    except Exception as exc:
        raise map_domain_exception(exc)

