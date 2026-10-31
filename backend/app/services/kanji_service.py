"""Kanji query and compound mining service for Kiroku Note."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sqlite3
from typing import Any

from app.services.kanji_strokes import get_kanji_strokes_service

JLPT_REF_PATH = Path(__file__).resolve().parent.parent / "data" / "jlpt_reference.sqlite"
DICT_PATH = Path(__file__).resolve().parent.parent.parent.parent / "kiroku_dict.sqlite"
if not DICT_PATH.exists():
    DICT_PATH = Path("kiroku_dict.sqlite").resolve()


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
        # Exclude metadata tags
        if content.get("data", {}).get("content") == "part-of-speech-info":
            return ""
        if "content" in content:
            return _extract_gloss_from_content(content["content"])
        if "text" in content:
            return content["text"]
    return ""


class KanjiService:
    def __init__(
        self,
        jlpt_db_path: Path | str | None = None,
        dict_db_path: Path | str | None = None,
    ):
        self.jlpt_db_path = Path(jlpt_db_path) if jlpt_db_path else JLPT_REF_PATH
        self.dict_db_path = Path(dict_db_path) if dict_db_path else DICT_PATH

    def get_details(self, char: str) -> dict[str, Any] | None:
        """Fetch readings, JLPT level, stroke count, grade and meanings for a kanji."""
        if not char or not str(char).strip():
            return None
        clean_char = str(char).strip()[0]

        # 1. Try jlpt_reference.sqlite
        if self.jlpt_db_path.exists():
            try:
                conn = sqlite3.connect(f"file:{self.jlpt_db_path.as_posix()}?mode=ro", uri=True)
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT * FROM kanji WHERE character = ?", (clean_char,)).fetchone()
                conn.close()
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
            except Exception:
                pass

        # 2. Try kiroku_dict.sqlite
        if self.dict_db_path.exists():
            try:
                conn = sqlite3.connect(f"file:{self.dict_db_path.as_posix()}?mode=ro", uri=True)
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT * FROM kanji WHERE character = ?", (clean_char,)).fetchone()
                conn.close()
                if row:
                    stats = json.loads(row["stats_json"]) if row["stats_json"] else {}
                    meanings = json.loads(row["meanings_json"]) if row["meanings_json"] else []
                    onyomi = [s.strip() for s in row["onyomi"].split(",") if s.strip()] if row["onyomi"] else []
                    kunyomi = [s.strip() for s in row["kunyomi"].split(",") if s.strip()] if row["kunyomi"] else []
                    return {
                        "character": row["character"],
                        "level": f"N{stats.get('jlpt')}" if stats.get("jlpt") else None,
                        "strokes": int(stats["strokes"]) if stats.get("strokes") else None,
                        "grade": int(stats["grade"]) if stats.get("grade") else None,
                        "freq": int(stats["freq"]) if stats.get("freq") else None,
                        "onyomi": onyomi,
                        "kunyomi": kunyomi,
                        "meanings": meanings,
                    }
            except Exception:
                pass

        return None

    def get_compounds(self, char: str, limit: int = 15) -> list[dict[str, Any]]:
        """Return common compound expressions containing char from the local dictionary."""
        if not char or not self.dict_db_path.exists():
            return []

        clean_char = str(char).strip()[0]
        try:
            from kiroku_dictionary.schema import decompress_content
        except ImportError:
            decompress_content = None

        compounds: list[dict[str, Any]] = []
        try:
            conn = sqlite3.connect(f"file:{self.dict_db_path.as_posix()}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                """SELECT term, reading, score, content_blob FROM terms
                   WHERE (term LIKE ? OR norm_term LIKE ?) AND length(term) >= 2
                   ORDER BY score DESC LIMIT ?""",
                (f"%{clean_char}%", f"%{clean_char}%", max(1, min(int(limit), 50))),
            )
            for row in cursor:
                gloss = ""
                if row["content_blob"] and decompress_content:
                    try:
                        content = decompress_content(row["content_blob"])
                        raw_gloss = _extract_gloss_from_content(content)
                        # Clean up punctuation and split
                        parts = [p.strip() for p in raw_gloss.split(";") if p.strip()]
                        # Deduplicate while preserving order
                        seen = set()
                        deduped = []
                        for p in parts:
                            if p.lower() not in seen and not p.startswith("http"):
                                seen.add(p.lower())
                                deduped.append(p)
                        gloss = " · ".join(deduped[:4])
                    except Exception:
                        pass

                compounds.append({
                    "term": row["term"],
                    "reading": row["reading"],
                    "meaning": gloss or "Compound definition available",
                    "score": float(row["score"] or 0),
                })
            conn.close()
        except Exception:
            pass

        return compounds

    def browse(self, level: str = "N3", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Browse kanji by JLPT level or Joyo status with pagination."""
        if not self.jlpt_db_path.exists():
            return {"level": level, "kanji": [], "total": 0}

        target_level = level.upper() if level else "N3"
        limit = max(1, min(int(limit), 100))
        offset = max(0, int(offset))

        try:
            conn = sqlite3.connect(f"file:{self.jlpt_db_path.as_posix()}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

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

            conn.close()

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

            return {"level": target_level, "kanji": items, "total": total}
        except Exception:
            return {"level": target_level, "kanji": [], "total": 0}

