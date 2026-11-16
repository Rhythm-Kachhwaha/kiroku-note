"""
Media Metadata Provider Service for Anime, TV, and YouTube.
Caches AniList and TVMaze queries to SQLite to work completely offline after first fetch.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import re
import sqlite3
from typing import Any, Dict, Optional
import urllib.parse
import urllib.request

from app.db.connection import get_db_connection

logger = logging.getLogger(__name__)

METADATA_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS media_metadata (
    query_key TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    title_display TEXT NOT NULL,
    poster_url TEXT NOT NULL DEFAULT '',
    synopsis TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_metadata_type ON media_metadata (media_type);
"""


def init_media_metadata_db(conn: Optional[sqlite3.Connection] = None) -> None:
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        conn.executescript(METADATA_SCHEMA_SQL)
        conn.commit()
    finally:
        if close_after:
            conn.close()


def cache_poster_image(url: str) -> Optional[Path]:
    """Download and cache poster image to local media directory for offline immersion."""
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return None
    try:
        from app.config import get_media_dir
        posters_dir = get_media_dir() / "posters"
        posters_dir.mkdir(parents=True, exist_ok=True)
        url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
        parsed = urllib.parse.urlparse(url)
        ext = Path(parsed.path).suffix.lower() or ".jpg"
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".jpg"
        cache_file = posters_dir / f"poster_{url_hash}{ext}"
        if cache_file.is_file() and cache_file.stat().st_size > 0:
            return cache_file
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                cache_file.write_bytes(resp.read())
                return cache_file
    except Exception as e:
        logger.debug(f"[MediaMetadata] Failed to pre-cache poster {url}: {e}")
    return None


def detect_media_type(site: str = "", title: str = "") -> str:
    """Classify site/title into 'youtube', 'tv', or 'anime'."""
    s = (site or "").lower()
    t = (title or "").lower()
    if "youtube.com" in s or "youtu.be" in s:
        return "youtube"
    if any(k in s for k in ["netflix.com", "disneyplus.com", "hulu.com", "primevideo.com", "amazon.com", "hbomax.com", "max.com"]):
        return "tv"
    # Default is anime (covers Crunchyroll, Aniwave, HiAnime, 9anime, Gogoanime, local video, etc.)
    return "anime"


def _clean_search_title(title: str) -> str:
    cleaned = re.sub(r"\[.*?\]|\(.*?\)", "", title).strip()
    cleaned = re.sub(r"(?i)\b(?:episode|ep|e|s\d+e|s\d+)\s*[-.:]?\s*\d+.*", "", cleaned).strip()
    cleaned = re.sub(r"第\s*\d+\s*[話話].*", "", cleaned).strip()
    cleaned = re.sub(r"[-_#]\s*\d+\b.*", "", cleaned).strip()
    return cleaned or title


