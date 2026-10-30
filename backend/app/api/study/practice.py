"""
Practice Session Lifecycle Router.
-----------------------------------
Implements:
- POST /practice/sessions
- GET /practice/sessions
- GET /practice/sessions/{id}
- GET /practice/sessions/{id}/next
- POST /practice/sessions/{id}/answers
- POST /practice/sessions/{id}/feedback
- POST /practice/sessions/{id}/complete
- POST /practice/sessions/{id}/abandon
- GET /practice/sessions/{id}/results
- GET /history/questions
"""
from __future__ import annotations

import sqlite3
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Header, Query, status
from fastapi.responses import JSONResponse

from app.api.study.converters import practice_item_to_dto
from app.api.study.deps import (
    get_media_store,
    get_practice_service,
    get_study_db,
)
from app.api.study.errors import (
    StudyNotFoundError,
    map_domain_exception,
)
from app.api.study.idempotency import (
    check_or_start_idempotency,
    clear_failed_idempotency,
    resolve_client_request_id,
    save_idempotency_result,
    validate_client_request_id,
)
from app.api.study.schemas import (
    CreatePracticeSessionRequest,
    GenericStatusResponse,
    PaginatedResponse,
    PracticeSessionResponse,
    QuestionDTO,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    SubmitFeedbackRequest,
)
from app.study.media import MediaStore
from app.study.session.enums import DifficultyRating, SessionStatus, SessionType
from app.study.session.models import PracticeSessionConfig
from app.study.session.service import PracticeSessionService

practice_router = APIRouter(tags=["study-practice"])


def _resolve_session_id(conn: sqlite3.Connection, session_id_or_ext: str) -> int:
    """Resolve an integer ID or ULID to integer primary key."""
    if session_id_or_ext.isdigit():
        return int(session_id_or_ext)
    row = conn.execute("SELECT id FROM test_attempt WHERE external_id = ?;", (session_id_or_ext,)).fetchone()
    if not row:
        raise StudyNotFoundError(f"Practice session '{session_id_or_ext}' not found.", code="SESSION_NOT_FOUND")
    return row["id"]


