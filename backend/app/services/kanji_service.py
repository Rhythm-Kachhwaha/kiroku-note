"""Kanji query and compound mining service for Kiroku Note."""
from __future__ import annotations

import functools
import json
import logging
from pathlib import Path
import re
import sqlite3
import threading
from typing import Any

from app.services.kanji_strokes import get_kanji_strokes_service
from app.services.operational_diagnostics import record_operational_failure


logger = logging.getLogger(__name__)

JLPT_REF_PATH = Path(__file__).resolve().parent.parent / "data" / "jlpt_reference.sqlite"


def resolve_kanji_dict_path() -> Path:
    """Resolve the location of kiroku_dict.sqlite via kiroku_dictionary.paths."""
    from kiroku_dictionary.paths import resolve_db_path
    return resolve_db_path()


_local_storage = threading.local()


def _get_reusable_connection(db_path: Path) -> sqlite3.Connection | None:
    """Return a cached, read-only SQLite connection for the current thread."""
    if not hasattr(_local_storage, "connections"):
        _local_storage.connections = {}
    path_key = str(db_path.resolve())
    conn = _local_storage.connections.get(path_key)
    if conn is not None:
        try:
            conn.execute("SELECT 1")
            return conn
        except (sqlite3.ProgrammingError, sqlite3.OperationalError):
            pass

    if not db_path.is_file():
        return None

    try:
        abs_posix = db_path.resolve().as_posix()
        conn = sqlite3.connect(f"file:{abs_posix}?mode=ro", uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _local_storage.connections[path_key] = conn
        return conn
    except Exception as exc:
        record_operational_failure("kanji.connection", exc, level=logging.DEBUG)
        return None


def _extract_gloss_from_content(content: Any) -> str:
    """Extract English gloss string from Yomitan structured-content JSON blob."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        items = []
        for item in content:
            txt = _extract_gloss_from_content(item)
            if txt:
                items.append(txt)
        return "; ".join(items)
    if isinstance(content, dict):
        if content.get("data", {}).get("content") == "part-of-speech-info":
            return ""
        if "content" in content:
            return _extract_gloss_from_content(content["content"])
        if "text" in content:
            return content["text"]
    return ""


@functools.lru_cache(maxsize=1024)
def _cached_compounds_for_char(dict_path_str: str, clean_char: str) -> list[dict[str, Any]]:
    """Query and cache top compounds for a kanji character with an LRU cache."""
    db_path = Path(dict_path_str)
    if not db_path.is_file():
        return []

    try:
        from kiroku_dictionary.schema import decompress_content
    except ImportError:
        decompress_content = None

    compounds: list[dict[str, Any]] = []
    try:
        conn = _get_reusable_connection(db_path)
        if conn is None:
            return []

        cursor = conn.execute(
            """SELECT term, reading, score, content_blob FROM terms
               WHERE (term LIKE ? OR norm_term LIKE ?) AND length(term) >= 2
               ORDER BY score DESC LIMIT 50""",
            (f"%{clean_char}%", f"%{clean_char}%"),
        )
        for row in cursor:
            gloss = ""
            if row["content_blob"] and decompress_content:
                try:
                    content = decompress_content(row["content_blob"])
                    raw_gloss = _extract_gloss_from_content(content)
                    parts = [p.strip() for p in raw_gloss.split(";") if p.strip()]
                    seen = set()
                    deduped = []
                    for p in parts:
                        if p.lower() not in seen and not p.startswith("http"):
                            seen.add(p.lower())
                            deduped.append(p)
                    gloss = " · ".join(deduped[:4])
                except Exception as exc:
                    record_operational_failure("kanji.compound_gloss", exc, level=logging.DEBUG)

            compounds.append({
                "term": row["term"],
                "reading": row["reading"],
                "meaning": gloss or "Compound definition available",
                "score": float(row["score"] or 0),
            })
    except Exception as exc:
        record_operational_failure("kanji.compounds", exc, level=logging.DEBUG)

    return compounds


class KanjiService:
    def __init__(
        self,
        jlpt_db_path: Path | str | None = None,
        dict_db_path: Path | str | None = None,
    ):
        self.jlpt_db_path = Path(jlpt_db_path) if jlpt_db_path else JLPT_REF_PATH
        self.dict_db_path = Path(dict_db_path) if dict_db_path else resolve_kanji_dict_path()

    def _get_jlpt_conn(self) -> sqlite3.Connection | None:
        return _get_reusable_connection(self.jlpt_db_path)

    def _get_dict_conn(self) -> sqlite3.Connection | None:
        return _get_reusable_connection(self.dict_db_path)

    def get_details(self, char: str) -> dict[str, Any] | None:
        """Fetch readings, JLPT level, stroke count, grade and meanings for a kanji."""
        if not char or not str(char).strip():
            return None
        clean_char = str(char).strip()[0]

        # 1. Try jlpt_reference.sqlite
        conn = self._get_jlpt_conn()
        if conn is not None:
            try:
                row = conn.execute("SELECT * FROM kanji WHERE character = ?", (clean_char,)).fetchone()
                if row:
                    onyomi = json.loads(row["onyomi"]) if row["onyomi"] else []
                    kunyomi = json.loads(row["kunyomi"]) if row["kunyomi"] else []
                    meanings = json.loads(row["meanings"]) if row["meanings"] else []
                    return {
                        "character": row["character"],
                        "level": row["level"],
                        "strokes": int(row["strokes"]) if row["strokes"] else None,
                        "grade": int(row["grade"]) if row["grade"] else None,
                        "freq": int(row["freq"]) if row["freq"] else None,
                        "onyomi": onyomi,
                        "kunyomi": kunyomi,
                        "meanings": meanings,
                    }
            except Exception as exc:
                record_operational_failure("kanji.jlpt_details", exc, level=logging.DEBUG)

        # 2. Try kiroku_dict.sqlite
        dict_conn = self._get_dict_conn()
        if dict_conn is not None:
            try:
                row = dict_conn.execute("SELECT * FROM kanji WHERE character = ?", (clean_char,)).fetchone()
                if row:
                    stats = json.loads(row["stats_json"]) if row["stats_json"] else {}
                    meanings = json.loads(row["meanings_json"]) if row["meanings_json"] else []
                    onyomi = [s.strip() for s in row["onyomi"].split(",") if s.strip()] if row["onyomi"] else []
                    kunyomi = [s.strip() for s in row["kunyomi"].split(",") if s.strip()] if row["kunyomi"] else []
                    raw_lvl = stats.get("jlpt")
                    lvl = f"N{raw_lvl}" if (raw_lvl and not str(raw_lvl).upper().startswith("N")) else (str(raw_lvl).upper() if raw_lvl else None)
                    return {
                        "character": row["character"],
                        "level": lvl,
                        "strokes": int(stats["strokes"]) if stats.get("strokes") else None,
                        "grade": int(stats["grade"]) if stats.get("grade") else None,
                        "freq": int(stats["freq"]) if stats.get("freq") else None,
                        "onyomi": onyomi,
                        "kunyomi": kunyomi,
                        "meanings": meanings,
                    }
            except Exception as exc:
                record_operational_failure("kanji.dictionary_details", exc, level=logging.DEBUG)

        return None

    def get_batch(self, chars: list[str] | str) -> dict[str, dict[str, Any] | None]:
        """Fetch kanji details for a batch of characters in a single query."""
        if isinstance(chars, str):
            char_list = [c for c in chars if "\u4e00" <= c <= "\u9fff" or "\u3400" <= c <= "\u4dbf"]
        else:
            char_list = [str(c).strip()[0] for c in chars if c and str(c).strip()]

        seen: set[str] = set()
        unique_chars: list[str] = []
        for c in char_list:
            if c not in seen:
                seen.add(c)
                unique_chars.append(c)

        if not unique_chars:
            return {}

        results: dict[str, dict[str, Any] | None] = {}
        conn = self._get_jlpt_conn()
        if conn is not None:
            try:
                q_marks = ",".join("?" for _ in unique_chars)
                rows = conn.execute(
                    f"SELECT * FROM kanji WHERE character IN ({q_marks})",
                    unique_chars,
                ).fetchall()
                for row in rows:
                    ch = row["character"]
                    onyomi = json.loads(row["onyomi"]) if row["onyomi"] else []
                    kunyomi = json.loads(row["kunyomi"]) if row["kunyomi"] else []
                    meanings = json.loads(row["meanings"]) if row["meanings"] else []
                    results[ch] = {
                        "character": ch,
                        "level": row["level"],
                        "strokes": int(row["strokes"]) if row["strokes"] else None,
                        "grade": int(row["grade"]) if row["grade"] else None,
                        "freq": int(row["freq"]) if row["freq"] else None,
                        "onyomi": onyomi,
                        "kunyomi": kunyomi,
                        "meanings": meanings,
                    }
            except Exception as exc:
                record_operational_failure("kanji.batch_jlpt", exc, level=logging.DEBUG)

        for ch in unique_chars:
            if ch not in results:
                results[ch] = self.get_details(ch)

        return results

    def get_compounds(self, char: str, limit: int = 15) -> list[dict[str, Any]]:
        """Return common compound expressions containing char from the local dictionary."""
        if not char or not self.dict_db_path.is_file():
            return []

        clean_char = str(char).strip()[0]
        compounds = _cached_compounds_for_char(str(self.dict_db_path), clean_char)
        return compounds[:max(1, min(int(limit), 50))]

    def browse(self, level: str = "N3", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Browse kanji by JLPT level or Joyo status with pagination."""
        if not self.jlpt_db_path.is_file():
            err_msg = f"JLPT reference database missing: {self.jlpt_db_path}"
            record_operational_failure("kanji.browse.missing_db", FileNotFoundError(err_msg))
            return {"level": level, "kanji": [], "total": 0, "error": err_msg}

        target_level = level.upper() if level else "N3"
        limit = max(1, min(int(limit), 2500))
        offset = max(0, int(offset))

        try:
            conn = self._get_jlpt_conn()
            if conn is None:
                err_msg = f"Could not connect to JLPT database: {self.jlpt_db_path}"
                record_operational_failure("kanji.browse.connection", RuntimeError(err_msg))
                return {"level": target_level, "kanji": [], "total": 0, "error": err_msg}

            if target_level == "JOYO":
                count_row = conn.execute("SELECT count(*) FROM kanji WHERE grade IS NOT NULL").fetchone()
                total = count_row[0] if count_row else 0
                rows = conn.execute(
                    "SELECT character, level, strokes, grade, freq, meanings FROM kanji WHERE grade IS NOT NULL ORDER BY grade ASC, freq ASC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
            else:
                count_row = conn.execute("SELECT count(*) FROM kanji WHERE level = ?", (target_level,)).fetchone()
                total = count_row[0] if count_row else 0
                rows = conn.execute(
                    "SELECT character, level, strokes, grade, freq, meanings FROM kanji WHERE level = ? ORDER BY freq ASC, strokes ASC LIMIT ? OFFSET ?",
                    (target_level, limit, offset),
                ).fetchall()

            items = []
            for r in rows:
                meanings = json.loads(r["meanings"]) if r["meanings"] else []
                items.append({
                    "character": r["character"],
                    "level": r["level"],
                    "strokes": r["strokes"],
                    "grade": r["grade"],
                    "freq": r["freq"],
                    "meanings": meanings,
                })

            return {"level": target_level, "kanji": items, "total": total, "error": None}
        except Exception as exc:
            record_operational_failure("kanji.browse", exc)
            return {"level": target_level, "kanji": [], "total": 0, "error": str(exc)}
