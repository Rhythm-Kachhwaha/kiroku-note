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
    """Classify site/title into 'youtube', 'tv', 'web', or 'anime'."""
    s = (site or "").lower()
    t = (title or "").lower()
    if "youtube.com" in s or "youtu.be" in s:
        return "youtube"
    if any(k in s for k in ["netflix.com", "disneyplus.com", "hulu.com", "primevideo.com", "amazon.com", "hbomax.com", "max.com"]):
        return "tv"
    # Identify generic non-media web browsing / URLs
    if any(k in s for k in ["github.com", "google.com", "wikipedia.org", "reddit.com", "twitter.com", "x.com", "stackoverflow.com", "yahoo.co.jp"]):
        return "web"
    if re.search(r"^https?://", t) or re.search(r"^https?://", s) or re.search(r"\.(?:com|org|net|io|edu|gov|co|app|html|php)(?:/|$)", t):
        return "web"
    if s in ("generic_web", "web", "browser"):
        return "web"
    # Default is anime (covers Crunchyroll, Aniwave, HiAnime, 9anime, Gogoanime, local video, etc.)
    return "anime"


_ANILIST_MEMORY_CACHE: Dict[str, Dict[str, Any]] = {}


def _clean_search_title(title: str) -> str:
    if not title:
        return ""
    import unicodedata
    cleaned = unicodedata.normalize("NFKC", title).strip()
    cleaned = re.sub(r"^(?:【(?:公式|PV|予告|本編)】|Watch\s+)", "", cleaned, flags=re.I).strip()
    cleaned = re.sub(r"^[『「【](.*?)[』」】]", r"\1", cleaned).strip()
    # Remove subtitles / subheaders like "Season 1", "2nd Season", "Cour 2", file extensions
    cleaned = re.sub(r"(?i)\.(?:mp4|mkv|avi|webm|ts|m4v|ass|srt)$", "", cleaned).strip()
    cleaned = re.sub(r"\[.*?\]|\(.*?\)", "", cleaned).strip()
    cleaned = re.sub(r"第\s*\d+\s*[話回].*", "", cleaned).strip()
    cleaned = re.sub(r"第\s*[一二三四五六七八九十百千]+\s*[話回].*", "", cleaned).strip()
    cleaned = re.sub(r"(?i)\b(?:episode|ep|e|s\d+e|s\d+)\s*[-.:]?\s*\d+.*", "", cleaned).strip()
    cleaned = re.sub(r"[-_#]\s*\d+\b.*", "", cleaned).strip()
    cleaned = re.sub(r"\s+-\s*$", "", cleaned).strip()
    # Strip trailing season specifiers for robust base matching
    cleaned = re.sub(r"(?i)\b(?:season\s*\d+|part\s*\d+|cour\s*\d+|2nd\s*season|3rd\s*season)\b.*", "", cleaned).strip()
    # If the remaining string is purely generic ("Episode 1", "Ep 04", digits, Anime, YouTube Video), do not search AniList
    if not cleaned or re.match(r"^(?:episode|ep|e|s\d+|s\d+e\d+|\d+|anime|youtube\s+video|netflix\s+series|series|video|player|generic)\s*[-.:]?\s*\d*$", cleaned, flags=re.I):
        return ""
    return cleaned


