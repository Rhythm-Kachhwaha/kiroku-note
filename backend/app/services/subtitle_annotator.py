"""Subtitle Annotator Service.

Performs greedy forward longest-match tokenization and annotation on Japanese subtitle cues.
Matches mined cards, known words, and OpenJLPT vocabulary/kanji with green precedence on overlap:
  should_know (if level <= learner_level) > mined (if in mined set) > unstyled.
"""
from __future__ import annotations

import functools
import logging
from pathlib import Path
import sqlite3
from typing import Any, Iterable

from app.config import get_db_path, get_learner_jlpt_level, is_within_learner_level
from app.services.jlpt_reference import JlptReferenceService
from kiroku_dictionary.deinflect import DeinflectionCandidate, deinflect

logger = logging.getLogger(__name__)

# Module-level LRU cache for deinflection candidate generation
_cached_deinflect = functools.lru_cache(maxsize=16384)(deinflect)

PARTICLES: frozenset[str] = frozenset([
    "は", "が", "を", "に", "へ", "で", "と", "の", "も", "から", "まで", "より", "か", "よ", "ね", "わ"
])

COPULAS: frozenset[str] = frozenset([
    "です", "だ", "ます", "でした", "ました"
])

FUNCTION_WORDS: frozenset[str] = PARTICLES | COPULAS

_LEVEL_PRIORITY: dict[str, int] = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1}


class AnnotatedToken(dict):
    """Token within a subtitle cue with surface, lemma, reading, status, and jlpt_level."""

    def __init__(
        self,
        surface: str,
        lemma: str,
        reading: str = "",
        status: str = "unstyled",
        jlpt_level: str | None = None,
        start: float = 0.0,
        end: float = 0.0,
        start_char: int = 0,
        end_char: int = 0,
    ) -> None:
        super().__init__(
            surface=surface,
            lemma=lemma,
            reading=reading,
            status=status,
            jlpt_level=jlpt_level,
            start=start,
            end=end,
            start_char=start_char,
            end_char=end_char,
        )

    @property
    def surface(self) -> str:
        return self["surface"]

    @property
    def lemma(self) -> str:
        return self["lemma"]

    @property
    def reading(self) -> str:
        return self["reading"]

    @property
    def status(self) -> str:
        return self["status"]

    @property
    def jlpt_level(self) -> str | None:
        return self["jlpt_level"]

    @property
    def start(self) -> float:
        return self["start"]

    @property
    def end(self) -> float:
        return self["end"]

    @property
    def start_char(self) -> int:
        return self["start_char"]

    @property
    def end_char(self) -> int:
        return self["end_char"]


class AnnotatedCue(dict):
    """Subtitle cue with timing and tokenized annotated content."""

    def __init__(
        self,
        start: float,
        end: float,
        text: str,
        tokens: list[AnnotatedToken],
    ) -> None:
        super().__init__(
            start=start,
            end=end,
            text=text,
            tokens=tokens,
        )

    @property
    def start(self) -> float:
        return self["start"]

    @property
    def end(self) -> float:
        return self["end"]

    @property
    def text(self) -> str:
        return self["text"]

    @property
    def tokens(self) -> list[AnnotatedToken]:
        return self["tokens"]


