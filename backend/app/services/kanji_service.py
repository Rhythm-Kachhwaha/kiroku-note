"""Kanji query and compound mining service for Kiroku Note."""
from __future__ import annotations

from datetime import datetime, timezone
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
_all_kanji_connections: list[sqlite3.Connection] = []
_kanji_conn_lock = threading.Lock()


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
        with _kanji_conn_lock:
            _all_kanji_connections.append(conn)
        return conn
    except Exception as exc:
        record_operational_failure("kanji.connection", exc, level=logging.DEBUG)
        return None


def close_kanji_connections() -> None:
    """Close any cached SQLite connections across all threads."""
    with _kanji_conn_lock:
        for conn in _all_kanji_connections:
            try:
                conn.close()
            except Exception:
                pass
        _all_kanji_connections.clear()
    if hasattr(_local_storage, "connections"):
        _local_storage.connections.clear()


_vocab_compounds_cache: dict[str, list[dict[str, Any]]] | None = None
_vocab_compounds_lock = threading.Lock()


def _get_vocab_compounds_index(jlpt_conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    """Build and cache an in-memory index of JLPT vocabulary words mapped by kanji character."""
    global _vocab_compounds_cache
    if _vocab_compounds_cache is not None:
        return _vocab_compounds_cache

    with _vocab_compounds_lock:
        if _vocab_compounds_cache is not None:
            return _vocab_compounds_cache

        index: dict[str, list[dict[str, Any]]] = {}
        try:
            rows = jlpt_conn.execute("SELECT word, reading, meanings FROM vocab").fetchall()
            for r in rows:
                word = r["word"]
                reading = r["reading"] or ""
                meanings_raw = r["meanings"]
                meaning_str = ""
                if meanings_raw:
                    try:
                        m_list = json.loads(meanings_raw) if isinstance(meanings_raw, str) else meanings_raw
                        if isinstance(m_list, list):
                            meaning_str = ", ".join(m_list[:2])
                        elif isinstance(m_list, str):
                            meaning_str = meanings_raw
                    except Exception:
                        meaning_str = str(meanings_raw)

                comp_entry = {
                    "term": word,
                    "reading": reading,
                    "meaning": meaning_str,
                }

                # Associate this compound with each kanji character it contains
                for ch in set(word):
                    if "\u4e00" <= ch <= "\u9faf":
                        comp_list = index.setdefault(ch, [])
                        if len(comp_list) < 8:
                            comp_list.append(comp_entry)
        except Exception as exc:
            record_operational_failure("kanji.vocab_compounds_index", exc, level=logging.DEBUG)

        _vocab_compounds_cache = index
        return index


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
        user_db_path: Path | str | None = None,
    ):
        self.jlpt_db_path = Path(jlpt_db_path) if jlpt_db_path else JLPT_REF_PATH
        self.dict_db_path = Path(dict_db_path) if dict_db_path else resolve_kanji_dict_path()
        self.user_db_path = Path(user_db_path) if user_db_path else None

    def _get_jlpt_conn(self) -> sqlite3.Connection | None:
        return _get_reusable_connection(self.jlpt_db_path)

    def _get_dict_conn(self) -> sqlite3.Connection | None:
        return _get_reusable_connection(self.dict_db_path)

    def _get_user_db_path(self) -> Path:
        if self.user_db_path:
            return self.user_db_path
        from app.config import get_db_path
        return get_db_path()

    def _get_user_conn(self) -> sqlite3.Connection:
        from app.db.connection import get_db_connection, ensure_user_kanji_compounds_table
        conn = get_db_connection(self._get_user_db_path())
        ensure_user_kanji_compounds_table(conn)
        return conn

    def add_user_compound(self, character: str, term: str, reading: str, meaning: str = "") -> dict[str, Any]:
        """Add a custom user compound for a kanji character to SQLite."""
        if not character or not term or not reading:
            raise ValueError("character, term, and reading are required")
        clean_char = str(character).strip()[0]
        clean_term = str(term).strip()
        clean_reading = str(reading).strip()
        clean_meaning = str(meaning or "").strip()
        now_iso = datetime.now(timezone.utc).isoformat()

        conn = self._get_user_conn()
        try:
            cur = conn.execute(
                """INSERT INTO user_kanji_compounds (character, term, reading, meaning, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (clean_char, clean_term, clean_reading, clean_meaning, now_iso),
            )
            conn.commit()
            compound_id = cur.lastrowid
            return {
                "id": compound_id,
                "character": clean_char,
                "term": clean_term,
                "reading": clean_reading,
                "meaning": clean_meaning,
                "created_at": now_iso,
            }
        finally:
            conn.close()

    def get_user_compounds(self, character: str | None = None) -> list[dict[str, Any]]:
        """Return custom compounds created by user, optionally filtered by character."""
        conn = self._get_user_conn()
        try:
            if character:
                clean_char = str(character).strip()[0]
                rows = conn.execute(
                    "SELECT id, character, term, reading, meaning, created_at FROM user_kanji_compounds WHERE character = ? ORDER BY id DESC",
                    (clean_char,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, character, term, reading, meaning, created_at FROM user_kanji_compounds ORDER BY id DESC"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def delete_user_compound(self, compound_id: int) -> bool:
        """Delete a custom compound by ID."""
        conn = self._get_user_conn()
        try:
            cur = conn.execute("DELETE FROM user_kanji_compounds WHERE id = ?", (int(compound_id),))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

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

    def get_study_list(self, level: str = "N5", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Fetch high-density study list per JLPT level with stroke count, On/Kun readings, custom compounds, and dictionary compounds."""
        if not self.jlpt_db_path.is_file():
            err_msg = f"JLPT reference database missing: {self.jlpt_db_path}"
            record_operational_failure("kanji.study_list.missing_db", FileNotFoundError(err_msg))
            return {"level": level, "items": [], "total": 0, "offset": offset, "limit": limit, "error": err_msg}

        target_level = level.upper() if level else "N5"
        limit = max(1, min(int(limit), 2500))
        offset = max(0, int(offset))

        try:
            conn = self._get_jlpt_conn()
            if conn is None:
                err_msg = f"Could not connect to JLPT database: {self.jlpt_db_path}"
                record_operational_failure("kanji.study_list.connection", RuntimeError(err_msg))
                return {"level": target_level, "items": [], "total": 0, "offset": offset, "limit": limit, "error": err_msg}

            if target_level == "JOYO":
                count_row = conn.execute("SELECT count(*) FROM kanji WHERE grade IS NOT NULL").fetchone()
                total = count_row[0] if count_row else 0
                rows = conn.execute(
                    "SELECT character, level, strokes, grade, freq, meanings, onyomi, kunyomi FROM kanji WHERE grade IS NOT NULL ORDER BY grade ASC, freq ASC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
            else:
                count_row = conn.execute("SELECT count(*) FROM kanji WHERE level = ?", (target_level,)).fetchone()
                total = count_row[0] if count_row else 0
                rows = conn.execute(
                    "SELECT character, level, strokes, grade, freq, meanings, onyomi, kunyomi FROM kanji WHERE level = ? ORDER BY freq ASC, strokes ASC LIMIT ? OFFSET ?",
                    (target_level, limit, offset),
                ).fetchall()

            characters = [r["character"] for r in rows]

            # Fetch user custom compounds for all characters in one query
            user_compounds_by_char: dict[str, list[dict[str, Any]]] = {}
            if characters:
                try:
                    u_conn = self._get_user_conn()
                    try:
                        q_marks = ",".join("?" for _ in characters)
                        u_rows = u_conn.execute(
                            f"SELECT id, character, term, reading, meaning, created_at FROM user_kanji_compounds WHERE character IN ({q_marks}) ORDER BY id ASC",
                            characters,
                        ).fetchall()
                        for ur in u_rows:
                            ch = ur["character"]
                            if ch not in user_compounds_by_char:
                                user_compounds_by_char[ch] = []
                            user_compounds_by_char[ch].append(dict(ur))
                    finally:
                        u_conn.close()
                except Exception as exc:
                    record_operational_failure("kanji.study_list.user_compounds", exc, level=logging.DEBUG)

            vocab_index = _get_vocab_compounds_index(conn)

            items = []
            for i, r in enumerate(rows):
                ch = r["character"]
                meanings = json.loads(r["meanings"]) if r["meanings"] else []
                onyomi = json.loads(r["onyomi"]) if r["onyomi"] else []
                kunyomi = json.loads(r["kunyomi"]) if r["kunyomi"] else []

                dict_compounds = vocab_index.get(ch, [])[:4]
                if not dict_compounds and limit <= 10:
                    dict_compounds = self.get_compounds(ch, limit=4)

                custom_compounds = user_compounds_by_char.get(ch, [])

                items.append({
                    "index": offset + i + 1,
                    "character": ch,
                    "level": r["level"],
                    "strokes": r["strokes"],
                    "grade": r["grade"],
                    "freq": r["freq"],
                    "meanings": meanings,
                    "onyomi": onyomi,
                    "kunyomi": kunyomi,
                    "compounds": dict_compounds,
                    "custom_compounds": custom_compounds,
                })

            return {
                "level": target_level,
                "items": items,
                "total": total,
                "offset": offset,
                "limit": limit,
                "error": None,
            }
        except Exception as exc:
            record_operational_failure("kanji.study_list", exc)
            return {"level": target_level, "items": [], "total": 0, "offset": offset, "limit": limit, "error": str(exc)}

