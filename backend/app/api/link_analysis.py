"""
API endpoints for Kiroku Link live analysis pipeline (Slice 40).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.link.analysis import analysis_pipeline, install_link_hub_hook

# Auto-hook WebSocket hub when module is imported
install_link_hub_hook()

router = APIRouter(prefix="/api/link", tags=["link-analysis"])


@router.get(
    "/cues/{hash}",
    summary="Get annotated subtitle cues and vocabulary coverage by cue list hash",
    response_model=Dict[str, Any],
)
def get_link_cues(
    hash: str,
    from_idx: Optional[int] = Query(None, alias="from", description="Starting cue index (inclusive)"),
    to_idx: Optional[int] = Query(None, alias="to", description="Ending cue index (exclusive)"),
) -> Dict[str, Any]:
    """Return annotated tokens, per-cue known percentage, and gap words for a cue list hash."""
    res = analysis_pipeline.get_cues(hash, from_idx=from_idx, to_idx=to_idx)
    if res is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cue analysis for hash '{hash}' not found",
        )
    return res


@router.get(
    "/cue-grammar",
    summary="Get cached grammar points for a specific cue index",
    response_model=Dict[str, Any],
)
def get_cue_grammar(
    hash: str = Query(..., description="Cue list hash"),
    i: int = Query(..., description="Cue index"),
) -> Dict[str, Any]:
    """Return cached grammar analysis for cue `i` under `hash`."""
    res = analysis_pipeline.get_cue_grammar(hash, i)
    if res is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cue index {i} not found for hash '{hash}'",
        )
    return res