@practice_router.post("/practice/sessions", response_model=PracticeSessionResponse, status_code=status.HTTP_201_CREATED)
def create_practice_session(
    request: CreatePracticeSessionRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """
    Create a new practice session with deterministically selected questions.
    """
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation="POST:/practice/sessions",
        payload=request,
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        sess_type = SessionType.CASUAL if request.session_type == "casual" else SessionType.PRACTICE
        target_weak = request.target_weak_areas or (request.session_type == "weak_area")
        target_bm = request.bookmarked_only or (request.session_type == "bookmarked")
        target_inc = request.incorrect_only or (request.session_type in ("trouble", "review"))

        # For weak areas or bookmarks without explicit level, default to None or N5
        lvl = request.level

        config = PracticeSessionConfig(
            level=lvl,
            category=request.category,
            format_code=request.format_code,
            question_count=request.question_count,
            session_type=sess_type,
            target_weak_areas=target_weak,
            bookmarked_only=target_bm,
            incorrect_only=target_inc,
            seed=request.seed,
        )
        state = practice_service.create_session(config)

        items_dto = [
            practice_item_to_dto(conn, it, reveal_answers=False)
            for it in state.items
        ]

        resp = PracticeSessionResponse(
            session_id=state.session_id,
            external_id=state.external_id,
            session_type=state.session_type.value,
            status=state.status.value,
            level=state.level or request.level,
            category=state.category,
            format_code=state.format_code,
            total_questions=state.total_questions,
            answered_count=state.answered_count,
            started_at=state.started_at,
            completed_at=state.completed_at,
            total_elapsed_ms=state.total_elapsed_ms,
            current_position=state.current_position,
            items=items_dto,
        )
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_201_CREATED,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@practice_router.post("/practice/weak-areas/session", response_model=PracticeSessionResponse, status_code=status.HTTP_201_CREATED)
def create_weak_area_session(
    request: CreatePracticeSessionRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """Convenience endpoint to launch a targeted weak-area practice drill."""
    request.target_weak_areas = True
    return create_practice_session(request, x_client_request_id, conn, practice_service)


@practice_router.post("/practice/bookmarks/session", response_model=PracticeSessionResponse, status_code=status.HTTP_201_CREATED)
def create_bookmarked_session(
    request: CreatePracticeSessionRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """Convenience endpoint to launch practice using bookmarked questions."""
    request.bookmarked_only = True
    return create_practice_session(request, x_client_request_id, conn, practice_service)


@practice_router.post("/practice/incorrect/session", response_model=PracticeSessionResponse, status_code=status.HTTP_201_CREATED)
def create_incorrect_review_session(
    request: CreatePracticeSessionRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """Convenience endpoint to retry questions answered incorrectly."""
    request.incorrect_only = True
    return create_practice_session(request, x_client_request_id, conn, practice_service)


@practice_router.get("/practice/sessions", response_model=PaginatedResponse)
def list_practice_sessions(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Retrieve paginated practice session history.
    """
    try:
        where_clauses = ["session_type != 'exam'"]
        params: List[Any] = []

        if level:
            where_clauses.append("level = ?")
            params.append(level)
        if status:
            where_clauses.append("status = ?")
            params.append(status)

        where_sql = " WHERE " + " AND ".join(where_clauses)
        count_row = conn.execute(f"SELECT COUNT(*) as c FROM test_attempt{where_sql};", tuple(params)).fetchone()
        total = count_row["c"] or 0

        query_sql = f"""
            SELECT
                id as session_id,
                external_id,
                session_type,
                status,
                level,
                category,
                format_code,
                total_elapsed_ms,
                created_at,
                started_at,
                completed_at
            FROM test_attempt
            {where_sql}
            ORDER BY id DESC
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


@practice_router.get("/practice/sessions/{id}", response_model=PracticeSessionResponse)
def get_practice_session(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
) -> PracticeSessionResponse:
    """
    Retrieve a practice session by integer ID or ULID external_id.
    Unsubmitted questions conceal answers and explanations.
    """
    try:
        sess_id = _resolve_session_id(conn, id)
        state = practice_service.get_session(sess_id)
        reveal_all = (state.status == SessionStatus.COMPLETED)

        items_dto = [
            practice_item_to_dto(conn, it, reveal_answers=reveal_all)
            for it in state.items
        ]

        return PracticeSessionResponse(
            session_id=state.session_id,
            external_id=state.external_id,
            session_type=state.session_type.value,
            status=state.status.value,
            level=state.level or "N5",
            category=state.category,
            format_code=state.format_code,
            total_questions=state.total_questions,
            answered_count=state.answered_count,
            started_at=state.started_at,
            completed_at=state.completed_at,
            total_elapsed_ms=state.total_elapsed_ms,
            current_position=state.current_position,
            items=items_dto,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@practice_router.get("/practice/sessions/{id}/next", response_model=QuestionDTO)
def get_next_practice_item(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
) -> QuestionDTO:
    """
    Present the next active unanswered question in the session.
    Never exposes correct answer key or rationales.
    """
    try:
        sess_id = _resolve_session_id(conn, id)
        state = practice_service.get_session(sess_id)

        # Present the item at current position
        item = practice_service.present_item(sess_id, state.current_position)
        return practice_item_to_dto(conn, item, reveal_answers=False)
    except Exception as exc:
        raise map_domain_exception(exc)


@practice_router.post("/practice/sessions/{id}/answers", response_model=SubmitAnswerResponse)
@practice_router.post("/practice/sessions/{id}/answer", response_model=SubmitAnswerResponse)
def submit_practice_answer(
    id: str,
    request: SubmitAnswerRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """
    Submit and deterministically grade an answer to a practice question.
    Returns correctness and structured explanation markup.
    """
    sess_id = _resolve_session_id(conn, id)
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/practice/sessions/{sess_id}/answers",
        payload=request,
        resource_id=str(sess_id),
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        rating = DifficultyRating(request.difficulty_rating) if request.difficulty_rating else None

        grading_result = practice_service.submit_answer(
            session_id=sess_id,
            attempt_item_id=request.attempt_item_id,
            selected_choice_id=request.selected_choice_id,
            time_spent_ms=request.time_spent_ms,
            difficulty_rating=rating,
        )

        resp = SubmitAnswerResponse(
            attempt_item_id=request.attempt_item_id,
            selected_choice_id=request.selected_choice_id,
            is_correct=grading_result.is_correct,
            grading_status=grading_result.grading_status.value,
            canonical_choice_id=grading_result.canonical_choice_id,
            explanation_markup=grading_result.rationale_markup,
            time_spent_ms=request.time_spent_ms,
        )
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_200_OK,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@practice_router.post("/practice/sessions/{id}/feedback", response_model=GenericStatusResponse)
def submit_practice_feedback(
    id: str,
    request: SubmitFeedbackRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """
    Record subjective learner difficulty rating for an answered attempt item.
    """
    sess_id = _resolve_session_id(conn, id)
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/practice/sessions/{sess_id}/feedback",
        payload=request,
        resource_id=str(sess_id),
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        practice_service.submit_feedback(
            session_id=sess_id,
            attempt_item_id=request.attempt_item_id,
            difficulty_rating=DifficultyRating(request.difficulty_rating),
        )
        resp = GenericStatusResponse(status="ok", message="Difficulty feedback recorded.")
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_200_OK,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@practice_router.post("/practice/sessions/{id}/complete", response_model=PracticeSessionResponse)
def complete_practice_session(
    id: str,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """
    Explicitly complete an active practice session.
    """
    sess_id = _resolve_session_id(conn, id)
    client_request_id = validate_client_request_id(x_client_request_id)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/practice/sessions/{sess_id}/complete",
        payload={},
        resource_id=str(sess_id),
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        state = practice_service.complete_session(sess_id)
        items_dto = [
            practice_item_to_dto(conn, it, reveal_answers=True)
            for it in state.items
        ]
        resp = PracticeSessionResponse(
            session_id=state.session_id,
            external_id=state.external_id,
            session_type=state.session_type.value,
            status=state.status.value,
            level=state.level or "N5",
            category=state.category,
            format_code=state.format_code,
            total_questions=state.total_questions,
            answered_count=state.answered_count,
            started_at=state.started_at,
            completed_at=state.completed_at,
            total_elapsed_ms=state.total_elapsed_ms,
            current_position=state.current_position,
            items=items_dto,
        )
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_200_OK,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@practice_router.post("/practice/sessions/{id}/abandon", response_model=PracticeSessionResponse)
def abandon_practice_session(
    id: str,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
):
    """
    Explicitly abandon an active practice session.
    """
    sess_id = _resolve_session_id(conn, id)
    client_request_id = validate_client_request_id(x_client_request_id)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/practice/sessions/{sess_id}/abandon",
        payload={},
        resource_id=str(sess_id),
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        state = practice_service.abandon_session(sess_id)
        items_dto = [
            practice_item_to_dto(conn, it, reveal_answers=False)
            for it in state.items
        ]
        resp = PracticeSessionResponse(
            session_id=state.session_id,
            external_id=state.external_id,
            session_type=state.session_type.value,
            status=state.status.value,
            level=state.level or "N5",
            category=state.category,
            format_code=state.format_code,
            total_questions=state.total_questions,
            answered_count=state.answered_count,
            started_at=state.started_at,
            completed_at=state.completed_at,
            total_elapsed_ms=state.total_elapsed_ms,
            current_position=state.current_position,
            items=items_dto,
        )
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_200_OK,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@practice_router.get("/practice/sessions/{id}/results", response_model=PracticeSessionResponse)
def get_practice_results(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    practice_service: PracticeSessionService = Depends(get_practice_service),
) -> PracticeSessionResponse:
    """
    Retrieve full review results for a practice session with canonical answers and explanations revealed.
    """
    try:
        sess_id = _resolve_session_id(conn, id)
        state = practice_service.get_session(sess_id)
        items_dto = [
            practice_item_to_dto(conn, it, reveal_answers=True)
            for it in state.items
        ]
        return PracticeSessionResponse(
            session_id=state.session_id,
            external_id=state.external_id,
            session_type=state.session_type.value,
            status=state.status.value,
            level=state.level or "N5",
            category=state.category,
            format_code=state.format_code,
            total_questions=state.total_questions,
            answered_count=state.answered_count,
            started_at=state.started_at,
            completed_at=state.completed_at,
            total_elapsed_ms=state.total_elapsed_ms,
            current_position=state.current_position,
            items=items_dto,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@practice_router.get("/history/questions", response_model=PaginatedResponse)
def list_question_history(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    format_code: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Retrieve paginated history of questions attempted, with accuracy,
    adaptive priority, and last attempted timestamp.
    """
    try:
        where_clauses = ["qas.total_attempts > 0"]
        params: List[Any] = []

        if level:
            where_clauses.append("q.level = ?")
            params.append(level)
        if format_code:
            where_clauses.append("q.format_code = ?")
            params.append(format_code)

        where_sql = " WHERE " + " AND ".join(where_clauses)

        count_sql = f"""
            SELECT COUNT(*) as c
            FROM question_adaptive_state qas
            JOIN question q ON qas.question_id = q.id
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
                qas.total_attempts as attempts_count,
                qas.total_correct as correct_count,
                ROUND((qas.total_correct * 100.0 / qas.total_attempts), 2) as accuracy,
                qas.consecutive_correct_easy,
                qas.last_rating,
                qas.last_is_correct,
                qas.last_attempted_at,
                qas.priority_score
            FROM question_adaptive_state qas
            JOIN question q ON qas.question_id = q.id
            JOIN question_revision qr ON q.current_revision_id = qr.id
            {where_sql}
            ORDER BY qas.last_attempted_at DESC
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
