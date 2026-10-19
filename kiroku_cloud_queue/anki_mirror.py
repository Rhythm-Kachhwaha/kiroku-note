"""
anki_mirror.py -- Mirror Anki Desktop cards and reviews to Kiroku Cloud Queue.

Architecture role:
  - Runs on the local PC inside the Kiroku worker loop or local backend poll cycle.
  - Interfaces with Anki Desktop via loopback AnkiConnect (127.0.0.1:8765).
  - Pure computation routines (clean_field, map_fields, classify_state, compute_difficulty, build_daily_series)
    are strictly separated from network I/O for unit testability without Anki.
  - Incrementally detects modified cards and new reviews; periodically runs full reconcile.
  - Pushes lean cleaned card rows and daily aggregated metrics to cloud storage (SQLite/Postgres).
  - Thread-safe and non-blocking: all blocking AnkiConnect HTTP requests run in asyncio.to_thread.
  - Fail-soft: if Anki is offline or calls fail, logs debug info, leaves state intact, and never crashes.
"""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import html
import json
import logging
import os
from pathlib import Path
import re
import sys
import tempfile
from typing import Any, Callable, Optional
import urllib.error
import urllib.request

log = logging.getLogger("kiroku_anki_mirror")

# ---------------------------------------------------------------------------
# Constants & Configuration
# ---------------------------------------------------------------------------
ANKI_DAY_ROLLOVER_HOUR = int(os.getenv("ANKI_DAY_ROLLOVER_HOUR", "4"))

def _resolve_default_state_file_path() -> Path:
    custom = os.getenv("MIRROR_STATE_PATH")
    if custom and custom.strip():
        return Path(custom.strip())
    if getattr(sys, "frozen", False):
        local_appdata = os.getenv("LOCALAPPDATA")
        base = Path(local_appdata) / "KirokuNote" if local_appdata else Path.home() / "AppData" / "Local" / "KirokuNote"
        base.mkdir(parents=True, exist_ok=True)
        return base / ".mirror_state.json"
    return Path(__file__).parent / ".mirror_state.json"

STATE_FILE_PATH = _resolve_default_state_file_path()

DIFFICULTY_CONSTANTS = {
    "W_LAPSE": 40.0,
    "W_AGAIN": 35.0,
    "W_TIME": 10.0,
    "W_INTERVAL": 15.0,
    "MAX_LAPSES": 6.0,
    "MAX_INTERVAL_DAYS": 90.0,
    "MAX_ANSWER_TIME_MS": 60000.0,
    "TIME_MEDIAN_FACTOR": 2.0,
    "LEECH_LAPSE_THRESHOLD": 8,
    "HARD_THRESHOLD": 60.0,
    "NORMAL_THRESHOLD": 30.0,
    "EASY_THRESHOLD": 10.0,
    "MATURE_INTERVAL_DAYS": 21,
}

FIELD_CANDIDATES = {
    "expression": ["expression", "word", "vocab", "front", "term", "kanji", "japanese", "keyword"],
    "reading": ["reading", "kana", "furigana", "pronunciation", "hiragana"],
    "meaning": ["meaning", "definition", "glossary", "back", "english", "translation"],
    "sentence": ["sentence", "examplesentence", "example", "context", "sentences", "sample"],
    "sentence_meaning": ["sentencemeaning", "sentencetranslation", "exampletranslation", "translation", "sentencesmeaning"],
}

# Module-level sync lock to prevent overlapping runs
_SYNC_LOCK = asyncio.Lock()


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------
@dataclass
class MirrorResult:
    status: str  # "ok", "offline", "locked", "error"
    mode: str = "incremental"  # "incremental" or "full"
    cards_seen: int = 0
    cards_changed: int = 0
    cards_pushed: int = 0
    daily_rows_pushed: int = 0
    deleted_on_reconcile: int = 0
    duration_s: float = 0.0
    message: str = ""


# ---------------------------------------------------------------------------
# Pure Computation Functions
# ---------------------------------------------------------------------------

def clean_field(val: Any, max_len: Optional[int] = None, strip_ruby_brackets: bool = False) -> str:
    """
    Clean raw Anki field markup into normalized plain text:
      - Strip [sound:...] tags
      - Convert <br>/<div>/<p> to newlines
      - Strip all other HTML tags
      - Decode HTML entities (&nbsp;, &amp;, etc.)
      - Optionally strip furigana brackets 漢字[かんじ] -> 漢字
      - Normalize whitespace and collapse excessive newlines
      - Enforce optional max length cap
    """
    if val is None:
        return ""
    text = str(val)

    # 1. Strip [sound:filename.mp3]
    text = re.sub(r"\[sound:[^\]]*\]", "", text, flags=re.IGNORECASE)

    # 2. Strip <style>...</style> and <script>...</script> blocks
    text = re.sub(r"(?is)<style.*?</style>", "", text)
    text = re.sub(r"(?is)<script.*?</script>", "", text)

    # 2b. Strip <rt>...</rt> and <rp>...</rp> furigana annotations when converting to plain text
    text = re.sub(r"(?is)<(rt|rp).*?</\1>", "", text)

    # 3. Convert line break and block tags to newlines
    text = re.sub(r"(?i)<(br\s*/?|/?div|/?p)>", "\n", text)

    # 4. Strip all remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # 4. Decode HTML entities and replace non-breaking spaces
    text = html.unescape(text)
    text = text.replace("\xa0", " ").replace("\u3000", " ")

    # 5. Optionally strip furigana markup brackets (e.g. 漢字[かんじ] -> 漢字)
    if strip_ruby_brackets:
        text = re.sub(r"(?<=[\u4e00-\u9fff])\[[^\]]+\]", "", text)
        text = re.sub(r" ?\[[^\]]+\]", "", text)

    # 6. Normalize horizontal whitespace
    text = re.sub(r"[ \t]+", " ", text)

    # 7. Collapse excessive newlines and trim
    lines = [line.strip() for line in text.split("\n")]
    cleaned = "\n".join(line for line in lines if line)

    # 8. Length cap
    if max_len is not None and len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()

    return cleaned


