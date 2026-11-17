"""
Link Episode Primer & Recap Engine (Slice 44).

Generates pre-watch Primers (top gap words, top grammar points, mini-quiz)
and post-watch Recaps (% known progression, mined words, unseen gap words),
persisting per-episode records to the local SQLite database.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import random
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from app.config import get_db_path, get_learner_jlpt_level
from app.db.connection import get_db_connection
from app.link.analysis import link_analysis_service
from app.services.dictionary_provider import LocalDictionaryProvider
from app.services.grammar_service import GrammarService
from app.services.jlpt_reference import JlptReferenceService
from app.services.subtitle_annotator import (
    FUNCTION_WORDS,
    SubtitleAnnotatorService,
    get_subtitle_annotator_service,
)

logger = logging.getLogger(__name__)

_LEVEL_PRIORITY: dict[str, int] = {
    "N5": 5,
    "N4": 4,
    "N3": 3,
    "N2": 2,
    "N1": 1,
}

EPISODE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS link_episode (
    hash TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    known_pct REAL NOT NULL DEFAULT 0.0,
    mined INTEGER NOT NULL DEFAULT 0,
    minutes REAL NOT NULL DEFAULT 0.0,
    ts TEXT NOT NULL,
    last_position_ms INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    series TEXT,
    episode_key TEXT,
    media_type TEXT NOT NULL DEFAULT 'anime',
    poster_url TEXT NOT NULL DEFAULT '',
    synopsis TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_link_episode_ts ON link_episode (ts DESC);

CREATE TABLE IF NOT EXISTS episode_cues (
    hash TEXT PRIMARY KEY,
    cues_json TEXT NOT NULL,
    synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episode_cues_hash ON episode_cues (hash);
"""


def extract_series_title(title: str) -> str:
    """Extract clean series name by stripping episode numbers, release tags, and file extensions, preserving season designations for season 2+."""
    if not title:
        return "Unknown Series"
    t = title.strip()
    # Strip file extensions
    t = re.sub(r"\.(?:ass|srt|vtt|sub|mkv|mp4|webm|avi)$", "", t, flags=re.I).strip()
    # Strip synthetic Kiroku / subtitle prefixes
    t = re.sub(r"^kiroku[\s_]*(?:titles?|subtitles?)[_\s-]*", "", t, flags=re.I).strip()
    # Strip brackets and release tags
    t = re.sub(r"\[.*?\]|\(.*?\)", "", t).strip()

    # Detect season number >= 2 before stripping episode info
    season_num = None
    m_se = re.search(r"(?i)\bS0*(\d+)E\d+\b", t)
    if m_se:
        s_val = int(m_se.group(1))
        if s_val >= 2:
            season_num = s_val
    else:
        m_s = re.search(r"(?i)\b(?:season|s)\s*0*([2-9]|\d{2,})\b", t)
        if m_s:
            season_num = int(m_s.group(1))
        else:
            m_ord = re.search(r"(?i)\b(\d+)(?:nd|rd|th)\s+season\b", t)
            if m_ord:
                season_num = int(m_ord.group(1))

    # Strip episode specifiers
    t = re.sub(r"(?i)\b(?:episode|ep|e|s\d+e|s\d+)\s*[-.:]?\s*\d+.*", "", t).strip()
    t = re.sub(r"第\s*\d+\s*[話話].*", "", t).strip()
    t = re.sub(r"[-_#]\s*\d+\b.*", "", t).strip()
    # Strip standalone episode numbers e.g. ' 01 ' or ' 01'
    t = re.sub(r"\s+0*\d{1,3}(?:v\d+)?(?:\s.*|$)", "", t).strip()
    # Only strip trailing number if NOT preceded by Season or S
    t = re.sub(r"(?i)(?<!\bseason)(?<!\bs)\s+\d{1,4}$", "", t).strip()
    t = re.sub(r"\s+-\s*$", "", t).strip()

    # If season >= 2 was detected and not already in the title text, append it
    if season_num and not re.search(r"(?i)\bseason\b", t):
        t = f"{t} Season {season_num}"

    return t or title


def init_link_episode_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Ensure the link_episode table exists and has all required columns."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        conn.executescript(EPISODE_SCHEMA_SQL)
        # Migrate table if last_position_ms, series, or episode_key is missing
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(link_episode)")
        cols = [r[1] for r in cur.fetchall()]
        if "last_position_ms" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN last_position_ms INTEGER NOT NULL DEFAULT 0")
        if "duration_ms" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0")
        if "series" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN series TEXT")
        if "episode_key" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN episode_key TEXT")
        if "media_type" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN media_type TEXT NOT NULL DEFAULT 'anime'")
        if "poster_url" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN poster_url TEXT NOT NULL DEFAULT ''")
        if "synopsis" not in cols:
            conn.execute("ALTER TABLE link_episode ADD COLUMN synopsis TEXT NOT NULL DEFAULT ''")
        conn.commit()
    finally:
        if close_after:
            conn.close()


