"""
FastAPI endpoints for Episode Primer & Recap (Slice 44).
"""
from __future__ import annotations

from collections import Counter
import hashlib
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import socket
import time
from typing import Any, Dict, List, Optional
import urllib.error
import urllib.parse
import urllib.request
from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

from app.api.cloud import _is_test_fixture_series, _resolve_user_id


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


def _ensure_turso_tables(turso) -> None:
    turso.execute(
        """
        CREATE TABLE IF NOT EXISTS user_anime_progress (
            user_id TEXT NOT NULL,
            series_id TEXT NOT NULL,
            episode_number INTEGER NOT NULL,
            last_position_ms INTEGER DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            mined_card_count INTEGER DEFAULT 0,
            last_watched_at INTEGER DEFAULT 0,
            poster_url TEXT DEFAULT '',
            series_title TEXT DEFAULT '',
            title_native TEXT DEFAULT '',
            title_english TEXT DEFAULT '',
            synopsis TEXT DEFAULT '',
            media_type TEXT DEFAULT 'anime',
            cue_hash TEXT DEFAULT '',
            PRIMARY KEY (user_id, series_id, episode_number)
        )
        """
    )
    try:
        turso.execute("ALTER TABLE user_anime_progress ADD COLUMN cue_hash TEXT DEFAULT ''")
    except Exception:
        pass

    turso.execute(
        """
        CREATE TABLE IF NOT EXISTS user_episode_cues (
            user_id TEXT NOT NULL,
            cue_hash TEXT NOT NULL,
            title TEXT,
            series TEXT,
            episode_number INTEGER DEFAULT 1,
            episode_key TEXT DEFAULT '',
            site TEXT,
            media_type TEXT,
            cues_json TEXT,
            duration_ms INTEGER DEFAULT 0,
            mined_words_json TEXT,
            known_pct REAL DEFAULT 0.0,
            total_lines INTEGER DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY (user_id, cue_hash)
        )
        """
    )
    for col, definition in [
        ("episode_number", "INTEGER DEFAULT 1"),
        ("episode_key", "TEXT DEFAULT ''"),
        ("known_pct", "REAL DEFAULT 0.0"),
        ("total_lines", "INTEGER DEFAULT 0"),
    ]:
        try:
            turso.execute(f"ALTER TABLE user_episode_cues ADD COLUMN {col} {definition}")
        except Exception:
            pass


from app.link.episode import (
    delete_episode_record,
    delete_series_records,
    episode_service,
    get_episode_record,
    group_episodes_by_series,
    list_episode_records,
    save_episode_position,
    update_series_category,
)
from app.schemas_link_episode import (
    EpisodeInspectorResponse,
    EpisodeRecord,
    EpisodeSyncRequest,
    PrimerRequest,
    PrimerResponse,
    RecapRequest,
    RecapResponse,
    SeriesGroup,
    UpdatePositionRequest,
    UpdateSeriesCategoryRequest,
)

router = APIRouter(prefix="/api/link", tags=["link-episode"])


@router.post("/primer", response_model=PrimerResponse, summary="Generate episode pre-watch primer")
def post_primer(
    request: PrimerRequest,
    authorization: Optional[str] = Header(None)
) -> PrimerResponse:
    """Generates pre-watch primer with top 20 gap words, top 5 grammar points, and 5 mini quiz questions."""
    user_id = _resolve_link_user(authorization)
    cues_to_use = request.cues
    if not cues_to_use and request.hash:
        is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"
        if user_id != "local_user" or is_prod:
            try:
                from app.db.turso_client import get_turso_client
                turso = get_turso_client()
                if turso.is_configured:
                    rows = turso.execute(
                        "SELECT cues_json FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                        [user_id, request.hash]
                    )
                    if rows and rows[0].get("cues_json"):
                        cues_to_use = json.loads(rows[0]["cues_json"])
            except Exception as e:
                logger.warning(f"Error reading cues for primer: {e}")
            if not cues_to_use:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cues not found for primer generation")

    res = episode_service.generate_primer(
        cues=cues_to_use,
        cue_hash=request.hash,
        learner_level=request.learner_level,
    )
    return PrimerResponse(**res)