def extract_rich_card_html(raw_fields: dict[str, Any]) -> str:
    """
    Extract sanitized rich HTML from Anki note fields:
      - Searches for candidate fields: Back, back, Meaning, meaning, content, or any field with kn-card
      - Strips dangerous script/iframe/object/embed/form elements
      - Strips style tags (relying on scoped dashboard CSS)
      - Strips [sound:...] audio tags
      - Strips dangerous attributes (on*, javascript: hrefs)
      - Preserves ruby, rt, rp, kanji-card, pitch, badges, and example sentences
    """
    if not isinstance(raw_fields, dict):
        return ""

    raw_html_candidate: str = ""

    # 1. First priority: look for a field that contains '<div class="kn-card'
    for _, field_data in raw_fields.items():
        val = field_data.get("value", "") if isinstance(field_data, dict) else str(field_data or "")
        if "kn-card" in val:
            raw_html_candidate = val
            break

    # 2. Second priority: look in standard Back/Meaning fields for HTML markup
    if not raw_html_candidate:
        for cand in ["back", "meaning", "definition", "glossary", "card", "content", "front"]:
            for original_name, field_data in raw_fields.items():
                clean_name = re.sub(r"[_\-\s]+", "", original_name).lower()
                if clean_name == cand:
                    val = field_data.get("value", "") if isinstance(field_data, dict) else str(field_data or "")
                    if "<" in val and ">" in val:
                        raw_html_candidate = val
                        break
            if raw_html_candidate:
                break

    if not raw_html_candidate or not ("<" in raw_html_candidate and ">" in raw_html_candidate):
        return ""

    text = raw_html_candidate

    # 3. Strip [sound:filename.mp3]
    text = re.sub(r"\[sound:[^\]]*\]", "", text, flags=re.IGNORECASE)

    # 4. Strip <style>...</style> and <script>...</script>
    text = re.sub(r"(?is)<style.*?</style>", "", text)
    text = re.sub(r"(?is)<script.*?</script>", "", text)

    # 5. Strip dangerous tags
    text = re.sub(r"(?is)<(iframe|object|embed|form|input|button|link|meta)[^>]*>.*?</\1>", "", text)
    text = re.sub(r"(?is)<(iframe|object|embed|form|input|button|link|meta)[^>]*>", "", text)

    # 6. Strip inline event handlers
    text = re.sub(r"""(?i)\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)""", "", text)

    # 7. Strip javascript: URLs
    text = re.sub(r"""(?i)(href|src)\s*=\s*['"]\s*javascript:[^'"]*['"]""", "", text)

    # 8. Clean comments
    text = re.sub(r"(?s)<!--.*?-->", "", text)

    cleaned = text.strip()
    return cleaned


def extract_image_filenames(raw_fields: dict[str, Any]) -> list[str]:
    """
    Extract local image filenames referenced in <img src="..."> across card fields.
    Excludes http://, https://, and data: URIs.
    """
    if not isinstance(raw_fields, dict):
        return []

    filenames: list[str] = []
    seen: set[str] = set()

    for _, field_data in raw_fields.items():
        val = field_data.get("value", "") if isinstance(field_data, dict) else str(field_data or "")
        if not val or "<img" not in val.lower():
            continue

        matches = re.findall(r"""<img[^>]+src=['"]([^'"]+)['"]""", val, flags=re.IGNORECASE)
        for src in matches:
            clean_src = src.strip()
            if not clean_src:
                continue
            lower_src = clean_src.lower()
            if lower_src.startswith(("http://", "https://", "data:")):
                continue
            if clean_src not in seen:
                seen.add(clean_src)
                filenames.append(clean_src)

    return filenames


def compress_image_webp(image_bytes: bytes, max_dim: int = 800, quality: int = 75) -> bytes:
    """
    Compress image bytes to lightweight WebP format (max max_dim width/height, default 800px, quality 75).
    """
    if not image_bytes:
        return b""

    try:
        from PIL import Image
        import io

        with Image.open(io.BytesIO(image_bytes)) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")

            if img.width > max_dim or img.height > max_dim:
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

            out_buf = io.BytesIO()
            img.save(out_buf, format="WEBP", quality=quality, method=4)
            return out_buf.getvalue()
    except Exception as exc:
        log.warning("Image compression to WebP failed: %s; returning original", exc)
        return image_bytes


