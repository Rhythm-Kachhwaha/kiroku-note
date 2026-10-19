"""
kiroku_dictionary -- Standalone local dictionary engine for Japanese vocabulary and kanji.

Uses Python standard library only (sqlite3, json, zipfile, re, unicodedata, dataclasses, zlib).
No third-party dependencies. Can be imported without importing backend/app.
"""
from __future__ import annotations

import os

from .lookup import DictionaryEngine, KanjiResult, TermDefinition, TermHeadwordGroup
from .deinflect import DeinflectionCandidate, deinflect

__version__ = "1.0.0"

_DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "kiroku_dict.sqlite"
)

_global_engine: DictionaryEngine | None = None


def get_default_engine(db_path: str | None = None) -> DictionaryEngine:
    global _global_engine
    target_path = db_path or os.getenv("KIROKU_DICT_SQLITE") or _DEFAULT_DB_PATH
    if _global_engine is None or _global_engine.db_path != target_path:
        _global_engine = DictionaryEngine(target_path)
    return _global_engine


def lookup_terms(text: str, max_results: int = 10, db_path: str | None = None) -> list[TermHeadwordGroup]:
    engine = get_default_engine(db_path)
    return engine.lookup_terms(text, max_results=max_results)


def lookup_kanji(text: str, db_path: str | None = None) -> list[KanjiResult]:
    engine = get_default_engine(db_path)
    return engine.lookup_kanji(text)


__all__ = [
    "DictionaryEngine",
    "TermHeadwordGroup",
    "TermDefinition",
    "KanjiResult",
    "DeinflectionCandidate",
    "deinflect",
    "get_default_engine",
    "lookup_terms",
    "lookup_kanji",
]
