"""Dedicated KanjiVG Stroke Order Service for Kiroku Note.

Provides fast, in-memory LRU-cached access to stroke order vector graphics (SVG)
for common Japanese kanji characters from the bundled kanji_strokes.sqlite database.

Dataset: KanjiVG (CC BY-SA 3.0) by Ulrich Apel and contributors.
"""
from __future__ import annotations

import functools
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Optional

logger = logging.getLogger(__name__)


def resolve_kanji_strokes_db_path() -> Path:
    """Resolve the filesystem path to the bundled kanji_strokes.sqlite database."""
    if env_path := (os.environ.get("KIROKU_KANJIVG_DB_PATH") or os.environ.get("KANJIVG_DB_PATH")):
        return Path(env_path)

    if hasattr(sys, "_MEIPASS"):
        meipass_data = Path(sys._MEIPASS) / "app" / "data" / "kanji_strokes.sqlite"
        if meipass_data.exists():
            return meipass_data

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        for candidate in [
            exe_dir / "_internal" / "app" / "data" / "kanji_strokes.sqlite",
            exe_dir / "app" / "data" / "kanji_strokes.sqlite",
        ]:
            if candidate.exists():
                return candidate

    return Path(__file__).resolve().parent.parent / "data" / "kanji_strokes.sqlite"


class KanjiStrokesService:
    """Service providing read-only Kanji stroke order SVG lookups with in-memory LRU caching."""

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path) if db_path is not None else resolve_kanji_strokes_db_path()
        self._conn: Optional[sqlite3.Connection] = None
        self._is_available: Optional[bool] = None

    def _get_connection(self) -> sqlite3.Connection | None:
        """Lazily initialize and cache a read-only connection to the SQLite database."""
        if self._conn is not None:
            return self._conn

        if self._is_available is False:
            return None

        if not self._db_path.is_file() or self._db_path.stat().st_size == 0:
            self._is_available = False
            return None

        try:
            abs_path = str(self._db_path.resolve()).replace("\\", "/")
            uri = f"file:{abs_path}?mode=ro"
            try:
                conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
            except (sqlite3.OperationalError, sqlite3.DatabaseError):
                conn = sqlite3.connect(str(self._db_path), check_same_thread=False)

            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kanji_strokes' LIMIT 1;")
            if not cursor.fetchone():
                conn.close()
                self._is_available = False
                return None

            self._conn = conn
            self._is_available = True
            return self._conn
        except Exception as err:
            logger.debug("Failed to initialize Kanji strokes database at %s: %s", self._db_path, err)
            self._is_available = False
            return None

    def _query_db(self, clean_char: str) -> str | None:
        """Internal uncached query against the SQLite database."""
        conn = self._get_connection()
        if conn is None:
            return None

        try:
            cursor = conn.cursor()
            # 1. Direct character query
            row = cursor.execute(
                "SELECT svg FROM kanji_strokes WHERE character = ? LIMIT 1;",
                (clean_char,),
            ).fetchone()
            if row and row[0]:
                return row[0]

            # 2. Hex codepoint fallback (e.g. '0610f' or '610F')
            if re.match(r"^[0-9a-fA-F]{4,5}$", clean_char):
                codepoint = f"{int(clean_char, 16):05x}"
                row = cursor.execute(
                    "SELECT svg FROM kanji_strokes WHERE codepoint = ? LIMIT 1;",
                    (codepoint,),
                ).fetchone()
                if row and row[0]:
                    return row[0]

            return None
        except Exception as err:
            logger.debug("Kanji strokes lookup query failed for '%s': %s", clean_char, err)
            return None

    @functools.lru_cache(maxsize=500)
    def get_stroke_svg(self, character: str) -> str | None:
        """Lookup stroke order SVG for a kanji character or hex codepoint.

        Caches up to 500 characters in memory using LRU policy.
        Returns the clean, inline-styled SVG string or None if not found.
        """
        if not character or not str(character).strip():
            return None

        clean_char = str(character).strip()
        # If multi-char string given without hex format, take first character
        if len(clean_char) > 1 and not re.match(r"^[0-9a-fA-F]{4,5}$", clean_char):
            clean_char = clean_char[0]

        return self._query_db(clean_char)

    def cache_info(self):
        """Return the LRU cache statistics."""
        return self.get_stroke_svg.cache_info()

    def clear_cache(self):
        """Clear the in-memory LRU cache."""
        self.get_stroke_svg.cache_clear()


# Global singleton instance
_kanji_strokes_service: Optional[KanjiStrokesService] = None


def get_kanji_strokes_service() -> KanjiStrokesService:
    """Return the global KanjiStrokesService singleton."""
    global _kanji_strokes_service
    if _kanji_strokes_service is None:
        _kanji_strokes_service = KanjiStrokesService()
    return _kanji_strokes_service