def map_fields(raw_fields: dict[str, Any]) -> dict[str, str]:
    """
    Generic case-insensitive, separator-insensitive field mapping from Anki note fields
    to canonical (expression, reading, meaning, sentence, sentence_meaning).
    """
    if not isinstance(raw_fields, dict):
        return {
            "expression": "",
            "reading": "",
            "meaning": "",
            "sentence": "",
            "sentence_meaning": "",
        }

    # Normalize available field names: remove underscores, hyphens, spaces, and lowercase
    norm_available: dict[str, str] = {}
    first_field_val: Optional[str] = None
    kn_card_val: Optional[str] = None

    for original_name, field_data in raw_fields.items():
        val = field_data.get("value", "") if isinstance(field_data, dict) else str(field_data or "")
        clean_name = re.sub(r"[_\-\s]+", "", original_name).lower()
        norm_available[clean_name] = val
        if first_field_val is None:
            first_field_val = val
        if "kn-card" in val:
            kn_card_val = val

    result: dict[str, str] = {
        "expression": "",
        "reading": "",
        "meaning": "",
        "sentence": "",
        "sentence_meaning": "",
    }

    # If this note contains a kn-card structure, extract structured subfields
    if kn_card_val:
        # Reading: look for kn-kana
        kana_m = re.search(r'<span class="kn-kana"[^>]*>(.*?)</span>', kn_card_val, flags=re.DOTALL | re.IGNORECASE)
        if kana_m:
            result["reading"] = clean_field(kana_m.group(1), max_len=200)

        # Meaning: look for kn-meaning or kn-meanings
        meaning_m = re.search(r'<div class="kn-meaning"[^>]*>(.*?)</div>', kn_card_val, flags=re.DOTALL | re.IGNORECASE)
        if not meaning_m:
            meaning_m = re.search(r'<ul class="kn-meanings"[^>]*>(.*?)</ul>', kn_card_val, flags=re.DOTALL | re.IGNORECASE)
        if meaning_m:
            result["meaning"] = clean_field(meaning_m.group(1), max_len=500)

        # Sentence: look for kn-example-ja
        sent_ja_m = re.search(r'<p class="kn-example-ja"[^>]*>(.*?)</p>', kn_card_val, flags=re.DOTALL | re.IGNORECASE)
        if sent_ja_m:
            result["sentence"] = clean_field(sent_ja_m.group(1), max_len=400, strip_ruby_brackets=True)

        # Sentence meaning: look for kn-example-en
        sent_en_m = re.search(r'<p class="kn-example-en"[^>]*>(.*?)</p>', kn_card_val, flags=re.DOTALL | re.IGNORECASE)
        if sent_en_m:
            result["sentence_meaning"] = clean_field(sent_en_m.group(1), max_len=400)

    # For any fields not yet extracted, check candidates
    for target, candidates in FIELD_CANDIDATES.items():
        if result[target]:
            continue
        matched_val: Optional[str] = None
        for cand in candidates:
            norm_cand = re.sub(r"[_\-\s]+", "", cand).lower()
            if norm_cand in norm_available:
                matched_val = norm_available[norm_cand]
                break
        max_length = 400 if "sentence" in target else (500 if target == "meaning" else 200)
        is_expr = (target == "expression")
        result[target] = clean_field(matched_val, max_len=max_length, strip_ruby_brackets=is_expr) if matched_val is not None else ""

    # Fallback: if expression is empty, use first field
    if not result["expression"] and first_field_val:
        result["expression"] = clean_field(first_field_val, max_len=200, strip_ruby_brackets=True)

    return result


def classify_state(card_info: dict[str, Any]) -> str:
    """
    Classify card study state.
    Precedence: suspended (-1) and buried (-2, -3) override review states.
    Otherwise: 0 -> new, 1 -> learning, 2 -> young/mature (interval >= 21), 3 -> relearning.
    """
    queue_code = int(card_info.get("queue", 0))
    if queue_code == -1:
        return "suspended"
    if queue_code in (-2, -3):
        return "buried"

    card_type = int(card_info.get("type", 0))
    if card_type == 0:
        return "new"
    if card_type == 1:
        return "learning"
    if card_type == 2:
        interval_days = int(card_info.get("interval", 0))
        return "mature" if interval_days >= DIFFICULTY_CONSTANTS["MATURE_INTERVAL_DAYS"] else "young"
    if card_type == 3:
        return "relearning"

    return "new"


def compute_difficulty(
    card_info: dict[str, Any],
    reviews_10: list[dict[str, Any]],
    median_time_ms: float = 3000.0,
) -> tuple[Optional[float], str]:
    """
    Compute FSRS-aware difficulty score (0..100) and difficulty label:
      - New cards (reps == 0): score=None, label="new"
      - Monotonic weighted sum of:
          * lapse pressure (weight 0.40)
          * recent again-rate with newest reviews weighted heavier (weight 0.35)
          * answer-time pressure vs collection median (weight 0.10)
          * low-interval pressure (weight 0.15)
          * Optional 50/50 blend with real FSRS difficulty if provided
      - Labels:
          * leech: is_leech only (tag:leech or lapses >= 8)
          * hard: score >= 60 without is_leech
          * normal: 30..59
          * easy: 10..29
          * solid: score < 10 and interval >= 21
          * new: reps == 0
    """
    reps = int(card_info.get("reps", 0))
    if reps == 0:
        return None, "new"

    lapses = max(0, int(card_info.get("lapses", 0)))
    interval_days = max(0, int(card_info.get("interval", 0)))
    is_leech_flag = bool(card_info.get("is_leech") or lapses >= DIFFICULTY_CONSTANTS["LEECH_LAPSE_THRESHOLD"])

    # 1. Lapse pressure
    w_lapse = DIFFICULTY_CONSTANTS["W_LAPSE"]
    lapse_ratio = min(1.0, lapses / DIFFICULTY_CONSTANTS["MAX_LAPSES"])
    lapse_score = lapse_ratio * w_lapse

    # 2. Recent again-rate (up to 10 reviews; filter real review types 0, 1, 2)
    w_again = DIFFICULTY_CONSTANTS["W_AGAIN"]
    valid_revs = [r for r in reviews_10 if int(r.get("type", 0)) in (0, 1, 2)]
    if valid_revs:
        # Give higher weight to newest reviews (last in list)
        weights = [1.0 + 0.1 * i for i in range(len(valid_revs))]
        total_w = sum(weights)
        again_w_sum = sum(weights[i] for i, r in enumerate(valid_revs) if int(r.get("ease", 0)) == 1)
        again_rate = again_w_sum / total_w
    else:
        again_rate = 0.0
    again_score = again_rate * w_again

    # 3. Answer-time pressure
    w_time = DIFFICULTY_CONSTANTS["W_TIME"]
    if valid_revs:
        times = [min(float(r.get("time", 0)), DIFFICULTY_CONSTANTS["MAX_ANSWER_TIME_MS"]) for r in valid_revs]
        avg_time = sum(times) / len(times)
        target_med = max(500.0, median_time_ms * DIFFICULTY_CONSTANTS["TIME_MEDIAN_FACTOR"])
        time_ratio = min(1.0, avg_time / target_med)
    else:
        time_ratio = 0.0
    time_score = time_ratio * w_time

    # 4. Low-interval pressure
    w_interval = DIFFICULTY_CONSTANTS["W_INTERVAL"]
    interval_ratio = 1.0 - min(1.0, interval_days / DIFFICULTY_CONSTANTS["MAX_INTERVAL_DAYS"])
    interval_score = interval_ratio * w_interval

    raw_score = lapse_score + again_score + time_score + interval_score
    raw_score = max(0.0, min(100.0, raw_score))

    # Blend with FSRS difficulty if present
    fsrs_d = card_info.get("fsrs_difficulty")
    if fsrs_d is not None:
        try:
            fd_val = float(fsrs_d)
            if fd_val > 1.0:
                normalized_fsrs = (fd_val - 1.0) / 9.0 * 100.0
            else:
                normalized_fsrs = fd_val * 100.0
            raw_score = 0.5 * raw_score + 0.5 * max(0.0, min(100.0, normalized_fsrs))
        except (ValueError, TypeError):
            pass

    score = round(raw_score, 1)

    # Assign difficulty label
    if is_leech_flag:
        label = "leech"
    elif score >= DIFFICULTY_CONSTANTS["HARD_THRESHOLD"]:
        label = "hard"
    elif score >= DIFFICULTY_CONSTANTS["NORMAL_THRESHOLD"]:
        label = "normal"
    elif score >= DIFFICULTY_CONSTANTS["EASY_THRESHOLD"]:
        label = "easy"
    elif interval_days >= DIFFICULTY_CONSTANTS["MATURE_INTERVAL_DAYS"]:
        label = "solid"
    else:
        label = "easy"

    return score, label