@router.get("/primer/{cue_hash}", response_model=PrimerResponse, summary="Get pre-watch primer by cue hash")
def get_primer_by_hash(
    cue_hash: str,
    learner_level: Optional[str] = Query(None, description="Optional learner JLPT level"),
    authorization: Optional[str] = Header(None)
) -> PrimerResponse:
    """Retrieves or builds primer for a known cached cue list."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT cues_json FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, cue_hash]
                )
                if rows and rows[0].get("cues_json"):
                    cues = json.loads(rows[0]["cues_json"])
                    res = episode_service.generate_primer(cues=cues, cue_hash=cue_hash, learner_level=learner_level)
                    return PrimerResponse(**res)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Error fetching cloud cues for primer: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Cue list with hash '{cue_hash}' not found")

    res = episode_service.generate_primer(
        cue_hash=cue_hash,
        learner_level=learner_level,
    )
    return PrimerResponse(**res)


@router.post("/recap", response_model=RecapResponse, summary="Generate and persist post-session episode recap")
def post_recap(
    request: RecapRequest,
    authorization: Optional[str] = Header(None)
) -> RecapResponse:
    """Calculates lines watched, % known before/after, unseen gap words, and persists episode record."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    cues_to_use = request.cues
    if not cues_to_use and request.hash and (user_id != "local_user" or is_prod):
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT cues_json FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, request.hash]
                )
                if rows and rows[0].get("cues_json"):
                    cues_to_use = json.loads(rows[0]["cues_json"])
        except Exception as e:
            logger.warning(f"Error reading cues for recap: {e}")

    res = episode_service.generate_recap(
        cue_hash=request.hash,
        cues=cues_to_use,
        mined_words=request.mined_words,
        minutes=request.minutes,
        title=request.title,
        site=request.site,
        learner_level=request.learner_level,
        last_position_ms=request.last_position_ms or 0,
    )
    if user_id != "local_user" or is_prod:
        try:
            from app.api.cloud import save_user_anime_progress, AnimeProgressRecord
            s_name = res.get("title", "")
            ep_match = re.search(r'(?:ep|episode|#)\s*(\d+)', f"{request.title} {request.hash}", re.IGNORECASE)
            ep_num = int(ep_match.group(1)) if ep_match else 1
            save_user_anime_progress(
                AnimeProgressRecord(
                    series_id=s_name or "Anime",
                    episode_number=ep_num,
                    last_position_ms=request.last_position_ms or 0,
                    duration_ms=int((request.minutes or 0) * 60000),
                    mined_card_count=len(request.mined_words or []),
                    series_title=s_name or "Anime",
                    cue_hash=request.hash,
                    last_watched_at=int(time.time() * 1000)
                ),
                authorization=authorization
            )
        except Exception as e:
            logger.warning(f"Error persisting recap to Turso: {e}")

    return RecapResponse(**res)


