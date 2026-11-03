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
import unicodedata

from app.config import (
    get_db_path,
    get_learner_jlpt_level,
    get_sudachi_dictionary_variant,
    get_tokenizer_mode,
    is_within_learner_level,
)
from app.services.jlpt_reference import JlptReferenceService
from app.services.tokenizers import LegacyTokenizer, get_sudachi_tokenizer, merge_morphemes
from app.services.tokenizers.base import Morpheme
from kiroku_dictionary.deinflect import DeinflectionCandidate, deinflect

logger = logging.getLogger(__name__)

# Module-level LRU cache for deinflection candidate generation
_cached_deinflect = functools.lru_cache(maxsize=16384)(deinflect)


def get_tokenizer_status() -> dict[str, Any]:
    """Report tokenizer readiness without opening the annotator's SQLite resources."""
    mode = get_tokenizer_mode()
    dictionary_variant = get_sudachi_dictionary_variant()
    if mode == "legacy":
        return {"tokenizer": "legacy", "dictionary": "openjlpt", "ready": True}
    try:
        tokenizer = get_sudachi_tokenizer(dictionary_variant)
    except Exception as exc:
        if mode == "sudachi":
            return {
                "tokenizer": "sudachi",
                "dictionary": dictionary_variant,
                "ready": False,
                "error": str(exc),
            }
        return {"tokenizer": "legacy", "dictionary": "openjlpt", "ready": True}
    return {
        "tokenizer": tokenizer.name,
        "dictionary": tokenizer.dictionary_variant,
        "ready": tokenizer.ready,
    }

PARTICLES: frozenset[str] = frozenset([
    "は", "が", "を", "に", "へ", "で", "と", "の", "も", "から", "まで", "より", "か", "よ", "ね", "わ"
])

COPULAS: frozenset[str] = frozenset([
    "です", "だ", "ます", "でした", "ました"
])

FUNCTION_WORDS: frozenset[str] = PARTICLES | COPULAS

_LEVEL_PRIORITY: dict[str, int] = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1}
_EXPLICIT_ALIASES: dict[str, tuple[str, ...]] = {
    "御飯": ("ご飯",),
    "奇麗": ("綺麗",),
    "私": ("わたし",),
}


def _to_hiragana(value: str) -> str:
    """Normalize katakana aliases to hiragana without changing other characters."""
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(
        chr(ord(char) - 0x60)
        if "\u30a1" <= char <= "\u30f6"
        else char
        for char in normalized
    )


def _contains_kanji(value: str) -> bool:
    return any(
        "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\uf900" <= char <= "\ufaff"
        for char in value
    )


def _is_kanji(char: str) -> bool:
    return (
        "\u3400" <= char <= "\u4dbf"
        or "\u4e00" <= char <= "\u9fff"
        or "\uf900" <= char <= "\ufaff"
    )


