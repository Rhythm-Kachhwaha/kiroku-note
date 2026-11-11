"""Shared sentence analysis combining tokenization, morpheme merging, and lemma validation."""
from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache
import logging
from pathlib import Path
from typing import Any

from app.services.tokenizers.base import Morpheme
from app.services.tokenizers.merge import merge_morphemes
from app.services.tokenizers.sudachi import get_sudachi_tokenizer

logger = logging.getLogger(__name__)

MERGE_VERSION = 2

_SKIP_POS = frozenset({"補助記号", "記号", "空白"})


@dataclass(frozen=True, slots=True)
class SentenceAnalysis:
    morphemes: list[Morpheme]
    merged: list[Morpheme]


def _is_skippable_token(morpheme: Morpheme) -> bool:
    if not morpheme.surface or morpheme.surface.isspace():
        return True
    return bool(morpheme.pos) and morpheme.pos[0] in _SKIP_POS


def _lookup_term_exists(dict_lookup: Any, term: str) -> bool:
    clean = (term or "").strip()
    if not clean:
        return False
    if hasattr(dict_lookup, "term_exists"):
        return bool(dict_lookup.term_exists(clean))
    if callable(dict_lookup):
        return bool(dict_lookup(clean))
    if isinstance(dict_lookup, (set, frozenset, dict, list, tuple)):
        return clean in dict_lookup
    return False


def resolve_morphemes(
    morphemes: list[Morpheme],
    *,
    dict_lookup: Any = None,
    sentence: str = "",
    source: str = "",
    log_unresolved: bool = False,
    db_path: Path | str | None = None,
) -> list[Morpheme]:
    """
    Validate proposed lemmas against a dictionary lookup and attach canonical identity.

    Fallback order: proposed lemma -> normalized -> surface.
    If dict_lookup is None, returns morphemes unchanged for backward compatibility.
    """
    if dict_lookup is None:
        return morphemes

    resolved: list[Morpheme] = []
    unresolved_items: list[Morpheme] = []
    has_canonical = hasattr(dict_lookup, "resolve_canonical")

    for m in morphemes:
        if _is_skippable_token(m):
            resolved.append(
                replace(
                    m,
                    unresolved=False,
                    resolution_status="skipped",
                    sequence_id=None,
                    canonical_reading=None,
                )
            )
            continue

        if has_canonical:
            canon = dict_lookup.resolve_canonical(
                m.lemma,
                normalized_form=m.normalized,
                surface=m.surface,
                reading=m.reading,
                pos=m.pos,
            )
            if canon is not None:
                final_lemma = m.lemma if canon.matched_on == "lemma" else canon.term
                resolved.append(
                    replace(
                        m,
                        lemma=final_lemma,
                        unresolved=False,
                        resolution_status="resolved",
                        sequence_id=canon.sequence_id,
                        canonical_reading=canon.reading,
                    )
                )
                continue
        else:
            matched_term: str | None = None
            for candidate in (m.lemma, m.normalized, m.surface):
                if candidate and _lookup_term_exists(dict_lookup, candidate):
                    matched_term = candidate
                    break
            if matched_term is not None:
                resolved.append(
                    replace(
                        m,
                        lemma=matched_term,
                        unresolved=False,
                        resolution_status="resolved",
                    )
                )
                continue

        unresolved_m = replace(
            m,
            unresolved=True,
            resolution_status="unresolved",
            sequence_id=None,
            canonical_reading=None,
        )
        resolved.append(unresolved_m)
        unresolved_items.append(unresolved_m)

    if log_unresolved and unresolved_items:
        try:
            from app.db.connection import record_unresolved_tokens

            record_unresolved_tokens(
                unresolved_items,
                sentence=sentence,
                source=source,
                db_path=db_path,
            )
        except Exception as exc:
            logger.debug("Failed to record unresolved tokens: %s", exc)

    return resolved


@lru_cache(maxsize=2048)
def _analyze_cached(text: str, variant: str, merge_version: int) -> SentenceAnalysis:
    tokenizer = get_sudachi_tokenizer(variant)
    morphemes = tokenizer.tokenize(text)
    merged = merge_morphemes(morphemes)
    return SentenceAnalysis(morphemes=morphemes, merged=merged)


def analyze(
    text: str,
    variant: str = "small",
    *,
    dict_lookup: Any = None,
    log_unresolved: bool = False,
    source: str = "",
    db_path: Path | str | None = None,
) -> SentenceAnalysis:
    """Analyze a Japanese sentence into morphemes and merged units with optional dictionary validation."""
    analysis = _analyze_cached(text, variant, MERGE_VERSION)
    if dict_lookup is None:
        return analysis
    resolved = resolve_morphemes(
        analysis.merged,
        dict_lookup=dict_lookup,
        sentence=text,
        source=source,
        log_unresolved=log_unresolved,
        db_path=db_path,
    )
    return SentenceAnalysis(morphemes=analysis.morphemes, merged=resolved)


def clear_analysis_cache() -> None:
    """Clear LRU cache for tests or updates."""
    _analyze_cached.cache_clear()


def get_analysis_cache_info():
    """Get cache info for monitoring / testing."""
    return _analyze_cached.cache_info()
