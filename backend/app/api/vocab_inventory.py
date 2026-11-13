"""Enriched Vocabulary Inventory API for Kiroku Note.

Exposes paginated, filterable inventory over word_states, encounter history,
cards database, JMdict categories, and JLPT reference words.
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.db.connection import db_session, ensure_vocab_state_tables, get_db_path
from app.repositories.word_state_repository import (
    VALID_WORD_STATES,
    normalize_word_expression,
    normalize_word_reading,
)
from app.services.jlpt_reference import JlptReferenceService
from app.services.subtitle_annotator import get_subtitle_annotator_service
from app.services.vocab_practice.categories import classify_pos_heuristic
from app.services.word_state_service import WordStateService

router = APIRouter(tags=["vocab-inventory"])

_jlpt_ref_instance: Optional[JlptReferenceService] = None


def _get_jlpt_ref() -> JlptReferenceService:
    global _jlpt_ref_instance
    if _jlpt_ref_instance is None:
        _jlpt_ref_instance = JlptReferenceService()
    return _jlpt_ref_instance


class VocabInventoryItem(BaseModel):
    id: Optional[int] = None
    expression: str
    reading: str
    meaning: str = ""
    jlpt_level: Optional[str] = None
    state: str = "unseen"
    categories: list[str] = Field(default_factory=list)
    encounters_count: int = 0
    last_seen_at: Optional[str] = None
    is_mined: bool = False
    card_id: Optional[int] = None
    sequence_id: Optional[int] = None


class VocabInventoryResponse(BaseModel):
    items: list[VocabInventoryItem]
    total: int
    counts_by_state: dict[str, int]
    limit: int
    offset: int


class BulkSetWordStateRequest(BaseModel):
    expressions: list[str] = Field(min_length=1)
    state: str


@router.get("/api/vocab/inventory", response_model=VocabInventoryResponse)
def get_vocab_inventory(
    search: Optional[str] = Query(default=None),
    jlpt_level: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    include_reference: bool = Query(default=True),
    sort_by: str = Query(default="last_seen"),
    sort_dir: str = Query(default="desc"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> VocabInventoryResponse:
    """
    Retrieve enriched inventory of Japanese vocabulary words combining
    tracked word_states, mined cards, encounter history, and reference words.
    """
    db_path = get_db_path()
    ref_service = _get_jlpt_ref()

    with db_session(db_path) as conn:
        ensure_vocab_state_tables(conn)

        # 1. Fetch tracked word states with aggregated encounters and cards
        base_query = """
            SELECT
                ws.id AS state_id,
                ws.sequence_id,
                ws.expression,
                ws.reading,
                ws.state,
                ws.first_seen_at,
                ws.last_seen_at,
                ws.updated_at,
                COALESCE(enc.encounter_count, 0) AS encounters_count,
                enc.last_encounter_time,
                enc.source_media AS last_source,
                c.id AS card_id,
                c.meaning AS card_meaning,
                c.jlpt_level AS card_jlpt_level,
                c.source_type AS card_source_type
            FROM word_states ws
            LEFT JOIN (
                SELECT
                    expression,
                    reading,
                    COUNT(*) AS encounter_count,
                    MAX(timestamp) AS last_encounter_time,
                    source_media
                FROM word_encounters
                GROUP BY expression, reading
            ) enc ON (enc.expression = ws.expression AND (ws.reading = '' OR enc.reading = ws.reading))
            LEFT JOIN (
                SELECT
                    id,
                    expression,
                    reading,
                    meaning,
                    jlpt_level,
                    source_type,
                    ROW_NUMBER() OVER (PARTITION BY expression, reading ORDER BY id DESC) as rn
                FROM cards
            ) c ON (c.expression = ws.expression AND (ws.reading = '' OR c.reading = ws.reading) AND c.rn = 1)
        """
        tracked_rows = conn.execute(base_query).fetchall()

        # Build categories index: sequence_id -> list of categories
        cat_rows = conn.execute("SELECT sequence_id, category, subtype FROM word_categories").fetchall()
        categories_by_seq: dict[int, list[str]] = {}
        for cr in cat_rows:
            seq = cr["sequence_id"]
            if seq not in categories_by_seq:
                categories_by_seq[seq] = []
            cat_label = cr["category"]
            if cr["subtype"]:
                cat_label = f"{cat_label}:{cr['subtype']}"
            if cat_label not in categories_by_seq[seq]:
                categories_by_seq[seq].append(cat_label)

        # Assemble tracked inventory items
        tracked_items: list[VocabInventoryItem] = []
        seen_expressions: set[str] = set()

        for r in tracked_rows:
            expr = str(r["expression"] or "")
            read = str(r["reading"] or "")
            seq_id = r["sequence_id"]
            st = str(r["state"] or "unseen")
            seen_expressions.add(expr)

            # Resolve JLPT level
            lvl = r["card_jlpt_level"]
            if not lvl and expr:
                lvl = ref_service.lookup_word_with_kanji_fallback(expr)

            # Resolve meaning
            meaning = r["card_meaning"] or ""
            if not meaning and expr:
                searched = ref_service.lookup_word(expr)
                if searched:
                    meaning = ""

            cats = list(categories_by_seq.get(seq_id, [])) if seq_id else []
            if not cats and expr:
                pos_guess = classify_pos_heuristic(expr, read, meaning)
                if pos_guess:
                    cats.append(pos_guess)

            tracked_items.append(
                VocabInventoryItem(
                    id=r["state_id"],
                    expression=expr,
                    reading=read,
                    meaning=meaning,
                    jlpt_level=lvl.upper() if lvl else None,
                    state=st,
                    categories=cats,
                    encounters_count=int(r["encounters_count"] or 0),
                    last_seen_at=r["last_seen_at"] or r["last_encounter_time"] or r["updated_at"],
                    is_mined=bool(r["card_id"]),
                    card_id=r["card_id"],
                    sequence_id=seq_id,
                )
            )

        # Also incorporate cards that may not be in word_states yet
        card_only_rows = conn.execute("""
            SELECT id, expression, reading, meaning, jlpt_level, source_type, created_at
            FROM cards
            WHERE expression NOT IN (SELECT expression FROM word_states)
        """).fetchall()

        for cr in card_only_rows:
            expr = str(cr["expression"] or "")
            if expr in seen_expressions:
                continue
            seen_expressions.add(expr)
            lvl = cr["jlpt_level"] or (ref_service.lookup_word_with_kanji_fallback(expr) if expr else None)
            c_read = str(cr["reading"] or "")
            c_mean = str(cr["meaning"] or "")
            pos_guess = classify_pos_heuristic(expr, c_read, c_mean)
            c_cats = [pos_guess] if pos_guess else []
            tracked_items.append(
                VocabInventoryItem(
                    id=None,
                    expression=expr,
                    reading=c_read,
                    meaning=c_mean,
                    jlpt_level=lvl.upper() if lvl else None,
                    state="learning",
                    categories=c_cats,
                    encounters_count=1,
                    last_seen_at=cr["created_at"],
                    is_mined=True,
                    card_id=cr["id"],
                    sequence_id=None,
                )
            )

        # 2. If include_reference is True and a JLPT level is requested, blend reference words
        if include_reference and jlpt_level and jlpt_level.strip().upper() != "ALL":
            ref_words = ref_service.get_words_by_level(jlpt_level.strip().upper(), limit=500)
            for rw in ref_words:
                expr = rw["expression"]
                if expr not in seen_expressions:
                    seen_expressions.add(expr)
                    rw_read = rw["reading"]
                    rw_mean = rw["meaning"]
                    rw_pos = classify_pos_heuristic(expr, rw_read, rw_mean)
                    rw_cats = [rw_pos] if rw_pos else []
                    tracked_items.append(
                        VocabInventoryItem(
                            id=None,
                            expression=expr,
                            reading=rw_read,
                            meaning=rw_mean,
                            jlpt_level=rw["jlpt_level"],
                            state="unseen",
                            categories=rw_cats,
                            encounters_count=0,
                            last_seen_at=None,
                            is_mined=False,
                            card_id=None,
                            sequence_id=None,
                        )
                    )

    # 3. Filtering
    filtered: list[VocabInventoryItem] = tracked_items

    if search and search.strip():
        term = search.strip().lower()
        filtered = [
            it for it in filtered
            if term in it.expression.lower()
            or term in it.reading.lower()
            or term in it.meaning.lower()
        ]

    if jlpt_level and jlpt_level.strip().upper() != "ALL":
        target_lvl = jlpt_level.strip().upper()
        filtered = [it for it in filtered if it.jlpt_level == target_lvl]

    if state and state.strip().lower() != "all":
        target_state = state.strip().lower()
        filtered = [it for it in filtered if it.state == target_state]

    if category and category.strip().lower() != "all":
        target_cat = category.strip().lower()
        EXACT_CATEGORY_MAP: dict[str, set[str]] = {
            "verb_transitive": {"verb_transitive", "vt"},
            "vt": {"verb_transitive", "vt"},
            "verb_intransitive": {"verb_intransitive", "vi"},
            "vi": {"verb_intransitive", "vi"},
            "suru_verb": {"suru_verb", "vs", "vs-i", "vs-s"},
            "vs": {"suru_verb", "vs", "vs-i", "vs-s"},
            "verb": {"verb", "verb_transitive", "verb_intransitive", "verb_ichidan", "verb_godan", "verb_kuru", "suru_verb", "vt", "vi", "v1", "v5", "vs"},
            "adjective_i": {"adjective_i", "adj-i"},
            "adj-i": {"adjective_i", "adj-i"},
            "adjective_na": {"adjective_na", "adj-na"},
            "adj-na": {"adjective_na", "adj-na"},
            "adjective": {"adjective", "adjective_i", "adjective_na", "adj-i", "adj-na"},
            "adverb": {"adverb", "adv", "adv-to"},
            "adv": {"adverb", "adv", "adv-to"},
            "onomatopoeia": {"onomatopoeia", "on-mim", "giongo", "giseigo", "gitaigo", "emotion"},
            "on-mim": {"onomatopoeia", "on-mim", "giongo", "giseigo", "gitaigo", "emotion"},
            "noun": {"noun", "n"},
            "n": {"noun", "n"},
            "expression": {"expression", "exp"},
            "exp": {"expression", "exp"},
        }
        allowed_tags = EXACT_CATEGORY_MAP.get(target_cat, {target_cat})

        def _item_matches_category(item: VocabInventoryItem) -> bool:
            for c in item.categories:
                c_low = c.lower().strip()
                clean_c = c_low.split(":")[0].strip()
                subtype = c_low.split(":")[1].strip() if ":" in c_low else ""
                if c_low in allowed_tags or clean_c in allowed_tags:
                    return True
                if subtype and subtype in allowed_tags:
                    return True
            return False

        filtered = [it for it in filtered if _item_matches_category(it)]

    # Compute state counts over filtered level/search
    counts = {
        "total": len(filtered),
        "known": sum(1 for it in filtered if it.state == "known"),
        "learning": sum(1 for it in filtered if it.state == "learning"),
        "unseen": sum(1 for it in filtered if it.state == "unseen"),
        "ignored": sum(1 for it in filtered if it.state in ("ignored", "blacklisted")),
    }

    # 4. Sorting
    reverse_sort = sort_dir.lower() == "desc"
    if sort_by == "expression":
        filtered.sort(key=lambda x: x.expression, reverse=reverse_sort)
    elif sort_by == "encounters":
        filtered.sort(key=lambda x: x.encounters_count, reverse=reverse_sort)
    elif sort_by == "level":
        filtered.sort(key=lambda x: x.jlpt_level or "Z", reverse=reverse_sort)
    else:  # default last_seen
        filtered.sort(
            key=lambda x: (x.last_seen_at or "", x.encounters_count),
            reverse=reverse_sort,
        )

    # 5. Pagination
    total = len(filtered)
    paginated = filtered[offset : offset + limit]

    return VocabInventoryResponse(
        items=paginated,
        total=total,
        counts_by_state=counts,
        limit=limit,
        offset=offset,
    )


@router.post("/api/vocab/inventory/bulk-state")
def bulk_set_word_state(request: BulkSetWordStateRequest) -> dict[str, Any]:
    """Bulk update learner state for a list of vocabulary word expressions."""
    clean_state = request.state.strip().lower()
    if clean_state not in VALID_WORD_STATES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid word state: {clean_state!r}. Must be one of: {', '.join(VALID_WORD_STATES)}",
        )

    service = WordStateService()
    updated_count = 0

    for expr in request.expressions:
        clean_expr = expr.strip()
        if not clean_expr:
            continue
        try:
            service.set_user_word_state(
                state=clean_state,
                expression=clean_expr,
            )
            updated_count += 1
        except Exception:
            pass

    try:
        get_subtitle_annotator_service().reload_mined_words()
    except Exception:
        pass

    return {
        "ok": True,
        "updated": updated_count,
        "state": clean_state,
    }
