"""
FastAPI endpoints for Episode Primer & Recap (Slice 44).
"""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
import urllib.parse
import urllib.request
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)

from app.link.episode import (
    episode_service,
    get_episode_record,
    group_episodes_by_series,
    list_episode_records,
    save_episode_position,
    update_series_category,
)
from app.schemas_link_episode import (
    EpisodeRecord,
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
    )
    return EpisodeRecord(**rec)


@router.get("/series", response_model=List[SeriesGroup], summary="Get watch history grouped by series")
def get_series(media_type: Optional[str] = Query(None, description="Optional media_type filter: anime, youtube, tv")) -> List[SeriesGroup]:
    """Returns watch history grouped by series with known% per episode and media metadata."""
    groups = group_episodes_by_series(media_type=media_type)
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
    ]


@router.put("/series/{series_name}/category", summary="Override series category")
def put_series_category(series_name: str, request: UpdateSeriesCategoryRequest) -> Dict[str, Any]:
    """Update media_type classification for a series."""
    success = update_series_category(series_name=series_name, media_type=request.media_type)
    return {"series": series_name, "media_type": request.media_type, "updated": success}


@router.get("/series/{series_name}/cards", summary="Get cards mined from a series")
def get_series_cards(series_name: str) -> List[Dict[str, Any]]:
    """Return vocabulary cards associated with this series by tag or source matching."""
    from app.repositories.card_repository import list_cards
    # Look for cards whose tags, notes, source_url or source_text match the series
    cards = list_cards(limit=500)
    matched = []
    s_norm = series_name.strip().lower()
    for c in cards:
        tags = (c.tags or "").lower()
        source_url = (c.source_url or "").lower()
        notes = (c.notes or "").lower()
        if s_norm in tags or s_norm in source_url or s_norm in notes:
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


@router.get("/poster", summary="Proxy or retrieve cached series poster image")
def get_series_poster(url: str = Query(..., description="Remote poster image URL to proxy/cache")):
    """Caches and proxies remote anime/media poster images locally to support offline immersion and bypass CSP/CORS blocks."""
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid poster URL")

    # Only allow safe media CDN domains to prevent SSRF
    allowed_domains = ("anilist.co", "youtube.com", "ytimg.com", "tvmaze.com", "media-amazon.com", "crunchyroll.com")
    parsed = urllib.parse.urlparse(url)
    if not any(parsed.netloc.endswith(domain) for domain in allowed_domains):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not permitted for poster proxy")

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
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            if resp.status == 200:
                img_bytes = resp.read()
                cache_file.write_bytes(img_bytes)
                actual_type = resp.headers.get("Content-Type") or content_type
                return Response(content=img_bytes, media_type=actual_type, headers={"Cache-Control": "public, max-age=31536000"})
    except Exception as e:
        logger.debug(f"[PosterProxy] Failed to fetch {url}: {e}")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Poster image could not be retrieved")