def fetch_anilist_metadata(title: str, conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    """Fetch anime poster & description from AniList GraphQL with SQLite caching."""
    clean_title = _clean_search_title(title)
    if not clean_title:
        return {"poster_url": "", "synopsis": "", "title_display": title}

    query_key = f"anime:{clean_title.lower()}"
    if query_key in _ANILIST_MEMORY_CACHE:
        return dict(_ANILIST_MEMORY_CACHE[query_key])

    init_media_metadata_db(conn)

    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT poster_url, synopsis, title_display, raw_json FROM media_metadata WHERE query_key = ?", (query_key,))
        row = cur.fetchone()
        raw_dict = {}
        if row:
            try:
                raw_dict = json.loads(row[3]) if len(row) > 3 and row[3] else {}
            except Exception:
                raw_dict = {}
            if raw_dict.get("anilist_id") is not None and raw_dict.get("title_native") is not None:
                cached_res = {
                    "poster_url": row[0],
                    "synopsis": row[1],
                    "title_display": row[2],
                    "raw_json": raw_dict,
                    "anilist_id": raw_dict.get("anilist_id"),
                    "title_english": raw_dict.get("title_english") or row[2],
                    "title_romaji": raw_dict.get("title_romaji") or row[2],
                    "title_native": raw_dict.get("title_native") or row[2],
                }
                _ANILIST_MEMORY_CACHE[query_key] = cached_res
                return cached_res

        # Query AniList GraphQL API with multi-candidate search
        graphql_query = """
        query ($search: String) {
          Page (page: 1, perPage: 5) {
            media (search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
              id
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
              episodes
              duration
            }
          }
        }
        """
        req_data = json.dumps({"query": graphql_query, "variables": {"search": clean_title}}).encode("utf-8")
        req = urllib.request.Request(
            "https://graphql.anilist.co",
            data=req_data,
            headers={"Content-Type": "application/json", "User-Agent": "KirokuNote/1.0"}
        )

        poster_url = row[0] if row else ""
        synopsis = row[1] if row else ""
        display_title = row[2] if row else clean_title
        raw_json_dict = dict(raw_dict)
        network_ok = False

        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    network_ok = True
                    data = json.loads(resp.read().decode("utf-8"))
                    page = data.get("data", {}).get("Page") or {}
                    candidates = page.get("media") or []
                    
                    STOP_WORDS = {"the", "a", "an", "no", "to", "of", "in", "and", "season", "part", "cour", "episode", "ep"}
                    best_cand = None
                    best_score = 0.0

                    for cand in candidates:
                        titles = cand.get("title") or {}
                        c_eng = (titles.get("english") or "").strip().lower()
                        c_rom = (titles.get("romaji") or "").strip().lower()
                        c_nat = (titles.get("native") or "").strip().lower()
                        s_clean = clean_title.strip().lower()

                        if s_clean in (c_eng, c_rom, c_nat):
                            score = 1.0
                        elif s_clean in c_eng or s_clean in c_rom or s_clean in c_nat:
                            score = 0.85
                        else:
                            s_tokens = {t for t in re.split(r'[\s\-_\.:!?,]+', s_clean) if len(t) >= 2 and t not in STOP_WORDS}
                            cand_tokens = {t for t in re.split(r'[\s\-_\.:!?,]+', f"{c_eng} {c_rom} {c_nat}") if len(t) >= 2 and t not in STOP_WORDS}
                            if s_tokens and cand_tokens:
                                score = len(s_tokens.intersection(cand_tokens)) / len(s_tokens)
                            else:
                                score = 0.0

                        # Cover image requirement: must have valid cover
                        cover = cand.get("coverImage") or {}
                        has_cover = bool(cover.get("extraLarge") or cover.get("large"))
                        if has_cover and score > best_score:
                            best_score = score
                            best_cand = cand

                    min_score = 0.85 if len(clean_title) <= 4 else 0.6
                    media = best_cand if best_score >= min_score else None
                    if not media and candidates:
                        logger.info(f"[AniList] Rejected weak matches for '{clean_title}', top score was {best_score:.2f}")

                    if media:
                        titles = media.get("title") or {}
                        t_eng = (titles.get("english") or "").strip()
                        t_rom = (titles.get("romaji") or "").strip()
                        t_nat = (titles.get("native") or "").strip()
                        cover = media.get("coverImage") or {}
                        poster_url = cover.get("extraLarge") or cover.get("large") or poster_url
                        raw_desc = media.get("description") or ""
                        if raw_desc:
                            clean_desc = re.sub(r"<br\s*/?>", "\n", raw_desc)
                            clean_desc = re.sub(r"<[^>]+>", "", clean_desc)
                            clean_desc = re.sub(r"\n{2,}", "\n\n", clean_desc).strip()
                            synopsis = clean_desc
                        display_title = t_eng or t_rom or t_nat or clean_title
                        raw_json_dict = {
                            "anilist_id": media.get("id"),
                            "episodes": media.get("episodes") if media.get("episodes") is not None else raw_dict.get("episodes"),
                            "duration": media.get("duration") if media.get("duration") is not None else raw_dict.get("duration"),
                            "title_english": t_eng or t_rom or clean_title,
                            "title_romaji": t_rom or clean_title,
                            "title_native": t_nat or clean_title,
                        }
        except Exception as e:
            logger.debug(f"[AniList] Metadata query failed for '{clean_title}': {e}")
            if row:
                return {
                    "poster_url": row[0],
                    "synopsis": row[1],
                    "title_display": row[2],
                    "raw_json": raw_dict,
                    "anilist_id": raw_dict.get("anilist_id"),
                    "title_english": raw_dict.get("title_english") or row[2],
                    "title_romaji": raw_dict.get("title_romaji") or row[2],
                    "title_native": raw_dict.get("title_native") or row[2],
                }

        # Cache even if empty so we don't spam network
        from datetime import datetime, timezone
        now_ts = datetime.now(timezone.utc).isoformat()
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO media_metadata (query_key, media_type, title_display, poster_url, synopsis, source, raw_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (query_key, "anime", display_title, poster_url, synopsis, "anilist", json.dumps(raw_json_dict), now_ts)
            )

        if poster_url:
            cache_poster_image(poster_url)

        final_res = {
            "poster_url": poster_url,
            "synopsis": synopsis,
            "title_display": display_title,
            "raw_json": raw_json_dict,
            "anilist_id": raw_json_dict.get("anilist_id"),
            "title_english": raw_json_dict.get("title_english") or display_title,
            "title_romaji": raw_json_dict.get("title_romaji") or display_title,
            "title_native": raw_json_dict.get("title_native") or display_title,
        }
        if network_ok or poster_url:
            _ANILIST_MEMORY_CACHE[query_key] = final_res
        return final_res
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
    # Check episode_key (bare 11-char ID or youtube/<id>/... segment) or site for v=...
    if episode_key:
        if len(episode_key) == 11 and re.match(r"^[A-Za-z0-9_-]{11}$", episode_key):
            vid = episode_key
        else:
            for seg in str(episode_key).split("/"):
                if len(seg) == 11 and re.match(r"^[A-Za-z0-9_-]{11}$", seg):
                    vid = seg
                    break
            if not vid:
                m_ek = re.search(r"(?:[?&]v=|youtu\.be/)([A-Za-z0-9_-]{11})", str(episode_key))
                if m_ek:
                    vid = m_ek.group(1)
    if not vid and site:
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


def get_series_metadata(series_name: str, media_type: str = "anime", site: str = "", episode_key: Optional[str] = None, conn: Optional[sqlite3.Connection] = None) -> Dict[str, Any]:
    """Retrieve metadata for a given series based on resolved media_type."""
    if media_type == "youtube":
        return fetch_youtube_metadata(series_name, episode_key=episode_key, site=site)
    elif media_type == "tv":
        return fetch_tvmaze_metadata(series_name, conn=conn)
    else:
        return fetch_anilist_metadata(series_name, conn=conn)
