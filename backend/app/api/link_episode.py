"""
FastAPI endpoints for Episode Primer & Recap (Slice 44).
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
from pathlib import Path
import socket
from typing import Any, Dict, List, Optional
import urllib.error
import urllib.parse
import urllib.request
from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

from app.api.cloud import _is_test_fixture_series
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
        last_position_ms=request.last_position_ms or 0,
    )
    return RecapResponse(**res)


@router.post("/episodes/{cue_hash}/position", response_model=EpisodeRecord, summary="Update episode playback position")
def post_episode_position(cue_hash: str, request: UpdatePositionRequest) -> EpisodeRecord:
    """Saves throttled playback position (in ms) for an episode."""
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
    return EpisodeRecord(**rec)


@router.get("/series", response_model=List[SeriesGroup], summary="Get watch history grouped by series")
def get_series(
    media_type: Optional[str] = Query(None, description="Optional media_type filter: anime, youtube, tv"),
    authorization: Optional[str] = Header(None)
) -> List[SeriesGroup]:
    """Returns watch history grouped by series with known% per episode and media metadata."""
    groups = [g for g in group_episodes_by_series(media_type=media_type) if not _is_test_fixture_series(g.get("series"))]
    if not groups and authorization:
        try:
            from app.db.turso_client import get_turso_client
            from app.api.cloud import _resolve_user_id
            turso = get_turso_client()
            if turso.is_configured:
                try:
                    user_id = _resolve_user_id(authorization)
                except Exception:
                    user_id = None
                if user_id:
                    rows = turso.execute(
                        """
                        SELECT series_id, episode_number, last_position_ms, duration_ms,
                               completed, mined_card_count, last_watched_at, poster_url,
                               series_title, title_native, title_english, synopsis, media_type
                        FROM user_anime_progress
                        WHERE user_id = ?
                        ORDER BY last_watched_at DESC
                        """,
                        [user_id]
                    )
                    series_map: Dict[str, Dict[str, Any]] = {}
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
                        series_map[s_name]["episodes"].append({
                            "hash": "",
                            "title": f"Episode {ep_num}",
                            "site": "generic",
                            "known_pct": 0.0,
                            "last_position_ms": r.get("last_position_ms", 0),
                            "duration_ms": r.get("duration_ms", 0),
                            "mined": r.get("mined_card_count", 0),
                            "minutes": round((r.get("duration_ms", 0) or 0) / 60000.0, 1),
                            "ts": str(r.get("last_watched_at") or ""),
                            "completed": r.get("completed", 0),
                            "last_watched_at": r.get("last_watched_at"),
                            "has_cues": False
                        })
                    groups = list(series_map.values())
        except Exception as e:
            logger.warning(f"Failed to fetch cloud series from Turso: {e}")

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
def delete_episode(episode_hash: str) -> Dict[str, Any]:
    """Delete an episode record and its cues from the watch history library."""
    success = delete_episode_record(episode_hash)
    return {"hash": episode_hash, "deleted": success}


@router.delete("/series/{series_name}", summary="Delete an entire series and all its episodes")
def delete_series(series_name: str) -> Dict[str, Any]:
    """Delete all episode records and cues belonging to a series."""
    count = delete_series_records(series_name)
    return {"series": series_name, "deleted_episodes": count}


@router.put("/series/{series_name}/category", summary="Override series category")
def put_series_category(series_name: str, request: UpdateSeriesCategoryRequest) -> Dict[str, Any]:
    """Update media_type classification for a series."""
    success = update_series_category(series_name=series_name, media_type=request.media_type)
    return {"series": series_name, "media_type": request.media_type, "updated": success}


@router.get("/series/{series_name}/cards", summary="Get cards mined from a series")
def get_series_cards(series_name: str) -> List[Dict[str, Any]]:
    """Return vocabulary cards associated with this series by tag or source matching."""
    import re
    from app.repositories.card_repository import CardRepository
    cards = CardRepository().list_cards(limit=1000)
    matched = []
    s_norm = series_name.strip().lower()
    s_slug = re.sub(r'[\s\-_!?:;.,\'"()[\]{}]+', '', series_name).strip().lower()
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
    if not matched:
        try:
            from app.db.turso_client import get_turso_client
            turso = get_turso_client()
            if turso.is_configured:
                rows = turso.execute(
                    "SELECT payload FROM user_op_log WHERE op_type = 'card_save' ORDER BY rowid DESC"
                )
                for r in rows:
                    payload_str = r.get("payload")
                    if not payload_str:
                        continue
                    try:
                        import json
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


@router.post("/episodes/sync", response_model=EpisodeRecord, summary="Sync episode subtitles and metrics from extension")
def post_episode_sync(request: EpisodeSyncRequest) -> EpisodeRecord:
    """Zero-latency background sync of subtitle cues and watch metrics from extension."""
    rec = episode_service.sync_episode_subtitles(
        cue_hash=request.hash,
        title=request.title,
        series=request.series,
        site=request.site,
        media_type=request.media_type,
        cues=request.cues,
        duration_ms=request.duration_ms,
        mined_words=request.mined_words,
    )
    return EpisodeRecord(**rec)


@router.get("/episodes/{cue_hash}/inspect", response_model=EpisodeInspectorResponse, summary="Inspect episode difficulty, gap words, and grammar")
def get_episode_inspect(
    cue_hash: str,
    learner_level: Optional[str] = Query(None, description="Optional learner JLPT level"),
) -> EpisodeInspectorResponse:
    """Returns rich episode analytics including JLPT difficulty breakdown, missed words, and grammar occurrences."""
    res = episode_service.inspect_episode(cue_hash=cue_hash, learner_level=learner_level)
    return EpisodeInspectorResponse(**res)


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


