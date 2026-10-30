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

from fastapi import APIRouter, Depends, Header, Query, status

from app.api.study.deps import (
    get_media_store,
    get_practice_analytics_service,
    get_study_db,
)
from app.api.study.errors import StudyNotFoundError, map_domain_exception
from app.api.study.schemas import (
    AddBookmarkRequest,
    BookmarkItemDTO,
    BookmarkListResponse,
    BookmarkReportResponse,
    GenericStatusResponse,
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
                MIN(r.answered_at) as first_incorrect_at,
                MAX(r.answered_at) as last_incorrect_at,
                COUNT(r.id) as incorrect_count,
                COALESCE(qas.total_attempts, COUNT(r.id)) as total_attempts,
                COALESCE(qas.total_correct, 0) as total_correct,
                CASE WHEN qas.last_is_correct = 1 THEN 1 ELSE 0 END as is_resolved,
                CASE WHEN qas.last_is_correct = 1 THEN 'improved' ELSE 'needs_review' END as improvement_status,
                qas.last_attempted_at
            FROM response r
            JOIN attempt_item ai ON r.attempt_item_id = ai.id
            JOIN question q ON ai.question_id = q.id
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
            {where_sql}
            GROUP BY q.id
            ORDER BY is_resolved ASC, last_incorrect_at DESC
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


@supporting_router.get("/history/incorrect/{question_id}")
def get_incorrect_question_detail(
    question_id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> Dict[str, Any]:
    """
    Retrieve full attempt history and improvement timeline for a specific incorrect question.
    """
    try:
        q_id = _resolve_question_pk(conn, question_id)
        q_row = conn.execute(
            """
            SELECT q.id, q.external_id, q.level, q.category, q.format_code, qr.stem_markup, qr.payload_json
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            WHERE q.id = ?;
            """,
            (q_id,),
        ).fetchone()
        if not q_row:
            raise StudyNotFoundError(f"Question {question_id} not found.", code="QUESTION_NOT_FOUND")

        attempts_rows = conn.execute(
            """
            SELECT
                ta.id as session_id,
                ta.external_id as session_external_id,
                ta.session_type,
                ai.position,
                r.is_correct,
                r.selected_choice_id,
                rc.choice_key as selected_choice_key,
                r.canonical_choice_id,
                r_canon.choice_key as canonical_choice_key,
                r.time_spent_ms,
                f.difficulty_rating,
                r.answered_at,
                ra.rationale_markup as explanation_markup
            FROM attempt_item ai
            JOIN test_attempt ta ON ai.attempt_id = ta.id
            JOIN response r ON ai.id = r.attempt_item_id
            LEFT JOIN revision_choice rc ON r.selected_choice_id = rc.id
            LEFT JOIN revision_choice r_canon ON r.canonical_choice_id = r_canon.id
            LEFT JOIN revision_answer ra ON ai.pinned_question_revision_id = ra.question_revision_id
            LEFT JOIN attempt_item_feedback f ON ai.id = f.attempt_item_id
            WHERE ai.question_id = ?
            ORDER BY r.answered_at ASC;
            """,
            (q_id,),
        ).fetchall()

        timeline = [dict(r) for r in attempts_rows]
        total_attempts = len(timeline)
        correct_attempts = sum(1 for a in timeline if a["is_correct"] == 1)
        is_resolved = bool(timeline and timeline[-1]["is_correct"] == 1)

        return {
            "question_id": q_row["id"],
            "external_id": q_row["external_id"],
            "level": q_row["level"],
            "category": q_row["category"],
            "format_code": q_row["format_code"],
            "stem_markup": q_row["stem_markup"],
            "total_attempts": total_attempts,
            "correct_attempts": correct_attempts,
            "is_resolved": is_resolved,
            "status": "improved" if is_resolved else "needs_review",
            "timeline": timeline,
        }
    except Exception as exc:
        raise map_domain_exception(exc)


def _resolve_question_pk(conn: sqlite3.Connection, question_id_or_ext: Any) -> int:
    """Resolve an integer ID or ULID external_id to integer primary key."""
    val = str(question_id_or_ext).strip()
    if val.isdigit():
        q_id = int(val)
        row = conn.execute("SELECT id FROM question WHERE id = ?;", (q_id,)).fetchone()
        if not row:
            raise StudyNotFoundError(f"Question with ID {q_id} not found.", code="QUESTION_NOT_FOUND")
        return q_id
    row = conn.execute("SELECT id FROM question WHERE external_id = ?;", (val,)).fetchone()
    if not row:
        raise StudyNotFoundError(f"Question with external ID '{val}' not found.", code="QUESTION_NOT_FOUND")
    return row["id"]


@supporting_router.get("/bookmarks", response_model=BookmarkListResponse)
def get_bookmarks(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    format_code: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> BookmarkListResponse:
    """
    Browse bookmarked questions with filtering and pagination.
    """
    try:
        where_clauses = ["1=1"]
        params: List[Any] = []

        if level:
            where_clauses.append("q.level = ?")
            params.append(level)
        if format_code:
            where_clauses.append("q.format_code = ?")
            params.append(format_code)
        if category:
            where_clauses.append("q.category = ?")
            params.append(category)

        where_sql = " AND ".join(where_clauses)
        count_sql = f"""
            SELECT COUNT(*) as c
            FROM question_bookmark qb
            JOIN question q ON qb.question_id = q.id
            WHERE {where_sql};
        """
        total = conn.execute(count_sql, tuple(params)).fetchone()["c"] or 0

        query_sql = f"""
            SELECT
                qb.id,
                qb.question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                qb.notes,
                qb.created_at,
                CASE WHEN (
                    vqe.question_status = 'active'
                    AND vqe.has_current_revision = 1
                    AND vqe.validation_status = 'valid'
                    AND vqe.has_answer = 1
                    AND vqe.missing_required_assets_count = 0
                    AND vqe.group_inconsistent = 0
                    AND vqe.has_answer_conflict = 0
                ) THEN 1 ELSE 0 END as is_eligible
            FROM question_bookmark qb
            JOIN question q ON qb.question_id = q.id
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN v_question_eligibility vqe ON q.id = vqe.question_id
            WHERE {where_sql}
            ORDER BY qb.id DESC
            LIMIT ? OFFSET ?;
        """
        rows = conn.execute(query_sql, tuple(params + [limit, offset])).fetchall()
        items = [
            BookmarkItemDTO(
                id=r["id"],
                question_id=r["question_id"],
                external_id=r["external_id"],
                level=r["level"],
                category=r["category"],
                format_code=r["format_code"],
                prompt_markup=r["prompt_markup"],
                notes=r["notes"] or "",
                created_at=r["created_at"],
                is_eligible=bool(r["is_eligible"]),
            )
            for r in rows
        ]

        return BookmarkListResponse(
            supported=True,
            message="Bookmarks supported.",
            total=total,
            limit=limit,
            offset=offset,
            items=items,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.post("/bookmarks", response_model=GenericStatusResponse, status_code=status.HTTP_201_CREATED)
def add_bookmark(
    request: AddBookmarkRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> GenericStatusResponse:
    """
    Bookmark a question. Idempotent: safe against duplicate requests.
    """
    try:
        q_id = _resolve_question_pk(conn, request.question_id)
        notes = request.notes or ""

        conn.execute(
            """
            INSERT INTO question_bookmark (question_id, notes)
            VALUES (?, ?)
            ON CONFLICT(question_id) DO UPDATE SET
                notes = excluded.notes;
            """,
            (q_id, notes),
        )
        conn.commit()
        return GenericStatusResponse(status="ok", message="Question bookmarked successfully.")
    except Exception as exc:
        raise map_domain_exception(exc)


@supporting_router.delete("/bookmarks/{question_id}", response_model=GenericStatusResponse)
def remove_bookmark(
    question_id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> GenericStatusResponse:
    """
    Remove bookmark for a question. Idempotent: succeeds even if bookmark was already removed.
    """
    try:
        q_id = _resolve_question_pk(conn, question_id)
        conn.execute("DELETE FROM question_bookmark WHERE question_id = ?;", (q_id,))
        conn.commit()
        return GenericStatusResponse(status="ok", message="Bookmark removed successfully.")
    except Exception as exc:
        raise map_domain_exception(exc)


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

