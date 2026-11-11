"""Subtitle Cue Vocabulary and Status Annotation Service.

Matches mined cards, known words, and OpenJLPT vocabulary/kanji with green precedence on overlap:
should_know (if level <= learner_level) > mined (if in mined set) > unstyled
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import logging
from pathlib import Path
import sqlite3
import unicodedata
from typing import Any, Iterable, Optional

from app.config import (
    get_db_path,
    get_learner_jlpt_level,
    get_sudachi_dictionary_variant,
    get_tokenizer_mode,
)
from app.repositories.word_state_repository import (
    WordStateRepository,
    WordStatesIndex,
    normalize_word_expression,
    normalize_word_reading,
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
        gloss: str = "",
        sequence_id: int | None = None,
        canonical_reading: str | None = None,
        unresolved: bool = False,
        resolution_status: str = "unvalidated",
        word_state: str = "unseen",
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
            gloss=gloss,
            sequence_id=sequence_id,
            canonical_reading=canonical_reading,
            unresolved=unresolved,
            resolution_status=resolution_status,
            word_state=word_state,
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

    @property
    def gloss(self) -> str:
        return self.get("gloss", "")

    @property
    def sequence_id(self) -> int | None:
        return self.get("sequence_id")

    @property
    def canonical_reading(self) -> str | None:
        return self.get("canonical_reading")

    @property
    def canonical_id(self) -> tuple[int, str] | None:
        seq = self.get("sequence_id")
        if seq is None:
            return None
        return (seq, self.get("canonical_reading") or self.get("reading", ""))

    @property
    def unresolved(self) -> bool:
        return bool(self.get("unresolved", False))

    @property
    def resolution_status(self) -> str:
        return self.get("resolution_status", "unvalidated")

    @property
    def word_state(self) -> str:
        return self.get("word_state", "unseen")


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
        dict_engine: Any = None,
        known_words: Iterable[str] | None = None,
    ) -> None:
        self._db_path = Path(db_path) if db_path is not None else get_db_path()
        self._jlpt_service = jlpt_service or JlptReferenceService()
        self._default_learner_level = learner_level
        self._default_ignore_function_words = ignore_function_words
        self._dict_engine = dict_engine
        self._dict_engine_checked = dict_engine is not None
        self._canonical_cache: dict[tuple[str, str, str, str, str], Any] = {}
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
        self._mined_words_no_reading: set[str] = set()
        self._mined_card_pairs: set[tuple[str, str]] = set()
        self._mined_readings: dict[str, str] = {}
        self._known_words_table: set[str] = set()
        self._explicit_known_words: set[str] = {
            str(w).strip() for w in (known_words or ()) if str(w).strip()
        }
        self._combined_known_words: set[str] = set(self._explicit_known_words)
        self._word_states_index: WordStatesIndex = WordStatesIndex()
        self._vocab_gloss_cache: dict[str, str] = {}
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
            entry = self._openjlpt_cache[cache_key]
            self._vocab_cache = entry[0]
            self._vocab_norm_cache = entry[1]
            self._vocab_reading_cache = entry[2]
            self._kanji_cache = entry[3]
            self._vocab_alias_cache = entry[4]
            self._vocab_gloss_cache = entry[5] if len(entry) > 5 else {}
            return

        vocab_dict: dict[str, tuple[str, str]] = {}
        vocab_gloss_dict: dict[str, str] = {}
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
                rows = cursor.execute("SELECT word, reading, level, meanings FROM vocab").fetchall()
                for row in rows:
                    if not row or not row[0]:
                        continue
                    word = row[0]
                    reading = row[1] if len(row) > 1 else ""
                    level = row[2] if len(row) > 2 else ""
                    meanings = row[3] if len(row) > 3 else None

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

                    if meanings and w not in vocab_gloss_dict:
                        try:
                            parsed = json.loads(meanings) if isinstance(meanings, str) else meanings
                            if isinstance(parsed, list) and parsed:
                                vocab_gloss_dict[w] = "; ".join(str(x) for x in parsed[:2])
                            elif isinstance(parsed, str):
                                vocab_gloss_dict[w] = parsed
                        except Exception:
                            vocab_gloss_dict[w] = str(meanings)

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
            vocab_gloss_dict,
        )
        self._vocab_cache = vocab_dict
        self._vocab_norm_cache = vocab_norm_dict
        self._vocab_reading_cache = vocab_reading_dict
        self._kanji_cache = kanji_dict
        self._vocab_alias_cache = vocab_alias_dict
        self._vocab_gloss_cache = vocab_gloss_dict

    def reload_mined_words(self) -> None:
        """Query and cache mined cards, known words, and canonical word_states from SQLite."""
        self._mined_words.clear()
        self._mined_words_no_reading.clear()
        self._mined_card_pairs.clear()
        self._mined_readings.clear()
        self._known_words_table.clear()
        self._word_states_index = WordStatesIndex()
        self._combined_known_words = set(self._explicit_known_words)

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
                        raw_reading = str(r["reading"] or "").strip()
                        norm_reading = normalize_word_reading(raw_reading)
                        if r["normalized_expression"]:
                            norm = str(r["normalized_expression"]).strip()
                            self._mined_words.add(norm)
                            if raw_reading:
                                self._mined_readings[norm] = raw_reading
                                self._mined_card_pairs.add((norm, norm_reading))
                            else:
                                self._mined_words_no_reading.add(norm)
                        if r["expression"]:
                            expr = str(r["expression"]).strip()
                            self._mined_words.add(expr)
                            if raw_reading:
                                if expr not in self._mined_readings:
                                    self._mined_readings[expr] = raw_reading
                                self._mined_card_pairs.add((expr, norm_reading))
                            else:
                                self._mined_words_no_reading.add(expr)
                except sqlite3.OperationalError:
                    pass

                # 2. Known words table
                try:
                    rows = cursor.execute("SELECT word FROM known_words").fetchall()
                    for r in rows:
                        if r["word"]:
                            w = str(r["word"]).strip()
                            self._mined_words.add(w)
                            self._known_words_table.add(w)
                except sqlite3.OperationalError:
                    pass

                # 3. Canonical word_states table
                try:
                    has_ws = cursor.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='word_states'"
                    ).fetchone()
                    if has_ws:
                        self._word_states_index = WordStateRepository(
                            self._db_path, initialize=False
                        ).get_word_states_index()
                except sqlite3.OperationalError:
                    pass
        except Exception as err:
            logger.debug("Failed to load mined cards from %s: %s", self._db_path, err)

        self._combined_known_words = self._known_words_table | self._explicit_known_words

    def add_mined_word(self, word: str, reading: str = "") -> None:
        """Dynamically add a word to the active in-memory mined and known caches."""
        w = str(word).strip()
        if not w:
            return
        self._mined_words.add(w)
        norm_expr = normalize_word_expression(w)
        if reading:
            clean_read = str(reading).strip()
            norm_read = normalize_word_reading(clean_read)
            self._mined_readings[w] = clean_read
            self._mined_card_pairs.add((w, norm_read))
            self._word_states_index.by_fallback_expr_reading.setdefault(
                (norm_expr, norm_read),
                None,  # replaced below if absent
            )
            from app.repositories.word_state_repository import WordStateRecord
            self._word_states_index.by_fallback_expr_reading[(norm_expr, norm_read)] = WordStateRecord(
                id=0,
                sequence_id=None,
                reading=norm_read,
                expression=norm_expr,
                state="known",
            )
        else:
            self._known_words_table.add(w)
            self._combined_known_words.add(w)
            from app.repositories.word_state_repository import WordStateRecord
            self._word_states_index.by_fallback_expr[norm_expr] = WordStateRecord(
                id=0,
                sequence_id=None,
                reading="",
                expression=norm_expr,
                state="known",
            )

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

    def _build_effective_known_words(
        self, known_words: Iterable[str] | None = None
    ) -> set[str]:
        if known_words is None:
            return self._combined_known_words
        extra = {str(w).strip() for w in known_words if str(w).strip()}
        return self._combined_known_words | extra

    def _resolve_token_word_state(
        self,
        *,
        seq_id: int | None,
        canon_rdg: str | None,
        resolved_lemma: str,
        lemma: str,
        normalized: str,
        surface: str,
        token_reading: str,
        effective_known_words: set[str],
        allow_deinflect_fallback: bool = True,
    ) -> tuple[str, bool, bool, str]:
        """
        Resolve (word_state, known, is_mined, resolved_lemma) for a token.

        Precedence:
        1. Canonical word_states by (sequence_id, reading) when sequence_id is resolved,
           falling back only to sequence_id IS NULL entries (never across sequence_ids).
        2. Explicit known_words (caller-supplied set/list or known_words table).
        3. Mined cards table (reading-matched when card reading exists).
        """
        # 1. word_states table
        ws_rec = self._word_states_index.resolve(
            sequence_id=seq_id,
            canonical_reading=canon_rdg,
            reading=token_reading,
            expression=resolved_lemma,
            surface=surface,
        )
        if ws_rec is None and lemma and lemma != resolved_lemma:
            ws_rec = self._word_states_index.resolve(
                sequence_id=seq_id,
                canonical_reading=canon_rdg,
                reading=token_reading,
                expression=lemma,
                surface=surface,
            )
        if ws_rec is None and normalized and normalized not in (resolved_lemma, lemma):
            ws_rec = self._word_states_index.resolve(
                sequence_id=seq_id,
                canonical_reading=canon_rdg,
                reading=token_reading,
                expression=normalized,
                surface=surface,
            )
        if ws_rec is None and seq_id is None and allow_deinflect_fallback and surface:
            for deinf_cand in deinflect(surface):
                if deinf_cand.term in (resolved_lemma, lemma, surface):
                    continue
                ws_rec = self._word_states_index.resolve(
                    sequence_id=None,
                    canonical_reading=None,
                    reading=token_reading,
                    expression=deinf_cand.term,
                    surface="",
                )
                if ws_rec is not None:
                    resolved_lemma = deinf_cand.term
                    break

        if ws_rec is not None:
            ws_state = ws_rec.state
            return ws_state, (ws_state == "known"), (ws_state in ("known", "learning", "tracking")), resolved_lemma

        # 2. Explicit known_words (caller param + known_words table)
        for cand in (resolved_lemma, lemma, surface, normalized):
            if cand and cand in effective_known_words:
                return "known", True, True, resolved_lemma
        if allow_deinflect_fallback and surface:
            for deinf_cand in deinflect(surface):
                if deinf_cand.term in effective_known_words:
                    return "known", True, True, deinf_cand.term

        # 3. Mined cards table (reading-aware to avoid homograph collisions)
        norm_tok_read = normalize_word_reading(canon_rdg or token_reading)
        for cand in (resolved_lemma, lemma, surface, normalized):
            if not cand:
                continue
            if cand in self._mined_words_no_reading:
                return "learning", False, True, resolved_lemma
            if norm_tok_read and (cand, norm_tok_read) in self._mined_card_pairs:
                return "learning", False, True, resolved_lemma
            if not norm_tok_read and cand in self._mined_words:
                return "learning", False, True, resolved_lemma
        if allow_deinflect_fallback and surface:
            for deinf_cand in deinflect(surface):
                if deinf_cand.term in self._mined_words_no_reading or (
                    norm_tok_read and (deinf_cand.term, norm_tok_read) in self._mined_card_pairs
                ):
                    return "learning", False, True, deinf_cand.term

        return "unseen", False, False, resolved_lemma

    @staticmethod
    def _is_encounter_skippable(token: AnnotatedToken) -> bool:
        surface = token.surface
        if not surface or surface.isspace():
            return True
        pos = token.pos
        if pos in ("補助記号", "記号", "空白"):
            return True
        if all(unicodedata.category(ch).startswith(("P", "Z", "C")) for ch in surface):
            return True
        return False

    def _record_encounters_for_tokens(
        self,
        cue_token_pairs: list[tuple[str, list[AnnotatedToken]]],
        *,
        source_media: str = "",
    ) -> int:
        encounters: list[dict[str, Any]] = []
        for sentence_text, tokens in cue_token_pairs:
            for tok in tokens:
                if self._is_encounter_skippable(tok):
                    continue
                encounters.append(
                    {
                        "sequence_id": tok.sequence_id,
                        "canonical_reading": tok.canonical_reading or tok.reading,
                        "reading": tok.reading,
                        "expression": tok.lemma or tok.surface,
                        "sentence": sentence_text,
                        "source_media": source_media,
                    }
                )
        if not encounters:
            return 0
        repo = WordStateRepository(self._db_path, initialize=True)
        count = repo.log_encounters(encounters, default_source_media=source_media)
        self._word_states_index = repo.get_word_states_index()
        return count

    def log_encounters_from_cues(
        self,
        cues: list[Any],
        *,
        source_media: str = "",
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
    ) -> list[AnnotatedCue]:
        """Annotate cues and persist encounters for every content token in one batch."""
        return self.annotate_cues(
            cues,
            learner_level=learner_level,
            ignore_function_words=ignore_function_words,
            record_encounters=True,
            source_media=source_media,
        )

    def annotate_cue(
        self,
        cue: Any,
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
        known_words: Iterable[str] | None = None,
        record_encounters: bool = False,
        source_media: str = "",
    ) -> AnnotatedCue:
        """Annotate a single subtitle cue."""
        start, end, text = self._extract_cue_fields(cue)
        tokens = self.annotate_text(
            text,
            learner_level=learner_level,
            ignore_function_words=ignore_function_words,
            start=start,
            end=end,
            known_words=known_words,
            record_encounters=record_encounters,
            source_media=source_media,
        )
        return AnnotatedCue(start=start, end=end, text=text, tokens=tokens)

    def annotate_cues(
        self,
        cues: list[Any],
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
        known_words: Iterable[str] | None = None,
        record_encounters: bool = False,
        source_media: str = "",
    ) -> list[AnnotatedCue]:
        """Batch annotate a list of subtitle cues."""
        results = [
            self.annotate_cue(
                c,
                learner_level=learner_level,
                ignore_function_words=ignore_function_words,
                known_words=known_words,
                record_encounters=False,
                source_media=source_media,
            )
            for c in cues
        ]
        if record_encounters and results:
            self._record_encounters_for_tokens(
                [(cue_res.text, cue_res.tokens) for cue_res in results],
                source_media=source_media,
            )
            # Refresh token word_state/known after unseen -> seen transition
            for cue_res in results:
                for tok in cue_res.tokens:
                    if tok.word_state == "unseen" and not self._is_encounter_skippable(tok):
                        tok["word_state"] = "seen"
        return results

    def _get_dict_engine(self) -> Any:
        if self._dict_engine is not None or self._dict_engine_checked:
            return self._dict_engine
        self._dict_engine_checked = True
        try:
            from app.services.dictionary_provider import resolve_dictionary_db_path
            from kiroku_dictionary import DictionaryEngine

            dict_path = resolve_dictionary_db_path()
            if dict_path.is_file():
                self._dict_engine = DictionaryEngine(str(dict_path))
        except Exception as exc:
            logger.debug("Optional DictionaryEngine init skipped in SubtitleAnnotatorService: %s", exc)
            self._dict_engine = None
        return self._dict_engine

    def _resolve_canonical_for_token(
        self,
        lemma: str,
        normalized: str,
        surface: str,
        reading: str,
        pos: tuple[str, ...] | str,
    ) -> tuple[int | None, str | None, bool, str]:
        pos0 = pos[0] if isinstance(pos, tuple) and pos else (pos if isinstance(pos, str) else "")
        if not surface or surface.isspace() or pos0 in ("補助記号", "記号", "空白"):
            return (None, None, False, "skipped")

        engine = self._get_dict_engine()
        if engine is None:
            return (None, None, False, "unvalidated")

        key = (lemma, normalized, surface, reading, pos0)
        if key not in self._canonical_cache:
            self._canonical_cache[key] = engine.resolve_canonical(
                lemma,
                normalized_form=normalized,
                surface=surface,
                reading=reading,
                pos=pos,
            )
        canon = self._canonical_cache[key]
        if canon is None:
            return (None, None, True, "unresolved")
        return (canon.sequence_id, canon.reading, False, "resolved")

    def _lookup_gloss(self, lemma: str, surface: str = "") -> str:
        return (
            self._vocab_gloss_cache.get(lemma)
            or self._vocab_gloss_cache.get(surface)
            or ""
        )

    def annotate_text(
        self,
        text: str,
        learner_level: str | None = None,
        ignore_function_words: bool | None = None,
        start: float = 0.0,
        end: float = 0.0,
        known_words: Iterable[str] | None = None,
        record_encounters: bool = False,
        source_media: str = "",
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
        effective_known_words = self._build_effective_known_words(known_words)

        if self._tokenizer.name == "legacy":
            tokens = self._annotate_legacy(
                text=text,
                learner_level=effective_level,
                ignore_function_words=effective_ignore_fn,
                start=start,
                end=end,
                effective_known_words=effective_known_words,
            )
        else:
            tokens = self._annotate_sudachi(
                text=text,
                learner_level=effective_level,
                ignore_function_words=effective_ignore_fn,
                start=start,
                end=end,
                effective_known_words=effective_known_words,
            )

        if record_encounters and tokens:
            self._record_encounters_for_tokens(
                [(text, tokens)],
                source_media=source_media,
            )
            for tok in tokens:
                if tok.word_state == "unseen" and not self._is_encounter_skippable(tok):
                    tok["word_state"] = "seen"
        return tokens

    def _annotate_sudachi(
        self,
        text: str,
        learner_level: str,
        ignore_function_words: bool,
        start: float,
        end: float,
        effective_known_words: set[str] | None = None,
    ) -> list[AnnotatedToken]:
        known_set = effective_known_words if effective_known_words is not None else self._combined_known_words
        if text in FUNCTION_WORDS:
            jlpt_lvl = self._vocab_cache.get(text, (None, ""))[0]
            seq_id, canon_rdg, is_unres, res_status = self._resolve_canonical_for_token(
                text, text, text, text, ("助詞",)
            )
            word_state, known, is_mined, _ = self._resolve_token_word_state(
                seq_id=seq_id,
                canon_rdg=canon_rdg,
                resolved_lemma=text,
                lemma=text,
                normalized=text,
                surface=text,
                token_reading=canon_rdg or text,
                effective_known_words=known_set,
                allow_deinflect_fallback=False,
            )
            if word_state in ("ignored", "blacklisted"):
                status = "unstyled"
            elif not ignore_function_words and jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level):
                status = "should_know"
            elif is_mined and not ignore_function_words:
                status = "mined"
            else:
                status = "unstyled"
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
                    known=known,
                    pos="助詞",
                    level_source="vocab" if jlpt_lvl else None,
                    est_level=None,
                    gloss=self._lookup_gloss(text, text),
                    sequence_id=seq_id,
                    canonical_reading=canon_rdg,
                    unresolved=is_unres,
                    resolution_status=res_status,
                    word_state=word_state,
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
                        gloss="",
                        word_state="unseen",
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
                    effective_known_words=known_set,
                )
                for st in span_tokens:
                    st_pos = st.pos or (m.pos[0] if m.pos else "")
                    seq_id, canon_rdg, is_unres, res_status = self._resolve_canonical_for_token(
                        st.lemma,
                        m.normalized if len(span_tokens) == 1 else st.lemma,
                        st.surface,
                        st.reading or m.reading,
                        st_pos,
                    )
                    word_state, known, is_mined, resolved_st_lemma = self._resolve_token_word_state(
                        seq_id=seq_id,
                        canon_rdg=canon_rdg,
                        resolved_lemma=st.lemma,
                        lemma=st.lemma,
                        normalized=m.normalized if len(span_tokens) == 1 else st.lemma,
                        surface=st.surface,
                        token_reading=canon_rdg or st.reading or _to_hiragana(m.reading),
                        effective_known_words=known_set,
                    )
                    if word_state in ("ignored", "blacklisted"):
                        tok_status = "unstyled"
                    elif st.status == "should_know":
                        tok_status = "should_know"
                    elif is_mined:
                        tok_status = "mined"
                    else:
                        tok_status = st.status
                    shifted = AnnotatedToken(
                        surface=st.surface,
                        lemma=resolved_st_lemma,
                        reading=canon_rdg or st.reading,
                        status=tok_status,
                        jlpt_level=st.jlpt_level,
                        start=start,
                        end=end,
                        start_char=m.start + st.start_char,
                        end_char=m.start + st.end_char,
                        known=known,
                        pos=st_pos,
                        level_source=st.level_source or ("vocab" if st.jlpt_level else None),
                        est_level=st.est_level,
                        gloss=st.get("gloss") or self._lookup_gloss(resolved_st_lemma, st.surface),
                        sequence_id=seq_id,
                        canonical_reading=canon_rdg,
                        unresolved=is_unres,
                        resolution_status=res_status,
                        word_state=word_state,
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

            pos_str = m.pos[0] if m.pos else ""
            seq_id, canon_rdg, is_unres, res_status = self._resolve_canonical_for_token(
                m.lemma,
                m.normalized,
                m.surface,
                m.reading or rdg or _to_hiragana(m.surface),
                m.pos,
            )

            if canon_rdg:
                token_reading = canon_rdg
            elif m.surface == m.lemma and m.reading:
                token_reading = _to_hiragana(m.reading)
            else:
                token_reading = (
                    rdg
                    or self._mined_readings.get(resolved_lemma)
                    or self._mined_readings.get(m.lemma)
                    or self._mined_readings.get(m.surface)
                    or _to_hiragana(m.reading or m.surface)
                )

            word_state, known, is_mined, resolved_lemma = self._resolve_token_word_state(
                seq_id=seq_id,
                canon_rdg=canon_rdg,
                resolved_lemma=resolved_lemma,
                lemma=m.lemma,
                normalized=m.normalized,
                surface=m.surface,
                token_reading=token_reading,
                effective_known_words=known_set,
            )

            if word_state in ("ignored", "blacklisted"):
                status = "unstyled"
            elif level_source == "vocab" and jlpt_lvl and is_within_learner_level(jlpt_lvl, learner_level):
                if ignore_function_words and (m.surface in FUNCTION_WORDS or resolved_lemma in FUNCTION_WORDS):
                    status = "unstyled"
                else:
                    status = "should_know"
            elif is_mined:
                status = "mined"
            else:
                status = "unstyled"

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
                    gloss=self._lookup_gloss(resolved_lemma, m.surface),
                    sequence_id=seq_id,
                    canonical_reading=canon_rdg,
                    unresolved=is_unres,
                    resolution_status=res_status,
                    word_state=word_state,
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
        effective_known_words: set[str] | None = None,
    ) -> list[AnnotatedToken]:
        """Legacy greedy forward longest-match scanning path."""
        known_set = effective_known_words if effective_known_words is not None else self._combined_known_words
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
                if sub in self._vocab_cache or sub in self._mined_words or sub in known_set:
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
                        if c.term in self._mined_words or c.term in known_set or c.term in self._vocab_cache:
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

        for tok in tokens:
            if not tok.surface or tok.surface.isspace():
                continue
            word_state, known, is_mined, resolved_lemma = self._resolve_token_word_state(
                seq_id=tok.sequence_id,
                canon_rdg=tok.canonical_reading,
                resolved_lemma=tok.lemma,
                lemma=tok.lemma,
                normalized=tok.lemma,
                surface=tok.surface,
                token_reading=tok.reading,
                effective_known_words=known_set,
            )
            tok["lemma"] = resolved_lemma
            tok["word_state"] = word_state
            tok["known"] = known
            if word_state in ("ignored", "blacklisted"):
                tok["status"] = "unstyled"
            elif tok.status == "unstyled" and is_mined:
                if not (ignore_function_words and (tok.surface in FUNCTION_WORDS or resolved_lemma in FUNCTION_WORDS)):
                    tok["status"] = "mined"

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