@router.post("/episodes/{cue_hash}/position", response_model=EpisodeRecord, summary="Update episode playback position")
def post_episode_position(
    cue_hash: str,
    request: UpdatePositionRequest,
    authorization: Optional[str] = Header(None)
) -> EpisodeRecord:
    """Saves throttled playback position (in ms) for an episode."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    cloud_persisted = False
    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                _ensure_turso_tables(turso)
                from app.api.cloud import save_user_anime_progress, AnimeProgressRecord
                s_name = request.series or request.title or "Anime"
                now_ts = int(time.time() * 1000)
                ep_num = 1
                ep_match = re.search(r'(?:ep|episode|#)\s*(\d+)', f"{request.title} {cue_hash}", re.IGNORECASE)
                if ep_match:
                    ep_num = int(ep_match.group(1))
                save_user_anime_progress(
                    AnimeProgressRecord(
                        series_id=s_name,
                        episode_number=ep_num,
                        last_position_ms=request.last_position_ms,
                        duration_ms=request.duration_ms or 0,
                        completed=1 if request.completed else 0,
                        series_title=s_name,
                        media_type=request.media_type or "anime",
                        cue_hash=cue_hash,
                        last_watched_at=now_ts
                    ),
                    authorization=authorization
                )
                cloud_persisted = True
            elif is_prod:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cloud database not configured in production")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Failed to persist episode position to Turso: {e}")
            if is_prod:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to persist position to cloud: {e}")

    rec: Dict[str, Any] = {}
    if user_id == "local_user" and not is_prod:
        rec = save_episode_position(
            hash_val=cue_hash,
            last_position_ms=request.last_position_ms,
            title=request.title,
            site=request.site,
            series=request.series,
            episode_key=request.episode_key,
            allow_rewind=request.allow_rewind,
            duration_ms=request.duration_ms,
            completed=request.completed,
        )
    else:
        rec = {
            "hash": cue_hash,
            "title": request.title,
            "site": request.site or "generic",
            "series": request.series or "",
            "episode_key": request.episode_key,
            "media_type": request.media_type or "anime",
            "last_position_ms": request.last_position_ms,
            "duration_ms": request.duration_ms or 0,
            "completed": request.completed,
            "has_cues": True,
            "cloud_synced": cloud_persisted,
        }

    rec["cloud_synced"] = cloud_persisted
    return EpisodeRecord(**rec)


@router.get("/series", response_model=List[SeriesGroup], summary="Get watch history grouped by series")
def get_series(
    media_type: Optional[str] = Query(None, description="Optional media_type filter: anime, youtube, tv"),
    authorization: Optional[str] = Header(None)
) -> List[SeriesGroup]:
    """Returns watch history grouped by series with known% per episode and media metadata."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"
    groups = []

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                _ensure_turso_tables(turso)
                rows = turso.execute(
                    """
                    SELECT 
                        p.series_id, p.episode_number, p.last_position_ms, p.duration_ms,
                        p.completed, p.mined_card_count, p.last_watched_at, p.poster_url,
                        p.series_title, p.title_native, p.title_english, p.synopsis, p.media_type,
                        COALESCE(NULLIF(p.cue_hash, ''), c.cue_hash, '') AS cue_hash,
                        CASE WHEN c.cue_hash IS NOT NULL THEN 1 ELSE 0 END AS has_cues,
                        COALESCE(c.known_pct, 0.0) AS known_pct,
                        COALESCE(c.title, '') AS cue_title
                    FROM user_anime_progress p
                    LEFT JOIN user_episode_cues c
                        ON c.user_id = p.user_id 
                        AND (
                            (p.cue_hash != '' AND c.cue_hash = p.cue_hash)
                            OR (c.series = p.series_id AND c.episode_number = p.episode_number)
                        )
                    WHERE p.user_id = ?
                    ORDER BY p.last_watched_at DESC
                    """,
                    [user_id]
                )
                series_map: Dict[str, Dict[str, Any]] = {}
                seen_cues = set()

                for r in rows:
                    if _is_test_fixture_series(r.get("series_id")) or _is_test_fixture_series(r.get("series_title")):
                        continue
                    s_name = r.get("series_title") or r.get("series_id") or "Anime"
                    if s_name not in series_map:
                        series_map[s_name] = {
                            "series": s_name,
                            "title_english": r.get("title_english") or s_name,
                            "title_native": r.get("title_native") or "",
                            "media_type": r.get("media_type") or "anime",
                            "poster_url": r.get("poster_url") or "",
                            "synopsis": r.get("synopsis") or "",
                            "episodes": [],
                        }
                    ep_num = r.get("episode_number", 1)
                    actual_hash = r.get("cue_hash") or f"{r.get('series_id')}_ep{ep_num}"
                    if actual_hash:
                        seen_cues.add(actual_hash)
                    series_map[s_name]["episodes"].append({
                        "hash": actual_hash,
                        "title": r.get("cue_title") or f"Episode {ep_num}",
                        "site": "generic",
                        "known_pct": float(r.get("known_pct") or 0.0),
                        "last_position_ms": r.get("last_position_ms", 0),
                        "duration_ms": r.get("duration_ms", 0),
                        "mined": r.get("mined_card_count", 0),
                        "minutes": round((r.get("duration_ms", 0) or 0) / 60000.0, 1),
                        "ts": str(r.get("last_watched_at") or ""),
                        "completed": bool(r.get("completed", 0)),
                        "last_watched_at": r.get("last_watched_at"),
                        "has_cues": bool(r.get("has_cues") or r.get("cue_hash")),
                        "episode_number": ep_num,
                    })

                # Also surface any user cues that haven't been recorded in progress yet
                unlinked_cues = turso.execute(
                    """
                    SELECT cue_hash, title, series, episode_number, site, media_type, duration_ms, known_pct, updated_at
                    FROM user_episode_cues
                    WHERE user_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [user_id]
                )
                for c in unlinked_cues:
                    c_hash = c.get("cue_hash")
                    if not c_hash or c_hash in seen_cues:
                        continue
                    s_name = c.get("series") or "Anime"
                    if _is_test_fixture_series(s_name):
                        continue
                    if s_name not in series_map:
                        series_map[s_name] = {
                            "series": s_name,
                            "title_english": s_name,
                            "title_native": "",
                            "media_type": c.get("media_type") or "anime",
                            "poster_url": "",
                            "synopsis": "",
                            "episodes": [],
                        }
                    ep_num = c.get("episode_number", 1)
                    series_map[s_name]["episodes"].append({
                        "hash": c_hash,
                        "title": c.get("title") or f"Episode {ep_num}",
                        "site": c.get("site") or "generic",
                        "known_pct": float(c.get("known_pct") or 0.0),
                        "last_position_ms": 0,
                        "duration_ms": c.get("duration_ms", 0),
                        "mined": 0,
                        "minutes": round((c.get("duration_ms", 0) or 0) / 60000.0, 1),
                        "ts": str(c.get("updated_at") or ""),
                        "completed": False,
                        "last_watched_at": c.get("updated_at"),
                        "has_cues": True,
                        "episode_number": ep_num,
                    })
                    seen_cues.add(c_hash)

                groups = list(series_map.values())
        except Exception as e:
            logger.warning(f"Failed to fetch cloud series from Turso: {e}")
            if is_prod:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch series from cloud")

        # In production or authenticated multi-user mode, return user's records strictly (no shared fallback)
        return [
            SeriesGroup(
                series=g["series"],
                title_english=g.get("title_english"),
                title_romaji=g.get("title_romaji"),
                title_native=g.get("title_native"),
                media_type=g.get("media_type", "anime"),
                poster_url=g.get("poster_url", ""),
                synopsis=g.get("synopsis", ""),
                total_episodes=g.get("total_episodes"),
                episodes=[EpisodeRecord(**ep) for ep in g["episodes"]]
            )
            for g in groups
            if not _is_test_fixture_series(g.get("series"))
        ]

    # Offline local desktop mode fallback strictly for local_user in non-production
    groups = [g for g in group_episodes_by_series(media_type=media_type) if not _is_test_fixture_series(g.get("series"))]
    return [
        SeriesGroup(
            series=g["series"],
            title_english=g.get("title_english"),
            title_romaji=g.get("title_romaji"),
            title_native=g.get("title_native"),
            media_type=g.get("media_type", "anime"),
            poster_url=g.get("poster_url", ""),
            synopsis=g.get("synopsis", ""),
            total_episodes=g.get("total_episodes"),
            episodes=[EpisodeRecord(**ep) for ep in g["episodes"]]
        )
        for g in groups
        if not _is_test_fixture_series(g.get("series"))
    ]


@router.delete("/episodes/{episode_hash}", summary="Delete an episode record from watch history")
def delete_episode(
    episode_hash: str,
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Delete an episode record and its cues from the watch history library."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    deleted = False
    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                turso.execute(
                    "DELETE FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, episode_hash]
                )
                turso.execute(
                    "DELETE FROM user_anime_progress WHERE user_id = ? AND cue_hash = ?",
                    [user_id, episode_hash]
                )
                deleted = True
        except Exception as e:
            logger.warning(f"Error deleting cloud cues: {e}")
            if is_prod:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete cloud episode")
        return {"hash": episode_hash, "deleted": deleted}

    success = delete_episode_record(episode_hash)
    return {"hash": episode_hash, "deleted": success}


@router.delete("/series/{series_name}", summary="Delete an entire series and all its episodes")
def delete_series(
    series_name: str,
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Delete all episode records and cues belonging to a series."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        count = 0
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                turso.execute(
                    "DELETE FROM user_anime_progress WHERE user_id = ? AND (series_id = ? OR series_title = ?)",
                    [user_id, series_name, series_name]
                )
                turso.execute(
                    "DELETE FROM user_episode_cues WHERE user_id = ? AND series = ?",
                    [user_id, series_name]
                )
                count = 1
        except Exception as e:
            logger.warning(f"Error deleting cloud series progress: {e}")
            if is_prod:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete cloud series")
        return {"series": series_name, "deleted_episodes": count}

    count = delete_series_records(series_name)
    return {"series": series_name, "deleted_episodes": count}


@router.put("/series/{series_name}/category", summary="Override series category")
def put_series_category(
    series_name: str,
    request: UpdateSeriesCategoryRequest,
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """Update media_type classification for a series."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                turso.execute(
                    "UPDATE user_anime_progress SET media_type = ? WHERE user_id = ? AND (series_id = ? OR series_title = ?)",
                    [request.media_type, user_id, series_name, series_name]
                )
                turso.execute(
                    "UPDATE user_episode_cues SET media_type = ? WHERE user_id = ? AND series = ?",
                    [request.media_type, user_id, series_name]
                )
        except Exception as e:
            logger.warning(f"Error updating cloud category: {e}")
        return {"series": series_name, "media_type": request.media_type, "updated": True}

    success = update_series_category(series_name=series_name, media_type=request.media_type)
    return {"series": series_name, "media_type": request.media_type, "updated": success}