def delete_episode_record(hash_val: str, conn: Optional[sqlite3.Connection] = None) -> bool:
    """Delete an episode record and its cached cues from SQLite."""
    if not hash_val:
        return False
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        init_link_episode_db(conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM episode_cues WHERE hash = ?", (hash_val,))
        res = cur.execute("DELETE FROM link_episode WHERE hash = ?", (hash_val,))
        conn.commit()
        return (res.rowcount > 0)
    finally:
        if close_after:
            conn.close()


def save_episode_cues(hash_val: str, cues: List[Dict[str, Any]], conn: Optional[sqlite3.Connection] = None) -> None:
    """Cache raw or normalized cues in SQLite for instant desktop analytics inspection."""
    if not hash_val or not cues:
        return
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        init_link_episode_db(conn)
        now_ts = datetime.now(timezone.utc).isoformat()
        cues_json = json.dumps(cues, ensure_ascii=False)
        conn.execute(
            """
            INSERT INTO episode_cues (hash, cues_json, synced_at)
            VALUES (?, ?, ?)
            ON CONFLICT(hash) DO UPDATE SET
                cues_json = excluded.cues_json,
                synced_at = excluded.synced_at
            """,
            (hash_val, cues_json, now_ts),
        )
        conn.commit()
    finally:
        if close_after:
            conn.close()


def get_episode_cues(hash_val: str, conn: Optional[sqlite3.Connection] = None) -> Optional[List[Dict[str, Any]]]:
    """Retrieve cached cues list from SQLite."""
    if not hash_val:
        return None
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        init_link_episode_db(conn)
        cur = conn.cursor()
        cur.execute("SELECT cues_json FROM episode_cues WHERE hash = ?", (hash_val,))
        row = cur.fetchone()
        if not row:
            return None
        return json.loads(row[0])
    except Exception as e:
        logger.debug("[EpisodeDB] Failed to load cues for %s: %s", hash_val, e)
        return None
    finally:
        if close_after:
            conn.close()


def save_episode_record(
    hash_val: str,
    title: str,
    site: str,
    known_pct: float,
    mined: int,
    minutes: float,
    ts: Optional[str] = None,
    last_position_ms: int = 0,
    duration_ms: int = 0,
    series: Optional[str] = None,
    episode_key: Optional[str] = None,
    media_type: Optional[str] = None,
    poster_url: Optional[str] = None,
    synopsis: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    """Upsert an episode record in SQLite."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    now_ts = ts or datetime.now(timezone.utc).isoformat()
    init_link_episode_db(conn)
    resolved_series = series if series is not None else extract_series_title(title)

    # Classify media_type if not provided
    from app.services.media_metadata import detect_media_type, get_series_metadata
    resolved_type = media_type or detect_media_type(site=site, title=title)

    # Auto-resolve metadata (poster/synopsis) if missing
    resolved_poster = poster_url or ""
    resolved_synopsis = synopsis or ""
    if not resolved_poster or not resolved_synopsis:
        meta = get_series_metadata(resolved_series, media_type=resolved_type, site=site, episode_key=episode_key)
        resolved_poster = resolved_poster or meta.get("poster_url", "")
        resolved_synopsis = resolved_synopsis or meta.get("synopsis", "")

    try:
        with conn:
            conn.execute(
                """
                INSERT INTO link_episode (hash, title, site, known_pct, mined, minutes, ts, last_position_ms, duration_ms, series, episode_key, media_type, poster_url, synopsis)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(hash) DO UPDATE SET
                    title = excluded.title,
                    site = excluded.site,
                    known_pct = excluded.known_pct,
                    mined = excluded.mined,
                    minutes = excluded.minutes,
                    ts = excluded.ts,
                    last_position_ms = CASE WHEN excluded.last_position_ms > 0 THEN excluded.last_position_ms ELSE link_episode.last_position_ms END,
                    duration_ms = CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE link_episode.duration_ms END,
                    series = CASE WHEN excluded.series IS NOT NULL THEN excluded.series ELSE link_episode.series END,
                    episode_key = CASE WHEN excluded.episode_key IS NOT NULL THEN excluded.episode_key ELSE link_episode.episode_key END,
                    media_type = CASE WHEN excluded.media_type != '' THEN excluded.media_type ELSE link_episode.media_type END,
                    poster_url = CASE WHEN excluded.poster_url != '' THEN excluded.poster_url ELSE link_episode.poster_url END,
                    synopsis = CASE WHEN excluded.synopsis != '' THEN excluded.synopsis ELSE link_episode.synopsis END
                """,
                (hash_val, title, site, round(known_pct, 1), mined, round(minutes, 1), now_ts, max(0, last_position_ms), max(0, duration_ms), resolved_series, episode_key, resolved_type, resolved_poster, resolved_synopsis),
            )
        return {
            "hash": hash_val,
            "title": title,
            "site": site,
            "known_pct": round(known_pct, 1),
            "mined": mined,
            "minutes": round(minutes, 1),
            "ts": now_ts,
            "last_position_ms": max(0, last_position_ms),
            "duration_ms": max(0, duration_ms),
            "series": resolved_series,
            "episode_key": episode_key,
            "media_type": resolved_type,
            "poster_url": resolved_poster,
            "synopsis": resolved_synopsis,
        }
    finally:
        if close_after:
            conn.close()


def save_episode_position(
    hash_val: str,
    last_position_ms: int,
    title: str = "",
    site: str = "",
    series: Optional[str] = None,
    episode_key: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    """Updates last watched position in milliseconds for an episode."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    now_ts = datetime.now(timezone.utc).isoformat()
    resolved_series = series if series is not None else (extract_series_title(title) if title else None)
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO link_episode (hash, title, site, known_pct, mined, minutes, ts, last_position_ms, series, episode_key)
                VALUES (?, ?, ?, 0.0, 0, 0.0, ?, ?, ?, ?)
                ON CONFLICT(hash) DO UPDATE SET
                    last_position_ms = excluded.last_position_ms,
                    title = CASE WHEN excluded.title != '' THEN excluded.title ELSE link_episode.title END,
                    site = CASE WHEN excluded.site != '' THEN excluded.site ELSE link_episode.site END,
                    ts = excluded.ts,
                    series = CASE WHEN excluded.series IS NOT NULL THEN excluded.series ELSE link_episode.series END,
                    episode_key = CASE WHEN excluded.episode_key IS NOT NULL THEN excluded.episode_key ELSE link_episode.episode_key END
                """,
                (hash_val, title, site, now_ts, max(0, last_position_ms), resolved_series, episode_key),
            )
        rec = get_episode_record(hash_val, conn=conn)
        return rec or {
            "hash": hash_val,
            "title": title,
            "site": site,
            "known_pct": 0.0,
            "mined": 0,
            "minutes": 0.0,
            "ts": now_ts,
            "last_position_ms": max(0, last_position_ms),
            "series": resolved_series or extract_series_title(title),
            "episode_key": episode_key,
        }
    finally:
        if close_after:
            conn.close()


def get_episode_record(hash_val: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    """Retrieve an episode record by hash."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT hash, title, site, known_pct, mined, minutes, ts, last_position_ms, series, episode_key, media_type, poster_url, synopsis, duration_ms FROM link_episode WHERE hash = ?",
            (hash_val,),
        )
        row = cur.fetchone()
        if not row:
            return None
        title = row[1] or ""
        series_val = row[8] or extract_series_title(title)
        return {
            "hash": row[0],
            "title": title,
            "site": row[2] or "",
            "known_pct": row[3] or 0.0,
            "mined": row[4] or 0,
            "minutes": row[5] or 0.0,
            "ts": row[6] or "",
            "last_position_ms": row[7] or 0,
            "series": series_val,
            "episode_key": row[9] if len(row) > 9 else None,
            "media_type": row[10] if len(row) > 10 and row[10] else "anime",
            "poster_url": row[11] if len(row) > 11 and row[11] else "",
            "synopsis": row[12] if len(row) > 12 and row[12] else "",
            "duration_ms": row[13] if len(row) > 13 and row[13] is not None else 0,
        }
    finally:
        if close_after:
            conn.close()


def list_episode_records(limit: int = 50, media_type: Optional[str] = None, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    """List recent episode records with optional media_type filter."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    try:
        cur = conn.cursor()
        if media_type:
            cur.execute(
                "SELECT hash, title, site, known_pct, mined, minutes, ts, last_position_ms, series, episode_key, media_type, poster_url, synopsis, duration_ms FROM link_episode WHERE media_type = ? ORDER BY ts DESC LIMIT ?",
                (media_type, limit),
            )
        else:
            cur.execute(
                "SELECT hash, title, site, known_pct, mined, minutes, ts, last_position_ms, series, episode_key, media_type, poster_url, synopsis, duration_ms FROM link_episode ORDER BY ts DESC LIMIT ?",
                (limit,),
            )
        rows = cur.fetchall()
        return [
            {
                "hash": r[0],
                "title": r[1] or "",
                "site": r[2] or "",
                "known_pct": r[3] or 0.0,
                "mined": r[4] or 0,
                "minutes": r[5] or 0.0,
                "ts": r[6] or "",
                "last_position_ms": r[7] or 0,
                "series": r[8] or extract_series_title(r[1] or ""),
                "episode_key": r[9] if len(r) > 9 else None,
                "media_type": r[10] if len(r) > 10 and r[10] else "anime",
                "poster_url": r[11] if len(r) > 11 and r[11] else "",
                "synopsis": r[12] if len(r) > 12 and r[12] else "",
                "duration_ms": r[13] if len(r) > 13 and r[13] is not None else 0,
            }
            for r in rows
        ]
    finally:
        if close_after:
            conn.close()


def group_episodes_by_series(records: Optional[List[Dict[str, Any]]] = None, media_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """Group episode records into canonical series, unifying Japanese and English titles for the same show."""
    from app.services.media_metadata import get_series_metadata

    recs = records if records is not None else list_episode_records(limit=200, media_type=media_type)
    groups: Dict[str, Dict[str, Any]] = {}

    for r in recs:
        raw_series = r.get("series") or extract_series_title(r.get("title", ""))
        m_type = r.get("media_type") or "anime"

        meta = {}
        try:
            meta = get_series_metadata(raw_series, media_type=m_type)
        except Exception:
            pass

        raw_json = meta.get("raw_json") or {}
        anilist_id = raw_json.get("anilist_id")
        title_eng = raw_json.get("title_english") or meta.get("title_display") or raw_series
        title_nat = raw_json.get("title_native") or raw_series
        title_rom = raw_json.get("title_romaji") or raw_series
        display_title = meta.get("title_display") or title_eng or raw_series

        # Determine canonical group key
        if m_type == "anime" and anilist_id:
            canon_key = f"anime_anilist_{anilist_id}"
        elif meta.get("title_display"):
            canon_key = f"{m_type}_{meta.get('title_display').strip().lower()}"
        else:
            canon_key = f"{m_type}_{raw_series.strip().lower()}"

        is_latin = bool(re.search(r"[a-zA-Z]", raw_series))
        chosen_series = raw_series if is_latin else (title_eng or display_title or raw_series)

        if canon_key not in groups:
            groups[canon_key] = {
                "series": chosen_series,
                "title_english": title_eng,
                "title_romaji": title_rom,
                "title_native": title_nat,
                "media_type": m_type,
                "poster_url": meta.get("poster_url") or r.get("poster_url") or "",
                "synopsis": meta.get("synopsis") or r.get("synopsis") or "",
                "total_episodes": raw_json.get("episodes"),
                "episodes_by_key": {},
            }
        else:
            g = groups[canon_key]
            if not re.search(r"[a-zA-Z]", g["series"]) and is_latin:
                g["series"] = raw_series
            if not g.get("poster_url") and (meta.get("poster_url") or r.get("poster_url")):
                g["poster_url"] = meta.get("poster_url") or r.get("poster_url")
            if not g.get("synopsis") and (meta.get("synopsis") or r.get("synopsis")):
                g["synopsis"] = meta.get("synopsis") or r.get("synopsis")
            if not g.get("total_episodes") and raw_json.get("episodes"):
                g["total_episodes"] = raw_json.get("episodes")
            if not g.get("title_native") and title_nat:
                g["title_native"] = title_nat

        ep_dict = groups[canon_key]["episodes_by_key"]

        # Episode deduplication: extract episode number
        ep_num = None
        title_str = r.get("title", "")
        m_ep = (
            re.search(r"(?i)\b(?:episode|ep|e|s\d+e)\s*[-.:]?\s*0*(\d+)\b", title_str)
            or re.search(r"第\s*0*(\d+)\s*[話話]", title_str)
            or re.search(r"[-_\s]0*(\d{1,3})(?:v\d+)?(?:[\s._-]|$)", title_str)
        )
        if m_ep:
            ep_num = int(m_ep.group(1))
        elif r.get("episode_key"):
            m_k = re.search(r"(?i)ep0*(\d+)", r.get("episode_key", ""))
            if m_k:
                ep_num = int(m_k.group(1))

        if ep_num is not None:
            r["episode_number"] = ep_num
        else:
            r["episode_number"] = 1
            ep_num = 1

        dedup_key = f"ep_{ep_num}" if ep_num is not None else (r.get("episode_key") or r.get("hash") or r.get("title"))

        if dedup_key in ep_dict:
            existing = ep_dict[dedup_key]
            existing_cues = get_episode_cues(existing.get("hash", ""))
            new_cues = get_episode_cues(r.get("hash", ""))
            # Pick base: strongly prefer the record with persisted subtitle cues
            base = r if (new_cues and not existing_cues) else existing
            other = existing if base is r else r
            merged = dict(base)
            merged["last_position_ms"] = max(base.get("last_position_ms") or 0, other.get("last_position_ms") or 0)
            merged["minutes"] = max(base.get("minutes") or 0, other.get("minutes") or 0, round(merged["last_position_ms"] / 60000.0, 1))
            merged["known_pct"] = max(base.get("known_pct") or 0.0, other.get("known_pct") or 0.0)
            merged["mined"] = max(base.get("mined") or 0, other.get("mined") or 0)
            if not merged.get("poster_url") and other.get("poster_url"):
                merged["poster_url"] = other["poster_url"]
            if not merged.get("synopsis") and other.get("synopsis"):
                merged["synopsis"] = other["synopsis"]
            ep_dict[dedup_key] = merged
        else:
            if not r.get("minutes") and r.get("last_position_ms"):
                r["minutes"] = round(r["last_position_ms"] / 60000.0, 1)
            ep_dict[dedup_key] = r

    result = []
    for g in groups.values():
        eps_list = list(g["episodes_by_key"].values())
        result.append({
            "series": g["series"],
            "title_english": g.get("title_english"),
            "title_romaji": g.get("title_romaji"),
            "title_native": g.get("title_native"),
            "media_type": g["media_type"],
            "poster_url": g["poster_url"],
            "synopsis": g["synopsis"],
            "total_episodes": g.get("total_episodes"),
            "episodes": eps_list,
        })
    return result


def update_series_category(series_name: str, media_type: str, conn: Optional[sqlite3.Connection] = None) -> bool:
    """Update media_type classification for all episodes belonging to a series."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    try:
        with conn:
            conn.execute("UPDATE link_episode SET media_type = ? WHERE series = ?", (media_type, series_name))
        return True
    finally:
        if close_after:
            conn.close()


def _is_gap_token(tok: Dict[str, Any], learner_pri: int) -> bool:
    """Determine whether a token qualifies as an authentic vocabulary learning gap."""
    surface = (tok.get("surface") or "").strip()
    if not surface:
        return False

    pos_val = tok.get("pos", "")
    if isinstance(pos_val, (list, tuple)) and pos_val:
        pos_head = pos_val[0]
    elif isinstance(pos_val, str):
        pos_head = pos_val.split("-")[0].split(",")[0].strip()
    else:
        pos_head = ""

    CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞", "副詞"}
    EXCLUDED_POS = {"助詞", "助動詞", "補助記号", "記号", "接頭辞", "接尾辞", "連体詞", "感動詞", "フィラー", "空白"}
    if pos_head in EXCLUDED_POS or (pos_head and pos_head not in CONTENT_POS):
        return False

    # Filter out pure ASCII / Latin fragments
    has_jp = any('\u3040' <= ch <= '\u309f' or '\u30a0' <= ch <= '\u30ff' or '\u4e00' <= ch <= '\u9fff' for ch in surface)
    if not has_jp:
        return False

    # Filter out single-character kana fragments unless containing kanji
    has_kanji = any('\u4e00' <= ch <= '\u9fff' for ch in surface)
    if len(surface) <= 1 and not has_kanji:
        return False

    lemma = (tok.get("lemma") or surface).strip() or surface
    if surface in FUNCTION_WORDS or lemma in FUNCTION_WORDS or surface in ("ッ", "っ", "ー", "〜", "…", "・") or lemma in ("ッ", "っ", "ー", "〜", "…", "・"):
        return False

    # Check known, mined, ignored, blacklisted states
    word_state = tok.get("word_state", "unseen")
    if word_state in ("known", "mined", "ignored", "blacklisted"):
        return False
    if tok.get("known", False):
        return False
    if tok.get("status") in ("known", "mined", "ignored", "blacklisted"):
        return False

    # Level filter: words at or below learner level are assumed known unless marked unknown
    tok_level = tok.get("jlpt_level")
    if tok_level and tok_level != "Unranked":
        w_pri = _LEVEL_PRIORITY.get(tok_level.upper())
        if w_pri is not None and w_pri >= learner_pri and tok.get("status") != "unknown" and word_state != "unknown":
            return False

    return True


class EpisodeService:
    """Core domain logic for Episode Primer and Recap generation."""

    def __init__(self) -> None:
        self._dict_provider: Optional[LocalDictionaryProvider] = None
        self._grammar_service = GrammarService()
        self._jlpt_service = JlptReferenceService()

    def _get_dict_provider(self) -> LocalDictionaryProvider:
        if self._dict_provider is None:
            self._dict_provider = LocalDictionaryProvider()
        return self._dict_provider

    def lookup_gloss(self, word: str) -> Tuple[str, str]:
        """Lookup primary reading and gloss for a word using local dictionary."""
        if not word or not word.strip():
            return ("", "")
        clean_word = word.strip()
        try:
            from app.services.yomitan import get_dictionary_service
            from app.services.card_service import synthesize_default_meaning
            dict_svc = get_dictionary_service()
            if dict_svc.check_availability():
                ident = dict_svc.identify(clean_word)
                if ident:
                    enr = dict_svc.enrich(ident)
                    if enr and enr.entries:
                        first_entry = enr.entries[0]
                        reading = first_entry.reading or clean_word
                        meaning = synthesize_default_meaning(enr.entries, getattr(enr, "kanji_entries", None))
                        if not meaning and first_entry.senses and first_entry.senses[0].glosses:
                            meaning = ", ".join(first_entry.senses[0].glosses)
                        if meaning:
                            return (reading, meaning)
        except Exception as e:
            logger.debug("[EpisodeService] Dictionary lookup failed for %s: %s", clean_word, e)
        return (clean_word, "")

    def generate_primer(
        self,
        cues: Optional[List[Dict[str, Any]]] = None,
        cue_hash: Optional[str] = None,
        learner_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate Episode Primer:
        1. Top 20 gap words (frequency in episode x not known x level <= learner + 1).
        2. Top 5 grammar points.
        3. 5-question mini quiz built from those gap words.
        """
        level = (learner_level or get_learner_jlpt_level() or "N4").upper()
        learner_priority = _LEVEL_PRIORITY.get(level, 4)
        # level <= learner + 1: word difficulty at most 1 level higher than learner.
        # In priority: N5=5, N4=4, N3=3, N2=2, N1=1.
        # So minimum priority allowed is learner_priority - 1.
        min_allowed_priority = max(1, learner_priority - 1)

        annotated_cues: List[Dict[str, Any]] = []
        effective_hash = cue_hash or "adhoc"

        # Check if cues exist in link_analysis_service cache
        if cue_hash and not cues:
            cached = link_analysis_service.get_cues_range(cue_hash)
            if cached:
                annotated_cues = cached

        if not annotated_cues:
            raw_cues = cues or []
            annotator = get_subtitle_annotator_service(learner_level=level)
            for idx, c in enumerate(raw_cues):
                if "tokens" in c:
                    annotated_cues.append(c)
                else:
                    cue_dict = {
                        "id": c.get("i", idx),
                        "text": c.get("text", ""),
                        "start": c.get("s", 0.0),
                        "end": c.get("e", 0.0),
                    }
                    ann = annotator.annotate_cue(cue_dict, learner_level=level)
                    annotated_cues.append({
                        "i": cue_dict["id"],
                        "s": cue_dict["start"],
                        "e": cue_dict["end"],
                        "text": cue_dict["text"],
                        "tokens": ann.get("tokens", []),
                    })

        # Count frequencies of gap words
        word_counter: Counter[str] = Counter()
        word_info: Dict[str, Dict[str, Any]] = {}

        for cue in annotated_cues:
            for tok in cue.get("tokens", []):
                surface = tok.get("surface", "").strip()
                lemma = tok.get("lemma", surface).strip() or surface
                status = tok.get("status", "unstyled")
                pos = tok.get("pos", "")
                is_known = tok.get("known", False) or status in ("known", "mined")
                is_punct = pos in ("補助記号", "記号") or not surface or surface in FUNCTION_WORDS

                if is_punct or is_known:
                    continue

                # Determine JLPT level
                tok_level = tok.get("jlpt_level") or self._jlpt_service.lookup_word(lemma)
                if tok_level:
                    w_pri = _LEVEL_PRIORITY.get(tok_level.upper())
                    if w_pri is not None and w_pri < min_allowed_priority:
                        # Too advanced for learner + 1
                        continue

                word_counter[lemma] += 1
                if lemma not in word_info:
                    word_info[lemma] = {
                        "word": lemma,
                        "reading": tok.get("reading", "") or surface,
                        "level": tok_level,
                    }

        # Select top 20 gap words
        top_20_lemmas = [lemma for lemma, _ in word_counter.most_common(20)]
        gap_words_list: List[Dict[str, Any]] = []

        for lemma in top_20_lemmas:
            info = word_info[lemma]
            reading, gloss = self.lookup_gloss(lemma)
            gap_words_list.append({
                "word": lemma,
                "reading": info.get("reading") or reading,
                "meaning": gloss,
                "level": info.get("level"),
                "frequency": word_counter[lemma],
            })

        # Top 5 grammar points across cues
        grammar_counter: Counter[str] = Counter()
        grammar_info: Dict[str, Dict[str, Any]] = {}

        for cue in annotated_cues:
            cue_text = cue.get("text", "").strip()
            if not cue_text:
                continue
            try:
                g_res = self._grammar_service.analyze(cue_text, learner_level=level)
                points = g_res.get("points", []) if isinstance(g_res, dict) else (getattr(g_res, "points", []) or [])
                for pt in points:
                    pkey = pt.get("pattern_key") or pt.get("display", "")
                    if pkey:
                        grammar_counter[pkey] += 1
                        if pkey not in grammar_info:
                            grammar_info[pkey] = {
                                "pattern_key": pkey,
                                "display": pt.get("display", pkey),
                                "level": pt.get("level"),
                            }
            except Exception as exc:
                logger.debug("[EpisodeService] Grammar parse error: %s", exc)

        top_5_grammar = [pkey for pkey, _ in grammar_counter.most_common(5)]
        grammar_points_list: List[Dict[str, Any]] = []
        for pkey in top_5_grammar:
            gi = grammar_info[pkey]
            grammar_points_list.append({
                "pattern_key": gi["pattern_key"],
                "display": gi["display"],
                "level": gi.get("level"),
                "frequency": grammar_counter[pkey],
            })

        # 5-question mini quiz from gap words
        quiz_questions = self._build_mini_quiz(gap_words_list)

        return {
            "hash": effective_hash,
            "learner_level": level,
            "total_cues": len(annotated_cues),
            "gap_words": gap_words_list,
            "grammar_points": grammar_points_list,
            "quiz": quiz_questions,
        }

    def _build_mini_quiz(self, gap_words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Build 5 multiple choice questions from gap words using their dictionary glosses."""
        if not gap_words:
            return []

        # Target words: up to 5
        quiz_targets = gap_words[:5]
        all_meanings = [gw["meaning"] for gw in gap_words if gw.get("meaning")]
        if len(all_meanings) < 4:
            # Add sensible fallbacks to ensure 4 distinct options
            default_distractors = [
                "to understand thoroughly",
                "quiet evening breeze",
                "careful observation",
                "sudden realization",
            ]
            for d in default_distractors:
                if d not in all_meanings:
                    all_meanings.append(d)

        quiz: List[Dict[str, Any]] = []
        for q_idx, item in enumerate(quiz_targets, start=1):
            target_word = item["word"]
            target_reading = item.get("reading", "")
            correct_meaning = item.get("meaning", "")

            # Select 3 distractor meanings different from correct meaning
            other_meanings = [m for m in all_meanings if m != correct_meaning]
            if len(other_meanings) >= 3:
                distractors = random.sample(other_meanings, 3)
            else:
                distractors = other_meanings + [f"Meaning {i}" for i in range(1, 4 - len(other_meanings) + 1)]

            options = [correct_meaning] + distractors[:3]
            # Shuffle options deterministically based on word hash to maintain stable order
            seed = sum(ord(c) for c in target_word) + q_idx
            rnd = random.Random(seed)
            rnd.shuffle(options)
            correct_idx = options.index(correct_meaning)

            quiz.append({
                "id": q_idx,
                "word": target_word,
                "reading": target_reading,
                "prompt": f"What is the meaning of 「{target_word}」({target_reading})?",
                "options": options,
                "correct_index": correct_idx,
                "explanation": f"「{target_word}」({target_reading}) means: {correct_meaning}",
            })

        return quiz

    def generate_recap(
        self,
        cue_hash: str,
        cues: Optional[List[Dict[str, Any]]] = None,
        mined_words: Optional[List[str]] = None,
        minutes: float = 0.0,
        title: str = "",
        site: str = "",
        learner_level: Optional[str] = None,
        last_position_ms: int = 0,
    ) -> Dict[str, Any]:
        """
        Generate Post-Session Recap:
        - lines watched
        - % known (before/after mining)
        - words mined
        - gap words still unseen
        - "Review mined words" -> Study Practice deep link
        - Persist record to link_episode
        """
        mined_set = set(mined_words or [])
        level = (learner_level or get_learner_jlpt_level() or "N4").upper()

        annotated_cues: List[Dict[str, Any]] = []
        if cue_hash and not cues:
            cached = link_analysis_service.get_cues_range(cue_hash)
            if cached:
                annotated_cues = cached

        if not annotated_cues:
            raw_cues = cues or []
            annotator = get_subtitle_annotator_service(learner_level=level)
            for idx, c in enumerate(raw_cues):
                if "tokens" in c:
                    annotated_cues.append(c)
                else:
                    cue_dict = {
                        "id": c.get("i", idx),
                        "text": c.get("text", ""),
                        "start": c.get("s", 0.0),
                        "end": c.get("e", 0.0),
                    }
                    ann = annotator.annotate_cue(cue_dict, learner_level=level)
                    annotated_cues.append({
                        "i": cue_dict["id"],
                        "s": cue_dict["start"],
                        "e": cue_dict["end"],
                        "text": cue_dict["text"],
                        "tokens": ann.get("tokens", []),
                    })

        total_meaningful = 0
        known_before_count = 0
        known_after_count = 0
        all_gap_words: set[str] = set()

        for cue in annotated_cues:
            for tok in cue.get("tokens", []):
                surface = tok.get("surface", "").strip()
                lemma = tok.get("lemma", surface).strip() or surface
                status = tok.get("status", "unstyled")
                pos = tok.get("pos", "")
                is_punct = pos in ("補助記号", "記号") or not surface or surface in FUNCTION_WORDS
                if is_punct:
                    continue

                total_meaningful += 1
                is_known_before = tok.get("known", False) or status in ("known", "mined")
                if is_known_before:
                    known_before_count += 1
                    known_after_count += 1
                else:
                    all_gap_words.add(lemma)
                    if lemma in mined_set or surface in mined_set:
                        known_after_count += 1

        known_pct_before = (
            round((known_before_count / total_meaningful) * 100.0, 1)
            if total_meaningful > 0
            else 100.0
        )
        known_pct_after = (
            round((known_after_count / total_meaningful) * 100.0, 1)
            if total_meaningful > 0
            else 100.0
        )

        unseen_gaps = sorted(list(all_gap_words - mined_set))
        now_ts = datetime.now(timezone.utc).isoformat()

        # Persist per-episode record
        save_episode_record(
            hash_val=cue_hash,
            title=title or "Episode",
            site=site or "local",
            known_pct=known_pct_after,
            mined=len(mined_set),
            minutes=minutes,
            ts=now_ts,
            last_position_ms=last_position_ms,
        )

        return {
            "hash": cue_hash,
            "title": title or "Episode",
            "site": site or "local",
            "lines_watched": len(annotated_cues),
            "known_pct_before": known_pct_before,
            "known_pct_after": known_pct_after,
            "words_mined": sorted(list(mined_set)),
            "gap_words_unseen": unseen_gaps,
            "minutes": round(minutes, 1),
            "ts": now_ts,
            "review_link": "#/study?mode=practice&filter=mined",
        }

    def sync_episode_subtitles(
        self,
        cue_hash: str,
        title: str = "",
        series: Optional[str] = None,
        site: str = "generic",
        media_type: str = "anime",
        cues: Optional[List[Dict[str, Any]]] = None,
        duration_ms: Optional[int] = 0,
        mined_words: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Deduplicates, persists cues to SQLite episode_cues, and updates episode record.
        Warms background analysis cache so desktop can inspect with zero latency.
        """
        raw_cues = cues or []
        if raw_cues:
            save_episode_cues(cue_hash, raw_cues)
            # Submit to link_analysis_service for background annotation
            link_analysis_service.on_cue_list({"hash": cue_hash, "cues": raw_cues})

        # Check existing episode record
        existing = get_episode_record(cue_hash)
        resolved_title = title or (existing.get("title") if existing else "Episode")
        resolved_series = series or (existing.get("series") if existing else None) or extract_series_title(resolved_title)
        resolved_site = site or (existing.get("site") if existing else "generic")
        resolved_media_type = media_type or (existing.get("media_type") if existing else "anime")
        mined_count = len(mined_words) if mined_words else (existing.get("mined", 0) if existing else 0)

        existing_pos = existing.get("last_position_ms", 0) if existing else 0
        existing_dur = existing.get("duration_ms", 0) if existing else 0
        final_duration_ms = duration_ms if (duration_ms and duration_ms > 0) else existing_dur
        minutes = round(final_duration_ms / 60000.0, 1) if final_duration_ms > 0 else (existing.get("minutes", 0.0) if existing else 0.0)

        known_pct = existing.get("known_pct", 0.0) if existing else 0.0
        # If cues present and known_pct is 0, estimate known_pct from tokens if available
        if known_pct == 0.0 and raw_cues:
            total_tokens = 0
            known_tokens = 0
            for c in raw_cues:
                for t in c.get("tokens", []):
                    if t.get("pos") not in ("補助記号", "記号") and t.get("surface", "").strip():
                        total_tokens += 1
                        if t.get("known") or t.get("status") in ("known", "mined"):
                            known_tokens += 1
            if total_tokens > 0:
                known_pct = round((known_tokens / total_tokens) * 100.0, 1)

        rec = save_episode_record(
            hash_val=cue_hash,
            title=resolved_title,
            site=resolved_site,
            known_pct=known_pct,
            mined=mined_count,
            minutes=minutes,
            series=resolved_series,
            media_type=resolved_media_type,
            last_position_ms=existing_pos,
            duration_ms=final_duration_ms,
        )
        return rec

    def inspect_episode(
        self,
        cue_hash: str,
        learner_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Deep episode analytics for Kiroku Desktop Anime tab:
        - difficulty: overall level, N5-N1 percentages, unique word count
        - missed_words: words with status 'gap'/'should_know', frequency, dictionary definitions, JLPT badges
        - grammar_points: grammar points found in episode with occurrences and sample context sentences
        - mined_cards: cards mined from this series or episode
        """
        level = (learner_level or get_learner_jlpt_level() or "N4").upper()
        rec = get_episode_record(cue_hash)
        if not rec:
            rec = {
                "hash": cue_hash,
                "title": "Episode",
                "site": "generic",
                "known_pct": 0.0,
                "mined": 0,
                "minutes": 0.0,
                "ts": datetime.now(timezone.utc).isoformat(),
                "last_position_ms": 0,
                "series": "Unknown Series",
                "episode_key": None,
                "media_type": "anime",
                "poster_url": "",
                "synopsis": "",
            }

        # Retrieve cues: in-memory analysis cache -> sqlite episode_cues cache
        annotated_cues: List[Dict[str, Any]] = []
        cached_range = link_analysis_service.get_cues_range(cue_hash)
        if cached_range:
            annotated_cues = cached_range
        else:
            persisted_cues = get_episode_cues(cue_hash)
            if persisted_cues:
                annotator = get_subtitle_annotator_service(learner_level=level)
                for idx, c in enumerate(persisted_cues):
                    if "tokens" in c:
                        annotated_cues.append(c)
                    else:
                        c_dict = {
                            "id": c.get("i", idx),
                            "start": c.get("s", 0.0),
                            "end": c.get("e", 0.0),
                            "text": c.get("text", ""),
                        }
                        ann = annotator.annotate_cue(c_dict, learner_level=level)
                        annotated_cues.append({
                            "i": c_dict["id"],
                            "s": c_dict["start"],
                            "e": c_dict["end"],
                            "text": c_dict["text"],
                            "tokens": ann.get("tokens", []),
                        })

        # 1. JLPT Difficulty Analysis & Gap Word Identification
        level_counts: Counter[str] = Counter()
        all_lemmas: set[str] = set()
        gap_words_counter: Counter[str] = Counter()
        gap_word_meta: Dict[str, Dict[str, Any]] = {}

        learner_pri = _LEVEL_PRIORITY.get(level, 3)
        CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞", "副詞"}
        EXCLUDED_POS = {"助詞", "助動詞", "補助記号", "記号", "接頭辞", "接尾辞", "連体詞", "感動詞", "空白"}

        for cue in annotated_cues:
            for tok in cue.get("tokens", []):
                surface = tok.get("surface", "").strip()
                if not surface:
                    continue

                pos_val = tok.get("pos", "")
                if isinstance(pos_val, (list, tuple)) and pos_val:
                    pos_head = pos_val[0]
                elif isinstance(pos_val, str):
                    pos_head = pos_val.split("-")[0].split(",")[0].strip()
                else:
                    pos_head = ""

                if pos_head in EXCLUDED_POS or (pos_head and pos_head not in CONTENT_POS):
                    continue

                # Filter out pure ASCII / Latin fragments (e.g. 'n')
                has_jp = any('\u3040' <= ch <= '\u309f' or '\u30a0' <= ch <= '\u30ff' or '\u4e00' <= ch <= '\u9fff' for ch in surface)
                if not has_jp:
                    continue

                # Filter out single-character kana fragments (e.g. 'し', 'ん', 'だ', 'て') unless containing kanji (e.g. '絵', '手')
                has_kanji = any('\u4e00' <= ch <= '\u9fff' for ch in surface)
                if len(surface) <= 1 and not has_kanji:
                    continue

                lemma = (tok.get("lemma") or surface).strip() or surface
                if surface in FUNCTION_WORDS or lemma in FUNCTION_WORDS or surface in ("ッ", "っ", "ー", "〜", "…", "・") or lemma in ("ッ", "っ", "ー", "〜", "…", "・"):
                    continue

                all_lemmas.add(lemma)
                tok_level = tok.get("jlpt_level") or self._jlpt_service.lookup_word(lemma) or "Unranked"
                level_counts[tok_level] += 1

                # Gap word resolution using unified gap token validator
                if _is_gap_token(tok, learner_pri):
                    gap_words_counter[lemma] += 1
                    if lemma not in gap_word_meta:
                        reading = tok.get("reading") or tok.get("canonical_reading") or ""
                        meaning = tok.get("meaning") or tok.get("gloss") or ""
                        if not reading or not meaning or "septillion" in meaning or "object at 0x" in meaning:
                            r, m = self.lookup_gloss(lemma)
                            reading = reading or r
                            meaning = m if (not meaning or "septillion" in meaning or "object at 0x" in meaning) else meaning
                        gap_word_meta[lemma] = {
                            "word": lemma,
                            "reading": reading,
                            "meaning": meaning,
                            "jlpt": tok_level,
                            "is_known": False,
                        }

        total_counted = sum(level_counts.values()) or 1
        n5_pct = round((level_counts.get("N5", 0) / total_counted) * 100.0, 1)
        n4_pct = round((level_counts.get("N4", 0) / total_counted) * 100.0, 1)
        n3_pct = round((level_counts.get("N3", 0) / total_counted) * 100.0, 1)
        n2_pct = round((level_counts.get("N2", 0) / total_counted) * 100.0, 1)
        n1_pct = round((level_counts.get("N1", 0) / total_counted) * 100.0, 1)
        unranked_pct = round((level_counts.get("Unranked", 0) / total_counted) * 100.0, 1)

        jlpt_ranks = ["N5", "N4", "N3", "N2", "N1"]
        ranked_counts = {k: level_counts.get(k, 0) for k in jlpt_ranks}
        if sum(ranked_counts.values()) > 0:
            overall_level = max(ranked_counts.items(), key=lambda x: x[1])[0]
        else:
            overall_level = "N4"

        difficulty = {
            "overall_level": overall_level,
            "n5_pct": n5_pct,
            "n4_pct": n4_pct,
            "n3_pct": n3_pct,
            "n2_pct": n2_pct,
            "n1_pct": n1_pct,
            "unranked_pct": unranked_pct,
            "unique_words_count": len(all_lemmas),
        }

        # 2. Missed Words List (sorted by frequency desc)
        missed_words: List[Dict[str, Any]] = []
        for lemma, freq in gap_words_counter.most_common(30):
            item = dict(gap_word_meta[lemma])
            item["frequency"] = freq
            missed_words.append(item)

        # 3. Grammar Points in Episode (cached per episode hash and level to avoid 1500 sync calls)
        cache_key = f"{cue_hash}_{level}"
        if hasattr(self, "_grammar_points_cache") and cache_key in self._grammar_points_cache:
            grammar_points = self._grammar_points_cache[cache_key]
        else:
            grammar_counter: Counter[str] = Counter()
            grammar_meta: Dict[str, Dict[str, Any]] = {}
            for cue in annotated_cues:
                cue_text = cue.get("text", "").strip()
                if not cue_text:
                    continue
                try:
                    g_res = self._grammar_service.analyze(cue_text, learner_level=level)
                    points = g_res.get("points", []) if isinstance(g_res, dict) else (getattr(g_res, "points", []) or [])
                    for pt in points:
                        pkey = pt.get("grammar_id") or pt.get("display") or pt.get("pattern_key", "")
                        if not pkey:
                            continue
                        grammar_counter[pkey] += 1
                        if pkey not in grammar_meta:
                            grammar_meta[pkey] = {
                                "point": pt.get("pattern_display") or pt.get("display") or pt.get("grammar_id") or pkey,
                                "grammar_id": pkey,
                                "jlpt": pt.get("jlpt") or pt.get("level") or "N4",
                                "meaning": pt.get("meaning_short") or pt.get("meaning") or pt.get("english_breakdown") or "",
                                "formation": pt.get("formation") or "",
                                "example_sentence": cue_text,
                            }
                except Exception:
                    pass

            grammar_points = []
            for pkey, count in grammar_counter.most_common(20):
                gm = dict(grammar_meta[pkey])
                gm["occurrences"] = count
                grammar_points.append(gm)

            if not hasattr(self, "_grammar_points_cache"):
                self._grammar_points_cache = {}
            if len(self._grammar_points_cache) > 20:
                self._grammar_points_cache.clear()
            self._grammar_points_cache[cache_key] = grammar_points

        # 4. Mined cards
        from app.repositories.card_repository import CardRepository
        repo = CardRepository()
        mined_cards: List[Dict[str, Any]] = []
        series_name = rec.get("series") or ""
        s_norm = series_name.strip().lower()
        all_cards = repo.list_cards(limit=200)
        for c in all_cards:
            tags = (c.tags or "").lower()
            source_url = (c.source_url or "").lower()
            notes = (c.notes or "").lower()
            if (s_norm and (s_norm in tags or s_norm in source_url or s_norm in notes)) or cue_hash.lower() in tags or cue_hash.lower() in source_url:
                mined_cards.append({
                    "id": c.id,
                    "expression": c.expression,
                    "reading": c.reading,
                    "meaning": c.meaning,
                    "image": c.image,
                    "audio": c.audio,
                    "example_sentence": c.example_sentence,
                })

        return {
            "episode_record": rec,
            "difficulty": difficulty,
            "missed_words": missed_words,
            "grammar_points": grammar_points,
            "mined_cards": mined_cards,
        }


# Global singleton
episode_service = EpisodeService()

