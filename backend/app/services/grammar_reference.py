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

    _index_cache: dict[Path, dict[str, Any]] = {}

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path) if db_path is not None else resolve_grammar_reference_db_path()
        self._connection: sqlite3.Connection | None = None
        self._loaded_data = self._index_cache.get(self._db_path.resolve())

    def _load(self) -> dict[str, dict[str, Any]]:
        if self._loaded_data is not None:
            return self._loaded_data["index"]
        path = self._db_path.resolve()
        uri = f"file:{path.as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        self._connection = connection
        concepts_by_id: dict[str, dict[str, Any]] = {}
        by_key: dict[str, list[dict[str, Any]]] = {}
        index: dict[str, dict[str, Any]] = {}

        for row in connection.execute("SELECT * FROM grammar_index ORDER BY id"):
            item = dict(row)
            for field in ("variants", "matcher", "guards", "examples", "sources"):
                if item.get(field) is not None and isinstance(item[field], str):
                    try:
                        item[field] = json.loads(item[field])
                    except (json.JSONDecodeError, TypeError):
                        pass
            cid = item.get("concept_id") or f"c_{item['id']}"
            concepts_by_id[cid] = item

            norm_key = _normalize_key(item["pattern_key"])
            by_key.setdefault(norm_key, []).append(item)

            existing = index.get(norm_key)
            if existing is None:
                if not item.get("sources"):
                    item["sources"] = [dict(item)]
                index[norm_key] = item
            else:
                cur_sources = existing.setdefault("sources", [dict(existing)])
                new_sources = item.get("sources") or [dict(item)]
                for s in new_sources:
                    if s not in cur_sources:
                        cur_sources.append(s)

        self._loaded_data = {
            "concepts_by_id": concepts_by_id,
            "by_key": by_key,
            "index": index,
        }
        self._index_cache[path] = self._loaded_data
        return index

    def get_point_by_key(self, pattern_key: str) -> dict[str, Any] | None:
        self._load()
        matches = self._loaded_data["by_key"].get(_normalize_key(pattern_key), [])
        return matches[0] if matches else None

    def get_points_by_key(self, pattern_key: str) -> list[dict[str, Any]]:
        self._load()
        return list(self._loaded_data["by_key"].get(_normalize_key(pattern_key), []))

    def get_point_by_concept_id(self, concept_id: str) -> dict[str, Any] | None:
        self._load()
        return self._loaded_data["concepts_by_id"].get(concept_id)

    def get_points(self) -> list[dict[str, Any]]:
        self._load()
        return list(self._loaded_data["concepts_by_id"].values())

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None
