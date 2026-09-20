"""Isolated JLPT Reference Service for Kiroku Note.

Queries the bundled OpenJLPT SQLite database to resolve modern JLPT levels (N5..N1)
for Japanese vocabulary words and kanji characters.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
from typing import Optional

logger = logging.getLogger(__name__)

_VALID_JLPT_LEVELS = {"N1", "N2", "N3", "N4", "N5"}


def resolve_jlpt_reference_db_path() -> Path:
    """Resolve the filesystem path to the bundled jlpt_reference.sqlite database."""
    if env_path := os.environ.get("KIROKU_JLPT_DB_PATH"):
        return Path(env_path)

    if hasattr(sys, "_MEIPASS"):
        meipass_data = Path(sys._MEIPASS) / "app" / "data" / "jlpt_reference.sqlite"
        if meipass_data.exists():
            return meipass_data

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
            row = cursor.execute("SELECT level FROM vocab WHERE word = ? LIMIT 1;", (clean_expr,)).fetchone()
            if row and row[0]:
                return _normalize_level(row[0])
            return None
        except Exception as err:
            logger.debug("JLPT vocab lookup failed for '%s': %s", clean_expr, err)
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

    def close(self) -> None:
        """Close cached SQLite connection handle if active."""
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
            self._is_available = None