@router.get("/series/{series_name}/cards", summary="Get cards mined from a series")
def get_series_cards(
    series_name: str,
    authorization: Optional[str] = Header(None)
) -> List[Dict[str, Any]]:
    """Return vocabulary cards associated with this series by tag or source matching."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"
    matched = []
    s_norm = series_name.strip().lower()
    s_slug = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', series_name).strip().lower()

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT payload FROM user_op_log WHERE user_id = ? AND op_type = 'card_save' ORDER BY rowid DESC",
                    [user_id]
                )
                for r in rows:
                    payload_str = r.get("payload")
                    if not payload_str:
                        continue
                    try:
                        card = json.loads(payload_str)
                        c_url = (card.get("source_url") or "").lower()
                        c_src = (card.get("source_text") or "").lower()
                        c_tags = (card.get("deck_name") or "").lower()
                        clean_u = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', c_url)
                        if s_norm in c_url or s_norm in c_src or s_norm in c_tags or (s_slug and s_slug in clean_u):
                            matched.append({
                                "id": card.get("id"),
                                "expression": card.get("expression", ""),
                                "reading": card.get("reading", ""),
                                "meaning": card.get("meaning", ""),
                                "deck_name": card.get("deck_name", "Default"),
                                "source_url": card.get("source_url", ""),
                                "created_at": card.get("created_at", ""),
                                "sync_status": card.get("sync_status", "synced")
                            })
                    except Exception:
                        continue
        except Exception as e:
            logger.warning(f"Failed to fetch cloud series cards from Turso: {e}")
        return matched

    from app.repositories.card_repository import CardRepository
    cards = CardRepository().list_cards(limit=1000)
    for c in cards:
        tags = (c.tags or "").lower()
        source_url = (c.source_url or "").lower()
        notes = (c.notes or "").lower()
        clean_url = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', source_url)
        clean_tags = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', tags)
        clean_notes = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', notes)
        if (
            s_norm in tags
            or s_norm in source_url
            or s_norm in notes
            or (s_slug and (s_slug in clean_url or s_slug in clean_tags or s_slug in clean_notes))
        ):
            matched.append({
                "id": c.id,
                "expression": c.expression,
                "reading": c.reading,
                "meaning": c.meaning,
                "image": c.image,
                "audio": c.audio,
                "example_sentence": c.example_sentence,
                "source_text": c.source_text,
                "tags": c.tags,
            })
    return matched


@router.post("/episodes/sync", response_model=EpisodeRecord, summary="Sync episode subtitles and metrics from extension")
def post_episode_sync(
    request: EpisodeSyncRequest,
    authorization: Optional[str] = Header(None)
) -> EpisodeRecord:
    """Zero-latency background sync of subtitle cues and watch metrics from extension."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    # Enforce backend subtitle resource limits
    MAX_CUES = 5000
    MAX_CUE_CHARS = 2000
    cleaned_cues = []
    for c in (request.cues or [])[:MAX_CUES]:
        txt = str(c.get("text") or "")[:MAX_CUE_CHARS]
        cue_obj = {
            "i": c.get("i", len(cleaned_cues)),
            "s": float(c.get("s", 0.0)),
            "e": float(c.get("e", 0.0)),
            "text": txt
        }
        if "image" in c:
            cue_obj["image"] = c["image"]
        if "tokens" in c:
            cue_obj["tokens"] = c["tokens"]
        cleaned_cues.append(cue_obj)

    # Calculate known_pct and total_lines
    known_pct = 0.0
    total_lines = len(cleaned_cues)
    if cleaned_cues:
        try:
            comp = episode_service.calculate_comprehension(cleaned_cues, learner_level="N4")
            known_pct = float(comp.get("known_pct", 0.0))
        except Exception:
            known_pct = 0.0

    cloud_persisted = False
    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                _ensure_turso_tables(turso)
                cues_payload = json.dumps(cleaned_cues)
                mined_payload = json.dumps(request.mined_words or [])
                now_ts = int(time.time() * 1000)
                ep_num = request.episode_number or 1
                if ep_num == 1:
                    ep_match = re.search(r'(?:ep|episode|#)\s*(\d+)', f"{request.title} {request.hash}", re.IGNORECASE)
                    if ep_match:
                        ep_num = int(ep_match.group(1))

                turso.execute(
                    """
                    INSERT INTO user_episode_cues (
                        user_id, cue_hash, title, series, episode_number, episode_key, site, media_type, cues_json, duration_ms, mined_words_json, known_pct, total_lines, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, cue_hash) DO UPDATE SET
                        cues_json = excluded.cues_json,
                        title = excluded.title,
                        series = excluded.series,
                        episode_number = excluded.episode_number,
                        episode_key = excluded.episode_key,
                        duration_ms = MAX(user_episode_cues.duration_ms, excluded.duration_ms),
                        mined_words_json = CASE WHEN excluded.mined_words_json != '[]' THEN excluded.mined_words_json ELSE user_episode_cues.mined_words_json END,
                        known_pct = excluded.known_pct,
                        total_lines = excluded.total_lines,
                        updated_at = excluded.updated_at
                    """,
                    [
                        user_id, request.hash, request.title or "", request.series or "", ep_num, request.episode_key or "",
                        request.site or "generic", request.media_type or "anime", cues_payload, request.duration_ms or 0,
                        mined_payload, known_pct, total_lines, now_ts
                    ]
                )

                s_name = request.series or request.title or "Anime"
                from app.api.cloud import save_user_anime_progress, AnimeProgressRecord
                save_user_anime_progress(
                    AnimeProgressRecord(
                        series_id=s_name,
                        episode_number=ep_num,
                        duration_ms=request.duration_ms or 0,
                        mined_card_count=len(request.mined_words or []),
                        series_title=s_name,
                        media_type=request.media_type or "anime",
                        cue_hash=request.hash,
                        last_watched_at=now_ts
                    ),
                    authorization=authorization
                )
                cloud_persisted = True
            elif is_prod:
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cloud database not configured in production")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Failed to persist episode cues to Turso: {e}")
            if is_prod:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to persist episode to cloud: {e}")

    rec: Dict[str, Any] = {}
    if user_id == "local_user" and not is_prod:
        rec = episode_service.sync_episode_subtitles(
            cue_hash=request.hash,
            title=request.title,
            series=request.series,
            site=request.site,
            media_type=request.media_type,
            cues=cleaned_cues,
            duration_ms=request.duration_ms,
            mined_words=request.mined_words,
        )
    else:
        rec = {
            "hash": request.hash,
            "title": request.title,
            "series": request.series or "",
            "site": request.site or "generic",
            "media_type": request.media_type or "anime",
            "known_pct": known_pct,
            "mined": len(request.mined_words or []),
            "minutes": round((request.duration_ms or 0) / 60000.0, 1),
            "duration_ms": request.duration_ms or 0,
            "has_cues": True,
            "episode_number": request.episode_number or 1,
            "cloud_synced": cloud_persisted,
        }

    rec["cloud_synced"] = cloud_persisted
    return EpisodeRecord(**rec)


