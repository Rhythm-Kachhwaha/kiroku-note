"""
JLPT Examination Lifecycle Router.
----------------------------------
Implements:
- POST /exam/sessions
- GET /exam/sessions/{id} (State polling via peek_state())
- POST /exam/sessions/{id}/sections/{section}/start
- POST /exam/sessions/{id}/sections/{section}/pause
- POST /exam/sessions/{id}/sections/{section}/resume
- POST /exam/sessions/{id}/sections/{section}/submit
- GET /exam/sessions/{id}/items/{item}
- PUT /exam/sessions/{id}/items/{item}/answer
- PUT /exam/sessions/{id}/items/{item}/flag
- POST /exam/sessions/{id}/complete
- GET /exam/sessions/{id}/result
- GET /exam/history
- POST /exam/diagnostic
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, Query, status
from fastapi.responses import JSONResponse

from app.api.study.converters import exam_item_to_dto, practice_item_to_dto
from app.api.study.deps import (
    get_exam_service,
    get_media_store,
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
    CreateDiagnosticRequest,
    CreateExamSessionRequest,
    ExamSectionStateDTO,
    ExamSessionResponse,
    GenericStatusResponse,
    PaginatedResponse,
    PracticeSessionResponse,
    QuestionDTO,
    SelectDraftChoiceRequest,
    ToggleReviewFlagRequest,
)
from app.study.exam.enums import ExamMode
from app.study.exam.models import ExamResult, ExamSessionState
from app.study.exam.service import ExamSessionService
from app.study.media import MediaStore

exam_router = APIRouter(tags=["study-exam"])


def _resolve_exam_id(conn: sqlite3.Connection, exam_id_or_ext: str) -> int:
    """Resolve an integer ID or ULID to integer primary key."""
    if exam_id_or_ext.isdigit():
        return int(exam_id_or_ext)
    row = conn.execute("SELECT id FROM test_attempt WHERE external_id = ?;", (exam_id_or_ext,)).fetchone()
    if not row:
        raise StudyNotFoundError(f"Exam session '{exam_id_or_ext}' not found.", code="SESSION_NOT_FOUND")
    return row["id"]


def _resolve_section_block_order(conn: sqlite3.Connection, session_id: int, section_param: str) -> int:
    """Resolve section parameter (block_order or section_code) to integer block_order."""
    if section_param.isdigit():
        return int(section_param)
    row = conn.execute(
        "SELECT block_order FROM exam_section_attempt WHERE attempt_id = ? AND section_code = ?;",
        (session_id, section_param),
    ).fetchone()
    if row:
        return row["block_order"]
    raise StudyNotFoundError(f"Exam section '{section_param}' not found in exam {session_id}.", code="SECTION_NOT_FOUND")


def _resolve_exam_item_id(conn: sqlite3.Connection, session_id: int, item_identifier: str) -> int:
    """Resolve item identifier (attempt_item_id, position, or question ULID) to attempt_item.id."""
    if item_identifier.isdigit():
        val = int(item_identifier)
        # 1. Direct attempt_item_id
        row = conn.execute("SELECT id FROM attempt_item WHERE id = ? AND attempt_id = ?;", (val, session_id)).fetchone()
        if row:
            return row["id"]
        # 2. Position within exam
        row = conn.execute("SELECT id FROM attempt_item WHERE position = ? AND attempt_id = ?;", (val, session_id)).fetchone()
        if row:
            return row["id"]

    # 3. Question external_id
    row = conn.execute(
        """
        SELECT ai.id FROM attempt_item ai
        JOIN question q ON ai.question_id = q.id
        WHERE q.external_id = ? AND ai.attempt_id = ?;
        """,
        (item_identifier, session_id),
    ).fetchone()
    if row:
        return row["id"]

    raise StudyNotFoundError(f"Exam item '{item_identifier}' not found in exam {session_id}.", code="ITEM_NOT_FOUND")


def _format_exam_session_response(conn: sqlite3.Connection, state: ExamSessionState) -> ExamSessionResponse:
    """Serialize ExamSessionState into standardized frontend ExamSessionResponse."""
    sections_dto = [
        ExamSectionStateDTO(
            section_id=s.section_id,
            section_code=s.section_code,
            block_order=s.block_order,
            label=s.label,
            status=s.status.value,
            allocated_time_seconds=s.allocated_time_seconds,
            remaining_time_seconds=s.remaining_time_seconds,
            started_at=s.started_at,
            deadline_at=s.deadline_at,
            paused_at=s.paused_at,
            completed_at=s.completed_at,
            total_elapsed_ms=s.total_elapsed_ms,
        )
        for s in state.sections
    ]

    is_completed = (state.status == "completed")
    items_dto = [
        exam_item_to_dto(conn, it, is_exam_completed=is_completed)
        for it in state.current_section_items
    ]

    # Find active section timing
    active_sec = None
    for s in state.sections:
        if s.block_order == state.active_section_order:
            active_sec = s
            break

    deadline_at = active_sec.deadline_at if active_sec else None
    remaining_seconds = active_sec.remaining_time_seconds if active_sec else None

    return ExamSessionResponse(
        session_id=state.session_id,
        external_id=state.external_id,
        level=state.level,
        status=state.status,
        blueprint_version=state.blueprint_version,
        total_questions=state.total_questions,
        answered_count=state.answered_count,
        marked_count=state.marked_count,
        active_section_order=state.active_section_order,
        sections=sections_dto,
        current_section_items=items_dto,
        server_time=state.server_time,
        deadline_at=deadline_at,
        remaining_seconds=remaining_seconds,
        exam_mode=state.exam_mode.value if isinstance(state.exam_mode, ExamMode) else str(state.exam_mode),
    )


@exam_router.post("/exam/sessions", response_model=ExamSessionResponse, status_code=status.HTTP_201_CREATED)
def create_exam_session(
    request: CreateExamSessionRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
):
    """
    Create a new JLPT examination simulation matching an authoritative blueprint.
    Enforces bank readiness when enforce_readiness is True.
    """
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation="POST:/exam/sessions",
        payload=request,
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        mode = ExamMode.STRICT if request.strict_timing else ExamMode.RELAXED
        state = exam_service.create_examination(
            blueprint_or_level=request.level,
            seed=request.seed,
            version=request.blueprint_version,
            mode=mode,
        )
        resp = _format_exam_session_response(conn, state)
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


@exam_router.get("/exam/sessions/{id}", response_model=ExamSessionResponse)
def get_exam_session_state(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamSessionResponse:
    """
    Poll examination state. Strictly read-only: calls peek_state() without mutating
    database or timers.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        state = exam_service.peek_state(sess_id)
        return _format_exam_session_response(conn, state)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.post("/exam/sessions/{id}/sections/{section}/start", response_model=ExamSessionResponse)
