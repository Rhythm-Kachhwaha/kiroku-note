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


def _resolve_link_user(authorization: Optional[str] = None) -> str:
    """Resolve and cryptographically verify user ID from Bearer token."""
    from app.api.cloud import _resolve_user_id
    import os
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


@router.get("/status")
def get_link_status() -> Dict[str, Any]:
    """Returns link status. HTTP-only episode persistence and analysis."""
    return {
        "status": "ok",
        "mode": "persisted-http",
        "connected": True,
    }


@router.get("/sessions")
def get_sessions(
    limit: int = Query(50, ge=1, le=500),
    authorization: Optional[str] = Header(None)
) -> List[Dict[str, Any]]:
    """Returns persisted link session statistics."""
    user_id = _resolve_link_user(authorization)
    import os
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    """
                    SELECT session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, series, episode_key, created_at
                    FROM user_anime_sessions
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    [user_id, limit]
                )
                return [
                    {
                        "session_id": r.get("session_id"),
                        "site": r.get("site"),
                        "title": r.get("title"),
                        "watch_seconds": r.get("watch_seconds", 0.0),
                        "lines_seen": r.get("lines_seen", 0),
                        "words_mined": r.get("words_mined", 0),
                        "gap_words_seen": r.get("gap_words_seen", 0),
                        "series": r.get("series"),
                        "episode_key": r.get("episode_key"),
                        "created_at": r.get("created_at")
                    }
                    for r in rows
                ]
        except Exception as e:
            logger.warning(f"Error reading sessions from Turso: {e}")
            if is_prod:
                from fastapi import HTTPException, status
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch sessions from cloud")
        return []

    return list_session_stats(limit=limit)


@router.post("/sessions")
def create_session_stat(
    stat: SessionStatCreate,
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Records a completed or updated link session stat."""
    user_id = _resolve_link_user(authorization)
    import os
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    cloud_persisted = False
    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                turso.execute(
                    """
                    CREATE TABLE IF NOT EXISTS user_anime_sessions (
                        user_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        site TEXT,
                        title TEXT,
                        watch_seconds REAL DEFAULT 0,
                        lines_seen INTEGER DEFAULT 0,
                        words_mined INTEGER DEFAULT 0,
                        gap_words_seen INTEGER DEFAULT 0,
                        series TEXT,
                        episode_key TEXT,
                        created_at INTEGER,
                        PRIMARY KEY (user_id, session_id)
                    )
                    """
                )
                now_ts = int(time.time() * 1000)
                turso.execute(
                    """
                    INSERT INTO user_anime_sessions (
                        user_id, session_id, site, title, watch_seconds, lines_seen, words_mined, gap_words_seen, series, episode_key, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, session_id) DO UPDATE SET
                        watch_seconds = MAX(user_anime_sessions.watch_seconds, excluded.watch_seconds),
                        lines_seen = MAX(user_anime_sessions.lines_seen, excluded.lines_seen),
                        words_mined = MAX(user_anime_sessions.words_mined, excluded.words_mined),
                        gap_words_seen = MAX(user_anime_sessions.gap_words_seen, excluded.gap_words_seen),
                        created_at = excluded.created_at
                    """,
                    [
                        user_id, stat.session_id, stat.site, stat.title, stat.watch_seconds,
                        stat.lines_seen, stat.words_mined, stat.gap_words_seen,
                        stat.series or "", stat.episode_key or "", now_ts
                    ]
                )
                cloud_persisted = True
            elif is_prod:
                from fastapi import HTTPException, status
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cloud database not configured in production")
        except Exception as e:
            logger.warning(f"Error persisting session to Turso: {e}")
            if is_prod:
                from fastapi import HTTPException, status
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to persist session to cloud: {e}")

    if user_id == "local_user" and not is_prod:
        res = save_session_stat(
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
        res["cloud_synced"] = cloud_persisted
        return res

    return {
        "session_id": stat.session_id,
        "site": stat.site,
        "title": stat.title,
        "watch_seconds": stat.watch_seconds,
        "lines_seen": stat.lines_seen,
        "words_mined": stat.words_mined,
        "gap_words_seen": stat.gap_words_seen,
        "series": stat.series,
        "episode_key": stat.episode_key,
        "cloud_synced": cloud_persisted,
    }


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

