"""
FastAPI endpoints for Link live analysis (Slice 40).
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Header, HTTPException, Query, status

logger = logging.getLogger(__name__)

from app.api.cloud import _resolve_user_id
from app.link.analysis import link_analysis_service

router = APIRouter(prefix="/api/link", tags=["link-analysis"])


def _resolve_link_user(authorization: Optional[str] = None) -> str:
    """Resolve and cryptographically verify user ID from Bearer token."""
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"
    if is_prod:
        return _resolve_user_id(authorization)
    if authorization and authorization.startswith("Bearer "):
        try:
            return _resolve_user_id(authorization)
        except Exception:
            if is_prod:
                raise
    return os.environ.get("KIROKU_DEV_AUTH_USER", "local_user")


@router.get("/cues/{cue_hash}", summary="Get annotated cues with known% and gap words list")
def get_cues(
    cue_hash: str,
    from_idx: Optional[int] = Query(None, alias="from", ge=0, description="Start cue index"),
    to_idx: Optional[int] = Query(None, alias="to", ge=0, description="End cue index"),
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Returns range of annotated cues with per-cue known% and gap words list."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT cues_json, title, series, site, media_type, duration_ms, mined_words_json FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, cue_hash]
                )
                if rows:
                    r = rows[0]
                    cues_data = json.loads(r.get("cues_json") or "[]")
                    mined_words = json.loads(r.get("mined_words_json") or "[]")
                    if cues_data:
                        from app.link.episode import episode_service
                        episode_service.sync_episode_subtitles(
                            cue_hash=cue_hash,
                            title=r.get("title") or "",
                            series=r.get("series") or "",
                            site=r.get("site") or "generic",
                            media_type=r.get("media_type") or "anime",
                            cues=cues_data,
                            duration_ms=r.get("duration_ms") or 0,
                            mined_words=mined_words,
                        )
                        cues = link_analysis_service.get_cues_range(cue_hash, from_idx, to_idx)
                        if cues is not None:
                            return {
                                "hash": cue_hash,
                                "cues": cues,
                                "count": len(cues),
                            }
        except Exception as e:
            logger.warning(f"Error checking cloud cues from Turso: {e}")

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cue list with hash '{cue_hash}' not found for user",
        )

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
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Returns cached grammar points for cue `i`."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT 1 FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, cue_hash]
                )
                if not rows:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Cue {i} for hash '{cue_hash}' not found",
                    )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Error verifying cue grammar owner: {e}")

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