def extract_jlpt_level(tags: Optional[list[str]] = None, deck_name: Optional[str] = None) -> Optional[str]:
    """
    Extract JLPT level (N1..N5) from note tags or deck name.
    Matches formats like N1..N5, JLPT_N1..JLPT_N5, JLPT-N1..JLPT-N5, JLPT1..JLPT5.
    Tags are checked first, then deck_name. Returns standard uppercase string 'N1'..'N5', or None.
    """
    if tags:
        for tag in tags:
            if not tag:
                continue
            m = re.search(r"(?i)(?:^|[\s_:\-/])(?:jlpt[_\s:\-/]*)?(n[1-5])(?:$|[\s_:\-/])", tag)
            if m:
                return m.group(1).upper()
            m2 = re.search(r"(?i)\bjlpt[_\s:\-/]*([1-5])\b", tag)
            if m2:
                return f"N{m2.group(1)}"

    if deck_name:
        m = re.search(r"(?i)(?:^|[\s_:\-/])(?:jlpt[_\s:\-/]*)?(n[1-5])(?:$|[\s_:\-/])", deck_name)
        if m:
            return m.group(1).upper()
        m2 = re.search(r"(?i)\bjlpt[_\s:\-/]*([1-5])\b", deck_name)
        if m2:
            return f"N{m2.group(1)}"

    return None


def compute_due_days(card_id: int, due_horizon_map: dict[int, int]) -> Optional[int]:
    """Retrieve due days relative to today from due_horizon_map, or None if outside horizon."""
    return due_horizon_map.get(card_id)


