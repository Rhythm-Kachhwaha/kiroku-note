"""FastAPI router for Phase 5 burst study modes (Sentence Scramble & Audio Shadowing)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.study_modes import StudyModesService

router = APIRouter(prefix="/api/study-modes", tags=["study-modes"])
_HTTP_422 = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)


class StartBurstSessionRequest(BaseModel):
    mode: str
    target_count: int = 5


class RevealBurstItemRequest(BaseModel):
    item_index: int = Field(ge=0)


class SubmitBurstAnswerRequest(BaseModel):
    item_index: int = Field(ge=0)
    user_answer: Any


def _get_service() -> StudyModesService:
    return StudyModesService()


@router.post("/sessions")
def start_burst_session(request: StartBurstSessionRequest) -> dict[str, Any]:
    """Start a 5- or 10-item sentence scramble or audio shadowing burst session."""
    service = _get_service()
    try:
        return service.start_session(mode=request.mode, target_count=request.target_count)
    except ValueError as exc:
        raise HTTPException(status_code=_HTTP_422, detail=str(exc)) from exc


@router.get("/consistency")
def get_weekly_consistency() -> dict[str, Any]:
    """Return rolling 7-day consistency without punitive daily streak resets."""
    service = _get_service()
    return service.get_weekly_consistency()


@router.get("/sessions/{session_id}")
def get_burst_session(session_id: int) -> dict[str, Any]:
    """Fetch an existing burst session with items and recorded attempts."""
    service = _get_service()
    try:
        return service.get_session(session_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/reveal")
def reveal_burst_item(session_id: int, request: RevealBurstItemRequest) -> dict[str, Any]:
    """Reveal concealed transcript, reading, gloss, and kanji breakdown for an item."""
    service = _get_service()
    try:
        return service.reveal_item(session_id=session_id, item_index=request.item_index)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_HTTP_422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/answer")
def submit_burst_answer(session_id: int, request: SubmitBurstAnswerRequest) -> dict[str, Any]:
    """Submit and grade an answer for a burst study item."""
    service = _get_service()
    try:
        return service.submit_answer(
            session_id=session_id,
            item_index=request.item_index,
            user_answer=request.user_answer,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_HTTP_422, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/complete")
def complete_burst_session(session_id: int) -> dict[str, Any]:
    """Complete a burst session and return accuracy plus updated weekly consistency."""
    service = _get_service()
    try:
        return service.complete_session(session_id=session_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
