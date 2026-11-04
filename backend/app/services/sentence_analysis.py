"""Shared sentence analysis combining tokenization and morpheme merging."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from app.services.tokenizers.base import Morpheme
from app.services.tokenizers.merge import merge_morphemes
from app.services.tokenizers.sudachi import get_sudachi_tokenizer

MERGE_VERSION = 1


@dataclass(frozen=True, slots=True)
class SentenceAnalysis:
    morphemes: list[Morpheme]
    merged: list[Morpheme]


@lru_cache(maxsize=2048)
def _analyze_cached(text: str, variant: str, merge_version: int) -> SentenceAnalysis:
    tokenizer = get_sudachi_tokenizer(variant)
    morphemes = tokenizer.tokenize(text)
    merged = merge_morphemes(morphemes)
    return SentenceAnalysis(morphemes=morphemes, merged=merged)


def analyze(text: str, variant: str = "small") -> SentenceAnalysis:
    """Analyze a Japanese sentence into morphemes and merged units with LRU cache."""
    return _analyze_cached(text, variant, MERGE_VERSION)


def clear_analysis_cache() -> None:
    """Clear LRU cache for tests or updates."""
    _analyze_cached.cache_clear()


def get_analysis_cache_info():
    """Get cache info for monitoring / testing."""
    return _analyze_cached.cache_info()
