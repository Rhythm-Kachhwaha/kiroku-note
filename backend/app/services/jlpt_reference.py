"""Isolated JLPT Reference Service for Kiroku Note.

Queries the bundled OpenJLPT SQLite database to resolve modern JLPT levels (N5..N1)
for Japanese vocabulary words and kanji characters.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Optional

logger = logging.getLogger(__name__)

_VALID_JLPT_LEVELS = {"N1", "N2", "N3", "N4", "N5"}
_DERIVATIONAL_SUFFIXES = ("性", "的", "化", "力", "感", "界", "者", "家")
_LEVEL_PRIORITY = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1}


def resolve_jlpt_reference_db_path() -> Path:
    """Resolve the filesystem path to the bundled jlpt_reference.sqlite database."""
    if env_path := os.environ.get("KIROKU_JLPT_DB_PATH"):
        return Path(env_path)

    if hasattr(sys, "_MEIPASS"):
        meipass_data = Path(sys._MEIPASS) / "app" / "data" / "jlpt_reference.sqlite"
        if meipass_data.exists():
            return meipass_data

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        for candidate in [
            exe_dir / "_internal" / "app" / "data" / "jlpt_reference.sqlite",
            exe_dir / "app" / "data" / "jlpt_reference.sqlite",
        ]:
            if candidate.exists():
                return candidate

    return Path(__file__).resolve().parent.parent / "data" / "jlpt_reference.sqlite"


def _normalize_level(raw: str | None) -> str | None:
    """Normalize raw level text (e.g. 'n5', 'N5', '5') into standard 'N5'..'N1'."""
    if not raw:
        return None
    s = str(raw).strip().upper()
    if s in _VALID_JLPT_LEVELS:
        return s
    if m := re.match(r"^N?([1-5])$", s):
        normalized = f"N{m.group(1)}"
        if normalized in _VALID_JLPT_LEVELS:
            return normalized
    return None


class JlptReferenceService:
    """Service providing read-only JLPT level lookups from the bundled OpenJLPT dataset."""

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path) if db_path is not None else resolve_jlpt_reference_db_path()
        self._conn: Optional[sqlite3.Connection] = None
        self._is_available: Optional[bool] = None

    def _get_connection(self) -> sqlite3.Connection | None:
        """Lazily initialize and cache a read-only connection to the reference SQLite database."""
        if self._conn is not None:
            return self._conn

        if self._is_available is False:
            return None

        if not self._db_path.is_file() or self._db_path.stat().st_size == 0:
            self._is_available = False
            return None

        try:
            # Connect in read-only mode where supported
            abs_path = str(self._db_path.resolve()).replace("\\", "/")
            uri = f"file:{abs_path}?mode=ro"
            try:
                conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            except (sqlite3.OperationalError, sqlite3.DatabaseError):
                conn = sqlite3.connect(str(self._db_path), check_same_thread=False)

            # Quick sanity test on tables
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='vocab' LIMIT 1;")
            if not cursor.fetchone():
                conn.close()
                self._is_available = False
                return None

            self._conn = conn
            self._is_available = True
            return self._conn
        except Exception as err:
            logger.debug("Failed to initialize JLPT reference database at %s: %s", self._db_path, err)
            self._is_available = False
            return None

    def lookup_word(self, expression: str) -> str | None:
        """Lookup modern JLPT level ('N5'..'N1') for a vocabulary expression, or None."""
        if not expression or not expression.strip():
            return None

        conn = self._get_connection()
        if conn is None:
            return None

        clean_expr = expression.strip()
        try:
            cursor = conn.cursor()
            # Query exact match, prefix, suffix, and surrounded space matches
            query = """
                SELECT level FROM vocab 
                WHERE word = ? 
                   OR word LIKE ? 
                   OR word LIKE ? 
                   OR word LIKE ?
            """
            rows = cursor.execute(
                query,
                (clean_expr, f"{clean_expr} %", f"% {clean_expr}", f"% {clean_expr} %"),
            ).fetchall()

            if rows:
                # Pick canonical level with lowest index / easiest grade (N5 over N3 if dual-listed)
                levels = [_normalize_level(r[0]) for r in rows if r and r[0]]
                valid_levels = [lvl for lvl in levels if lvl in _LEVEL_PRIORITY]
                if valid_levels:
                    # Return highest priority (N5 > N4 > N3 > N2 > N1 for beginner safety)
                    return max(valid_levels, key=lambda lvl: _LEVEL_PRIORITY[lvl])

            # Suffix stripping fallback
            for suffix in _DERIVATIONAL_SUFFIXES:
                if clean_expr.endswith(suffix) and len(clean_expr) > len(suffix) + 1:
                    base_expr = clean_expr[:-len(suffix)]
                    base_level = self.lookup_word(base_expr)
                    if base_level:
                        return base_level

            return None
        except Exception as err:
            logger.debug("JLPT vocab lookup failed for '%s': %s", clean_expr, err)
            return None

    def lookup_word_with_kanji_fallback(self, expression: str) -> str | None:
        """Lookup modern JLPT level ('N5'..'N1') with kanji fallback for unlisted compounds."""
        direct = self.lookup_word(expression)
        if direct:
            return direct
        kanji_chars = [ch for ch in expression if "\u4e00" <= ch <= "\u9fff"]
        if not kanji_chars:
            return None
        kanji_levels = [self.lookup_kanji(ch) for ch in kanji_chars]
        valid = [lvl for lvl in kanji_levels if lvl in _LEVEL_PRIORITY]
        if len(valid) == len(kanji_chars):
            # All kanji are known; return the most advanced kanji level
            return min(valid, key=lambda lvl: _LEVEL_PRIORITY[lvl])
        return None

    def lookup_kanji(self, character: str) -> str | None:
        """Lookup modern JLPT level ('N5'..'N1') for a kanji character, or None."""
        if not character or not character.strip():
            return None

        conn = self._get_connection()
        if conn is None:
            return None

        clean_char = character.strip()
        if len(clean_char) > 1:
            clean_char = clean_char[0]

        try:
            cursor = conn.cursor()
            row = cursor.execute("SELECT level FROM kanji WHERE character = ? LIMIT 1;", (clean_char,)).fetchone()
            if row and row[0]:
                return _normalize_level(row[0])
            return None
        except Exception as err:
            logger.debug("JLPT kanji lookup failed for '%s': %s", clean_char, err)
            return None

    def search_english(self, query: str, limit: int = 20) -> list[dict]:
        """Search vocabulary by English meaning keywords/phrases."""
        clean_query = query.strip().lower()
        if not clean_query:
            return []

        norm_query = re.sub(r"^(to|a|an)\s+", "", clean_query)
        words = re.findall(r"\b[a-z0-9'-]+\b", norm_query)
        if not words:
            return []

        conn = self._get_connection()
        if conn is None:
            return []

        try:
            where_clauses = ["meanings LIKE ?" for _ in words]
            params = [f"%{w}%" for w in words]
            sql = f"SELECT word, reading, meanings, level FROM vocab WHERE {' AND '.join(where_clauses)} LIMIT 100;"
            cursor = conn.cursor()
            rows = cursor.execute(sql, params).fetchall()

            scored_entries = []
            level_weights = {"N5": 50, "N4": 40, "N3": 30, "N2": 20, "N1": 10}

            for word, reading, meanings_raw, level in rows:
                try:
                    meanings_list = json.loads(meanings_raw) if meanings_raw else []
                except Exception:
                    meanings_list = [meanings_raw] if meanings_raw else []

                matched = False
                exact_gloss = False
                starts_with_gloss = False
                primary_gloss = meanings_list[0] if meanings_list else ""

                for m in meanings_list:
                    m_lower = str(m).lower()
                    all_words_present = all(re.search(r"\b" + re.escape(w) + r"\b", m_lower) for w in words)
                    if all_words_present:
                        matched = True
                        if m_lower == clean_query or m_lower == f"to {clean_query}":
                            exact_gloss = True
                        elif m_lower.startswith(clean_query) or m_lower.startswith(f"to {clean_query}"):
                            starts_with_gloss = True

                if not matched:
                    continue

                norm_lvl = _normalize_level(level)
                score = level_weights.get(norm_lvl, 0)
                if exact_gloss:
                    score += 100
                elif starts_with_gloss:
                    score += 50

                scored_entries.append({
                    "score": score,
                    "term": word,
                    "reading": reading or word,
                    "senses": [{"glosses": [primary_gloss] if primary_gloss else [""]}],
                    "tags": [norm_lvl] if norm_lvl else [],
                })

            scored_entries.sort(key=lambda x: x["score"], reverse=True)
            return [
                {
                    "term": item["term"],
                    "reading": item["reading"],
                    "senses": item["senses"],
                    "tags": item["tags"],
                }
                for item in scored_entries[:limit]
            ]
        except Exception as err:
            logger.debug("search_english failed for '%s': %s", clean_query, err)
            return []

    def close(self) -> None:
        """Close cached SQLite connection handle if active."""
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            self._is_available = None
