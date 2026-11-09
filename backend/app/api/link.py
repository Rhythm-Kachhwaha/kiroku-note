"""
Link HTTP Status and Session API endpoints.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.link.session import list_session_stats, save_session_stat
from app.services.condensed_audio import build_ffmpeg_concat_filter

router = APIRouter(prefix="/api/link", tags=["link"])


class SessionStatCreate(BaseModel):
    session_id: str = ""
    site: str = ""
    title: str = ""
    watch_seconds: float = 0.0
    lines_seen: int = 0
    words_mined: int = 0
    gap_words_seen: int = 0
    series: Optional[str] = None
    episode_key: Optional[str] = None


@router.get("/status")
def get_link_status() -> Dict[str, Any]:
    """Returns link status. Live WebSocket removed in v2.1; HTTP-only."""
    return {
        "status": "ok",
        "connected": False,
        "connected_ext": 0,
        "desk_clients": 0,
        "sessions": []
    }


@router.get("/sessions")
def get_sessions(limit: int = Query(50, ge=1, le=500)) -> List[Dict[str, Any]]:
    """Returns persisted link session statistics."""
    return list_session_stats(limit=limit)


@router.post("/sessions")
def create_session_stat(stat: SessionStatCreate) -> Dict[str, Any]:
    """Records a completed or updated link session stat."""
    return save_session_stat(
        session_id=stat.session_id,
        site=stat.site,
        title=stat.title,
        watch_seconds=stat.watch_seconds,
        lines_seen=stat.lines_seen,
        words_mined=stat.words_mined,
        gap_words_seen=stat.gap_words_seen,
        series=stat.series,
        episode_key=stat.episode_key,
    )


class CondensedAudioRequest(BaseModel):
    cues: List[Dict[str, Any]] = Field(default_factory=list)
    source_audio_path: str = ""
    padding: float = 0.15


@router.post("/export-condensed-audio")
async def export_condensed_audio(req: CondensedAudioRequest):
    filter_chain = build_ffmpeg_concat_filter(req.cues, padding=req.padding)
    return {
        "ok": True,
        "filter": filter_chain,
        "cue_count": len(req.cues),
        "status": "ready"
    }
