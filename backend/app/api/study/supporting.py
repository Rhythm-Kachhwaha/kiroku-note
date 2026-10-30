"""
Supporting & Analytics Router for Study Subsystem.
--------------------------------------------------
Implements:
- GET /dashboard/overview & GET /analytics/overview
- GET /analytics/weak-areas
- GET /analytics/trouble-questions
- GET /history/incorrect
- GET /bookmarks (Clear report on domain support status)
- GET /settings & PATCH /settings
- GET /diagnostics (M10 read-only diagnostics)
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, status

from app.api.study.deps import (
    get_media_store,
    get_practice_analytics_service,
    get_study_db,
)
from app.api.study.errors import map_domain_exception
from app.api.study.schemas import (
    BookmarkReportResponse,
    LearningOverviewResponse,
    PaginatedResponse,
    StudySettingsDTO,
    TroubleQuestionItem,
    WeakAreaItem,
)
from app.study.diagnostics import run_study_diagnostics
from app.study.media import MediaStore
from app.study.session.analytics import PracticeAnalyticsService

supporting_router = APIRouter(tags=["study-supporting"])

# In-memory session settings defaults
_STUDY_SETTINGS = StudySettingsDTO()


@supporting_router.get("/dashboard/overview", response_model=LearningOverviewResponse)
@supporting_router.get("/analytics/overview", response_model=LearningOverviewResponse)
def get_analytics_overview(
    analytics_service: PracticeAnalyticsService = Depends(get_practice_analytics_service),
) -> LearningOverviewResponse:
    """
    Retrieve aggregated learning overview metrics, level accuracy, format breakdown,
    and recent activity.
    """
    try:
        summary = analytics_service.get_learning_summary()
        by_level = analytics_service.get_accuracy_by_level()
        by_family = analytics_service.get_accuracy_by_family()
        recent = analytics_service.get_recent_activity(limit=10)

        return LearningOverviewResponse(
            learning_summary=summary.model_dump(),
            accuracy_by_level=[x.model_dump() for x in by_level],
            accuracy_by_family=[x.model_dump() for x in by_family],
            recent_activity=[x.model_dump() for x in recent],
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.get("/analytics/weak-areas", response_model=List[WeakAreaItem])
def get_weak_areas(
    analytics_service: PracticeAnalyticsService = Depends(get_practice_analytics_service),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> List[WeakAreaItem]:
    """
    Identify question formats and categories with lower accuracy (< 75%) or high error rates.
    """
    try:
        rows = conn.execute(
            """
            SELECT
                q.format_code,
                q.category,
                q.level,
                COUNT(r.id) as attempted,
                SUM(r.is_correct) as correct
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            GROUP BY q.format_code, q.category, q.level
            HAVING attempted >= 1
            ORDER BY (SUM(r.is_correct) * 1.0 / COUNT(r.id)) ASC, attempted DESC
            LIMIT 10;
            """
        ).fetchall()

        weak_areas = []
        for r in rows:
            att = r["attempted"] or 0
            cor = r["correct"] or 0
            acc = round((cor / att * 100.0), 2) if att > 0 else 0.0
            weak_areas.append(
                WeakAreaItem(
                    format_code=r["format_code"],
                    category=r["category"],
                    level=r["level"],
                    attempted_count=att,
                    accuracy=acc,
                    description=f"{r['format_code']} ({r['level']}): {acc}% accuracy across {att} attempts.",
                )
            )
        return weak_areas
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.get("/analytics/trouble-questions", response_model=List[TroubleQuestionItem])
def get_trouble_questions(
    limit: int = Query(default=10, ge=1, le=50),
    analytics_service: PracticeAnalyticsService = Depends(get_practice_analytics_service),
) -> List[TroubleQuestionItem]:
    """
    Retrieve questions repeatedly answered incorrectly, ordered by error count.
    """
    try:
        items = analytics_service.get_trouble_questions(limit=limit)
        return [
            TroubleQuestionItem(
                question_id=it.question_id,
                external_id=it.external_id,
                level=it.level,
                category=it.category,
                format_code=it.format_code,
                prompt_markup=it.prompt_markup,
                attempts_count=it.attempts_count,
                correct_count=it.correct_count,
                accuracy=it.accuracy,
                consecutive_correct_easy=it.consecutive_correct_easy,
                priority_score=it.priority_score,
                last_rating=it.last_rating,
                last_attempted_at=it.last_attempted_at,
            )
            for it in items
        ]
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.get("/history/incorrect", response_model=PaginatedResponse)
def get_incorrect_questions_history(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Retrieve history of questions answered incorrectly for focused review drills.
    """
    try:
        where_clauses = ["r.is_correct = 0"]
        params: List[Any] = []
        if level:
            where_clauses.append("q.level = ?")
            params.append(level)

        where_sql = " WHERE " + " AND ".join(where_clauses)
        count_sql = f"""
            SELECT COUNT(DISTINCT q.id) as c
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            {where_sql};
        """
        total = conn.execute(count_sql, tuple(params)).fetchone()["c"] or 0

        query_sql = f"""
            SELECT
                q.id as question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                MAX(r.answered_at) as last_incorrect_at,
                COUNT(r.id) as incorrect_count
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            JOIN question_revision qr ON q.current_revision_id = qr.id
            {where_sql}
            GROUP BY q.id
            ORDER BY last_incorrect_at DESC
            LIMIT ? OFFSET ?;
        """
        rows = conn.execute(query_sql, tuple(params + [limit, offset])).fetchall()
        items = [dict(r) for r in rows]

        return PaginatedResponse(
            total=total,
            limit=limit,
            offset=offset,
            items=items,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.get("/bookmarks", response_model=BookmarkReportResponse)
def get_bookmarks() -> BookmarkReportResponse:
    """
    Report bookmark status. Bookmarks are not currently supported by the local study domain.
    """
    return BookmarkReportResponse(
        supported=False,
        message="Bookmarks are not currently supported by the local study domain.",
        items=[],
    )


@supporting_router.get("/settings", response_model=StudySettingsDTO)
def get_study_settings() -> StudySettingsDTO:
    """
    Retrieve study subsystem preferences and execution configuration.
    """
    return _STUDY_SETTINGS


@supporting_router.patch("/settings", response_model=StudySettingsDTO)
def update_study_settings(updates: Dict[str, Any]) -> StudySettingsDTO:
    """
    Update study subsystem runtime preferences.
    """
    global _STUDY_SETTINGS
    data = _STUDY_SETTINGS.model_dump()
    for k, v in updates.items():
        if k in data and v is not None:
            data[k] = v
    _STUDY_SETTINGS = StudySettingsDTO(**data)
    return _STUDY_SETTINGS


@supporting_router.get("/diagnostics")
def get_study_diagnostics(
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> Dict[str, Any]:
    """
    Run comprehensive, strictly read-only diagnostics across SQLite integrity,
    foreign keys, migrations, media storage, and JLPT bank readiness.
    """
    try:
        report = run_study_diagnostics(
            conn=conn,
            media_dir=media_store.media_dir,
            verify_media_hashes=False,
        )
        return report.model_dump()
    except Exception as exc:
        raise map_domain_exception(exc)

