"""Sentence grammar orchestration and small SQLite response cache."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any

from app.config import get_db_path, get_learner_jlpt_level, is_within_learner_level
from app.db.connection import db_session
from .dictionary_provider import DictionaryProvider, YomitanHttpProvider
from .grammar_matcher import GrammarMatcher
from .grammar_reference import GrammarReferenceService, resolve_grammar_reference_db_path


class GrammarService:
    def __init__(
        self,
        provider: DictionaryProvider | None = None,
        matcher: GrammarMatcher | None = None,
        reference: GrammarReferenceService | None = None,
        db_path: str | Path | None = None,
    ):
        self.provider = provider or YomitanHttpProvider()
        self.reference = reference or GrammarReferenceService()
        self.matcher = matcher or GrammarMatcher(self.reference)
        self.db_path = db_path
        self._index_version = self._get_index_version()

    def _get_index_version(self) -> str:
        path = resolve_grammar_reference_db_path()
        try:
            return f"{path.stat().st_mtime_ns}:{path.stat().st_size}"
        except OSError:
            return "missing"

    def _cache_key(self, sentence: str, dictionary_hash: str) -> tuple[str, str, str]:
        digest = hashlib.sha256(sentence.encode("utf-8")).hexdigest()
        return digest, self._index_version, dictionary_hash

    def _cache_get(self, key: tuple[str, str, str]) -> dict[str, Any] | None:
        try:
            with db_session(self.db_path) as conn:
                row = conn.execute(
                    "SELECT response_json FROM grammar_cache WHERE sentence_hash=? AND index_version=? AND grammar_dict_hash=?",
                    key,
                ).fetchone()
                return json.loads(row["response_json"]) if row else None
        except sqlite3.OperationalError:
            return None

    def _cache_put(self, key: tuple[str, str, str], response: dict[str, Any]) -> None:
        try:
            with db_session(self.db_path) as conn:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS grammar_cache (
                        sentence_hash TEXT NOT NULL, index_version TEXT NOT NULL,
                        grammar_dict_hash TEXT NOT NULL, response_json TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY(sentence_hash, index_version, grammar_dict_hash)
                    )"""
                )
                conn.execute(
                    "INSERT OR REPLACE INTO grammar_cache(sentence_hash,index_version,grammar_dict_hash,response_json) VALUES(?,?,?,?)",
                    (*key, json.dumps(response, ensure_ascii=False)),
                )
                conn.commit()
        except sqlite3.DatabaseError:
            pass

    def analyze(self, sentence: str, learner_level: str | None = None) -> dict[str, Any]:
        sentence = sentence.strip()
        level = learner_level or get_learner_jlpt_level()
        # Dictionary discovery is deliberately kept out of the sentence path:
        # analysis is budgeted around one tokenizer request.
        dictionary_hash = hashlib.sha256(type(self.provider).__name__.encode()).hexdigest()
        key = self._cache_key(sentence, dictionary_hash)
        cached = self._cache_get(key)
        if cached is not None:
            return {**cached, "cached": True}

        tokens: list[dict[str, Any]] = []
        limited_offline = False
        try:
            tokens = self.provider.tokenize_with_inflection(sentence)
        except Exception:
            limited_offline = True

        # A selection containing one lexical item is a dictionary lookup, not
        # sentence grammar. This also prevents matching a bare word such as わけ.
        has_sentence_context = len(tokens) > 1 or any(ch in sentence for ch in "。！？、,， \n")
        matches = self.matcher.match_sentence(tokens, sentence) if has_sentence_context else []
        points = [
            item.as_dict() for item in matches
            if is_within_learner_level(item.level, level)
        ]
        response = {
            "sentence": sentence,
            "learner_level": level,
            "points": points,
            "is_limited_offline": limited_offline,
            "cached": False,
        }
        self._cache_put(key, response)
        return response

    def setup_check(self) -> dict[str, Any]:
        try:
            dictionaries = self.provider.discover_available_dictionaries()
        except Exception:
            dictionaries = []
        counts: dict[str, int] = {}
        try:
            for point in self.reference._load().values():
                counts[point.get("level", "unknown")] = counts.get(point.get("level", "unknown"), 0) + 1
            index_loaded = bool(counts)
        except Exception:
            index_loaded = False
        try:
            yomitan_available = bool(self.provider.check_availability())
        except Exception:
            yomitan_available = False
        return {
            "yomitan_available": yomitan_available,
            "index_loaded": index_loaded,
            "point_counts_by_level": counts,
            "designated_grammar_dictionary_hits": dictionaries,
        }
