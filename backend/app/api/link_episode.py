"""
FastAPI endpoints for Episode Primer & Recap (Slice 44).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.link.episode import (
    episode_service,
    get_episode_record,
    list_episode_records,
)
from app.schemas_link_episode import (
    EpisodeRecord,
    PrimerRequest,
    PrimerResponse,
    RecapRequest,
    RecapResponse,
)

router = APIRouter(prefix="/api/link", tags=["link-episode"])


@router.post("/primer", response_model=PrimerResponse, summary="Generate episode pre-watch primer")
def post_primer(request: PrimerRequest) -> PrimerResponse:
    """Generates pre-watch primer with top 20 gap words, top 5 grammar points, and 5 mini quiz questions."""
    res = episode_service.generate_primer(
        cues=request.cues,
        cue_hash=request.hash,
        learner_level=request.learner_level,
    )
    return PrimerResponse(**res)


@router.get("/primer/{cue_hash}", response_model=PrimerResponse, summary="Get pre-watch primer by cue hash")
def get_primer_by_hash(
    cue_hash: str,
    learner_level: Optional[str] = Query(None, description="Optional learner JLPT level"),
) -> PrimerResponse:
    """Retrieves or builds primer for a known cached cue list."""
    res = episode_service.generate_primer(
        cue_hash=cue_hash,
        learner_level=learner_level,
    )
    return PrimerResponse(**res)


@router.post("/recap", response_model=RecapResponse, summary="Generate and persist post-session episode recap")
def post_recap(request: RecapRequest) -> RecapResponse:
    """Calculates lines watched, % known before/after, unseen gap words, and persists episode record."""
    res = episode_service.generate_recap(
        cue_hash=request.hash,
        cues=request.cues,
        mined_words=request.mined_words,
        minutes=request.minutes,
        title=request.title,
        site=request.site,
        learner_level=request.learner_level,
    )
    return RecapResponse(**res)


@router.get("/episodes", response_model=List[EpisodeRecord], summary="List persisted episode records")
def get_episodes(limit: int = Query(50, ge=1, le=200)) -> List[EpisodeRecord]:
    """Returns list of persisted episode records."""
    records = list_episode_records(limit=limit)
    return [EpisodeRecord(**r) for r in records]


@router.get("/episodes/{cue_hash}", response_model=EpisodeRecord, summary="Get single persisted episode record")
def get_episode(cue_hash: str) -> EpisodeRecord:
    """Returns episode record by cue hash."""
    record = get_episode_record(cue_hash)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode record with hash '{cue_hash}' not found",
        )
    return EpisodeRecord(**record)
