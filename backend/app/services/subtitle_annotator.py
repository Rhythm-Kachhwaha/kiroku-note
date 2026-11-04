"""Subtitle Cue Vocabulary and Status Annotation Service.

Matches mined cards, known words, and OpenJLPT vocabulary/kanji with green precedence on overlap:
should_know (if level <= learner_level) > mined (if in mined set) > unstyled
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path
import sqlite3
import unicodedata
from typing import Any, Optional

from app.config import (
    get_db_path,
    get_learner_jlpt_level,
    get_sudachi_dictionary_variant,
    get_tokenizer_mode,
)
from app.services.jlpt_reference import JlptReferenceService
from app.services.sentence_analysis import analyze
from app.services.tokenizers.base import Morpheme
from app.services.tokenizers.legacy import LegacyTokenizer
from app.services.tokenizers.merge import merge_morphemes
from app.services.tokenizers.sudachi import get_sudachi_tokenizer
from kiroku_dictionary.deinflect import deinflect

logger = logging.getLogger(__name__)

LEGACY_HACKS = True

_global_service: SubtitleAnnotatorService | None = None


def set_subtitle_annotator_service(service: SubtitleAnnotatorService | None) -> None:
    """Explicitly set or reset the process-wide subtitle annotator singleton."""
    global _global_service
    _global_service = service


def get_subtitle_annotator_service(
    db_path: Path | str | None = None,
    jlpt_service: JlptReferenceService | None = None,
    learner_level: str | None = None,
    ignore_function_words: bool = True,
    force_new: bool = False,
) -> SubtitleAnnotatorService:
    """Return a process-wide singleton of SubtitleAnnotatorService."""
    global _global_service
    if force_new or _global_service is None or db_path is not None or jlpt_service is not None:
        service = SubtitleAnnotatorService(
            db_path=db_path,
            jlpt_service=jlpt_service,
            learner_level=learner_level,
            ignore_function_words=ignore_function_words,
        )
        if _global_service is None and db_path is None and jlpt_service is None and not force_new:
            _global_service = service
        elif force_new:
            _global_service = service
        return service
    return _global_service


def get_active_tokenizer_status() -> dict[str, Any]:
    """Report the current runtime tokenizer selection."""
    if _global_service is not None:
        return _global_service.tokenizer_status()
    tokenizer = get_sudachi_tokenizer()
    if tokenizer is None:
        return {"tokenizer": "legacy", "dictionary": "openjlpt", "ready": True}
    return {
        "tokenizer": tokenizer.name,
        "dictionary": tokenizer.dictionary_variant,
        "ready": tokenizer.ready,
    }


get_tokenizer_status = get_active_tokenizer_status


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


def _estimate_kanji_level(text: str, kanji_cache: dict[str, str]) -> str | None:
    kanji_levels = []
    for char in text:
        if _is_kanji(char):
            lvl = kanji_cache.get(char)
            if lvl:
                kanji_levels.append(lvl)
            else:
                kanji_levels.append("N1")
    if not kanji_levels:
        return None
    return min(kanji_levels, key=lambda l: _LEVEL_PRIORITY.get(l, 99))


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
        known: bool = False,
        pos: str = "",
        level_source: str | None = None,
        est_level: str | None = None,
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
            known=known,
            pos=pos,
            level_source=level_source,
            est_level=est_level,
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

    @property
    def known(self) -> bool:
        return self.get("known", False)

    @property
    def pos(self) -> str:
        return self.get("pos", "")

    @property
    def level_source(self) -> str | None:
        return self.get("level_source")

    @property
    def est_level(self) -> str | None:
        return self.get("est_level")


class AnnotatedCue(dict):
    """Subtitle cue containing a list of AnnotatedToken objects."""

    def __init__(
        self,
        start: float,
        end: float,
        text: str,
        tokens: list[AnnotatedToken],
    ) -> None:
        super().__init__(start=start, end=end, text=text, tokens=tokens)

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

    # Class-level cache: db_path_str -> (exact vocab, by_norm, by_reading, kanji, aliases)
    _openjlpt_cache: dict[
        str,
        tuple[
            dict[str, tuple[str, str]],
            dict[str, list[tuple[str, str, str]]],
            dict[str, list[tuple[str, str]]],
            dict[str, str],
            dict[str, tuple[tuple[str, str, str], ...]],
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
                self._vocab_norm_cache,
                self._vocab_reading_cache,
                self._kanji_cache,
                self._vocab_alias_cache,
            ) = self._openjlpt_cache[cache_key]
            return

        vocab_dict: dict[str, tuple[str, str]] = {}
        vocab_norm_dict: dict[str, list[tuple[str, str, str]]] = {}
        vocab_reading_dict: dict[str, list[tuple[str, str]]] = {}
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
                        if _LEVEL_PRIORITY.get(lvl, 0) > _LEVEL_PRIORITY.get(existing_lvl, 0):
                            vocab_dict[w] = (lvl, r or existing_r)
                        elif not existing_r and r:
                            vocab_dict[w] = (existing_lvl, r)

                    norm = _to_hiragana(unicodedata.normalize("NFKC", w))
                    vocab_norm_dict.setdefault(norm, []).append((w, lvl, r))

                    if r:
                        r_hira = _to_hiragana(unicodedata.normalize("NFKC", r))
                        vocab_reading_dict.setdefault(r_hira, []).append((w, lvl))

                    if LEGACY_HACKS:
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
        if LEGACY_HACKS:
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
            vocab_norm_dict,
            vocab_reading_dict,
            kanji_dict,
            vocab_alias_dict,
        )
        self._vocab_cache = vocab_dict
        self._vocab_norm_cache = vocab_norm_dict
        self._vocab_reading_cache = vocab_reading_dict
        self._kanji_cache = kanji_dict
        self._vocab_alias_cache = vocab_alias_dict

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
        """Tokenize and annotate Japanese text using Sudachi-primary analysis with legacy fallback."""
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

        if self._tokenizer.name == "legacy":
            return self._annotate_legacy(
                text=text,
                learner_level=effective_level,
                ignore_function_words=effective_ignore_fn,
                start=start,
                end=end,
            )

        return self._annotate_sudachi(
            text=text,
            learner_level=effective_level,
            ignore_function_words=effective_ignore_fn,
            start=start,
            end=end,
        )

    def _annotate_sudachi(
        self,
        text: str,
        learner_level: str,
        ignore_function_words: bool,
        start: float,
        end: float,
    ) -> list[AnnotatedToken]:
        if text in FUNCTION_WORDS:
            jlpt_lvl = self._vocab_cache.get(text, (None, ""))[0]
            status = (
                "should_know"
                if not ignore_function_words and jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level)
                else "unstyled"
            )
            return [
                AnnotatedToken(
                    surface=text,
                    lemma=text,
                    reading=text,
                    status=status,
                    jlpt_level=jlpt_lvl,
                    start=start,
                    end=end,
                    start_char=0,
                    end_char=len(text),
                    known=False,
                    pos="助詞",
                    level_source="vocab" if jlpt_lvl else None,
                    est_level=None,
                )
            ]

        analysis = analyze(text, variant=self._tokenizer.dictionary_variant)
        tokens: list[AnnotatedToken] = []

        for m in analysis.merged:
            if m.surface.isspace():
                tokens.append(
                    AnnotatedToken(
                        surface=m.surface,
                        lemma=m.surface,
                        reading="",
                        status="unstyled",
                        jlpt_level=None,
                        start=start,
                        end=end,
                        start_char=m.start,
                        end_char=m.end,
                        known=False,
                        pos="",
                        level_source=None,
                        est_level=None,
                    )
                )
                continue

            if m.is_oov:
                # OOV units keep greedy fallback only for those spans
                span_tokens = self._annotate_legacy(
                    text=m.surface,
                    learner_level=learner_level,
                    ignore_function_words=ignore_function_words,
                    start=start,
                    end=end,
                )
                for st in span_tokens:
                    shifted = AnnotatedToken(
                        surface=st.surface,
                        lemma=st.lemma,
                        reading=st.reading,
                        status=st.status,
                        jlpt_level=st.jlpt_level,
                        start=start,
                        end=end,
                        start_char=m.start + st.start_char,
                        end_char=m.start + st.end_char,
                        known=st.known,
                        pos=st.pos or (m.pos[0] if m.pos else ""),
                        level_source=st.level_source or ("vocab" if st.jlpt_level else None),
                        est_level=st.est_level,
                    )
                    tokens.append(shifted)
                continue

            # Lookup order: lemma -> normalized_form -> surface -> (kana-only unit) by_reading
            jlpt_lvl = None
            rdg = ""
            level_source = None
            est_level = None
            resolved_lemma = m.lemma

            if m.lemma in self._vocab_cache:
                jlpt_lvl, rdg = self._vocab_cache[m.lemma]
                level_source = "vocab"
            elif m.normalized in self._vocab_cache:
                jlpt_lvl, rdg = self._vocab_cache[m.normalized]
                level_source = "vocab"
                if len(m.normalized) == len(m.lemma):
                    resolved_lemma = m.normalized
            elif m.surface in self._vocab_cache:
                jlpt_lvl, rdg = self._vocab_cache[m.surface]
                level_source = "vocab"
                if len(m.surface) == len(m.lemma):
                    resolved_lemma = m.surface
            elif norm_hits := self._vocab_norm_cache.get(_to_hiragana(unicodedata.normalize("NFKC", m.lemma))):
                jlpt_lvl, rdg = norm_hits[0][1], norm_hits[0][2]
                level_source = "vocab"
            elif not _contains_kanji(m.surface):
                rdg_key = _to_hiragana(m.reading or m.surface)
                hits = self._vocab_reading_cache.get(rdg_key, [])
                if hits:
                    if len(hits) == 1:
                        jlpt_lvl = hits[0][1]
                        rdg = rdg_key
                        level_source = "vocab"
                        resolved_lemma = hits[0][0]
                    else:
                        unique_levels = {h[1] for h in hits}
                        if len(unique_levels) == 1:
                            jlpt_lvl = hits[0][1]
                            rdg = rdg_key
                            level_source = "vocab"
                            resolved_lemma = hits[0][0]
                        else:
                            best_hit = max(hits, key=lambda h: _LEVEL_PRIORITY.get(h[1], 0))
                            jlpt_lvl = best_hit[1]
                            rdg = rdg_key
                            level_source = "vocab"
                            resolved_lemma = best_hit[0]

            if level_source != "vocab":
                if _contains_kanji(m.surface) or _contains_kanji(m.lemma):
                    est = _estimate_kanji_level(m.surface, self._kanji_cache)
                    if est:
                        est_level = est
                        level_source = "kanji_est"
                        jlpt_lvl = None

            is_mined = (
                (resolved_lemma in self._mined_words)
                or (m.lemma in self._mined_words)
                or (m.surface in self._mined_words)
                or (m.normalized in self._mined_words)
            )
            if not is_mined:
                for deinf_cand in deinflect(m.surface):
                    if deinf_cand.term in self._mined_words:
                        is_mined = True
                        resolved_lemma = deinf_cand.term
                        break
            known = is_mined
            token_reading = (
                self._mined_readings.get(resolved_lemma)
                or self._mined_readings.get(m.lemma)
                or self._mined_readings.get(m.surface)
                or rdg
                or _to_hiragana(m.reading or m.surface)
            )

            if level_source == "vocab" and jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level):
                if ignore_function_words and (m.surface in FUNCTION_WORDS or resolved_lemma in FUNCTION_WORDS):
                    status = "unstyled"
                else:
                    status = "should_know"
            elif is_mined:
                status = "mined"
            else:
                status = "unstyled"

            pos_str = m.pos[0] if m.pos else ""
            tokens.append(
                AnnotatedToken(
                    surface=m.surface,
                    lemma=resolved_lemma,
                    reading=token_reading,
                    status=status,
                    jlpt_level=jlpt_lvl,
                    start=start,
                    end=end,
                    start_char=m.start,
                    end_char=m.end,
                    known=known,
                    pos=pos_str,
                    level_source=level_source,
                    est_level=est_level,
                )
            )

        return tokens

    def _annotate_legacy(
        self,
        text: str,
        learner_level: str,
        ignore_function_words: bool,
        start: float,
        end: float,
    ) -> list[AnnotatedToken]:
        """Legacy greedy forward longest-match scanning path."""
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
                    "mined"
                    if is_mined
                    else (
                        "should_know"
                        if jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level)
                        else "unstyled"
                    )
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
                        start_char=morpheme.start,
                        end_char=morpheme.end,
                    )
                )
                i = morpheme.end
                continue

            # Greedy longest-match scan: try lengths from max_scan_len down to 1
            matched = False
            best_match: tuple[str, str | None, str] | None = None
            match_len = 0

            # 1. First check deinflection chains (verbs and adjectives)
            inflected = self._match_inflected_span(text, i, n)
            if inflected:
                span_length, lemma, jlpt_lvl, reading = inflected
                is_mined = (lemma in self._mined_words) or (
                    text[i : i + span_length] in self._mined_words
                )
                status = (
                    "mined"
                    if is_mined
                    else (
                        "should_know"
                        if jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level)
                        else "unstyled"
                    )
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

            boundary = morpheme_boundaries.get(i)
            if (
                boundary is not None
                and boundary.surface == text[i : boundary.end]
                and boundary.lemma in self._vocab_cache
            ):
                jlpt_lvl, reading = self._vocab_cache[boundary.lemma]
                tokens.append(
                    AnnotatedToken(
                        surface=boundary.surface,
                        lemma=boundary.lemma,
                        reading=reading or boundary.reading,
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

            # 2. Check for katakana loanword runs
            if "\u30a1" <= text[i] <= "\u30f6":
                katakana_end = i
                while katakana_end < n and (
                    "\u30a1" <= text[katakana_end] <= "\u30f6"
                    or text[katakana_end] == "\u30fc"
                ):
                    katakana_end += 1
                run = text[i:katakana_end]

                deinflected_candidates = deinflect(run)
                for candidate in deinflected_candidates:
                    if (
                        candidate.term in self._mined_words
                        or candidate.term in self._vocab_cache
                    ):
                        jlpt_lvl, reading = self._vocab_cache.get(
                            candidate.term, (None, "")
                        )
                        tokens.append(
                            AnnotatedToken(
                                surface=run,
                                lemma=candidate.term,
                                reading=reading or run,
                                status="mined"
                                if candidate.term in self._mined_words
                                else "unstyled",
                                jlpt_level=jlpt_lvl,
                                start=start,
                                end=end,
                                start_char=i,
                                end_char=katakana_end,
                            )
                        )
                        i = katakana_end
                        matched = True
                        break
                if matched:
                    continue

                if (
                    run in self._mined_words
                    and run not in self._vocab_cache
                    and _to_hiragana(run) in self._vocab_alias_cache
                ):
                    alias_entries = self._vocab_alias_cache.get(_to_hiragana(run))
                    if alias_entries:
                        alias_lemma, jlpt_lvl, reading = alias_entries[0]
                        tokens.append(
                            AnnotatedToken(
                                surface=run,
                                lemma=alias_lemma,
                                reading=reading or _to_hiragana(run),
                                status="mined",
                                jlpt_level=None,
                                start=start,
                                end=end,
                                start_char=i,
                                end_char=katakana_end,
                            )
                        )
                        i = katakana_end
                        continue

                if run in self._mined_words:
                    tokens.append(
                        AnnotatedToken(
                            surface=run,
                            lemma=run,
                            reading=self._mined_readings.get(run, run),
                            status="mined",
                            jlpt_level=None,
                            start=start,
                            end=end,
                            start_char=i,
                            end_char=katakana_end,
                        )
                    )
                    i = katakana_end
                    continue

                if run not in self._vocab_cache:
                    tokens.append(
                        AnnotatedToken(
                            surface=run,
                            lemma=run,
                            reading=_to_hiragana(run),
                            status="unstyled",
                            jlpt_level=None,
                            start=start,
                            end=end,
                            start_char=i,
                            end_char=katakana_end,
                        )
                    )
                    i = katakana_end
                    continue

            # 3. Standard longest match scan
            for length in range(min(n - i, max_scan_len), 0, -1):
                sub = text[i : i + length]
                if sub in self._vocab_cache or sub in self._mined_words:
                    jlpt_lvl, rdg = self._vocab_cache.get(sub, (None, ""))
                    if not rdg and sub in self._mined_readings:
                        rdg = self._mined_readings[sub]
                    best_match = (sub, jlpt_lvl, rdg)
                    match_len = length
                    break
                elif _to_hiragana(sub) in self._vocab_alias_cache:
                    alias_entries = self._vocab_alias_cache[_to_hiragana(sub)]
                    alias_lemma, jlpt_lvl, rdg = alias_entries[0]
                    best_match = (alias_lemma, jlpt_lvl, rdg)
                    match_len = length
                    break
                elif length == 1 and sub in self._kanji_cache:
                    jlpt_lvl = self._kanji_cache[sub]
                    best_match = (sub, jlpt_lvl, "")
                    match_len = length
                    break
                elif length > 1:
                    candidates = deinflect(sub)
                    found = False
                    for c in candidates:
                        if c.term in self._mined_words or c.term in self._vocab_cache:
                            jlpt_lvl, rdg = self._vocab_cache.get(c.term, (None, ""))
                            if not rdg and c.term in self._mined_readings:
                                rdg = self._mined_readings[c.term]
                            best_match = (c.term, jlpt_lvl, rdg)
                            match_len = length
                            found = True
                            break
                    if found:
                        break

            if not best_match:
                sub = text[i : i + 1]
                jlpt_lvl, rdg = self._vocab_cache.get(sub, (None, ""))
                best_match = (sub, jlpt_lvl, rdg or sub)
                match_len = 1

            if best_match:
                lemma, jlpt_lvl, reading = best_match
                sub = text[i : i + match_len]

                is_mined = (lemma in self._mined_words) or (sub in self._mined_words)
                if jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level):
                    if ignore_function_words and (
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
                        end_char=i + match_len,
                    )
                )
                i += match_len
            else:
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

        return tokens

    def _match_inflected_span(
        self, text: str, i: int, n: int
    ) -> tuple[int, str, str | None, str] | None:
        """Attempt to match inflected verbs/adjectives."""
        _INFLECTED_SUFFIXES = (
            "ながら", "やすい", "にくい", "たい", "たくない", "たかった", "たくなかった",
            "そう", "そうだ", "そうに", "そうな", "られる", "られた", "られない",
            "られると", "させる", "させた", "させない", "ている", "ていた", "ていません",
            "ていました", "て", "で", "た", "だ", "ない", "なかった", "ば",
            "れば", "たら", "だら", "なら", "ます", "ました", "ません", "ませんでした",
        )
        for length in range(min(n - i, 16), 1, -1):
            sub = text[i : i + length]
            for suffix in _INFLECTED_SUFFIXES:
                if sub.endswith(suffix):
                    prefix = sub[: -len(suffix)]
                    if prefix:
                        candidates = deinflect(sub)
                        for candidate in candidates:
                            if candidate.term in self._mined_words or candidate.term in self._vocab_cache:
                                jlpt_lvl, reading = self._vocab_cache.get(candidate.term, (None, ""))
                                if not reading and candidate.term in self._mined_readings:
                                    reading = self._mined_readings[candidate.term]
                                return length, candidate.term, jlpt_lvl, reading
        return None


def is_within_learner_level(word_level: str | None, learner_level: str | None) -> bool:
    """Return True if word_level <= learner_level."""
    if not word_level or not learner_level:
        return False
    w_p = _LEVEL_PRIORITY.get(word_level.upper())
    l_p = _LEVEL_PRIORITY.get(learner_level.upper())
    if w_p is None or l_p is None:
        return False
    return w_p >= l_p
