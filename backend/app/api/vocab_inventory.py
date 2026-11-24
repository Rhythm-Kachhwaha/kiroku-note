"""Enriched Vocabulary Inventory API for Kiroku Note.

Exposes paginated, filterable inventory over word_states, encounter history,
cards database, JMdict categories, and JLPT reference words.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
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
from app.services.vocab_practice.categories import classify_pos_heuristic, lookup_jmdict_pos_batch
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
    example_sentence: str = ""
    example_translation: str = ""


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
    cumulative: bool = Query(default=False),
    state: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    include_reference: bool = Query(default=True),
    sort_by: str = Query(default="last_seen"),
    sort_dir: str = Query(default="desc"),
    limit: int = Query(default=50, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
) -> VocabInventoryResponse:
    """
    Retrieve enriched inventory of Japanese vocabulary words combining
    tracked word_states, mined cards, encounter history, and reference words.
    """
    db_path = get_db_path()
    ref_service = _get_jlpt_ref()

    # Normalize FastAPI Query parameters when called directly in tests
    search = search if isinstance(search, str) else None
    jlpt_level = jlpt_level if isinstance(jlpt_level, str) else None
    cumulative = cumulative if isinstance(cumulative, bool) else False
    state = state if isinstance(state, str) else None
    category = category if isinstance(category, str) else None
    source = source if isinstance(source, str) else None
    include_reference = include_reference if isinstance(include_reference, bool) else True
    sort_by = sort_by if isinstance(sort_by, str) else "last_seen"
    sort_dir = sort_dir if isinstance(sort_dir, str) else "desc"
    limit = limit if isinstance(limit, int) else 50
    offset = offset if isinstance(offset, int) else 0

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
                c.source_type AS card_source_type,
                c.example_sentence AS card_example_sentence,
                c.example_translation AS card_example_translation
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
                    example_sentence,
                    example_translation,
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

            ex_sent = str(r["card_example_sentence"] or "")
            ex_trans = str(r["card_example_translation"] or "")
            if not ex_sent and expr:
                ex_sent, ex_trans = ref_service.get_example_for_word(expr)

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
                    example_sentence=ex_sent,
                    example_translation=ex_trans,
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

        # Incorporate cloud cards from Turso user_op_log if local cards table is empty
        if len(tracked_items) == 0:
            try:
                from app.db.turso_client import get_turso_client
                turso = get_turso_client()
                if turso.is_configured:
                    from app.api.cloud import _resolve_user_id
                    user_id = _resolve_user_id()
                    t_rows = turso.execute(
                        "SELECT payload FROM user_op_log WHERE user_id = ? ORDER BY created_at DESC",
                        [user_id]
                    )
                    for tr in t_rows:
                        p_raw = tr.get("payload")
                        if not p_raw:
                            continue
                        try:
                            c_dict = json.loads(p_raw) if isinstance(p_raw, str) else p_raw
                            if isinstance(c_dict, dict) and "payload" in c_dict and isinstance(c_dict["payload"], dict):
                                c_dict = c_dict["payload"]
                            expr = c_dict.get("expression") or ""
                            if not expr or expr in seen_expressions:
                                continue
                            if expr.startswith("word_") or expr.startswith("test_") or expr.startswith("mock_") or re.match(r"^word_\d+$", expr):
                                continue
                            seen_expressions.add(expr)
                            c_read = c_dict.get("reading") or ""
                            c_mean = c_dict.get("meaning") or ""
                            lvl = c_dict.get("jlpt_level") or (ref_service.lookup_word_with_kanji_fallback(expr) if expr else None)
                            pos_guess = classify_pos_heuristic(expr, c_read, c_mean)
                            c_cats = [pos_guess] if pos_guess else []
                            raw_cid = c_dict.get("id")
                            int_cid = None
                            if raw_cid:
                                m = re.search(r'\d+', str(raw_cid))
                                if m:
                                    int_cid = int(m.group(0))
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
                                    last_seen_at=c_dict.get("created_at"),
                                    is_mined=True,
                                    card_id=int_cid,
                                    sequence_id=None,
                                )
                            )
                        except Exception:
                            continue
            except Exception as e:
                logger.debug(f"[VocabInventory] Turso fallback notice: {e}")

        # 2. If include_reference is True, blend reference words for requested JLPT level(s)
        if include_reference:
            JLPT_CUMULATIVE_LEVELS = {
                "N5": ["N5"],
                "N4": ["N5", "N4"],
                "N3": ["N5", "N4", "N3"],
                "N2": ["N5", "N4", "N3", "N2"],
                "N1": ["N5", "N4", "N3", "N2", "N1"],
            }
            req_lvl = jlpt_level.strip().upper() if jlpt_level else None
            levels_to_fetch = JLPT_CUMULATIVE_LEVELS.get(req_lvl, ["N5", "N4", "N3", "N2", "N1"]) if req_lvl and req_lvl != "ALL" else ["N5", "N4", "N3", "N2", "N1"]

            for lvl_code in levels_to_fetch:
                ref_words = ref_service.get_words_by_level(lvl_code, limit=5000)
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
                                example_sentence=rw.get("example_sentence", ""),
                                example_translation=rw.get("example_translation", ""),
                            )
                        )

    # Enrich items lacking DB sequence_id categories with authoritative JMdict POS tags
    needs_pos = [it for it in tracked_items if not it.sequence_id]
    if needs_pos:
        pos_batch = lookup_jmdict_pos_batch(
            [it.expression for it in needs_pos],
            {it.expression: it.meaning for it in needs_pos if it.meaning},
        )
        for it in needs_pos:
            dict_cats = pos_batch.get(it.expression)
            if dict_cats:
                it.categories = list(dict_cats)

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
        if cumulative:
            cumulative_map = {
                "N5": {"N5"},
                "N4": {"N5", "N4"},
                "N3": {"N5", "N4", "N3"},
                "N2": {"N5", "N4", "N3", "N2"},
                "N1": {"N5", "N4", "N3", "N2", "N1"},
            }
            allowed_lvls = cumulative_map.get(target_lvl, {target_lvl})
            filtered = [it for it in filtered if it.jlpt_level in allowed_lvls]
        else:
            filtered = [it for it in filtered if it.jlpt_level == target_lvl]

    if state and state.strip().lower() != "all":
        target_state = state.strip().lower()
        filtered = [it for it in filtered if it.state == target_state]

    if category and category.strip().lower() != "all":
        target_cat = category.strip().lower()
        if target_cat in ("katakana_loanword", "loanword", "katakana"):
            _KATAKANA_RE = re.compile(r"^[ァ-ヶー・]+$")
            filtered = [
                it for it in filtered
                if _KATAKANA_RE.match(it.expression or "")
                and not any("onomatopoeia" in c.lower() for c in (it.categories or []))
            ]
        else:
            EXACT_CATEGORY_MAP: dict[str, set[str]] = {
                "verb_transitive": {"verb_transitive", "vt"},
                "vt": {"verb_transitive", "vt"},
                "verb_intransitive": {"verb_intransitive", "vi"},
                "vi": {"verb_intransitive", "vi"},
                "suru_verb": {"suru_verb", "vs", "vs-i", "vs-s"},
                "vs": {"suru_verb", "vs", "vs-i", "vs-s"},
                "verb_ichidan": {"verb_ichidan", "v1", "v1-s"},
                "verb_godan": {"verb_godan", "v5"},
                "verb_kuru": {"verb_kuru", "vk"},
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


@router.get("/api/vocab/conjugations")
def get_word_conjugations(
    expression: str = Query(..., min_length=1),
    reading: str = Query(default=""),
    categories: str = Query(default=""),
) -> dict[str, Any]:
    """Return full verb conjugation forms and verb-specific formation rules."""
    import zlib
    from app.services.dictionary_provider import resolve_dictionary_db_path
    from app.services.vocab_practice.categories import _DICT_CODE_RE
    from app.services.vocab_practice.conjugation_drill import get_all_verb_conjugations

    expr = expression.strip()
    read = reading.strip()
    cat_list = [c.strip() for c in categories.split(",") if c.strip()] if categories else []

    pos_codes: set[str] = set()
    try:
        dict_path = resolve_dictionary_db_path()
        if dict_path and dict_path.exists():
            conn = sqlite3.connect(str(dict_path))
            try:
                rows = conn.execute(
                    "SELECT reading, rules, content_blob FROM terms WHERE term = ? LIMIT 8",
                    (expr,),
                ).fetchall()
                for r_read, rules, blob in rows:
                    if not read and r_read:
                        read = str(r_read)
                    if rules:
                        pos_codes.update(str(rules).split())
                    if blob:
                        try:
                            txt = zlib.decompress(blob).decode("utf-8", "ignore")
                            pos_codes.update(_DICT_CODE_RE.findall(txt))
                        except Exception:
                            pass
            finally:
                conn.close()
    except Exception:
        pass

    return get_all_verb_conjugations(
        expression=expr,
        reading=read,
        pos_codes=sorted(pos_codes),
        categories=cat_list,
    )
