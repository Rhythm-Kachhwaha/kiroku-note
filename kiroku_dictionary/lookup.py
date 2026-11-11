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


@dataclass(frozen=True)
class CanonicalResolution:
    """Resolved canonical JMdict entry identity for a token or term."""

    term: str
    reading: str
    sequence_id: int
    matched_on: str  # "lemma", "normalized", "surface", or "deinflected"
    score: float = 0.0
    def_tags: tuple[str, ...] = ()
    term_tags: tuple[str, ...] = ()
    rules: str = ""

    @property
    def canonical_id(self) -> tuple[int, str]:
        """Return (sequence_id, reading) canonical key."""
        return (self.sequence_id, self.reading)


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

_PRIORITY_TAGS = frozenset({"\u2605", "priority", "spec1", "spec2", "ichi1", "ichi2", "news1", "news2", "gai1", "gai2"})
_PENALTY_TAGS = frozenset({"obsolete", "irregular", "rarely", "old", "ateji", "arch", "outdated"})
_VERB_RULES = frozenset({"v1", "v5", "vs", "vk", "vz"})


def _common_prefix_len(left: str, right: str) -> int:
    limit = min(len(left), len(right))
    idx = 0
    while idx < limit and left[idx] == right[idx]:
        idx += 1
    return idx


def _extract_pos_codes(blob: bytes | None) -> set[str]:
    """Extract part-of-speech codes from compressed Jitendex structured content."""
    if not blob:
        return set()
    try:
        data = decompress_content(blob)
    except Exception:
        return set()
    codes: set[str] = set()
    stack: list[Any] = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            node_data = node.get("data")
            if isinstance(node_data, dict) and node_data.get("content") == "part-of-speech-info":
                code = node_data.get("code")
                if isinstance(code, str) and code:
                    codes.add(code)
            content = node.get("content")
            if isinstance(content, (list, dict)):
                stack.append(content)
    return codes


def _normalize_pos_tuple(pos: tuple[str, ...] | list[str] | str) -> tuple[str, ...]:
    if not pos:
        return ()
    if isinstance(pos, str):
        return (pos,)
    return tuple(str(p) for p in pos if p)


def _pos_score_adjustment(
    pos_tuple: tuple[str, ...],
    rules: str,
    blob: bytes | None,
    need_deep_pos: bool,
) -> float:
    if not pos_tuple:
        return 0.0
    pos0 = pos_tuple[0]
    rule_set = set(rules.split()) if rules else set()
    has_verb_rule = any(r in _VERB_RULES or r.startswith("v5") or r.startswith("vs") for r in rule_set)

    if pos0 == "動詞":
        if has_verb_rule:
            return 1000.0
        if "adj-i" in rule_set:
            return -500.0
        return 0.0
    if pos0 == "形容詞":
        return 1000.0 if "adj-i" in rule_set else 0.0
    if pos0 == "形状詞":
        if need_deep_pos:
            codes = _extract_pos_codes(blob)
            if "adj-na" in codes:
                return 800.0
        return -500.0 if has_verb_rule else 0.0
    if pos0 == "接尾辞":
        if need_deep_pos:
            codes = _extract_pos_codes(blob)
            if codes & {"n-suf", "suf", "ctr"}:
                return 800.0
        return -400.0 if has_verb_rule else 0.0
    if pos0 in {"名詞", "代名詞"}:
        if has_verb_rule or "adj-i" in rule_set:
            return -400.0
        if need_deep_pos:
            codes = _extract_pos_codes(blob)
            if codes & {"n", "n-adv", "n-t", "adj-no", "vs"}:
                return 400.0
    return 0.0