def fetch_anilist_metadata(title: str, conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    """Fetch anime poster & description from AniList GraphQL with SQLite caching."""
    clean_title = _clean_search_title(title)
    if not clean_title:
        return {"poster_url": "", "synopsis": "", "title_display": title}

    query_key = f"anime:{clean_title.lower()}"
    init_media_metadata_db(conn)

    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT poster_url, synopsis, title_display FROM media_metadata WHERE query_key = ?", (query_key,))
        row = cur.fetchone()
        if row:
            return {"poster_url": row[0], "synopsis": row[1], "title_display": row[2]}

        # Query AniList GraphQL API
        graphql_query = """
        query ($search: String) {
          Media (search: $search, type: ANIME) {
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
            }
            description(asHtml: false)
          }
        }
        """
        req_data = json.dumps({"query": graphql_query, "variables": {"search": clean_title}}).encode("utf-8")
        req = urllib.request.Request(
            "https://graphql.anilist.co",
            data=req_data,
            headers={"Content-Type": "application/json", "User-Agent": "KirokuNote/1.0"}
        )

        poster_url = ""
        synopsis = ""
        display_title = clean_title

        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    media = data.get("data", {}).get("Media")
                    if media:
                        cover = media.get("coverImage") or {}
                        poster_url = cover.get("extraLarge") or cover.get("large") or ""
                        synopsis = (media.get("description") or "").replace("<br>", "\n").strip()
                        titles = media.get("title") or {}
                        display_title = titles.get("english") or titles.get("romaji") or titles.get("native") or clean_title
        except Exception as e:
            logger.debug(f"[AniList] Metadata query failed for '{clean_title}': {e}")

        # Cache even if empty so we don't spam network
        from datetime import datetime, timezone
        now_ts = datetime.now(timezone.utc).isoformat()
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO media_metadata (query_key, media_type, title_display, poster_url, synopsis, source, raw_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (query_key, "anime", display_title, poster_url, synopsis, "anilist", "{}", now_ts)
            )

        if poster_url:
            cache_poster_image(poster_url)

        return {"poster_url": poster_url, "synopsis": synopsis, "title_display": display_title}
    finally:
        if close_after:
            conn.close()


def fetch_tvmaze_metadata(title: str, conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    """Fetch TV series poster & synopsis from TVMaze API with SQLite caching."""
    clean_title = _clean_search_title(title)
    if not clean_title:
        return {"poster_url": "", "synopsis": "", "title_display": title}

    query_key = f"tv:{clean_title.lower()}"
    init_media_metadata_db(conn)

    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT poster_url, synopsis, title_display FROM media_metadata WHERE query_key = ?", (query_key,))
        row = cur.fetchone()
        if row:
            return {"poster_url": row[0], "synopsis": row[1], "title_display": row[2]}

        encoded = urllib.parse.quote(clean_title)
        url = f"https://api.tvmaze.com/singlesearch/shows?q={encoded}"
        req = urllib.request.Request(url, headers={"User-Agent": "KirokuNote/1.0"})

        poster_url = ""
        synopsis = ""
        display_title = clean_title

        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    show = json.loads(resp.read().decode("utf-8"))
                    display_title = show.get("name") or clean_title
                    img = show.get("image") or {}
                    poster_url = img.get("original") or img.get("medium") or ""
                    summary = show.get("summary") or ""
                    # Strip basic HTML tags from summary
                    synopsis = re.sub(r"<[^>]+>", "", summary).strip()
        except Exception as e:
            logger.debug(f"[TVMaze] Query failed for '{clean_title}': {e}")

        from datetime import datetime, timezone
        now_ts = datetime.now(timezone.utc).isoformat()
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO media_metadata (query_key, media_type, title_display, poster_url, synopsis, source, raw_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (query_key, "tv", display_title, poster_url, synopsis, "tvmaze", "{}", now_ts)
            )

        if poster_url:
            cache_poster_image(poster_url)

        return {"poster_url": poster_url, "synopsis": synopsis, "title_display": display_title}
    finally:
        if close_after:
            conn.close()


def fetch_youtube_metadata(title: str, episode_key: Optional[str] = None, site: str = "") -> Dict[str, Any]:
    """Derive YouTube video thumbnail from standard video ID in URL or episode_key."""
    vid = ""
    # Check episode_key or site for v=...
    if episode_key and len(episode_key) == 11 and re.match(r"^[A-Za-z0-9_-]{11}$", episode_key):
        vid = episode_key
    elif site:
        m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", site)
        if m:
            vid = m.group(1)
        else:
            m2 = re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", site)
            if m2:
                vid = m2.group(1)

    poster_url = f"https://img.youtube.com/vi/{vid}/hqdefault.jpg" if vid else ""
    return {
        "poster_url": poster_url,
        "synopsis": f"YouTube video: {title}",
        "title_display": title,
    }


def get_series_metadata(series_name: str, media_type: str = "anime", site: str = "", episode_key: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve metadata for a given series based on resolved media_type."""
    if media_type == "youtube":
        return fetch_youtube_metadata(series_name, episode_key=episode_key, site=site)
    elif media_type == "tv":
        return fetch_tvmaze_metadata(series_name)
    else:
        return fetch_anilist_metadata(series_name)
