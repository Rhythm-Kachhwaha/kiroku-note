"""Sentence grammar orchestration and small SQLite response cache."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any

from app.config import (
    get_db_path,
    get_learner_jlpt_level,
    is_within_learner_level,
    normalize_jlpt_level,
)
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

    def _dictionary_notes(
        self, points: list[dict[str, Any]], dictionary_name: str | None
    ) -> None:
        if not dictionary_name:
            return
        try:
            if not self.provider.check_availability():
                return
        except Exception:
            return
        seen: set[str] = set()
        for point in points[:5]:
            key = point.get("pattern_key")
            if not isinstance(key, str) or key in seen:
                continue
            seen.add(key)
            try:
                entries = self.provider.scan_term_entries(point.get("text", ""))
            except Exception:
                continue
            notes: list[dict[str, str]] = []
            for entry in entries if isinstance(entries, list) else []:
                if not isinstance(entry, dict):
                    continue
                entry_dictionary = str(entry.get("dictionary", "")).strip()
                definitions = entry.get("definitions", [])
                if entry_dictionary and entry_dictionary != dictionary_name:
                    continue
                candidates = definitions if isinstance(definitions, list) else [entry]
                for definition in candidates:
                    if not isinstance(definition, dict):
                        continue
                    text = definition.get("glosses") or definition.get("definition") or definition.get("content")
                    if isinstance(text, list):
                        text = "; ".join(str(item) for item in text if isinstance(item, str))
                    if not isinstance(text, str):
                        continue
                    text = re.sub(r"<[^>]+>", "", text).strip()
                    if text:
                        notes.append({"dictionary": dictionary_name, "text": text[:500]})
                    if len(notes) >= 3:
                        break
                if len(notes) >= 3:
                    break
            if notes:
                point["dictionary_notes"] = notes

    def analyze(
        self,
        sentence: str,
        learner_level: str | None = None,
        *,
        show_basic_particles: bool = False,
        source: str = "text",
        hide_known: bool = False,
        designated_dictionary: str | None = None,
        show_below_level: bool = True,
    ) -> dict[str, Any]:
        sentence = sentence.strip()
        level = normalize_jlpt_level(learner_level) or get_learner_jlpt_level()
        filter_level = level if show_below_level else "N1"
        # Dictionary discovery is deliberately kept out of the sentence path:
        # analysis is budgeted around one tokenizer request.
        # Learner filtering changes the response, so keep cache entries isolated
        # by the normalized level rather than allowing a filtered response to
        # satisfy a request for a broader level.
        dictionary_hash = hashlib.sha256(
            json.dumps({
                "provider": type(self.provider).__name__, "level": level,
                "filter_level": filter_level, "show_basic_particles": show_basic_particles,
                "source": source, "hide_known": hide_known,
                "designated_dictionary": designated_dictionary or "",
            }, sort_keys=True).encode()
        ).hexdigest()
        key = self._cache_key(sentence, dictionary_hash)
        cached = self._cache_get(key)
        if cached is not None:
            # The cache predates learner-level-aware keys. Re-filter cached
            # points so a response generated for another level cannot leak
            # out-of-scope grammar.
            points = [
                point for point in cached.get("points", [])
                if is_within_learner_level(point.get("level"), filter_level)
            ]
            if hide_known:
                cached_points = self._hide_known(cached)
                points = cached_points
            return {**cached, "learner_level": level, "points": points, "cached": True}

        tokens: list[dict[str, Any]] = []
        limited_offline = not getattr(self.provider, "supports_sentence_tokenization", True)
        try:
            tokens = self.provider.tokenize_with_inflection(sentence)
        except Exception:
            limited_offline = True

        # A selection containing one lexical item is a dictionary lookup, not
        # sentence grammar. This also prevents matching a bare word such as わけ.
        # Without a tokenizer, retain literal matching for sentence-like
        # selections while continuing to suppress isolated short words.
        has_sentence_context = (
            len(tokens) > 1
            or any(ch in sentence for ch in "。！？、,， \n")
            or (limited_offline and len(sentence) > 2)
        )
        matches = self.matcher.match_sentence(
            tokens, sentence, show_basic_particles=show_basic_particles
        ) if has_sentence_context else []
        points = [
            item.as_dict() for item in matches
            if is_within_learner_level(item.level, filter_level)
        ]
        if hide_known:
            points = self._hide_known({"points": points})
        self._dictionary_notes(points, designated_dictionary)
        response = {
            "sentence": sentence,
            "learner_level": level,
            "points": points,
            "is_limited_offline": limited_offline,
            "cached": False,
        }
        self._cache_put(key, response)
        return response

    def _hide_known(self, response: dict[str, Any]) -> list[dict[str, Any]]:
        points = response.get("points", [])
        if not points:
            return []
        keys = [point.get("pattern_key") for point in points if point.get("pattern_key")]
        try:
            with db_session(self.db_path) as conn:
                known = {
                    row["pattern_key"] for row in conn.execute(
                        f"SELECT pattern_key FROM grammar_points WHERE status IN ('known', 'ignored') "
                        f"AND pattern_key IN ({','.join('?' for _ in keys)})", keys
                    )
                }
        except sqlite3.DatabaseError:
            known = set()
        return [point for point in points if point.get("pattern_key") not in known]

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