@router.get("/episodes/{cue_hash}/inspect", response_model=EpisodeInspectorResponse, summary="Inspect episode difficulty, gap words, and grammar")
def get_episode_inspect(
    cue_hash: str,
    learner_level: Optional[str] = Query(None, description="Optional learner JLPT level"),
    authorization: Optional[str] = Header(None)
) -> EpisodeInspectorResponse:
    """Returns rich episode analytics including JLPT difficulty breakdown, missed words, and grammar occurrences."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT cues_json, title, series, site, media_type, duration_ms, mined_words_json, episode_number FROM user_episode_cues WHERE user_id = ? AND cue_hash = ?",
                    [user_id, cue_hash]
                )
                if rows:
                    r = rows[0]
                    cues_data = json.loads(r.get("cues_json") or "[]")
                    mined_words = json.loads(r.get("mined_words_json") or "[]")
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
                    res = episode_service.inspect_episode(cue_hash=cue_hash, learner_level=learner_level)
                    return EpisodeInspectorResponse(**res)
        except Exception as e:
            logger.warning(f"Error checking cloud episode inspection: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Episode with hash '{cue_hash}' not found")

    res = episode_service.inspect_episode(cue_hash=cue_hash, learner_level=learner_level)
    return EpisodeInspectorResponse(**res)


@router.get("/episodes", response_model=List[EpisodeRecord], summary="List persisted episode records")
def get_episodes(
    limit: int = Query(50, ge=1, le=200),
    authorization: Optional[str] = Header(None)
) -> List[EpisodeRecord]:
    """Returns list of persisted episode records."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    """
                    SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, duration_ms, known_pct, updated_at
                    FROM user_episode_cues
                    WHERE user_id = ?
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    [user_id, limit]
                )
                return [
                    EpisodeRecord(
                        hash=r["cue_hash"],
                        title=r.get("title") or "",
                        series=r.get("series") or "",
                        episode_number=r.get("episode_number", 1),
                        episode_key=r.get("episode_key"),
                        site=r.get("site") or "generic",
                        media_type=r.get("media_type") or "anime",
                        duration_ms=r.get("duration_ms", 0),
                        known_pct=float(r.get("known_pct") or 0.0),
                        has_cues=True,
                        ts=str(r.get("updated_at") or ""),
                        minutes=round((r.get("duration_ms", 0) or 0) / 60000.0, 1)
                    )
                    for r in rows
                ]
        except Exception as e:
            logger.warning(f"Error reading episodes from Turso: {e}")
        return []

    records = list_episode_records(limit=limit)
    return [EpisodeRecord(**r) for r in records]


