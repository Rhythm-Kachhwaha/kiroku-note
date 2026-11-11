"""Read-only access to the bundled grammar reference index."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import sys
import unicodedata
from typing import Any


CREATE_ENRICHMENT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS grammar_enrichment (
    concept_id TEXT PRIMARY KEY,
    big_picture_concept TEXT,
    formation_rules JSON,
    common_pitfalls JSON,
    nuance_contrasts JSON,
    visual_anchor_svg TEXT,
    source_url TEXT,
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_grammar_enrichment_updated_at ON grammar_enrichment(updated_at);
"""


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

        # Load enrichment data if table exists
        enrichment_by_concept: dict[str, dict[str, Any]] = {}
        try:
            has_enrichment = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grammar_enrichment'"
            ).fetchone()
            if has_enrichment:
                for erow in connection.execute("SELECT * FROM grammar_enrichment"):
                    edata = dict(erow)
                    for jfield in ("formation_rules", "common_pitfalls", "nuance_contrasts"):
                        if edata.get(jfield) is not None and isinstance(edata[jfield], str):
                            try:
                                edata[jfield] = json.loads(edata[jfield])
                            except (json.JSONDecodeError, TypeError):
                                pass
                    enrichment_by_concept[edata["concept_id"]] = edata
        except Exception:
            pass

        for row in connection.execute("SELECT * FROM grammar_index ORDER BY id"):
            item = dict(row)
            for field in ("variants", "matcher", "guards", "examples", "sources"):
                if item.get(field) is not None and isinstance(item[field], str):
                    try:
                        item[field] = json.loads(item[field])
                    except (json.JSONDecodeError, TypeError):
                        pass
            cid = item.get("concept_id") or f"c_{item['id']}"
            item["enrichment"] = enrichment_by_concept.get(cid)
            concepts_by_id[cid] = item

            raw_key = item["pattern_key"]
            if "/" in raw_key:
                parts = [p.strip() for p in raw_key.split("/") if p.strip()]
                canonical_key = parts[0]
                aliases = parts[1:]
            else:
                canonical_key = raw_key
                aliases = []
            item["pattern_key"] = canonical_key
            item["pattern_aliases"] = aliases

            norm_canonical = _normalize_key(canonical_key)
            by_key.setdefault(norm_canonical, []).append(item)
            for alias in aliases:
                by_key.setdefault(_normalize_key(alias), []).append(item)
            if raw_key != canonical_key:
                by_key.setdefault(_normalize_key(raw_key), []).append(item)

            existing = index.get(norm_canonical)
            if existing is None:
                if not item.get("sources"):
                    item["sources"] = [dict(item)]
                index[norm_canonical] = item
            else:
                cur_sources = existing.setdefault("sources", [dict(existing)])
                new_sources = item.get("sources") or [dict(item)]
                for s in new_sources:
                    if s not in cur_sources:
                        cur_sources.append(s)

            for alias in aliases:
                norm_alias = _normalize_key(alias)
                if norm_alias not in index:
                    index[norm_alias] = item

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

    def get_enrichment(self, concept_id: str) -> dict[str, Any] | None:
        """Retrieve enrichment data for a concept if available."""
        point = self.get_point_by_concept_id(concept_id)
        if point:
            return point.get("enrichment")
        return None

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None
