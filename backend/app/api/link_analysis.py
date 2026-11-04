"""
FastAPI endpoints for Link live analysis (Slice 40).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status

from app.link.analysis import link_analysis_service

router = APIRouter(prefix="/api/link", tags=["link-analysis"])


@router.get("/cues/{cue_hash}", summary="Get annotated cues with known% and gap words list")
def get_cues(
    cue_hash: str,
    from_idx: Optional[int] = Query(None, alias="from", ge=0, description="Start cue index"),
    to_idx: Optional[int] = Query(None, alias="to", ge=0, description="End cue index"),
) -> Dict[str, Any]:
    """Returns range of annotated cues with per-cue known% and gap words list."""
    cues = link_analysis_service.get_cues_range(cue_hash, from_idx, to_idx)
    if cues is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cue list with hash '{cue_hash}' not found or not yet processed",
        )
    return {
        "hash": cue_hash,
        "cues": cues,
        "count": len(cues),
    }


@router.get("/cue-grammar", summary="Get cached grammar points per cue")
def get_cue_grammar(
    cue_hash: str = Query(..., alias="hash", description="Subtitle cue list hash"),
    i: int = Query(..., alias="i", ge=0, description="Cue index"),
) -> Dict[str, Any]:
    """Returns cached grammar points for cue `i`."""
    points = link_analysis_service.get_cue_grammar(cue_hash, i)
    if points is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cue {i} for hash '{cue_hash}' not found",
        )
    return {
        "hash": cue_hash,
        "i": i,
        "points": points,
    }
