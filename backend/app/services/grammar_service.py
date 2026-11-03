"""Sentence grammar orchestration and small SQLite response cache."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import logging
from pathlib import Path
import re
import sqlite3
import time
from typing import Any

from app.config import (
    get_db_path,
    get_learner_jlpt_level,
    get_sudachi_dictionary_variant,
    is_within_learner_level,
    normalize_jlpt_level,
)
from app.db.connection import db_session
from .dictionary_provider import DictionaryProvider, LocalDictionaryProvider
from .grammar_matcher import GrammarMatcher
from .grammar_reference import GrammarReferenceService, resolve_grammar_reference_db_path
from .tokenizers import get_sudachi_tokenizer, sudachi_status

logger = logging.getLogger(__name__)

GRAMMAR_CACHE_TTL_SECONDS = 24 * 60 * 60
GRAMMAR_CACHE_MAX_ENTRIES = 1000


class GrammarService:
    def __init__(
        self,
        provider: DictionaryProvider | None = None,
        matcher: GrammarMatcher | None = None,
        reference: GrammarReferenceService | None = None,
        db_path: str | Path | None = None,
    ):
        self.provider = provider or LocalDictionaryProvider()
        self.reference = reference or GrammarReferenceService()
        self.matcher = matcher or GrammarMatcher(self.reference)
        self.db_path = db_path
        self._index_version = self._get_index_version()
        self._ensure_cache_schema()

    def _get_index_version(self) -> str:
        path = resolve_grammar_reference_db_path()
        try:
            return f"{path.stat().st_mtime_ns}:{path.stat().st_size}"
        except OSError:
            return "missing"

    def _tokenizer_version(self, dictionary_variant: str) -> str:
        versions: list[str] = []
        for package in ("SudachiPy", f"sudachidict_{dictionary_variant}"):
            try:
                versions.append(f"{package}={importlib.metadata.version(package)}")
            except importlib.metadata.PackageNotFoundError:
                versions.append(f"{package}=missing")
        return f"sudachi:{dictionary_variant}:{';'.join(versions)}"

    def _ensure_cache_schema(self) -> None:
        try:
            with db_session(self.db_path) as conn:
                columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(grammar_cache)").fetchall()
                }
                if columns and "tokenizer_version" not in columns:
                    conn.execute("DROP TABLE grammar_cache")
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS grammar_cache (
                        sentence_hash TEXT NOT NULL,
                        index_version TEXT NOT NULL,
                        tokenizer_version TEXT NOT NULL,
                        grammar_dict_hash TEXT NOT NULL,
                        response_json TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        PRIMARY KEY(
                            sentence_hash, index_version,
                            tokenizer_version, grammar_dict_hash
                        )
                    )"""
                )
                cutoff = time.time() - GRAMMAR_CACHE_TTL_SECONDS
                conn.execute("DELETE FROM grammar_cache WHERE created_at <= ?", (cutoff,))
                conn.execute(
                    """DELETE FROM grammar_cache
                    WHERE rowid NOT IN (
                        SELECT rowid FROM grammar_cache
                        ORDER BY created_at DESC
                        LIMIT ?
                    )""",
                    (GRAMMAR_CACHE_MAX_ENTRIES,),
                )
                conn.commit()
        except sqlite3.DatabaseError as exc:
            logger.warning("Unable to maintain grammar analysis cache: %s", exc)

    def _cache_key(
        self,
        sentence: str,
        tokenizer_version: str,
        dictionary_hash: str,
    ) -> tuple[str, str, str, str]:
        digest = hashlib.sha256(sentence.encode("utf-8")).hexdigest()
        self._index_version = self._get_index_version()
        return digest, self._index_version, tokenizer_version, dictionary_hash

    def _cache_get(self, key: tuple[str, str, str, str]) -> dict[str, Any] | None:
        try:
            with db_session(self.db_path) as conn:
                row = conn.execute(
                    """SELECT response_json FROM grammar_cache
                    WHERE sentence_hash=? AND index_version=?
                      AND tokenizer_version=? AND grammar_dict_hash=?
                      AND created_at > ?""",
                    (*key, time.time() - GRAMMAR_CACHE_TTL_SECONDS),
                ).fetchone()
                return json.loads(row["response_json"]) if row else None
        except (sqlite3.DatabaseError, json.JSONDecodeError) as exc:
            logger.warning("Unable to read grammar analysis cache: %s", exc)
            return None

    def _cache_put(self, key: tuple[str, str, str, str], response: dict[str, Any]) -> None:
        try:
            with db_session(self.db_path) as conn:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS grammar_cache (
                        sentence_hash TEXT NOT NULL, index_version TEXT NOT NULL,
                        tokenizer_version TEXT NOT NULL, grammar_dict_hash TEXT NOT NULL,
                        response_json TEXT NOT NULL, created_at REAL NOT NULL,
                        PRIMARY KEY(sentence_hash, index_version, tokenizer_version, grammar_dict_hash)
                    )"""
                )
                conn.execute(
                    """INSERT OR REPLACE INTO grammar_cache(
                        sentence_hash,index_version,tokenizer_version,
                        grammar_dict_hash,response_json,created_at
                    ) VALUES(?,?,?,?,?,?)""",
                    (*key, json.dumps(response, ensure_ascii=False), time.time()),
                )
                conn.execute(
                    """DELETE FROM grammar_cache
                    WHERE rowid NOT IN (
                        SELECT rowid FROM grammar_cache
                        ORDER BY created_at DESC
                        LIMIT ?
                    )""",
                    (GRAMMAR_CACHE_MAX_ENTRIES,),
                )
                conn.commit()
        except sqlite3.DatabaseError as exc:
            logger.warning("Unable to write grammar analysis cache: %s", exc)

    def _local_tokens(self, sentence: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        dictionary_variant = get_sudachi_dictionary_variant()
        status = sudachi_status(dictionary_variant)
        if not status.get("ready"):
            return [], {
                "source": "none",
                "status": "unavailable",
                "version": self._tokenizer_version(dictionary_variant),
            }
        tokenizer = get_sudachi_tokenizer(dictionary_variant)
        tokens = [
            {
                "text": morpheme.surface,
                "surface": morpheme.surface,
                "lemma": morpheme.lemma,
                "base_form": morpheme.lemma,
                "reading": morpheme.reading,
                "pos": " ".join(morpheme.pos),
                "start": morpheme.start,
                "end": morpheme.end,
            }
            for morpheme in tokenizer.tokenize(sentence)
        ]
        return tokens, {
            "source": "sudachi",
            "status": "ready",
            "version": self._tokenizer_version(dictionary_variant),
        }

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
        tokens, tokenizer = self._local_tokens(sentence)
        # Dictionary discovery is deliberately kept out of the sentence path:
        # analysis is budgeted around one local tokenizer request.
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
        key = self._cache_key(sentence, tokenizer["version"], dictionary_hash)
        cached = self._cache_get(key) if tokenizer["source"] == "sudachi" else None
        if cached is not None and cached.get("tokenizer_source") == "sudachi":
            # The cache predates learner-level-aware keys. Re-filter cached
            # points so a response generated for another level cannot leak
            # out-of-scope grammar.
            points = [
                point for point in cached.get("points", [])
                if is_within_learner_level(point.get("level"), filter_level)
            ]
            if hide_known:
                cached_points = self._hide_known({"points": points})
                points = cached_points
            return {**cached, "learner_level": level, "points": points, "cached": True}

        limited_offline = tokenizer["source"] != "sudachi"

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
            "tokenizer_source": tokenizer["source"],
            "tokenizer_status": tokenizer["status"],
            "cached": False,
        }
        if tokenizer["source"] == "sudachi" and not limited_offline:
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
        except Exception as exc:
            logger.warning("Unable to discover local grammar dictionaries: %s", exc)
            dictionaries = []
        counts: dict[str, int] = {}
        try:
            for point in self.reference._load().values():
                counts[point.get("level", "unknown")] = counts.get(point.get("level", "unknown"), 0) + 1
            index_loaded = bool(counts)
        except Exception:
            index_loaded = False
        tokenizer = self._local_tokens("日")[1]
        return {
            "yomitan_available": False,
            "index_loaded": index_loaded,
            "point_counts_by_level": counts,
            "designated_grammar_dictionary_hits": dictionaries,
            "tokenizer_source": tokenizer["source"],
            "tokenizer_status": tokenizer["status"],
        }
