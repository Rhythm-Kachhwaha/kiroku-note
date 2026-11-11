"""Interactive Sentence Scramble engine using Phase 1 sentence analysis."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import random
import sqlite3
from typing import Any, Sequence

from app.services.sentence_analysis import analyze
from app.services.tokenizers.base import Morpheme

try:
    from kiroku_dictionary.schema import katakana_to_hiragana
except ImportError:  # pragma: no cover - defensive fallback
    def katakana_to_hiragana(text: str) -> str:
        out: list[str] = []
        for ch in text:
            code = ord(ch)
            if 0x30A1 <= code <= 0x30F6:
                out.append(chr(code - 0x60))
            else:
                out.append(ch)
        return "".join(out)


_SKIP_POS = frozenset({"補助記号", "記号", "空白"})

KEY_PARTICLES: dict[str, str] = {
    "は": "topic particle",
    "が": "subject particle",
    "を": "object particle",
    "に": "target / time particle",
    "で": "location / means particle",
    "へ": "direction particle",
    "と": "and / with particle",
    "から": "from / because particle",
    "まで": "until / up to particle",
    "も": "also / too particle",
}

_ATTACH_TO_PREV_POS = frozenset({"助動詞", "接尾辞"})
_ROLE_HINTS: dict[str, str] = {
    "topic": "topic",
    "subject": "subject",
    "object": "object",
    "verb": "verb",
    "adjective": "adjective",
    "adverb": "adverb",
    "noun": "noun / phrase",
    "phrase": "phrase",
}


@dataclass
class _SemanticUnit:
    morphemes: list[Morpheme]
    is_key_particle: bool = False

    @property
    def surface(self) -> str:
        return "".join(m.surface for m in self.morphemes)

    @property
    def reading(self) -> str:
        parts = [katakana_to_hiragana(m.reading or m.surface) for m in self.morphemes]
        return "".join(parts)

    @property
    def primary_pos(self) -> str:
        for m in self.morphemes:
            if m.pos and m.pos[0] not in _SKIP_POS:
                return m.pos[0]
        return ""


def _is_key_particle(morpheme: Morpheme) -> bool:
    if morpheme.surface not in KEY_PARTICLES:
        return False
    pos0 = morpheme.pos[0] if morpheme.pos else ""
    if pos0 == "助詞":
        return True
    # Some tokenizers may classify standalone particles under sub-tags
    return morpheme.surface in {"は", "が", "を", "へ", "も"} and pos0 != "動詞"


def _is_sahen_noun(morpheme: Morpheme) -> bool:
    return (
        bool(morpheme.pos)
        and morpheme.pos[0] == "名詞"
        and len(morpheme.pos) >= 3
        and morpheme.pos[2] == "サ変可能"
    )


def _should_attach_to_previous(prev: _SemanticUnit, curr: Morpheme) -> bool:
    if prev.is_key_particle or _is_key_particle(curr):
        return False
    pos0 = curr.pos[0] if curr.pos else ""
    if pos0 in _ATTACH_TO_PREV_POS:
        return True
    if pos0 == "助詞":
        # Non-key particles like の, て, ね, よ, か attach cleanly to host phrase
        return True
    last_prev = prev.morphemes[-1]
    if _is_sahen_noun(last_prev) and pos0 == "動詞":
        return True
    if last_prev.pos and last_prev.pos[0] == "接頭辞":
        return True
    return False


def _group_morphemes(morphemes: Sequence[Morpheme]) -> list[_SemanticUnit]:
    units: list[_SemanticUnit] = []
    for m in morphemes:
        if _is_key_particle(m):
            units.append(_SemanticUnit(morphemes=[m], is_key_particle=True))
        elif units and _should_attach_to_previous(units[-1], m):
            units[-1].morphemes.append(m)
        else:
            units.append(_SemanticUnit(morphemes=[m], is_key_particle=False))
    return units


def _merge_pair_score(left: _SemanticUnit, right: _SemanticUnit) -> tuple[int, int]:
    """Lower score = better candidate pair to merge while preserving key particles."""
    if left.is_key_particle and right.is_key_particle:
        priority = 10
    elif left.is_key_particle and not right.is_key_particle:
        # Avoid swallowing a following phrase into a key particle if possible
        priority = 5
    elif not left.is_key_particle and right.is_key_particle:
        # Only attach key particle to preceding noun/phrase as last resort
        priority = 3
    else:
        # Both are content units: prefer modifier/adverb/noun merges
        lpos = left.primary_pos
        rpos = right.primary_pos
        if lpos in {"連体詞", "副詞", "形容詞", "形状詞"} and rpos in {"名詞", "代名詞", "動詞", "形容詞", "形状詞"}:
            priority = 1
        else:
            priority = 2
    return (priority, len(left.surface) + len(right.surface))


def _coalesce_to_max(units: list[_SemanticUnit], max_blocks: int = 6) -> list[_SemanticUnit]:
    while len(units) > max_blocks:
        best_idx = 0
        best_score = _merge_pair_score(units[0], units[1])
        for idx in range(1, len(units) - 1):
            score = _merge_pair_score(units[idx], units[idx + 1])
            if score < best_score:
                best_score = score
                best_idx = idx
        merged = _SemanticUnit(
            morphemes=[*units[best_idx].morphemes, *units[best_idx + 1].morphemes],
            is_key_particle=units[best_idx].is_key_particle and units[best_idx + 1].is_key_particle,
        )
        units = [*units[:best_idx], merged, *units[best_idx + 2 :]]
    return units


def _expand_to_min(units: list[_SemanticUnit], raw_morphemes: list[Morpheme], min_blocks: int = 3) -> list[_SemanticUnit]:
    while len(units) < min_blocks:
        splittable_idx = next((i for i, u in enumerate(units) if len(u.morphemes) >= 2), None)
        if splittable_idx is None:
            break
        u = units[splittable_idx]
        cut = max(1, len(u.morphemes) // 2)
        left_m = u.morphemes[:cut]
        right_m = u.morphemes[cut:]
        left_u = _SemanticUnit(morphemes=left_m, is_key_particle=(len(left_m) == 1 and _is_key_particle(left_m[0])))
        right_u = _SemanticUnit(morphemes=right_m, is_key_particle=(len(right_m) == 1 and _is_key_particle(right_m[0])))
        units = [*units[:splittable_idx], left_u, right_u, *units[splittable_idx + 1 :]]

    if len(units) < min_blocks and len(raw_morphemes) >= min_blocks:
        raw_units = _group_morphemes(raw_morphemes)
        if len(raw_units) >= min_blocks:
            return _coalesce_to_max(raw_units, max_blocks=6)
        # Split raw morphemes directly if grouping still fell below min_blocks
        direct_units = [_SemanticUnit(morphemes=[m], is_key_particle=_is_key_particle(m)) for m in raw_morphemes]
        return _coalesce_to_max(direct_units, max_blocks=6)
    return units


def _assign_role_and_hint(unit: _SemanticUnit, next_unit: _SemanticUnit | None) -> tuple[str, str]:
    if unit.is_key_particle and unit.surface in KEY_PARTICLES:
        return ("particle", KEY_PARTICLES[unit.surface])

    if next_unit is not None and next_unit.is_key_particle:
        if next_unit.surface == "は":
            return ("topic", "topic")
        if next_unit.surface == "が":
            return ("subject", "subject")
        if next_unit.surface == "を":
            return ("object", "object")

    pos0 = unit.primary_pos
    if pos0 == "動詞":
        return ("verb", _ROLE_HINTS["verb"])
    if pos0 in {"形容詞", "形状詞"}:
        return ("adjective", _ROLE_HINTS["adjective"])
    if pos0 == "副詞":
        return ("adverb", _ROLE_HINTS["adverb"])
    if pos0 in {"名詞", "代名詞"}:
        return ("noun", _ROLE_HINTS["noun"])
    if pos0 == "助詞" and unit.surface in KEY_PARTICLES:
        return ("particle", KEY_PARTICLES[unit.surface])
    return ("phrase", _ROLE_HINTS["phrase"])


def chunk_sentence(sentence: str) -> list[dict[str, Any]]:
    """Chunk a Japanese sentence into 3-6 semantic blocks, keeping key particles clear."""
    clean = str(sentence or "").strip()
    if not clean:
        return []

    analysis = analyze(clean)
    merged_tokens = [
        m for m in analysis.merged
        if m.surface and not m.surface.isspace() and not (m.pos and m.pos[0] in _SKIP_POS)
    ]
    raw_tokens = [
        m for m in analysis.morphemes
        if m.surface and not m.surface.isspace() and not (m.pos and m.pos[0] in _SKIP_POS)
    ]
    if not merged_tokens:
        return []

    units = _group_morphemes(merged_tokens)
    units = _coalesce_to_max(units, max_blocks=6)
    units = _expand_to_min(units, raw_tokens, min_blocks=3)
    units = _coalesce_to_max(units, max_blocks=6)

    blocks: list[dict[str, Any]] = []
    for idx, unit in enumerate(units):
        next_unit = units[idx + 1] if idx + 1 < len(units) else None
        role, hint = _assign_role_and_hint(unit, next_unit)
        blocks.append(
            {
                "tile_id": f"tile_{idx}",
                "canonical_index": idx,
                "surface": unit.surface,
                "reading": unit.reading,
                "role": role,
                "hint": hint,
            }
        )
    return blocks


def deterministic_shuffle_indices(length: int, seed_text: str, seed: int | None = None) -> list[int]:
    """Return a deterministic permutation of [0..length-1] guaranteed != canonical order for length >= 2."""
    if length <= 0:
        return []
    if length == 1:
        return [0]

    seed_val = seed if seed is not None else int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest(), 16)
    rng = random.Random(seed_val)
    canonical = list(range(length))
    indices = list(canonical)
    rng.shuffle(indices)
    if indices == canonical:
        indices = [*indices[1:], indices[0]]
    return indices


def build_scramble_item(
    sentence: str,
    *,
    english_gloss: str = "",
    source_card_id: int | None = None,
    item_index: int = 0,
    seed: int | None = None,
) -> dict[str, Any]:
    """Build an interactive sentence scramble item with shuffled tiles and grading metadata."""
    blocks = chunk_sentence(sentence)
    if len(blocks) < 2:
        raise ValueError("Sentence must produce at least 2 blocks for scrambling.")

    shuffled_indices = deterministic_shuffle_indices(len(blocks), sentence, seed=seed)
    shuffled_tiles = [
        {
            "tile_id": blocks[idx]["tile_id"],
            "surface": blocks[idx]["surface"],
            "reading": blocks[idx]["reading"],
            "role": blocks[idx]["role"],
            "hint": blocks[idx]["hint"],
        }
        for idx in shuffled_indices
    ]
    canonical_sentence = "".join(b["surface"] for b in blocks)
    expected_order = [b["tile_id"] for b in blocks]

    return {
        "item_index": item_index,
        "mode": "sentence_scramble",
        "source_card_id": source_card_id,
        "source_sentence": sentence,
        "canonical_sentence": canonical_sentence,
        "english_gloss": str(english_gloss or "").strip(),
        "tile_count": len(blocks),
        "blocks": blocks,
        "expected_order": expected_order,
        "shuffled_indices": shuffled_indices,
        "shuffled_tiles": shuffled_tiles,
    }


def public_scramble_item(item: dict[str, Any], *, answered: bool = False) -> dict[str, Any]:
    """Return client-safe scramble item payload without leaking canonical order prematurely."""
    return {
        "item_index": int(item["item_index"]),
        "mode": "sentence_scramble",
        "source_card_id": item.get("source_card_id"),
        "english_gloss": item.get("english_gloss") or "",
        "tile_count": int(item["tile_count"]),
        "tiles": item["shuffled_tiles"],
        "shuffled_indices": item["shuffled_indices"],
        "answered": answered,
    }


def _normalize_submitted_order(
    submitted_order: Any,
    blocks: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    by_id = {b["tile_id"]: b for b in blocks}

    if isinstance(submitted_order, str):
        raw = submitted_order.strip()
        if not raw:
            return ([], [])
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    submitted_order = parsed
            except json.JSONDecodeError:
                pass
        elif "," in raw:
            submitted_order = [part.strip() for part in raw.split(",") if part.strip()]

    if isinstance(submitted_order, str):
        # String sentence submission fallback
        clean_raw = submitted_order.strip()
        return ([], [clean_raw]) if clean_raw else ([], [])

    if not isinstance(submitted_order, (list, tuple)):
        raise ValueError("submitted_order must be a list of tile IDs or indices.")

    tile_ids: list[str] = []
    surfaces: list[str] = []
    used_surface_ids: set[str] = set()
    for entry in submitted_order:
        if isinstance(entry, int) and not isinstance(entry, bool):
            tid = f"tile_{entry}"
        else:
            tid = str(entry).strip()
        if tid in by_id:
            tile_ids.append(tid)
            surfaces.append(by_id[tid]["surface"])
            used_surface_ids.add(tid)
        else:
            # Allow matching by surface string if caller passed surface blocks directly,
            # preferring an unmatched block when duplicate surfaces exist.
            matched_block = next(
                (b for b in blocks if b["surface"] == tid and b["tile_id"] not in used_surface_ids),
                None,
            ) or next((b for b in blocks if b["surface"] == tid), None)
            if matched_block is not None:
                tile_ids.append(matched_block["tile_id"])
                surfaces.append(matched_block["surface"])
                used_surface_ids.add(matched_block["tile_id"])
            else:
                tile_ids.append(tid)
                surfaces.append(tid)
    return (tile_ids, surfaces)


def grade_scramble_answer(item: dict[str, Any], submitted_order: Any) -> dict[str, Any]:
    """Deterministically grade a submitted tile order and return per-tile diff feedback."""
    blocks: list[dict[str, Any]] = item["blocks"]
    expected_order: list[str] = item["expected_order"]
    canonical_sentence: str = item["canonical_sentence"]
    by_id = {b["tile_id"]: b for b in blocks}

    submitted_ids, submitted_surfaces = _normalize_submitted_order(submitted_order, blocks)
    if not submitted_surfaces or not any(s.strip() for s in submitted_surfaces):
        raise ValueError("submitted_order cannot be empty.")

    expected_surfaces = [b["surface"] for b in blocks]
    submitted_sentence = "".join(submitted_surfaces)
    has_duplicate_ids = bool(submitted_ids) and len(set(submitted_ids)) != len(submitted_ids)
    all_known_ids = (not submitted_ids) or all(tid in by_id for tid in submitted_ids)
    is_correct = (
        not has_duplicate_ids
        and all_known_ids
        and len(submitted_surfaces) == len(expected_surfaces)
        and (submitted_surfaces == expected_surfaces or submitted_sentence == canonical_sentence)
    )

    tile_feedback: list[dict[str, Any]] = []
    max_len = max(len(blocks), len(submitted_surfaces))
    for pos in range(max_len):
        exp_block = blocks[pos] if pos < len(blocks) else None
        sub_id = submitted_ids[pos] if pos < len(submitted_ids) else None
        sub_surface = submitted_surfaces[pos] if pos < len(submitted_surfaces) else ""
        exp_surface = exp_block["surface"] if exp_block else ""
        is_match = bool(exp_block and sub_surface == exp_surface)
        tile_feedback.append(
            {
                "position": pos,
                "expected_tile_id": exp_block["tile_id"] if exp_block else None,
                "expected_surface": exp_surface,
                "submitted_tile_id": sub_id,
                "submitted_surface": sub_surface,
                "is_match": is_match,
                "role": exp_block["role"] if exp_block else "extra",
                "hint": exp_block["hint"] if exp_block else "",
            }
        )

    return {
        "is_correct": is_correct,
        "expected_sentence": canonical_sentence,
        "submitted_sentence": submitted_sentence,
        "expected_order": expected_order,
        "submitted_order": submitted_ids,
        "english_gloss": item.get("english_gloss") or "",
        "tile_feedback": tile_feedback,
    }


def select_scramble_candidates(conn: sqlite3.Connection, limit: int = 10) -> list[dict[str, Any]]:
    """Select real Japanese sentences from cards and word_encounters suitable for 3-6 block scramble."""
    candidates: list[dict[str, Any]] = []
    seen_sentences: set[str] = set()

    # 1. Captured cards with example sentences or source text
    card_rows = conn.execute(
        """
        SELECT id, expression, meaning, example_sentence, example_translation, source_text
        FROM cards
        WHERE TRIM(example_sentence) != '' OR TRIM(source_text) != ''
        ORDER BY id DESC
        LIMIT ?
        """,
        (max(limit * 6, 60),),
    ).fetchall()

    raw_pool: list[tuple[str, str, int | None]] = []
    for row in card_rows:
        sent = str(row["example_sentence"] or "").strip() or str(row["source_text"] or "").strip()
        gloss = str(row["example_translation"] or "").strip() or str(row["meaning"] or "").strip()
        if sent:
            raw_pool.append((sent, gloss, int(row["id"])))

    # 2. Word encounters with recorded sentences
    try:
        enc_rows = conn.execute(
            """
            SELECT sentence
            FROM word_encounters
            WHERE TRIM(sentence) != ''
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
            """,
            (max(limit * 4, 40),),
        ).fetchall()
        for row in enc_rows:
            sent = str(row["sentence"] or "").strip()
            if sent:
                raw_pool.append((sent, "", None))
    except sqlite3.DatabaseError:
        pass

    fallback_short: list[dict[str, Any]] = []
    for sent, gloss, card_id in raw_pool:
        if sent in seen_sentences:
            continue
        blocks = chunk_sentence(sent)
        if len(blocks) < 2:
            continue
        seen_sentences.add(sent)
        if 3 <= len(blocks) <= 6:
            candidates.append(
                build_scramble_item(
                    sent,
                    english_gloss=gloss,
                    source_card_id=card_id,
                    item_index=len(candidates),
                )
            )
            if len(candidates) >= limit:
                return candidates
        elif len(blocks) == 2:
            fallback_short.append(
                build_scramble_item(
                    sent,
                    english_gloss=gloss,
                    source_card_id=card_id,
                    item_index=0,
                )
            )

    for fb in fallback_short:
        if len(candidates) >= limit:
            break
        fb["item_index"] = len(candidates)
        candidates.append(fb)

    return candidates