class SubtitleAnnotatorService:
    """Service providing high-throughput tokenization and annotation for subtitle cues."""

    # Class-level cache: db_path_str -> (vocab_dict, kanji_dict)
    _openjlpt_cache: dict[str, tuple[dict[str, tuple[str, str]], dict[str, str]]] = {}

    def __init__(
        self,
        db_path: Path | str | None = None,
        jlpt_service: JlptReferenceService | None = None,
        learner_level: str | None = None,
        ignore_function_words: bool = True,
    ) -> None:
        self._db_path = Path(db_path) if db_path is not None else get_db_path()
        self._jlpt_service = jlpt_service or JlptReferenceService()
        self._default_learner_level = learner_level
        self._default_ignore_function_words = ignore_function_words

        self._mined_words: set[str] = set()
        self._mined_readings: dict[str, str] = {}
        self.reload_mined_words()

        self._init_openjlpt_cache()

    def _init_openjlpt_cache(self) -> None:
        """Pre-load and index OpenJLPT vocab and kanji in memory for sub-millisecond lookups."""
        cache_key = (
            str(self._jlpt_service._db_path.resolve())
            if hasattr(self._jlpt_service, "_db_path") and self._jlpt_service._db_path
            else "default"
        )
        if cache_key in self._openjlpt_cache:
            self._vocab_cache, self._kanji_cache = self._openjlpt_cache[cache_key]
            return

        vocab_dict: dict[str, tuple[str, str]] = {}
        kanji_dict: dict[str, str] = {}

        conn = (
            self._jlpt_service._get_connection()
            if hasattr(self._jlpt_service, "_get_connection")
            else None
        )
        if conn is not None:
            try:
                cursor = conn.cursor()
                rows = cursor.execute("SELECT word, reading, level FROM vocab").fetchall()
                for word, reading, level in rows:
                    if not word:
                        continue
                    w = word.strip()
                    lvl = str(level).strip().upper() if level else ""
                    r = reading.strip() if reading else ""
                    if not lvl or lvl not in _LEVEL_PRIORITY:
                        continue

                    if w not in vocab_dict:
                        vocab_dict[w] = (lvl, r)
                    else:
                        existing_lvl, existing_r = vocab_dict[w]
                        # Prefer beginner level (lower index / N5 > N4 > N3...)
                        if _LEVEL_PRIORITY.get(lvl, 0) > _LEVEL_PRIORITY.get(existing_lvl, 0):
                            vocab_dict[w] = (lvl, r or existing_r)
                        elif not existing_r and r:
                            vocab_dict[w] = (existing_lvl, r)

                kanji_rows = cursor.execute("SELECT character, level FROM kanji").fetchall()
                for char, level in kanji_rows:
                    if not char:
                        continue
                    ch = char.strip()
                    lvl = str(level).strip().upper() if level else ""
                    if lvl in _LEVEL_PRIORITY:
                        kanji_dict[ch] = lvl
            except Exception as err:
                logger.debug("Failed to build OpenJLPT memory cache: %s", err)

        self._openjlpt_cache[cache_key] = (vocab_dict, kanji_dict)
        self._vocab_cache = vocab_dict
        self._kanji_cache = kanji_dict

    def reload_mined_words(self) -> None:
        """Query and cache mined cards and known words from the authoritative database."""
        self._mined_words.clear()
        self._mined_readings.clear()

        if not self._db_path.exists() and str(self._db_path) != ":memory:":
            return

        try:
            with sqlite3.connect(str(self._db_path), timeout=5.0) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # 1. Cards table
                try:
                    rows = cursor.execute(
                        "SELECT expression, reading, normalized_expression FROM cards"
                    ).fetchall()
                    for r in rows:
                        if r["normalized_expression"]:
                            norm = str(r["normalized_expression"]).strip()
                            self._mined_words.add(norm)
                            if r["reading"]:
                                self._mined_readings[norm] = str(r["reading"]).strip()
                        if r["expression"]:
                            expr = str(r["expression"]).strip()
                            self._mined_words.add(expr)
                            if r["reading"] and expr not in self._mined_readings:
                                self._mined_readings[expr] = str(r["reading"]).strip()
                except sqlite3.OperationalError:
                    pass

                # 2. Known words table
                try:
                    rows = cursor.execute("SELECT word FROM known_words").fetchall()
                    for r in rows:
                        if r["word"]:
                            self._mined_words.add(str(r["word"]).strip())
                except sqlite3.OperationalError:
                    pass
        except Exception as err:
            logger.debug("Failed to load mined cards from %s: %s", self._db_path, err)

    def add_mined_word(self, word: str, reading: str = "") -> None:
        """Dynamically add a word to the active in-memory mined set."""
        w = str(word).strip()
        if w:
            self._mined_words.add(w)
            if reading:
                self._mined_readings[w] = str(reading).strip()

    def _extract_cue_fields(self, cue: Any) -> tuple[float, float, str]:
        """Extract start, end, and text from dictionary or object cue representations."""
        if isinstance(cue, dict):
            start = float(cue.get("start", cue.get("startTime", 0.0)) or 0.0)
            end = float(cue.get("end", cue.get("endTime", 0.0)) or 0.0)
            text = str(cue.get("text", cue.get("surface", "")) or "")
        else:
            start = float(getattr(cue, "start", getattr(cue, "startTime", 0.0)) or 0.0)
            end = float(getattr(cue, "end", getattr(cue, "endTime", 0.0)) or 0.0)
            text = str(getattr(cue, "text", getattr(cue, "surface", "")) or "")
        return start, end, text

    def annotate_cue(
        self,
        cue: Any,
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
    ) -> AnnotatedCue:
        """Annotate a single subtitle cue."""
        start, end, text = self._extract_cue_fields(cue)
        tokens = self.annotate_text(
            text,
            learner_level=learner_level,
            ignore_function_words=ignore_function_words,
            start=start,
            end=end,
        )
        return AnnotatedCue(start=start, end=end, text=text, tokens=tokens)

    def annotate_cues(
        self,
        cues: list[Any],
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
    ) -> list[AnnotatedCue]:
        """Batch annotate a list of subtitle cues."""
        return [
            self.annotate_cue(
                c,
                learner_level=learner_level,
                ignore_function_words=ignore_function_words,
            )
            for c in cues
        ]

    def annotate_text(
        self,
        text: str,
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
        start: float = 0.0,
        end: float = 0.0,
    ) -> list[AnnotatedToken]:
        """Tokenize and annotate Japanese text using greedy forward longest-match scanning."""
        if not text:
            return []

        effective_level = (
            learner_level
            if learner_level is not None
            else (self._default_learner_level or get_learner_jlpt_level())
        )
        effective_ignore_fn = (
            ignore_function_words
            if ignore_function_words is not None
            else self._default_ignore_function_words
        )

        tokens: list[AnnotatedToken] = []
        n = len(text)
        i = 0
        max_scan_len = 16

        while i < n:
            matched = False
            limit = min(max_scan_len, n - i)

            for l in range(limit, 0, -1):
                sub = text[i : i + l]

                # 1. Particles and copulas check
                if sub in FUNCTION_WORDS and effective_ignore_fn:
                    tokens.append(
                        AnnotatedToken(
                            surface=sub,
                            lemma=sub,
                            reading=sub,
                            status="unstyled",
                            jlpt_level=None,
                            start=start,
                            end=end,
                            start_char=i,
                            end_char=i + l,
                        )
                    )
                    i += l
                    matched = True
                    break

                # 2. Direct dictionary & mined words check
                best_match: tuple[str, str | None, str] | None = None
                if sub in self._vocab_cache or sub in self._mined_words:
                    jlpt_lvl, rdg = self._vocab_cache.get(sub, (None, ""))
                    rdg = (
                        rdg
                        or self._mined_readings.get(sub, "")
                    )
                    best_match = (sub, jlpt_lvl, rdg)
                elif l == 1 and sub in self._kanji_cache:
                    jlpt_lvl = self._kanji_cache[sub]
                    best_match = (sub, jlpt_lvl, "")
                elif 1 < l <= 12:
                    # Only invoke deinflection BFS for candidate inflected ranges
                    try:
                        candidates = _cached_deinflect(sub)
                    except Exception:
                        candidates = []

                    for c in candidates[1:]:
                        if c.term in self._mined_words or c.term in self._vocab_cache:
                            jlpt_lvl, rdg = self._vocab_cache.get(c.term, (None, ""))
                            rdg = (
                                rdg
                                or self._mined_readings.get(c.term, "")
                                or self._mined_readings.get(sub, "")
                            )
                            best_match = (c.term, jlpt_lvl, rdg)
                            break

                # Fallback: function words when ignore_function_words=False
                if best_match is None and sub in FUNCTION_WORDS and not effective_ignore_fn:
                    jlpt_lvl, rdg = self._vocab_cache.get(sub, (None, ""))
                    best_match = (sub, jlpt_lvl, rdg or sub)

                if best_match is not None:
                    lemma, jlpt_lvl, reading = best_match

                    # Green Overlap Precedence:
                    # should_know (if level <= learner_level) > mined (if in mined set) > unstyled
                    is_mined = (lemma in self._mined_words) or (sub in self._mined_words)
                    if jlpt_lvl and is_within_learner_level(jlpt_lvl, effective_level):
                        if effective_ignore_fn and (
                            sub in FUNCTION_WORDS or lemma in FUNCTION_WORDS
                        ):
                            status = "unstyled"
                        else:
                            status = "should_know"
                    elif is_mined:
                        status = "mined"
                    else:
                        status = "unstyled"

                    tokens.append(
                        AnnotatedToken(
                            surface=sub,
                            lemma=lemma,
                            reading=reading,
                            status=status,
                            jlpt_level=jlpt_lvl,
                            start=start,
                            end=end,
                            start_char=i,
                            end_char=i + l,
                        )
                    )
                    i += l
                    matched = True
                    break

            if not matched:
                # Emit single unstyled character
                char = text[i]
                tokens.append(
                    AnnotatedToken(
                        surface=char,
                        lemma=char,
                        reading="",
                        status="unstyled",
                        jlpt_level=None,
                        start=start,
                        end=end,
                        start_char=i,
                        end_char=i + 1,
                    )
                )
                i += 1

        return tokens
