"""
Link HTTP Status and Session API endpoints.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging
import time

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

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


class JimakuKeyPayload(BaseModel):
    api_key: str = ""


@router.get("/jimaku-key")
def get_jimaku_key(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Retrieve the Jimaku.cc API key saved in local DPAPI secret store or cloud user secrets."""
    key = ""
    try:
        from app.services.secret_store import get_secret_store
        store = get_secret_store()
        key = store.get_secret("jimaku_api_key") or ""
    except Exception:
        pass

    if not key:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                from app.api.cloud import _resolve_user_id
                user_id = _resolve_user_id(authorization)
                row = turso.fetchone(
                    "SELECT secret_value FROM user_secrets WHERE user_id = ? AND secret_key = 'jimaku_api_key'",
                    [user_id]
                )
                if row and row.get("secret_value"):
                    key = row["secret_value"]
        except Exception as e:
            logger.debug(f"[JimakuKey] Cloud fallback notice: {e}")

    return {"has_key": bool(key), "api_key": key}


@router.post("/jimaku-key")
def set_jimaku_key(req: JimakuKeyPayload, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Persist or clear the Jimaku.cc API key in local secret store and cloud Turso database."""
    val = (req.api_key or "").strip()
    try:
        from app.services.secret_store import get_secret_store
        store = get_secret_store()
        if val:
            store.set_secret("jimaku_api_key", val)
        else:
            store.delete_secret("jimaku_api_key")
    except Exception:
        pass

    try:
        from app.db.turso_client import get_turso_client
        turso = get_turso_client()
        if turso.is_configured:
            from app.api.cloud import _resolve_user_id
            user_id = _resolve_user_id(authorization)
            turso.execute(
                """CREATE TABLE IF NOT EXISTS user_secrets (
                    user_id TEXT NOT NULL,
                    secret_key TEXT NOT NULL,
                    secret_value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, secret_key)
                )"""
            )
            now_sec = int(time.time())
            if val:
                turso.execute(
                    "INSERT OR REPLACE INTO user_secrets (user_id, secret_key, secret_value, updated_at) VALUES (?, 'jimaku_api_key', ?, ?)",
                    [user_id, val, now_sec]
                )
            else:
                turso.execute(
                    "DELETE FROM user_secrets WHERE user_id = ? AND secret_key = 'jimaku_api_key'",
                    [user_id]
                )
    except Exception as e:
        logger.warning(f"[JimakuKey] Failed to sync secret to Turso: {e}")

    return {"ok": True, "has_key": bool(val), "api_key": val}

