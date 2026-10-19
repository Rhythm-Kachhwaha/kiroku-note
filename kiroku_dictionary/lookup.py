"""
lookup.py -- Term and kanji lookup engine with candidate ranking and headword grouping.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import sqlite3
import threading
from typing import Any

from .deinflect import deinflect
from .schema import apply_runtime_pragmas, decompress_content, normalize_text


@dataclass
class TermDefinition:
    dictionary: str
    score: float
    sequence: int
    rules: str
    def_tags: list[str]
    term_tags: list[str]
    glossary: list[Any]


@dataclass
class TermHeadwordGroup:
    term: str
    reading: str
    source: str
    is_deinflected: bool
    reasons: tuple[str, ...]
    score: float
    definitions: list[TermDefinition] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


@dataclass
class KanjiResult:
    character: str
    dictionary: str
    onyomi: list[str]
    kunyomi: list[str]
    nanori: list[str]
    meanings: list[str]
    tags: list[str]
    stats: dict[str, Any]


_KANJI_RANGES = [
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0x3400, 0x4DBF),  # CJK Extension A
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
]


def is_kanji_char(ch: str) -> bool:
    if not ch:
        return False
    code = ord(ch)
    return any(start <= code <= end for start, end in _KANJI_RANGES)


def is_kana_only(text: str) -> bool:
    """Return True if text contains only hiragana, katakana, and kana punctuation."""
    if not text:
        return False
    for ch in text:
        code = ord(ch)
        if (
            0x3040 <= code <= 0x309F  # Hiragana
            or 0x30A0 <= code <= 0x30FF  # Katakana
            or 0x31F0 <= code <= 0x31FF  # Katakana phonetic extensions
            or 0xFF66 <= code <= 0xFF9F  # Halfwidth katakana
            or ch in ("ー", "・", " ", "　")
        ):
            continue
        return False
    return True


_PUNCT_TRIM_CHARS = " \t\r\n　「」『』（）［］【】〈〉《》〔〕“”‘’\"'.,、。"


class DictionaryEngine:
    """
    Thread-safe query engine for kiroku_dict.sqlite.
    Provides fast, low-latency, read-only lookup of Japanese terms and kanji.
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()

    def get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, check_same_thread=False)
            apply_runtime_pragmas(conn)
            self._local.conn = conn
        return self._local.conn

    def lookup_terms(self, text: str, max_results: int = 10) -> list[TermHeadwordGroup]:
        """
        Lookup vocabulary entries for input text.
        Returns grouped headwords ranked by exactness, deinflection chain, and popularity score.
        """
        clean_text = text.strip(_PUNCT_TRIM_CHARS) or text.strip()
        if not clean_text:
            return []

        conn = self.get_connection()
        cur = conn.cursor()

        kana_input = is_kana_only(clean_text)
        norm_query = normalize_text(clean_text)

        # Map: (term, reading) -> TermHeadwordGroup
        grouped: dict[tuple[str, str], TermHeadwordGroup] = {}

        # Scan lengths: from full text length down to 1 (longest-prefix match)
        text_len = len(clean_text)
        prefixes = [clean_text[:l] for l in range(text_len, 0, -1)]

        for prefix in prefixes:
            candidates = deinflect(prefix)

            for cand in candidates:
                cand_term = cand.term
                cand_norm = normalize_text(cand_term)

                if kana_input:
                    # Input is kana: match either on reading, norm_reading, or kana term
                    cur.execute(
                        """
                        SELECT term, reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
                        FROM terms
                        WHERE norm_reading = ? OR reading = ? OR term = ?
                        ORDER BY score DESC
                        LIMIT 50
                        """,
                        (cand_norm, cand_term, cand_term),
                    )
                else:
                    # Input has kanji: match exact term
                    cur.execute(
                        """
                        SELECT term, reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
                        FROM terms
                        WHERE term = ?
                        ORDER BY score DESC
                        LIMIT 50
                        """,
                        (cand_term,),
                    )

                rows = cur.fetchall()
                for row in rows:
                    term, reading, rules, def_tags, score, seq, term_tags, dict_name, blob = row

                    # Filter by inflection rule constraint
                    if not cand.matches_entry_rules(rules):
                        continue

                    key = (term, reading)
                    def_tag_list = def_tags.split() if def_tags else []
                    term_tag_list = term_tags.split() if term_tags else []

                    # Decompress structured content glossary
                    glossary = decompress_content(blob)
                    definition = TermDefinition(
                        dictionary=dict_name,
                        score=float(score),
                        sequence=int(seq),
                        rules=rules,
                        def_tags=def_tag_list,
                        term_tags=term_tag_list,
                        glossary=glossary,
                    )

                    if key not in grouped:
                        is_exact = (term == clean_text or reading == clean_text) and not cand.reasons
                        ratio = len(prefix) / text_len

                        # Matched text length ratio dominates (e.g. full match >> single character prefix)
                        base_score = float(score) + (ratio * 500000.0)

                        if is_exact:
                            base_score += 100000.0  # Highest bonus for exact match
                        elif not cand.reasons:
                            base_score += 50000.0   # Uninflected dictionary match
                        else:
                            base_score -= len(cand.reasons) * 100.0  # Shorter inflection chains preferred

                        all_tags = list(dict.fromkeys(term_tag_list + def_tag_list))
                        grouped[key] = TermHeadwordGroup(
                            term=term,
                            reading=reading,
                            source=prefix,
                            is_deinflected=bool(cand.reasons),
                            reasons=cand.reasons,
                            score=base_score,
                            definitions=[definition],
                            tags=all_tags,
                        )
                    else:
                        existing = grouped[key]
                        existing.definitions.append(definition)
                        for t in term_tag_list + def_tag_list:
                            if t not in existing.tags:
                                existing.tags.append(t)

        # Deterministic ranking
        # Tie-break: (-score, is_deinflected, len(reasons), -len(definitions), sequence, term, reading)
        sorted_groups = sorted(
            grouped.values(),
            key=lambda g: (
                -g.score,
                1 if g.is_deinflected else 0,
                len(g.reasons),
                -len(g.definitions),
                g.definitions[0].sequence if g.definitions else 0,
                g.term,
                g.reading,
            ),
        )

        return sorted_groups[:max_results]

    def lookup_kanji(self, text: str) -> list[KanjiResult]:
        """Lookup kanji dictionary entries for all kanji characters found in text."""
        if not text:
            return []

        kanji_chars = [ch for ch in text if is_kanji_char(ch)]
        if not kanji_chars:
            return []

        conn = self.get_connection()
        cur = conn.cursor()

        results: list[KanjiResult] = []
        seen: set[str] = set()

        for ch in kanji_chars:
            if ch in seen:
                continue
            seen.add(ch)

            cur.execute(
                """
                SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary
                FROM kanji
                WHERE character = ?
                """,
                (ch,),
            )
            row = cur.fetchone()
            if not row:
                continue

            char, onyomi_str, kunyomi_str, tags_str, stats_json, meanings_json, dict_name = row
            onyomi = onyomi_str.split() if onyomi_str else []
            kunyomi = kunyomi_str.split() if kunyomi_str else []
            tags = tags_str.split() if tags_str else []
            stats = json.loads(stats_json) if stats_json else {}
            meanings = json.loads(meanings_json) if meanings_json else []

            results.append(
                KanjiResult(
                    character=char,
                    dictionary=dict_name,
                    onyomi=onyomi,
                    kunyomi=kunyomi,
                    nanori=[],
                    meanings=meanings,
                    tags=tags,
                    stats=stats,
                )
            )

        return results