def build_daily_series(
    cards: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    rollover_hour: int = ANKI_DAY_ROLLOVER_HOUR,
) -> list[dict[str, Any]]:
    """
    Build cumulative and daily activity series (anki_daily) from raw reviews and cards:
      - Respects Anki day rollover (default 4 am)
      - Review types 0, 1, 2 count as reviews; types 3 and 4 are ignored for retention
      - Mature reviews: lastIvl >= 21
      - Historical card state counts (new, learning, young, mature, suspended) reconstructed by date
    """
    if not cards and not reviews:
        return []

    def _to_day_str(ms: int) -> str:
        dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
        adj_dt = dt - timedelta(hours=rollover_hour)
        return adj_dt.strftime("%Y-%m-%d")

    # 1. Bucket card creation dates
    card_birth_map: dict[str, int] = {}
    for c in cards:
        c_id = int(c.get("card_id", 0))
        if c_id > 0:
            d_str = _to_day_str(c_id)
            card_birth_map[d_str] = card_birth_map.get(d_str, 0) + 1

    # 2. Bucket reviews
    # Group reviews by day and per-card latest state at end of day
    day_reviews: dict[str, dict[str, Any]] = {}
    # Track latest review per card: card_id -> (timestamp_ms, ivl, type, ease)
    card_latest: dict[int, tuple[int, int, int, int]] = {}

    # Sort reviews chronologically
    sorted_revs = sorted(reviews, key=lambda r: int(r.get("id", 0)))

    for r in sorted_revs:
        r_id = int(r.get("id", 0))
        if r_id <= 0:
            continue
        day_str = _to_day_str(r_id)
        d_entry = day_reviews.setdefault(day_str, {
            "day": day_str,
            "reviews": 0,
            "again": 0,
            "hard": 0,
            "good": 0,
            "easy": 0,
            "time_ms": 0,
            "true_retention_num": 0,
            "true_retention_den": 0,
            "mature_retention_num": 0,
            "mature_retention_den": 0,
        })

        d_entry["reviews"] += 1
        ease = int(r.get("ease", 0))
        if ease == 1:
            d_entry["again"] += 1
        elif ease == 2:
            d_entry["hard"] += 1
        elif ease == 3:
            d_entry["good"] += 1
        elif ease == 4:
            d_entry["easy"] += 1

        d_entry["time_ms"] += max(0, int(r.get("time", 0)))

        # Retention math: type == 1 only
        r_type = int(r.get("type", 0))
        if r_type == 1:
            d_entry["true_retention_den"] += 1
            if ease >= 2:
                d_entry["true_retention_num"] += 1

            last_ivl = int(r.get("lastIvl", 0))
            if last_ivl >= 21:
                d_entry["mature_retention_den"] += 1
                if ease >= 2:
                    d_entry["mature_retention_num"] += 1

    # 3. Determine contiguous range of days from first card / review to today
    all_dates = set(card_birth_map.keys()) | set(day_reviews.keys())
    if not all_dates:
        return []

    min_date_str = min(all_dates)
    now_dt = datetime.now(timezone.utc) - timedelta(hours=rollover_hour)
    today_str = now_dt.strftime("%Y-%m-%d")
    max_date_str = max(max(all_dates), today_str)

    cur_dt = datetime.strptime(min_date_str, "%Y-%m-%d").date()
    end_dt = datetime.strptime(max_date_str, "%Y-%m-%d").date()

    # Pre-index reviews by day
    revs_by_day: dict[str, list[dict[str, Any]]] = {}
    for r in sorted_revs:
        r_id = int(r.get("id", 0))
        if r_id > 0:
            d_s = _to_day_str(r_id)
            revs_by_day.setdefault(d_s, []).append(r)

    # Pre-index card creation dates
    card_created_day: dict[int, str] = {
        int(c["card_id"]): _to_day_str(int(c["card_id"]))
        for c in cards if int(c.get("card_id", 0)) > 0
    }

    daily_series: list[dict[str, Any]] = []
    cumulative_cards = 0

    # Map of card_id -> state
    active_cards: dict[int, str] = {}

    while cur_dt <= end_dt:
        d_str = cur_dt.strftime("%Y-%m-%d")

        # 1. Add cards created on this day
        new_added = card_birth_map.get(d_str, 0)
        cumulative_cards += new_added

        for cid, b_day in card_created_day.items():
            if b_day == d_str:
                active_cards[cid] = "new"

        # 2. Apply reviews that happened on this day
        if d_str in revs_by_day:
            for r in revs_by_day[d_str]:
                cid = int(r.get("cardId", 0) or r.get("card_id", 0))
                ivl = int(r.get("ivl", 0))
                rtype = int(r.get("type", 0))

                if rtype == 3:
                    # Filtered / cram reviews do not change card lifecycle state
                    continue

                if ivl >= 21:
                    active_cards[cid] = "mature"
                elif ivl > 0:
                    active_cards[cid] = "young"
                else:  # ivl < 0 (seconds/learning steps) or relearn
                    active_cards[cid] = "learning"

        # Count state distribution as of end of this day
        n_new = sum(1 for s in active_cards.values() if s == "new")
        n_learning = sum(1 for s in active_cards.values() if s == "learning")
        n_young = sum(1 for s in active_cards.values() if s == "young")
        n_mature = sum(1 for s in active_cards.values() if s == "mature")
        n_suspended = 0

        d_metrics = day_reviews.get(d_str, {
            "reviews": 0,
            "again": 0,
            "hard": 0,
            "good": 0,
            "easy": 0,
            "time_ms": 0,
            "true_retention_num": 0,
            "true_retention_den": 0,
            "mature_retention_num": 0,
            "mature_retention_den": 0,
        })

        daily_series.append({
            "day": d_str,
            "reviews": d_metrics["reviews"],
            "again": d_metrics["again"],
            "hard": d_metrics["hard"],
            "good": d_metrics["good"],
            "easy": d_metrics["easy"],
            "time_ms": d_metrics["time_ms"],
            "true_retention_num": d_metrics["true_retention_num"],
            "true_retention_den": d_metrics["true_retention_den"],
            "mature_retention_num": d_metrics["mature_retention_num"],
            "mature_retention_den": d_metrics["mature_retention_den"],
            "new_cards_added": new_added,
            "total_cards": cumulative_cards,
            "n_new": n_new,
            "n_learning": n_learning,
            "n_young": n_young,
            "n_mature": n_mature,
            "n_suspended": n_suspended,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        })

        cur_dt += timedelta(days=1)

    return daily_series


# ---------------------------------------------------------------------------
# AnkiClient Transport & Read-Only Whitelist
# ---------------------------------------------------------------------------

ANKI_READ_ACTIONS_WHITELIST: frozenset[str] = frozenset({
    "version",
    "deckNames",
    "findCards",
    "cardsInfo",
    "notesInfo",
    "cardsModTime",
    "getReviewsOfCards",
    "cardReviews",
    "getLatestReviewID",
    "getNumCardsReviewedByDay",
    "getNumCardsReviewedToday",
    "getDeckStats",
    "getActiveProfile",
    "getProfileNames",
    "retrieveMediaFile",
})