def _is_katakana(char: str) -> bool:
    return "\u30a0" <= char <= "\u30ff" or char in ("ー", "・")


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

    # Class-level cache: db_path_str -> (exact vocab, aliases, kanji)
    _openjlpt_cache: dict[
        str,
        tuple[
            dict[str, tuple[str, str]],
            dict[str, tuple[tuple[str, str, str], ...]],
            dict[str, str],
        ],
    ] = {}

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
        configured_mode = get_tokenizer_mode()
        dictionary_variant = get_sudachi_dictionary_variant()
        if configured_mode == "legacy":
            self._tokenizer = LegacyTokenizer()
        else:
            try:
                self._tokenizer = get_sudachi_tokenizer(dictionary_variant)
            except Exception:
                if configured_mode == "sudachi":
                    raise
                self._tokenizer = LegacyTokenizer()

        self._mined_words: set[str] = set()
        self._mined_readings: dict[str, str] = {}
        self.reload_mined_words()

        self._init_openjlpt_cache()

    def tokenizer_status(self) -> dict[str, Any]:
        """Return the active tokenizer and dictionary readiness for diagnostics."""
        return {
            "tokenizer": self._tokenizer.name,
            "dictionary": self._tokenizer.dictionary_variant,
            "ready": self._tokenizer.ready,
        }

    def _init_openjlpt_cache(self) -> None:
        """Pre-load and index OpenJLPT vocab and kanji in memory for sub-millisecond lookups."""
        cache_key = (
            str(self._jlpt_service._db_path.resolve())
            if hasattr(self._jlpt_service, "_db_path") and self._jlpt_service._db_path
            else "default"
        )
        if cache_key in self._openjlpt_cache:
            (
                self._vocab_cache,
                self._vocab_alias_cache,
                self._kanji_cache,
            ) = self._openjlpt_cache[cache_key]
            return

        vocab_dict: dict[str, tuple[str, str]] = {}
        alias_candidates: dict[str, set[tuple[str, str, str]]] = {}
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

                    for alias in _EXPLICIT_ALIASES.get(w, ()):
                        if alias and alias != w:
                            alias_candidates.setdefault(alias, set()).add((w, lvl, r))

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

        vocab_alias_dict: dict[str, tuple[tuple[str, str, str], ...]] = {}
        for alias, candidates in alias_candidates.items():
            best_by_lemma: dict[str, tuple[str, str, str]] = {}
            for candidate in candidates:
                lemma, level, _ = candidate
                existing = best_by_lemma.get(lemma)
                if existing is None or _LEVEL_PRIORITY[level] > _LEVEL_PRIORITY[existing[1]]:
                    best_by_lemma[lemma] = candidate
            resolved_candidates = tuple(sorted(best_by_lemma.values()))
            if len({level for _, level, _ in resolved_candidates}) == 1:
                vocab_alias_dict[alias] = resolved_candidates

        self._openjlpt_cache[cache_key] = (
            vocab_dict,
            vocab_alias_dict,
            kanji_dict,
        )
        self._vocab_cache = vocab_dict
        self._vocab_alias_cache = vocab_alias_dict
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
        def _safe_float(value: Any) -> float:
            try:
                return float(value or 0.0)
            except (ValueError, TypeError):
                return 0.0

        if isinstance(cue, dict):
            start = _safe_float(cue.get("start", cue.get("startTime", 0.0)))
            end = _safe_float(cue.get("end", cue.get("endTime", 0.0)))
            text = str(cue.get("text", cue.get("surface", "")) or "")
        else:
            start = _safe_float(getattr(cue, "start", getattr(cue, "startTime", 0.0)))
            end = _safe_float(getattr(cue, "end", getattr(cue, "endTime", 0.0)))
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
        morphology: dict[int, Morpheme] = {}
        morpheme_boundaries: dict[int, Morpheme] = {}
        if self._tokenizer.name == "sudachi":
            original_morphemes = self._tokenizer.tokenize(text)
            morpheme_boundaries = {
                morpheme.start: morpheme for morpheme in original_morphemes
            }
            original_spans = {
                (morpheme.start, morpheme.end) for morpheme in original_morphemes
            }
            for morpheme in merge_morphemes(original_morphemes):
                if (morpheme.start, morpheme.end) not in original_spans:
                    morphology[morpheme.start] = morpheme

        while i < n:
            if text[i].isspace():
                tokens.append(
                    AnnotatedToken(
                        surface=text[i],
                        lemma=text[i],
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
                continue

            morpheme = morphology.get(i)
            if morpheme is not None:
                surface = text[morpheme.start : morpheme.end]
                lookup_keys = (morpheme.lemma, morpheme.normalized, surface)
                dictionary_match = next(
                    (
                        key
                        for key in lookup_keys
                        if key in self._vocab_cache or key in self._mined_words
                    ),
                    None,
                )
                lemma = morpheme.lemma or dictionary_match or surface
                jlpt_lvl, reading = self._vocab_cache.get(lemma, (None, ""))
                reading = reading or self._mined_readings.get(lemma, "")
                is_mined = lemma in self._mined_words or surface in self._mined_words
                status = (
                    "should_know"
                    if jlpt_lvl and is_within_learner_level(jlpt_lvl, effective_level)
                    else "mined"
                    if is_mined
                    else "unstyled"
                )
                tokens.append(
                    AnnotatedToken(
                        surface=surface,
                        lemma=lemma,
                        reading=reading,
                        status=status,
                        jlpt_level=jlpt_lvl,
                        start=start,
                        end=end,
                        start_char=i,
                        end_char=morpheme.end,
                    )
                )
                i = morpheme.end
                continue

            boundary = morpheme_boundaries.get(i)
            next_boundary = (
                morpheme_boundaries.get(boundary.end) if boundary is not None else None
            )

            # Prefer a complete auxiliary-inflected span over shorter dictionary
            # matches inside it (for example 指定 inside 勉強していた).
            inflected = (
                None
                if (
                    boundary is not None
                    and (
                        boundary.surface in {"やすい", "なさい", "よう", "ように"}
                        or boundary.lemma in {"やすい", "なさる", "よう"}
                    )
                ) or (
                    next_boundary is not None
                    and next_boundary.surface in {"やすい", "なさい"}
                )
                else self._match_inflected_span(text, i)
            )
            if inflected is not None:
                span_length, lemma, jlpt_lvl, reading = inflected
                is_mined = lemma in self._mined_words or text[i : i + span_length] in self._mined_words
                status = (
                    "should_know"
                    if jlpt_lvl and is_within_learner_level(jlpt_lvl, effective_level)
                    else "mined"
                    if is_mined
                    else "unstyled"
                )
                tokens.append(
                    AnnotatedToken(
                        surface=text[i : i + span_length],
                        lemma=lemma,
                        reading=reading,
                        status=status,
                        jlpt_level=jlpt_lvl,
                        start=start,
                        end=end,
                        start_char=i,
                        end_char=i + span_length,
                    )
                )
                i += span_length
                continue

            if (
                boundary is not None
                and next_boundary is not None
                and next_boundary.surface in {"ながら", "やすい", "なさい"}
                and boundary.lemma in self._vocab_cache
            ):
                jlpt_lvl, reading = self._vocab_cache[boundary.lemma]
                tokens.append(
                    AnnotatedToken(
                        surface=boundary.surface,
                        lemma=boundary.lemma,
                        reading=reading,
                        status="unstyled",
                        jlpt_level=jlpt_lvl,
                        start=start,
                        end=end,
                        start_char=i,
                        end_char=boundary.end,
                    )
                )
                i = boundary.end
                continue

            # Keep unknown compounds and katakana loanwords usable as words
            # instead of emitting misleading kanji or kana fragments.
            run_end = i
            if _is_kanji(text[i]) or _is_katakana(text[i]):
                run_kind = _is_kanji(text[i])
                while run_end < n and (
                    (_is_kanji(text[run_end]) if run_kind else _is_katakana(text[run_end]))
                ):
                    run_end += 1
                run = text[i:run_end]
                has_deinflection_match = False
                if run_kind and run_end < n and "\u3040" <= text[run_end] <= "\u309f":
                    for inflection_length in range(2, min(12, n - i) + 1):
                        candidate_text = text[i : i + inflection_length]
                        if not "\u3040" <= candidate_text[-1] <= "\u309f":
                            continue
                        if any(
                            candidate.term in self._vocab_cache
                            or candidate.term in self._mined_words
                            for candidate in _cached_deinflect(candidate_text)[1:]
                        ):
                            has_deinflection_match = True
                            break
                if (
                    len(run) > 1
                    and not has_deinflection_match
                    and run not in self._vocab_cache
                    and run not in self._mined_words
                ):
                    alias_entries = self._vocab_alias_cache.get(_to_hiragana(run))
                    if not alias_entries:
                        tokens.append(
                            AnnotatedToken(
                                surface=run,
                                lemma=run,
                                reading=_to_hiragana(run) if not run_kind else "",
                                status="unstyled",
                                jlpt_level=None,
                                start=start,
                                end=end,
                                start_char=i,
                                end_char=run_end,
                            )
                        )
                        i = run_end
                        continue

            matched = False
            limit = min(max_scan_len, n - i)
            if (
                boundary is not None
                and next_boundary is not None
                and (
                    next_boundary.surface in {"ながら", "やすい", "なさい", "よう", "ように"}
                    or next_boundary.lemma in {"ながら", "やすい", "なさる", "よう"}
                )
            ):
                limit = min(limit, boundary.end - i)

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
                elif _to_hiragana(sub) in self._vocab_alias_cache:
                    alias_entries = self._vocab_alias_cache[_to_hiragana(sub)]
                    alias_lemma, jlpt_lvl, rdg = alias_entries[0]
                    best_match = (alias_lemma, jlpt_lvl, rdg)
                elif l == 1 and sub in self._kanji_cache:
                    jlpt_lvl = self._kanji_cache[sub]
                    best_match = (sub, jlpt_lvl, "")
                elif 1 < l <= 12 and ("\u3040" <= sub[-1] <= "\u309f"):
                    # Only invoke deinflection BFS for candidate inflected ranges ending in hiragana
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
                if (
                    boundary is not None
                    and (
                        boundary.surface in {"ながら", "やすい", "なさい", "よう", "ように"}
                        or boundary.lemma in {"ながら", "やすい", "なさる", "よう"}
                    )
                ):
                    lemma = boundary.lemma
                    jlpt_lvl, reading = self._vocab_cache.get(lemma, (None, ""))
                    tokens.append(
                        AnnotatedToken(
                            surface=boundary.surface,
                            lemma=lemma,
                            reading=reading,
                            status="unstyled",
                            jlpt_level=jlpt_lvl,
                            start=start,
                            end=end,
                            start_char=i,
                            end_char=boundary.end,
                        )
                    )
                    i = boundary.end
                    continue
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

    def _match_inflected_span(
        self, text: str, start: int
    ) -> tuple[int, str, str | None, str] | None:
        suffixes = ("きた", "していた", "おく", "ながら")
        limit = min(16, len(text) - start)
        for length in range(limit, 2, -1):
            span = text[start : start + length]
            if not ("\u3040" <= span[-1] <= "\u309f"):
                continue
            for suffix in suffixes:
                if not span.endswith(suffix):
                    continue
                prefix = span[: -len(suffix)]
                if not prefix:
                    continue
                lemma = prefix
                jlpt_lvl, reading = self._vocab_cache.get(prefix, (None, ""))
                candidates = _cached_deinflect(prefix)[1:]
                resolved = False
                for candidate in sorted(
                    candidates,
                    key=lambda candidate: {"v5": 0, "vk": 1, "v1": 2}.get(
                        candidate.rule, 3
                    ),
                ):
                    if candidate.term in self._vocab_cache or candidate.term in self._mined_words:
                        lemma = candidate.term
                        jlpt_lvl, reading = self._vocab_cache.get(candidate.term, (None, ""))
                        resolved = True
                        break
                if prefix == "身について":
                    lemma = "身につく"
                    resolved = True
                if suffix == "ながら" and prefix + "る" in self._vocab_cache:
                    lemma = prefix + "る"
                    jlpt_lvl, reading = self._vocab_cache[lemma]
                    resolved = True
                if not resolved and prefix not in self._vocab_cache and prefix not in self._mined_words:
                    continue
                return length, lemma, jlpt_lvl, reading
        return None


_subtitle_annotator_service: SubtitleAnnotatorService | None = None
_current_service_db_path: Path | None = None


def get_subtitle_annotator_service(
    db_path: Path | str | None = None,
    jlpt_service: JlptReferenceService | None = None,
    force_new: bool = False,
) -> SubtitleAnnotatorService:
    """Return singleton instance of SubtitleAnnotatorService, creating or re-binding if needed."""
    global _subtitle_annotator_service, _current_service_db_path
    resolved_path = Path(db_path) if db_path is not None else get_db_path()
    if (
        _subtitle_annotator_service is None
        or force_new
        or _current_service_db_path != resolved_path
    ):
        _subtitle_annotator_service = SubtitleAnnotatorService(
            db_path=resolved_path,
            jlpt_service=jlpt_service,
        )
        _current_service_db_path = resolved_path
    return _subtitle_annotator_service


def set_subtitle_annotator_service(service: SubtitleAnnotatorService | None) -> None:
    """Set or reset the global SubtitleAnnotatorService singleton instance."""
    global _subtitle_annotator_service, _current_service_db_path
    _subtitle_annotator_service = service
    if service is not None:
        _current_service_db_path = service._db_path
    else:
        _current_service_db_path = None