@router.get("/episodes/{cue_hash}", response_model=EpisodeRecord, summary="Get single persisted episode record")
def get_episode(
    cue_hash: str,
    authorization: Optional[str] = Header(None)
) -> EpisodeRecord:
    """Returns episode record by cue hash."""
    user_id = _resolve_link_user(authorization)
    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"

    if user_id != "local_user" or is_prod:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    """
                    SELECT cue_hash, title, series, episode_number, episode_key, site, media_type, duration_ms, known_pct, updated_at
                    FROM user_episode_cues
                    WHERE user_id = ? AND cue_hash = ?
                    """,
                    [user_id, cue_hash]
                )
                if rows:
                    r = rows[0]
                    return EpisodeRecord(
                        hash=r["cue_hash"],
                        title=r.get("title") or "",
                        series=r.get("series") or "",
                        episode_number=r.get("episode_number", 1),
                        episode_key=r.get("episode_key"),
                        site=r.get("site") or "generic",
                        media_type=r.get("media_type") or "anime",
                        duration_ms=r.get("duration_ms", 0),
                        known_pct=float(r.get("known_pct") or 0.0),
                        has_cues=True,
                        ts=str(r.get("updated_at") or ""),
                        minutes=round((r.get("duration_ms", 0) or 0) / 60000.0, 1)
                    )
        except Exception as e:
            logger.warning(f"Error reading episode from Turso: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode record with hash '{cue_hash}' not found",
        )

    record = get_episode_record(cue_hash)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode record with hash '{cue_hash}' not found",
        )
    return EpisodeRecord(**record)


