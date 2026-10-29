"""Read-only access to the bundled grammar reference index."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import sys
import unicodedata
from typing import Any


def _normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip()
    value = value.replace("〜", "").replace("~", "").replace("～", "")
    return "".join(
        chr(ord(char) - 0x60) if "\u30a1" <= char <= "\u30f6" else char
        for char in value
    )


def resolve_grammar_reference_db_path() -> Path:
    if env_path := os.environ.get("KIROKU_GRAMMAR_DB_PATH"):
        return Path(env_path)
    if hasattr(sys, "_MEIPASS"):
        candidate = Path(sys._MEIPASS) / "app" / "data" / "grammar_reference.sqlite"
        if candidate.exists():
            return candidate
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        for candidate in (
            exe_dir / "_internal" / "app" / "data" / "grammar_reference.sqlite",
            exe_dir / "app" / "data" / "grammar_reference.sqlite",
        ):
            if candidate.exists():
                return candidate
    return Path(__file__).resolve().parent.parent / "data" / "grammar_reference.sqlite"


class GrammarReferenceService:
    """Look up grammar points, loading the small reference index only once."""

    _index_cache: dict[Path, dict[str, dict[str, Any]]] = {}

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path) if db_path is not None else resolve_grammar_reference_db_path()
        self._connection: sqlite3.Connection | None = None
        self._index = self._index_cache.get(self._db_path.resolve())

    def _load(self) -> dict[str, dict[str, Any]]:
        if self._index is not None:
            return self._index
        path = self._db_path.resolve()
        uri = f"file:{path.as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        self._connection = connection
        index: dict[str, dict[str, Any]] = {}
        for row in connection.execute("SELECT * FROM grammar_index"):
            item = dict(row)
            for field in ("variants", "matcher", "guards", "examples"):
                if item[field] is not None:
                    item[field] = json.loads(item[field])
            key = item["pattern_key"]
            existing = index.get(key)
            if existing is None:
                # Keep the historical top-level shape while exposing every
                # source row when display normalization causes a collision.
                item["sources"] = [dict(item)]
                index[key] = item
            else:
                existing["sources"].append(item)
        self._index_cache[path] = index
        self._index = index
        return index

    def get_point_by_key(self, pattern_key: str) -> dict[str, Any] | None:
        return self._load().get(_normalize_key(pattern_key))

    def get_points(self) -> list[dict[str, Any]]:
        return list(self._load().values())

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None