def _score_canonical_row(
    row: tuple[Any, ...],
    token_norm_reading: str,
    deinflected_readings: set[str],
    pos_tuple: tuple[str, ...],
    need_deep_pos: bool,
) -> float:
    term, reading, rules, def_tags, score, seq, term_tags, _dict_name, blob = row
    rank = float(score)
    row_norm_reading = normalize_text(reading)

    if token_norm_reading:
        if row_norm_reading == token_norm_reading:
            rank += 10000.0
        elif row_norm_reading in deinflected_readings:
            rank += 8000.0
        else:
            prefix_len = _common_prefix_len(token_norm_reading, row_norm_reading)
            if prefix_len > 0:
                rank += prefix_len * 500.0
            else:
                rank -= 2000.0

    rank += _pos_score_adjustment(pos_tuple, rules, blob, need_deep_pos)

    all_tag_tokens = set((def_tags or "").split()) | set((term_tags or "").split())
    if all_tag_tokens & _PRIORITY_TAGS:
        rank += 300.0
    if all_tag_tokens & _PENALTY_TAGS:
        rank -= 1000.0

    return rank


class DictionaryEngine:
    """
    Thread-safe query engine for kiroku_dict.sqlite.
    Provides fast, low-latency, read-only lookup of Japanese terms and kanji.
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
        self._connections: list[sqlite3.Connection] = []
        self._conn_lock = threading.Lock()

    def get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, check_same_thread=False)
            apply_runtime_pragmas(conn)
            self._local.conn = conn
            with self._conn_lock:
                self._connections.append(conn)
        return self._local.conn

    def close(self) -> None:
        """Close all opened database connections across threads."""
        with self._conn_lock:
            for conn in self._connections:
                try:
                    conn.close()
                except Exception:
                    pass
            self._connections.clear()
        if hasattr(self._local, "conn"):
            self._local.conn = None

    def term_exists(self, term: str) -> bool:
        """Return True if term (or normalized kana reading for kana-only input) exists in terms."""
        clean = (term or "").strip()
        if not clean:
            return False
        conn = self.get_connection()
        cur = conn.cursor()
        row = cur.execute("SELECT 1 FROM terms WHERE term = ? LIMIT 1", (clean,)).fetchone()
        if row is not None:
            return True
        if is_kana_only(clean):
            norm = normalize_text(clean)
            row = cur.execute(
                "SELECT 1 FROM terms WHERE norm_reading = ? OR reading = ? LIMIT 1",
                (norm, clean),
            ).fetchone()
            return row is not None
        return False

    def _query_canonical_rows(self, cur: sqlite3.Cursor, query: str) -> list[tuple[Any, ...]]:
        rows = cur.execute(
            """
            SELECT term, reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
            FROM terms
            WHERE term = ?
            ORDER BY score DESC
            LIMIT 50
            """,
            (query,),
        ).fetchall()
        if rows or not is_kana_only(query):
            return rows
        norm_q = normalize_text(query)
        return cur.execute(
            """
            SELECT term, reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
            FROM terms
            WHERE norm_reading = ? OR reading = ?
            ORDER BY score DESC
            LIMIT 50
            """,
            (norm_q, query),
        ).fetchall()

    def resolve_canonical(
        self,
        lemma: str,
        *,
        normalized_form: str = "",
        surface: str = "",
        reading: str = "",
        pos: tuple[str, ...] | list[str] | str = (),
        allow_deinflect: bool = True,
    ) -> CanonicalResolution | None:
        """
        Resolve a token to its canonical JMdict entry (term, reading, sequence_id).

        Checks candidates in fallback order: lemma -> normalized_form -> surface,
        disambiguating multiple matches by reading, Sudachi POS, and dictionary tags.
        """
        candidates: list[tuple[str, str]] = []
        seen_queries: set[str] = set()
        for value, label in ((lemma, "lemma"), (normalized_form, "normalized"), (surface, "surface")):
            cleaned = (value or "").strip()
            if cleaned and cleaned not in seen_queries:
                seen_queries.add(cleaned)
                candidates.append((cleaned, label))

        if not candidates:
            return None

        conn = self.get_connection()
        cur = conn.cursor()
        token_norm_reading = normalize_text(reading)
        deinflected_readings: set[str] = set()
        if token_norm_reading:
            deinflected_readings = {
                normalize_text(c.term) for c in deinflect(token_norm_reading) if c.reasons
            }
        pos_tuple = _normalize_pos_tuple(pos)

        for query, matched_on in candidates:
            rows = self._query_canonical_rows(cur, query)
            if rows:
                return self._pick_best_canonical_row(
                    rows,
                    matched_on=matched_on,
                    token_norm_reading=token_norm_reading,
                    deinflected_readings=deinflected_readings,
                    pos_tuple=pos_tuple,
                )

        if allow_deinflect:
            deinf_rows: list[tuple[Any, ...]] = []
            for query, _label in candidates:
                for cand in deinflect(query):
                    if not cand.reasons:
                        continue
                    for row in self._query_canonical_rows(cur, cand.term):
                        if cand.matches_entry_rules(row[2]):
                            deinf_rows.append(row)
                if deinf_rows:
                    return self._pick_best_canonical_row(
                        deinf_rows,
                        matched_on="deinflected",
                        token_norm_reading=token_norm_reading,
                        deinflected_readings=deinflected_readings,
                        pos_tuple=pos_tuple,
                    )

        return None

    def _pick_best_canonical_row(
        self,
        rows: list[tuple[Any, ...]],
        *,
        matched_on: str,
        token_norm_reading: str,
        deinflected_readings: set[str],
        pos_tuple: tuple[str, ...],
    ) -> CanonicalResolution:
        need_deep_pos = len(rows) > 1 and bool(pos_tuple) and pos_tuple[0] in {"形状詞", "接尾辞", "名詞", "代名詞"}
        best_row = max(
            rows,
            key=lambda row: (
                _score_canonical_row(
                    row,
                    token_norm_reading=token_norm_reading,
                    deinflected_readings=deinflected_readings,
                    pos_tuple=pos_tuple,
                    need_deep_pos=need_deep_pos,
                ),
                -int(row[5]),
                row[0],
                row[1],
            ),
        )
        term, row_reading, rules, def_tags, score, seq, term_tags, _dict_name, _blob = best_row
        return CanonicalResolution(
            term=term,
            reading=row_reading,
            sequence_id=int(seq),
            matched_on=matched_on,
            score=float(score),
            def_tags=tuple((def_tags or "").split()),
            term_tags=tuple((term_tags or "").split()),
            rules=rules or "",
        )

    def lookup_terms(
        self,
        text: str,
        max_results: int = 10,
        mode: str = "word",
        preferred_lemma: str | None = None,
        preferred_reading: str | None = None,
    ) -> list[TermHeadwordGroup]:
        """
        Lookup vocabulary entries for input text.
        Returns grouped headwords ranked by exactness, deinflection chain, and popularity score.

        mode: "word" (default) evaluates full text + deinflections only (avoids prefix junk for Quick Add).
              "scan" performs longest-prefix scanning down to length 1 (for sentences/text passages).
        """
        if not text or not isinstance(text, str):
            return []
        clean_text = text.strip(_PUNCT_TRIM_CHARS) or text.strip()
        if not clean_text:
            return []

        conn = self.get_connection()
        cur = conn.cursor()

        kana_input = is_kana_only(clean_text)
        norm_query = normalize_text(clean_text)

        # Map: (term, reading) -> TermHeadwordGroup
        grouped: dict[tuple[str, str], TermHeadwordGroup] = {}

        # Scan lengths: "word" mode only checks full string + deinflections; "scan" checks prefixes down to 1
        text_len = len(clean_text)
        if mode == "scan":
            prefixes = [clean_text[:l] for l in range(text_len, 0, -1)]
        else:
            prefixes = [clean_text]

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

                        if preferred_lemma and term == preferred_lemma:
                            base_score += 20000.0
                        if preferred_reading:
                            pref_norm = normalize_text(preferred_reading)
                            row_norm = normalize_text(reading)
                            if pref_norm and row_norm == pref_norm:
                                base_score += 5000.0
                            elif pref_norm and row_norm and _common_prefix_len(pref_norm, row_norm) > 0:
                                base_score += _common_prefix_len(pref_norm, row_norm) * 500.0

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
        if not text or not isinstance(text, str):
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