ALLOWED_POSTER_DOMAINS = (
    "anilist.co",
    "kitsu.io",
    "youtube.com",
    "ytimg.com",
    "tvmaze.com",
    "media-amazon.com",
    "amazon.com",
    "crunchyroll.com",
    "myanimelist.net",
)
MAX_POSTER_BYTES = 5 * 1024 * 1024  # 5 MB
POSTER_TIMEOUT_SEC = 5
MAX_POSTER_CACHE_FILES = 300


def _is_safe_host(hostname: str) -> bool:
    if not hostname:
        return False
    h = hostname.lower().strip()
    return any(h == d or h.endswith("." + d) for d in ALLOWED_POSTER_DOMAINS)


def _validate_safe_ip(hostname: str) -> None:
    """Resolve hostname and ensure none of the resolved IPs are loopback, private, or link-local."""
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot resolve poster host: {e}")

    for entry in addr_info:
        ip_str = entry[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Poster URL resolves to a prohibited private, loopback, or link-local IP"
                )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid resolved IP address")


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Prohibited redirect scheme")
        if not _is_safe_host(parsed.hostname or ""):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Redirect domain not permitted")
        _validate_safe_ip(parsed.hostname or "")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _validate_image_bytes(data: bytes) -> str:
    """Validate magic bytes and return content-type, or raise 400."""
    if len(data) < 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Truncated image file")
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported or invalid image payload")