def start_exam_section(
    id: str,
    section: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamSessionResponse:
    """
    Start countdown timer and open items for the specified test section.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        block_order = _resolve_section_block_order(conn, sess_id, section)
        state = exam_service.start_section(sess_id, block_order)
        return _format_exam_session_response(conn, state)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.post("/exam/sessions/{id}/sections/{section}/pause", response_model=ExamSessionResponse)
def pause_exam_section(
    id: str,
    section: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamSessionResponse:
    """
    Pause an active test section timer (relaxed mode only).
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        block_order = _resolve_section_block_order(conn, sess_id, section)
        state = exam_service.pause_section(sess_id, block_order)
        return _format_exam_session_response(conn, state)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.post("/exam/sessions/{id}/sections/{section}/resume", response_model=ExamSessionResponse)
def resume_exam_section(
    id: str,
    section: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamSessionResponse:
    """
    Resume a paused test section timer.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        block_order = _resolve_section_block_order(conn, sess_id, section)
        state = exam_service.resume_section(sess_id, block_order)
        return _format_exam_session_response(conn, state)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.post("/exam/sessions/{id}/sections/{section}/submit", response_model=ExamSessionResponse)
def submit_exam_section(
    id: str,
    section: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamSessionResponse:
    """
    Submit and permanently close a test section, locking all answers and advancing
    to the next section.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        block_order = _resolve_section_block_order(conn, sess_id, section)
        state = exam_service.submit_section(sess_id, block_order)
        return _format_exam_session_response(conn, state)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.get("/exam/sessions/{id}/items/{item}", response_model=QuestionDTO)
def get_exam_item(
    id: str,
    item: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> QuestionDTO:
    """
    Retrieve an individual question presentation for an exam.
    Never exposes canonical answer key or rationales during active exams.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        item_id = _resolve_exam_item_id(conn, sess_id, item)

        state = exam_service.peek_state(sess_id)
        is_completed = (state.status == "completed")

        # Find presentation item from active section or DB
        target_it = None
        for it in state.current_section_items:
            if it.attempt_item_id == item_id:
                target_it = it
                break

        if not target_it:
            # Query item from db
            row = conn.execute(
                """
                SELECT
                    ai.id as attempt_item_id,
                    ai.position,
                    ai.question_id,
                    ai.presented_at,
                    q.external_id,
                    q.level,
                    q.category,
                    q.format_code,
                    qr.stem_markup as prompt_markup,
                    esa.section_code,
                    esa.block_order,
                    eis.is_marked_for_review,
                    eis.selected_choice_id,
                    eis.audio_play_count
                FROM attempt_item ai
                JOIN question q ON ai.question_id = q.id
                JOIN question_revision qr ON ai.pinned_question_revision_id = qr.id
                JOIN exam_item_state eis ON ai.id = eis.attempt_item_id
                JOIN exam_section_attempt esa ON eis.section_attempt_id = esa.id
                WHERE ai.id = ? AND ai.attempt_id = ?;
                """,
                (item_id, sess_id),
            ).fetchone()

            if not row:
                raise StudyNotFoundError(f"Exam item '{item}' not found in exam {sess_id}.", code="ITEM_NOT_FOUND")

            from app.study.exam.models import ExamItemPresentation
            from app.study.session.models import ChoicePresentation

            # Fetch choices
            c_rows = conn.execute(
                """
                SELECT rc.id as choice_id, rc.choice_key, aico.display_position, rc.label, rc.text_markup, rc.asset_id
                FROM attempt_item_choice_order aico
                JOIN revision_choice rc ON aico.choice_id = rc.id
                WHERE aico.attempt_item_id = ?
                ORDER BY aico.display_position ASC;
                """,
                (item_id,),
            ).fetchall()
            choices = [
                ChoicePresentation(
                    choice_id=cr["choice_id"],
                    choice_key=cr["choice_key"],
                    display_position=cr["display_position"],
                    label=cr["label"],
                    mode="image" if cr["asset_id"] else "text",
                    text_markup=cr["text_markup"],
                    asset_id=cr["asset_id"],
                )
                for cr in c_rows
            ]

            target_it = ExamItemPresentation(
                attempt_item_id=row["attempt_item_id"],
                position=row["position"],
                section_code=row["section_code"],
                block_order=row["block_order"],
                question_id=row["question_id"],
                external_id=row["external_id"],
                level=row["level"],
                category=row["category"],
                format_code=row["format_code"],
                prompt_markup=row["prompt_markup"],
                choices=choices,
                presented_at=row["presented_at"],
                is_marked_for_review=bool(row["is_marked_for_review"]),
                is_answered=row["selected_choice_id"] is not None,
                selected_choice_id=row["selected_choice_id"],
                audio_play_count=row["audio_play_count"] or 0,
            )

        return exam_item_to_dto(conn, target_it, is_exam_completed=is_completed)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.put("/exam/sessions/{id}/items/{item}/answer", response_model=GenericStatusResponse)
def select_exam_choice(
    id: str,
    item: str,
    request: SelectDraftChoiceRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> GenericStatusResponse:
    """
    Draft selection of a choice within an active, non-expired section.
    Allows changing or clearing the selection before section submission.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        item_id = _resolve_exam_item_id(conn, sess_id, item)

        exam_service.select_choice(sess_id, item_id, request.selected_choice_id)
        return GenericStatusResponse(status="ok", message="Draft choice selected.")
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.put("/exam/sessions/{id}/items/{item}/flag", response_model=GenericStatusResponse)
def toggle_exam_review_flag(
    id: str,
    item: str,
    request: ToggleReviewFlagRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> GenericStatusResponse:
    """
    Toggle the 'mark for review' flag on an exam question.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        item_id = _resolve_exam_item_id(conn, sess_id, item)

        exam_service.toggle_review_flag(sess_id, item_id, request.is_flagged)
        return GenericStatusResponse(status="ok", message="Review flag updated.")
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.post("/exam/sessions/{id}/complete", response_model=ExamResult)
def complete_exam_session(
    id: str,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
):
    """
    Complete the examination: grade all draft answers, evaluate official thresholds,
    and persist an immutable exam result snapshot.
    """
    sess_id = _resolve_exam_id(conn, id)
    client_request_id = validate_client_request_id(x_client_request_id)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/exam/sessions/{sess_id}/complete",
        payload={},
        resource_id=str(sess_id),
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        result = exam_service.complete_exam(sess_id)
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_200_OK,
            response_data=result,
        )
        return result
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@exam_router.get("/exam/sessions/{id}/result", response_model=ExamResult)
def get_exam_result_snapshot(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
) -> ExamResult:
    """
    Retrieve the immutable scoring snapshot and pass/fail assessment for a completed exam.
    """
    try:
        sess_id = _resolve_exam_id(conn, id)
        return exam_service.get_exam_result(sess_id)
    except Exception as exc:
        raise map_domain_exception(exc)


@exam_router.get("/exam/history", response_model=PaginatedResponse)
def list_exam_history(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Retrieve paginated exam history with final scores and pass/fail status.
    """
    try:
        where_clauses = ["ta.session_type = 'exam'"]
        params: List[Any] = []

        if level:
            where_clauses.append("ta.level = ?")
            params.append(level)

        where_sql = " WHERE " + " AND ".join(where_clauses)
        count_sql = f"SELECT COUNT(*) as c FROM test_attempt ta {where_sql};"
        total = conn.execute(count_sql, tuple(params)).fetchone()["c"] or 0

        query_sql = f"""
            SELECT
                ta.id as session_id,
                ta.external_id,
                ta.level,
                ta.status,
                ta.total_elapsed_ms,
                ta.created_at,
                ta.started_at,
                ta.completed_at,
                ers.estimated_total_score,
                ers.passed_overall,
                ers.readiness_assessment
            FROM test_attempt ta
            LEFT JOIN exam_result_snapshot ers ON ta.id = ers.attempt_id
            {where_sql}
            ORDER BY ta.id DESC
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


@exam_router.post("/exam/diagnostic", response_model=PracticeSessionResponse)
def create_diagnostic_exam(
    request: CreateDiagnosticRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
    exam_service: ExamSessionService = Depends(get_exam_service),
):
    """
    Create a diagnostic practice session containing questions across formats for a JLPT level.
    """
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation="POST:/exam/diagnostic",
        payload=request,
    )
    if idemp.is_cached:
        return JSONResponse(status_code=idemp.status_code, content=idemp.cached_response)

    try:
        state = exam_service.create_diagnostic_practice(
            level=request.level,
            seed=request.seed,
        )
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
            status_code=status.HTTP_200_OK,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)
