"""Word-state, encounter summary, and Anki FSRS sync routes.

The legacy known-words routes (``GET /api/known-words``,
``POST /api/known-words/mark``,
``DELETE /api/known-words/mark/{word}``) live in :mod:`app.api.subtitle`.
This module exposes the Phase 2 word-state lifecycle API and exposes a
module-level ``router`` so it is discovered by :mod:`app.api.registry`.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.repositories.word_state_repository import VALID_WORD_STATES
from app.services.anki_connect import AnkiConnectService, AnkiError
from app.services.subtitle_annotator import get_subtitle_annotator_service
from app.services.word_state_service import WordStateService

router = APIRouter(tags=["known-words", "word-states"])


class SetWordStateRequest(BaseModel):
    state: str
    expression: str = ""
    reading: str = ""
    sequence_id: Optional[int] = None


class WordStateItemResponse(BaseModel):
    id: int
    sequence_id: Optional[int] = None
    reading: str
    expression: str
    state: str
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    anki_interval: Optional[int] = None
    anki_lapses: Optional[int] = None
    anki_status: Optional[str] = None
    updated_at: str


class WordStateListResponse(BaseModel):
    items: list[WordStateItemResponse]
    total: int


class WordStateStatsResponse(BaseModel):
    counts: dict[str, int] = Field(default_factory=dict)
    active_total: int = 0
    blacklisted_excluded: int = 0


class SyncAnkiWordStatesRequest(BaseModel):
    deck_name: Optional[str] = None
    query: Optional[str] = None
    note_ids: Optional[list[int]] = None
    known_min_interval: Optional[int] = Field(default=None, ge=1)
    max_lapses: Optional[int] = Field(default=None, ge=1)
    reconcile_deleted: Optional[bool] = None


class SyncAnkiWordStatesResponse(BaseModel):
    ok: bool = True
    connected: bool = True
    error: Optional[str] = None
    synced: int = 0
    known: int = 0
    learning: int = 0
    demoted: int = 0
    suspended: int = 0
    flagged: int = 0
    deleted: int = 0
    skipped_override: int = 0


class EncounterSummaryResponse(BaseModel):
    sequence_id: Optional[int] = None
    reading: str = ""
    expression: str = ""
    total_encounters: int = 0
    episode_count: int = 0
    distinct_sources: int = 0
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    recent_sentences: list[dict[str, Any]] = Field(default_factory=list)


def _reload_annotator_cache() -> None:
    try:
        get_subtitle_annotator_service().reload_mined_words()
    except Exception:
        pass


@router.get("/api/word-states", response_model=WordStateListResponse)
def list_word_states(
    state: Optional[str] = Query(default=None),
    include_blacklisted: bool = Query(default=True),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> WordStateListResponse:
    """List persisted word states with optional filters."""
    if state is not None and state not in VALID_WORD_STATES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid word state: {state!r}",
        )
    service = WordStateService()
    records = service.list_word_states(
        state=state,
        include_blacklisted=include_blacklisted,
        search=search,
        limit=limit,
        offset=offset,
    )
    items = [WordStateItemResponse(**asdict(rec)) for rec in records]
    return WordStateListResponse(items=items, total=len(items))


@router.get("/api/word-states/stats", response_model=WordStateStatsResponse)
def get_word_state_stats() -> WordStateStatsResponse:
    """Return word state counts (excluding blacklisted from active totals)."""
    service = WordStateService()
    return WordStateStatsResponse(**service.get_stats())


@router.post("/api/word-states/set", response_model=WordStateItemResponse)
def set_word_state(request: SetWordStateRequest) -> WordStateItemResponse:
    """Explicitly set a user word state (e.g. ignored, blacklisted, tracking, known)."""
    if request.state not in VALID_WORD_STATES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid word state: {request.state!r}",
        )
    try:
        record = WordStateService().set_user_word_state(
            state=request.state,
            expression=request.expression,
            reading=request.reading,
            sequence_id=request.sequence_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    _reload_annotator_cache()
    return WordStateItemResponse(**asdict(record))


@router.post("/api/word-states/sync-anki", response_model=SyncAnkiWordStatesResponse)
def sync_word_states_from_anki(
    request: Optional[SyncAnkiWordStatesRequest] = None,
) -> SyncAnkiWordStatesResponse:
    """Hydrate word states from live AnkiConnect FSRS/card review metrics."""
    req = request or SyncAnkiWordStatesRequest()
    service = WordStateService()
    try:
        summary = service.sync_from_anki(
            anki_service=AnkiConnectService(),
            deck_name=req.deck_name,
            query=req.query,
            note_ids=req.note_ids,
            known_min_interval=req.known_min_interval,
            max_lapses=req.max_lapses,
            reconcile_deleted=req.reconcile_deleted,
        )
    except AnkiError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    _reload_annotator_cache()
    return SyncAnkiWordStatesResponse(ok=bool(summary.get("connected", True)), **summary)


@router.get("/api/word-states/encounters", response_model=EncounterSummaryResponse)
def get_word_encounter_summary(
    sequence_id: Optional[int] = Query(default=None),
    reading: str = Query(default=""),
    expression: str = Query(default=""),
    recent_limit: int = Query(default=10, ge=1, le=50),
) -> EncounterSummaryResponse:
    """Return encounter counts, distinct source media count, and recent sentences."""
    if sequence_id is None and not expression.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide sequence_id or expression.",
        )
    summary = WordStateService().get_encounter_summary(
        sequence_id=sequence_id,
        reading=reading,
        expression=expression,
        recent_limit=recent_limit,
    )
    return EncounterSummaryResponse(**summary)