def _evict_poster_cache_if_needed(posters_dir: Path) -> None:
    try:
        files = list(posters_dir.glob("poster_*.*"))
        if len(files) > MAX_POSTER_CACHE_FILES:
            files.sort(key=lambda f: f.stat().st_mtime)
            to_remove = files[: len(files) - MAX_POSTER_CACHE_FILES + 20]
            for f in to_remove:
                try:
                    f.unlink()
                except Exception:
                    pass
    except Exception:
        pass


@router.get("/poster", summary="Proxy or retrieve cached series poster image")
def get_series_poster(url: str = Query(..., description="Remote poster image URL to proxy/cache")):
    """Caches and proxies remote anime/media poster images locally with strict SSRF defenses."""
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid poster URL")

    parsed = urllib.parse.urlparse(url)
    if parsed.username or parsed.password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Userinfo not permitted in poster URL")

    hostname = (parsed.hostname or "").lower()
    if not _is_safe_host(hostname):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not permitted for poster proxy")

    _validate_safe_ip(hostname)

    from app.config import get_media_dir
    posters_dir = get_media_dir() / "posters"
    posters_dir.mkdir(parents=True, exist_ok=True)

    url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
    ext = Path(parsed.path).suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    cache_file = posters_dir / f"poster_{url_hash}{ext}"

    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    content_type = media_types.get(ext, "image/jpeg")

    if cache_file.is_file() and cache_file.stat().st_size > 0:
        return FileResponse(cache_file, media_type=content_type, headers={"Cache-Control": "public, max-age=31536000"})

    try:
        opener = urllib.request.build_opener(SafeRedirectHandler())
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
        )
        with opener.open(req, timeout=POSTER_TIMEOUT_SEC) as resp:
            if resp.status == 200:
                content_len = resp.headers.get("Content-Length")
                if content_len and int(content_len) > MAX_POSTER_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Poster exceeds size limit")

                chunks = []
                total = 0
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_POSTER_BYTES:
                        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Poster exceeds size limit")
                    chunks.append(chunk)

                img_bytes = b"".join(chunks)
                actual_type = _validate_image_bytes(img_bytes)

                cache_file.write_bytes(img_bytes)
                _evict_poster_cache_if_needed(posters_dir)

                return Response(content=img_bytes, media_type=actual_type, headers={"Cache-Control": "public, max-age=31536000"})
    except HTTPException:
        raise
    except urllib.error.HTTPError as e:
        if e.code == 403 or e.code == 404:
            raise HTTPException(status_code=e.code, detail="Remote server rejected poster request")
        logger.debug(f"[PosterProxy] Remote HTTP error fetching {url}: {e}")
    except Exception as e:
        logger.debug(f"[PosterProxy] Failed to fetch {url}: {e}")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster image could not be retrieved")