class AnkiClient:
    """Thin, synchronous loopback client for AnkiConnect with injectable transport for tests."""

    def __init__(
        self,
        endpoint: str = "http://127.0.0.1:8765",
        timeout_seconds: float = 30.0,
        transport: Optional[Callable[[str, dict[str, Any]], Any]] = None,
    ):
        self.endpoint = endpoint
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    def invoke(self, action: str, **params: Any) -> Any:
        if action not in ANKI_READ_ACTIONS_WHITELIST:
            raise PermissionError(
                f"Forbidden AnkiConnect action '{action}'. "
                f"The mirror is strictly read-only and restricted to: {sorted(ANKI_READ_ACTIONS_WHITELIST)}"
            )

        if self._transport is not None:
            return self._transport(action, params)

        req_payload = {"action": action, "version": 6, "params": params}
        data = json.dumps(req_payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Origin": "http://localhost",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("error"):
                raise ValueError(f"AnkiConnect error on '{action}': {body['error']}")
            return body.get("result")

    def get_cards_info_batched(self, card_ids: list[int], chunk_size: int = 500) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for i in range(0, len(card_ids), chunk_size):
            chunk = card_ids[i : i + chunk_size]
            info = self.invoke("cardsInfo", cards=chunk) or []
            results.extend(info)
        return results

    def get_notes_info_batched(self, note_ids: list[int], chunk_size: int = 500) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for i in range(0, len(note_ids), chunk_size):
            chunk = note_ids[i : i + chunk_size]
            info = self.invoke("notesInfo", notes=chunk) or []
            results.extend(info)
        return results

    def get_reviews_of_cards_batched(self, card_ids: list[int], chunk_size: int = 500) -> dict[int, list[dict[str, Any]]]:
        all_revs: dict[int, list[dict[str, Any]]] = {}
        for i in range(0, len(card_ids), chunk_size):
            chunk = card_ids[i : i + chunk_size]
            try:
                chunk_res = self.invoke("getReviewsOfCards", cards=chunk) or {}
                for k, v in chunk_res.items():
                    all_revs[int(k)] = v
            except Exception as exc:
                log.warning("getReviewsOfCards batch failed: %s", exc)
        return all_revs


# ---------------------------------------------------------------------------
# State File Management
# ---------------------------------------------------------------------------

def _load_state(path: Path = STATE_FILE_PATH) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        log.warning("Corrupt mirror state file %s (%s); triggering full reconcile", path, exc)
        return {}


def _save_state(state: dict[str, Any], path: Path = STATE_FILE_PATH) -> None:
    try:
        temp_dir = path.parent
        with tempfile.NamedTemporaryFile("w", dir=temp_dir, delete=False, encoding="utf-8") as tf:
            json.dump(state, tf, indent=2, ensure_ascii=False)
            temp_name = tf.name
        os.replace(temp_name, path)
    except Exception as exc:
        log.warning("Failed to atomically save mirror state file: %s", exc)


# ---------------------------------------------------------------------------
# Main Orchestrator: sync_anki_mirror
# ---------------------------------------------------------------------------

async def sync_anki_mirror(
    adapter: Any,
    *,
    full: bool = False,
    allow_shrink: bool = False,
    anki_client: Optional[AnkiClient] = None,
    state_file: Path = STATE_FILE_PATH,
) -> MirrorResult:
    """
    Orchestrate Anki mirror synchronization to cloud:
      - Uses module-level asyncio.Lock() to prevent concurrent execution.
      - Dispatches all blocking Anki calls via asyncio.to_thread.
      - Performs incremental sync by default, or full reconcile when requested/first run.
      - Reconcile safety: prevents wiping mirror on 0 cards or >50% shrink without --allow-shrink.
      - Profile guard: checks getActiveProfile against saved profile to avoid cross-profile contamination.
      - Never raises into callers; returns structured MirrorResult.
    """
    if _SYNC_LOCK.locked():
        log.debug("Mirror sync already in progress; returning immediately.")
        return MirrorResult(status="locked", message="Sync already in progress")

    async with _SYNC_LOCK:
        start_time = datetime.now(timezone.utc)
        client = anki_client or AnkiClient()

        # Step 1: Pre-flight check with version
        try:
            ver = await asyncio.to_thread(client.invoke, "version")
            if not ver:
                return MirrorResult(status="offline", message="Anki returned empty version")
        except Exception as exc:
            log.debug("AnkiConnect unreachable: %s", exc)
            return MirrorResult(status="offline", message=f"AnkiConnect unreachable: {exc}")

        # Profile check: prevent cross-profile contamination
        saved_state = _load_state(state_file)
        active_profile = None
        try:
            active_profile = await asyncio.to_thread(client.invoke, "getActiveProfile")
        except Exception as exc:
            log.debug("getActiveProfile unavailable: %s", exc)

        saved_profile = saved_state.get("active_profile")
        if active_profile and saved_profile and active_profile != saved_profile:
            msg = f"Profile mismatch: expected '{saved_profile}', but active Anki profile is '{active_profile}'. Sync skipped to prevent cross-profile contamination."
            log.warning("Safety guard: %s", msg)
            return MirrorResult(
                status="skipped",
                mode="profile_mismatch",
                cards_seen=0,
                cards_changed=0,
                cards_pushed=0,
                daily_rows_pushed=0,
                deleted_on_reconcile=0,
                duration_s=0.0,
                message=msg,
            )

        # Step 2: Fetch all live card IDs
        try:
            all_card_ids = await asyncio.to_thread(client.invoke, "findCards", query="deck:*")
            all_card_ids = [int(cid) for cid in (all_card_ids or [])]
        except Exception as exc:
            log.warning("findCards failed: %s", exc)
            return MirrorResult(status="error", message=f"findCards error: {exc}")

        # Fetch leech card IDs
        leech_card_ids: set[int] = set()
        try:
            leech_ids = await asyncio.to_thread(client.invoke, "findCards", query="tag:leech")
            leech_card_ids = {int(cid) for cid in (leech_ids or [])}
        except Exception:
            pass

        # Fetch due horizon map (0..60 days and overdue)
        due_map: dict[int, int] = {}
        try:
            overdue_ids = await asyncio.to_thread(client.invoke, "findCards", query="prop:due<0")
            for cid in (overdue_ids or []):
                due_map[int(cid)] = -1
            for d in range(0, 31):
                d_ids = await asyncio.to_thread(client.invoke, "findCards", query=f"prop:due={d}")
                for cid in (d_ids or []):
                    due_map[int(cid)] = d
        except Exception as exc:
            log.debug("Due forecast query degraded: %s", exc)

        # Step 3: Mod time checking for incremental sync
        saved_state = _load_state(state_file)
        saved_mods: dict[str, int] = saved_state.get("card_mods", {})
        last_reconcile = saved_state.get("last_full_reconcile_at")

        # Determine mode: force full if full=True, or no saved mods, or > 24 hours since last reconcile
        is_full_mode = full or not saved_mods or not last_reconcile
        if not is_full_mode and last_reconcile:
            try:
                last_dt = datetime.fromisoformat(last_reconcile)
                if (start_time - last_dt) > timedelta(hours=24):
                    is_full_mode = True
            except Exception:
                is_full_mode = True

        mode_str = "full" if is_full_mode else "incremental"
        log.info("Starting Anki mirror sync (mode=%s, total_cards=%d)", mode_str, len(all_card_ids))

        # Fetch cardsModTime
        try:
            mod_times_raw = await asyncio.to_thread(client.invoke, "cardsModTime", cards=all_card_ids)
            current_mods = {int(item["cardId"]): int(item["mod"]) for item in (mod_times_raw or [])}
        except Exception as exc:
            log.warning("cardsModTime failed: %s; falling back to full card fetch", exc)
            current_mods = {cid: 0 for cid in all_card_ids}
            is_full_mode = True

        # Identify cards to fetch
        if is_full_mode:
            target_ids = all_card_ids
        else:
            target_ids = [
                cid for cid, m in current_mods.items()
                if saved_mods.get(str(cid)) != m
            ]

        cards_changed = len(target_ids)
        cards_pushed = 0

        # Step 4: Fetch cardsInfo for target cards
        cards_info: list[dict[str, Any]] = []
        if target_ids:
            cards_info = await asyncio.to_thread(client.get_cards_info_batched, target_ids)

        # Fetch reviews for target cards
        reviews_map: dict[int, list[dict[str, Any]]] = {}
        if target_ids:
            reviews_map = await asyncio.to_thread(client.get_reviews_of_cards_batched, target_ids)

        # Fetch notesInfo for target cards (for tags, JLPT extraction, and media)
        notes_map: dict[int, dict[str, Any]] = {}
        if target_ids and cards_info:
            target_note_ids = list({int(c["note"]) for c in cards_info if c.get("note")})
            if target_note_ids:
                try:
                    notes_info = await asyncio.to_thread(client.get_notes_info_batched, target_note_ids)
                    for n in notes_info:
                        if n.get("noteId"):
                            notes_map[int(n["noteId"])] = n
                except Exception as exc:
                    log.warning("notesInfo batch failed soft: %s", exc)

        # Pre-fetch JLPT levels for target cards via local backend if reachable
        jlpt_lookup: dict[str, Any] = {}
        target_expressions = []
        for cinfo in cards_info:
            mapped = map_fields(cinfo.get("fields", {}))
            expr = mapped.get("expression")
            if expr:
                target_expressions.append(expr)
        if target_expressions:
            try:
                from kiroku_client import lookup_jlpt_batch
                jlpt_lookup = await lookup_jlpt_batch(list(set(target_expressions)))
            except Exception as exc:
                log.debug("JLPT batch lookup skipped/failed soft: %s", exc)

        # Process each card row
        now_iso = start_time.isoformat()
        card_rows: list[dict[str, Any]] = []
        media_rows: list[dict[str, Any]] = []

        for cinfo in cards_info:
            cid = int(cinfo["cardId"])
            nid = int(cinfo.get("note", 0))
            note_entry = notes_map.get(nid, {})
            note_tags = note_entry.get("tags", [])
            deck_name = str(cinfo.get("deckName", ""))

            fields_mapped = map_fields(cinfo.get("fields", {}))
            state_label = classify_state(cinfo)
            c_reviews = reviews_map.get(cid, [])
            c_info_augmented = dict(cinfo)
            c_info_augmented["is_leech"] = (cid in leech_card_ids)

            # Check for FSRS fields
            fsrs_d = cinfo.get("difficulty") or cinfo.get("fsrsDifficulty")
            fsrs_s = cinfo.get("stability") or cinfo.get("fsrsStability")
            fsrs_r = cinfo.get("retrievability") or cinfo.get("fsrsRetrievability")
            c_info_augmented["fsrs_difficulty"] = fsrs_d

            score, diff_label = compute_difficulty(c_info_augmented, c_reviews[-10:] if c_reviews else [])
            due_in_days = compute_due_days(cid, due_map)
            jlpt_level = extract_jlpt_level(note_tags, deck_name) or jlpt_lookup.get(fields_mapped["expression"])

            # Answer times
            valid_revs = [r for r in c_reviews[-10:] if int(r.get("type", 0)) in (0, 1, 2)]
            again_count_10 = sum(1 for r in valid_revs if int(r.get("ease", 0)) == 1)
            reviews_10 = len(valid_revs)
            again_rate_10 = round(again_count_10 / reviews_10, 2) if reviews_10 > 0 else 0.0
            avg_time_ms = int(sum(r.get("time", 0) for r in valid_revs) / reviews_10) if reviews_10 > 0 else 0

            first_rev_at = None
            last_rev_at = None
            if c_reviews:
                first_rev_at = datetime.fromtimestamp(int(c_reviews[0]["id"]) / 1000.0, tz=timezone.utc).isoformat()
                last_rev_at = datetime.fromtimestamp(int(c_reviews[-1]["id"]) / 1000.0, tz=timezone.utc).isoformat()

            created_at = datetime.fromtimestamp(cid / 1000.0, tz=timezone.utc).isoformat()
            raw_html = extract_rich_card_html(cinfo.get("fields", {}))
            img_fnames = extract_image_filenames(cinfo.get("fields", {}))
            has_media = bool(img_fnames)

            if img_fnames:
                target_fname = img_fnames[0]
                try:
                    b64_data = await asyncio.to_thread(client.invoke, "retrieveMediaFile", filename=target_fname)
                    if b64_data and isinstance(b64_data, str):
                        raw_bytes = base64.b64decode(b64_data)
                        compressed_webp = compress_image_webp(raw_bytes, max_dim=800, quality=75)
                        media_rows.append({
                            "card_id": cid,
                            "media_name": target_fname,
                            "mime_type": "image/webp",
                            "image_webp_b64": base64.b64encode(compressed_webp).decode("ascii"),
                        })
                except Exception as m_exc:
                    log.warning("Media retrieval failed for card %d (%s): %s", cid, target_fname, m_exc)

            card_rows.append({
                "card_id": cid,
                "note_id": int(cinfo.get("note", 0)),
                "deck_name": str(cinfo.get("deckName", "")),
                "model_name": str(cinfo.get("modelName", "")),
                "expression": fields_mapped["expression"],
                "reading": fields_mapped["reading"],
                "meaning": fields_mapped["meaning"],
                "sentence": fields_mapped["sentence"],
                "sentence_meaning": fields_mapped["sentence_meaning"],
                "jlpt_level": jlpt_level,
                "state": state_label,
                "queue_code": int(cinfo.get("queue", 0)),
                "interval_days": int(cinfo.get("interval", 0)),
                "reps": int(cinfo.get("reps", 0)),
                "lapses": int(cinfo.get("lapses", 0)),
                "again_count_10": again_count_10,
                "reviews_10": reviews_10,
                "again_rate_10": again_rate_10,
                "avg_time_ms": avg_time_ms,
                "difficulty_score": score,
                "difficulty_label": diff_label,
                "is_leech": (cid in leech_card_ids or int(cinfo.get("lapses", 0)) >= DIFFICULTY_CONSTANTS["LEECH_LAPSE_THRESHOLD"]),
                "fsrs_difficulty": float(fsrs_d) if fsrs_d is not None else None,
                "fsrs_stability": float(fsrs_s) if fsrs_s is not None else None,
                "fsrs_retrievability": float(fsrs_r) if fsrs_r is not None else None,
                "due_in_days": due_in_days,
                "raw_html": raw_html,
                "has_media": has_media,
                "created_at": created_at,
                "first_review_at": first_rev_at,
                "last_review_at": last_rev_at,
                "mod_at": datetime.fromtimestamp(current_mods.get(cid, 0), tz=timezone.utc).isoformat(),
                "synced_at": now_iso,
            })

        # Push cards in batches of 500
        if card_rows:
            for i in range(0, len(card_rows), 500):
                batch = card_rows[i : i + 500]
                ok = await adapter.push_anki_cards(batch)
                if ok:
                    cards_pushed += len(batch)

        # Push card media in batches of 50
        if media_rows:
            for i in range(0, len(media_rows), 50):
                m_batch = media_rows[i : i + 50]
                try:
                    await adapter.push_anki_media(m_batch)
                except Exception as m_err:
                    log.warning("push_anki_media batch failed soft: %s", m_err)

        # Step 5: Build and push daily series if in full mode or reviews happened
        daily_rows_pushed = 0
        if is_full_mode:
            all_reviews_flat: list[dict[str, Any]] = []
            for r_list in reviews_map.values():
                all_reviews_flat.extend(r_list)
            daily_rows = build_daily_series(card_rows, all_reviews_flat)
            if daily_rows:
                for i in range(0, len(daily_rows), 1000):
                    batch = daily_rows[i : i + 1000]
                    ok = await adapter.push_anki_daily(batch)
                    if ok:
                        daily_rows_pushed += len(batch)

        # Step 6: Reconcile deletions if in full mode with safety guards
        deleted_count = 0
        reconcile_skipped_reason = None
        if is_full_mode:
            if len(all_card_ids) == 0:
                reconcile_skipped_reason = "Anki returned 0 cards; reconcile skipped to prevent accidental collection wipe."
                log.warning("Safety guard: %s", reconcile_skipped_reason)
            else:
                prev_count = len(saved_mods)
                if prev_count > 0 and len(all_card_ids) < 0.5 * prev_count and not allow_shrink:
                    reconcile_skipped_reason = (
                        f"Safety guard: new card count ({len(all_card_ids)}) is less than 50% of previous "
                        f"mirrored count ({prev_count}). Reconcile delete skipped without --allow-shrink."
                    )
                    log.warning("%s", reconcile_skipped_reason)
                else:
                    try:
                        deleted_count = await adapter.reconcile_anki_cards(all_card_ids)
                    except Exception as exc:
                        log.warning("reconcile_anki_cards failed: %s", exc)

        # Step 7: Push metadata
        meta_payload = {
            "last_mirror_sync_at": now_iso,
            "last_full_reconcile_at": now_iso if is_full_mode else last_reconcile,
            "card_count": len(all_card_ids),
            "schema_version": "1.0",
            "collection_day_rollover_hour": ANKI_DAY_ROLLOVER_HOUR,
            "reconcile_skipped_reason": reconcile_skipped_reason or "",
        }
        if active_profile:
            meta_payload["active_profile"] = str(active_profile)
        await adapter.push_anki_meta(meta_payload)

        # Step 8: Update state file
        new_state = {
            "schema_version": 1,
            "last_full_reconcile_at": now_iso if is_full_mode else last_reconcile,
            "last_sync_at": now_iso,
            "card_mods": {str(k): v for k, v in current_mods.items()},
        }
        if active_profile:
            new_state["active_profile"] = str(active_profile)
        _save_state(new_state, state_file)

        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
        log.info(
            "Mirror sync completed in %.2fs: mode=%s, seen=%d, changed=%d, pushed=%d, daily=%d, deleted=%d",
            elapsed, mode_str, len(all_card_ids), cards_changed, cards_pushed, daily_rows_pushed, deleted_count,
        )

        return MirrorResult(
            status="ok",
            mode=mode_str,
            cards_seen=len(all_card_ids),
            cards_changed=cards_changed,
            cards_pushed=cards_pushed,
            daily_rows_pushed=daily_rows_pushed,
            deleted_on_reconcile=deleted_count,
            duration_s=elapsed,
            message=f"Sync {mode_str} completed successfully in {elapsed:.2f}s",
        )
