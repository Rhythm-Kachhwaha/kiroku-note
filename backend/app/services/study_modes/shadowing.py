"""Audio-first shadowing drill engine backed by captured cards."""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from typing import Any

from app.services.kanji_service import KanjiService
from app.services.operational_diagnostics import record_operational_failure

logger = logging.getLogger(__name__)

VALID_SHADOWING_GRADES = frozenset({"got_it", "missed"})
_SOUND_TAG_RE = re.compile(r"\[sound:([^\]]+)\]", re.IGNORECASE)


def resolve_card_audio_url(audio_value: str | None) -> str | None:
    """Resolve stored card audio field into a playable local media or remote URL."""
    raw = str(audio_value or "").strip()
    if not raw:
        return None
    match = _SOUND_TAG_RE.search(raw)
    if match:
        raw = match.group(1).strip()
    if not raw:
        return None
    lowered = raw.lower()
    if lowered.startswith("/api/media/"):
        if ".." in raw or "\\" in raw:
            return None
        return raw
    if lowered.startswith(("http://", "https://", "data:audio/")):
        return raw
    safe_name = os.path.basename(raw)
    if safe_name != raw or ".." in raw:
        return None
    return f"/api/media/{safe_name}"


def extract_kanji_breakdown(
    text: str,
    *,
    kanji_service: KanjiService | None = None,
) -> list[dict[str, Any]]:
    """Build per-kanji reading, meaning, and JLPT breakdown using local KanjiService."""
    chars: list[str] = []
    seen: set[str] = set()
    for ch in str(text or ""):
        if ("\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf") and ch not in seen:
            seen.add(ch)
            chars.append(ch)

    if not chars:
        return []

    svc = kanji_service or KanjiService()
    batch: dict[str, dict[str, Any] | None] = {}
    try:
        batch = svc.get_batch(chars)
    except Exception as exc:
        record_operational_failure("study_modes.shadowing_kanji", exc, level=logging.DEBUG)
        batch = {}

    breakdown: list[dict[str, Any]] = []
    for ch in chars:
        details = batch.get(ch) or {}
        breakdown.append(
            {
                "character": ch,
                "meanings": list(details.get("meanings") or []),
                "onyomi": list(details.get("onyomi") or []),
                "kunyomi": list(details.get("kunyomi") or []),
                "level": details.get("level"),
                "strokes": details.get("strokes"),
            }
        )
    return breakdown


def _extract_jlpt_from_meanings_json(meanings_raw: str | None) -> str | None:
    if not meanings_raw:
        return None
    try:
        parsed = json.loads(meanings_raw)
        if isinstance(parsed, dict) and parsed.get("jlpt_level"):
            return str(parsed["jlpt_level"]).upper()
    except Exception:
        return None
    return None


def build_shadowing_item(
    card: dict[str, Any],
    *,
    item_index: int = 0,
    kanji_service: KanjiService | None = None,
) -> dict[str, Any]:
    """Build an audio shadowing item from a real captured card without placeholder mocks."""
    example_sentence = str(card.get("example_sentence") or "").strip()
    expression = str(card.get("expression") or "").strip()
    transcript = example_sentence or expression
    if not transcript:
        raise ValueError("Captured card has no expression or sentence transcript.")

    reading = str(card.get("reading") or "").strip()
    english_gloss = str(card.get("example_translation") or "").strip() or str(card.get("meaning") or "").strip()
    audio_raw = str(card.get("audio") or "").strip() or str(card.get("audio_path") or "").strip()
    audio_url = resolve_card_audio_url(audio_raw)
    kanji_breakdown = extract_kanji_breakdown(transcript, kanji_service=kanji_service)
    jlpt_level = card.get("jlpt_level") or _extract_jlpt_from_meanings_json(card.get("meanings_json"))

    return {
        "item_index": item_index,
        "mode": "audio_shadowing",
        "source_card_id": int(card["id"]) if card.get("id") is not None else None,
        "audio_url": audio_url,
        "audio_available": bool(audio_url),
        "jlpt_level": jlpt_level,
        "transcript": transcript,
        "expression": expression,
        "reading": reading,
        "english_gloss": english_gloss,
        "kanji_breakdown": kanji_breakdown,
    }


def public_shadowing_item(item: dict[str, Any], *, revealed: bool = False, answered: bool = False) -> dict[str, Any]:
    """Return concealed or revealed view of a shadowing item."""
    is_revealed = bool(revealed or answered)
    payload: dict[str, Any] = {
        "item_index": int(item["item_index"]),
        "mode": "audio_shadowing",
        "source_card_id": item.get("source_card_id"),
        "audio_url": item.get("audio_url"),
        "audio_available": bool(item.get("audio_available")),
        "jlpt_level": item.get("jlpt_level"),
        "revealed": is_revealed,
        "answered": answered,
    }
    if is_revealed:
        payload.update(
            {
                "transcript": item["transcript"],
                "reading": item["reading"],
                "english_gloss": item["english_gloss"],
                "kanji_breakdown": item["kanji_breakdown"],
            }
        )
    else:
        payload.update(
            {
                "transcript": None,
                "reading": None,
                "english_gloss": None,
                "kanji_breakdown": [],
            }
        )
    return payload


def grade_shadowing_answer(item: dict[str, Any], user_answer: Any) -> dict[str, Any]:
    """Grade self-assessment ('got_it' or 'missed') and return revealed breakdown."""
    clean = str(user_answer or "").strip().lower()
    if clean not in VALID_SHADOWING_GRADES:
        raise ValueError("Shadowing self-grade must be 'got_it' or 'missed'.")

    return {
        "is_correct": clean == "got_it",
        "self_grade": clean,
        "revealed": True,
        "transcript": item["transcript"],
        "reading": item["reading"],
        "english_gloss": item["english_gloss"],
        "kanji_breakdown": item["kanji_breakdown"],
    }


def select_shadowing_candidates(
    conn: sqlite3.Connection,
    limit: int = 10,
    *,
    kanji_service: KanjiService | None = None,
) -> list[dict[str, Any]]:
    """Select captured cards for shadowing, preferring cards with audio attached."""
    rows = conn.execute(
        """
        SELECT id, expression, reading, meaning, example_sentence, example_translation, audio, meanings_json
        FROM cards
        WHERE TRIM(example_sentence) != '' OR TRIM(expression) != ''
        ORDER BY CASE WHEN TRIM(audio) != '' THEN 0 ELSE 1 END, id DESC
        LIMIT ?
        """,
        (max(1, limit * 2),),
    ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows:
        card_dict = dict(row)
        item = build_shadowing_item(
            card_dict,
            item_index=len(items),
            kanji_service=kanji_service,
        )
        items.append(item)
        if len(items) >= limit:
            break
    return items
