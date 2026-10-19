"""
schema.py -- Database schema, normalization, and compression utilities for kiroku_dictionary.
"""
from __future__ import annotations

import json
import sqlite3
import unicodedata
import zlib
from typing import Any

SCHEMA_VERSION = "1.0.0"

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    reading TEXT NOT NULL,
    norm_term TEXT NOT NULL,
    norm_reading TEXT NOT NULL,
    rules TEXT NOT NULL,
    def_tags TEXT,
    score REAL NOT NULL DEFAULT 0,
    sequence INTEGER NOT NULL DEFAULT 0,
    term_tags TEXT,
    dictionary TEXT NOT NULL,
    content_blob BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS kanji (
    character TEXT PRIMARY KEY,
    onyomi TEXT NOT NULL,
    kunyomi TEXT NOT NULL,
    tags TEXT,
    stats_json TEXT NOT NULL,
    meanings_json TEXT NOT NULL,
    dictionary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    sorting_order REAL NOT NULL DEFAULT 0,
    notes TEXT,
    score REAL NOT NULL DEFAULT 0,
    dictionary TEXT NOT NULL,
    PRIMARY KEY (name, dictionary)
);
"""

CREATE_INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_terms_term ON terms(term);
CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms(reading);
CREATE INDEX IF NOT EXISTS idx_terms_norm_reading ON terms(norm_reading);
"""


def katakana_to_hiragana(text: str) -> str:
    """Convert Katakana characters (U+30A1..U+30F6) to Hiragana (U+3041..U+3096)."""
    chars = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            chars.append(chr(code - 0x60))
        elif code == 0x30F7:  # ヷ -> わ゙
            chars.append("わ\u3099")
        elif code == 0x30F8:  # ヸ -> ゐ゙
            chars.append("ゐ\u3099")
        elif code == 0x30F9:  # ヹ -> ゑ゙
            chars.append("ゑ\u3099")
        elif code == 0x30FA:  # ヺ -> を゙
            chars.append("を\u3099")
        else:
            chars.append(ch)
    return "".join(chars)


def normalize_text(text: str) -> str:
    """
    Fold text for indexed dictionary lookup:
    1. Unicode NFKC (folds half-width katakana, full-width ascii, decomposition)
    2. Katakana -> Hiragana folding
    3. Strip surrounding whitespace and lowercase ASCII.
    """
    if not text:
        return ""
    nfkc = unicodedata.normalize("NFKC", text).strip().lower()
    return katakana_to_hiragana(nfkc)


def compress_content(data: Any) -> bytes:
    """Compress structured content AST or glossary JSON with zlib level 6."""
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return zlib.compress(serialized, level=6)


def decompress_content(blob: bytes) -> Any:
    """Decompress structured content AST or glossary JSON."""
    decompressed = zlib.decompress(blob).decode("utf-8")
    return json.loads(decompressed)


def create_schema(conn: sqlite3.Connection) -> None:
    """Create all required tables."""
    conn.executescript(CREATE_TABLES_SQL)


def create_indexes(conn: sqlite3.Connection) -> None:
    """Create all indexes after bulk insertion for optimal build performance."""
    conn.executescript(CREATE_INDEXES_SQL)


def apply_build_pragmas(conn: sqlite3.Connection) -> None:
    """Configure fast write-oriented pragmas for the build process."""
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA page_size = 4096;")
    conn.execute("PRAGMA cache_size = -64000;")  # 64 MB cache
    conn.execute("PRAGMA temp_store = MEMORY;")


def apply_runtime_pragmas(conn: sqlite3.Connection) -> None:
    """Configure memory-efficient, low-latency read-only runtime pragmas."""
    conn.execute("PRAGMA query_only = ON;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA mmap_size = 268435456;")  # Memory-map up to 256MB
    conn.execute("PRAGMA cache_size = -8000;")     # ~8MB RAM cache
