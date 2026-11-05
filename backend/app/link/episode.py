"""
Link Episode Primer & Recap Engine (Slice 44).

Generates pre-watch Primers (top gap words, top grammar points, mini-quiz)
and post-watch Recaps (% known progression, mined words, unseen gap words),
persisting per-episode records to the local SQLite database.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import logging
from pathlib import Path
import random
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from app.config import get_db_path, get_learner_jlpt_level
from app.db.connection import get_db_connection
from app.link.analysis import link_analysis_service
from app.services.dictionary_provider import LocalDictionaryProvider
from app.services.grammar_service import GrammarService
from app.services.jlpt_reference import JlptReferenceService
from app.services.subtitle_annotator import (
    FUNCTION_WORDS,
    SubtitleAnnotatorService,
    get_subtitle_annotator_service,
)

logger = logging.getLogger(__name__)

_LEVEL_PRIORITY: dict[str, int] = {
    "N5": 5,
    "N4": 4,
    "N3": 3,
    "N2": 2,
    "N1": 1,
}

EPISODE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS link_episode (
    hash TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    site TEXT NOT NULL DEFAULT '',
    known_pct REAL NOT NULL DEFAULT 0.0,
    mined INTEGER NOT NULL DEFAULT 0,
    minutes REAL NOT NULL DEFAULT 0.0,
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_link_episode_ts ON link_episode (ts DESC);
"""


def init_link_episode_db(conn: Optional[sqlite3.Connection] = None) -> None:
    """Ensure the link_episode table exists."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True
    try:
        conn.executescript(EPISODE_SCHEMA_SQL)
        conn.commit()
    finally:
        if close_after:
            conn.close()


def save_episode_record(
    hash_val: str,
    title: str,
    site: str,
    known_pct: float,
    mined: int,
    minutes: float,
    ts: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, Any]:
    """Upsert an episode record in SQLite."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    now_ts = ts or datetime.now(timezone.utc).isoformat()
    init_link_episode_db(conn)

    try:
        with conn:
            conn.execute(
                """
                INSERT INTO link_episode (hash, title, site, known_pct, mined, minutes, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(hash) DO UPDATE SET
                    title = excluded.title,
                    site = excluded.site,
                    known_pct = excluded.known_pct,
                    mined = excluded.mined,
                    minutes = excluded.minutes,
                    ts = excluded.ts
                """,
                (hash_val, title, site, round(known_pct, 1), mined, round(minutes, 1), now_ts),
            )
        return {
            "hash": hash_val,
            "title": title,
            "site": site,
            "known_pct": round(known_pct, 1),
            "mined": mined,
            "minutes": round(minutes, 1),
            "ts": now_ts,
        }
    finally:
        if close_after:
            conn.close()


def get_episode_record(hash_val: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    """Retrieve an episode record by hash."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT hash, title, site, known_pct, mined, minutes, ts FROM link_episode WHERE hash = ?",
            (hash_val,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "hash": row[0],
            "title": row[1],
            "site": row[2],
            "known_pct": row[3],
            "mined": row[4],
            "minutes": row[5],
            "ts": row[6],
        }
    finally:
        if close_after:
            conn.close()


def list_episode_records(limit: int = 50, conn: Optional[sqlite3.Connection] = None) -> List[Dict[str, Any]]:
    """List recent episode records."""
    close_after = False
    if conn is None:
        conn = get_db_connection()
        close_after = True

    init_link_episode_db(conn)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT hash, title, site, known_pct, mined, minutes, ts FROM link_episode ORDER BY ts DESC LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
        return [
            {
                "hash": r[0],
                "title": r[1],
                "site": r[2],
                "known_pct": r[3],
                "mined": r[4],
                "minutes": r[5],
                "ts": r[6],
            }
            for r in rows
        ]
    finally:
        if close_after:
            conn.close()


class EpisodeService:
    """Core domain logic for Episode Primer and Recap generation."""

    def __init__(self) -> None:
        self._dict_provider: Optional[LocalDictionaryProvider] = None
        self._grammar_service = GrammarService()
        self._jlpt_service = JlptReferenceService()

    def _get_dict_provider(self) -> LocalDictionaryProvider:
        if self._dict_provider is None:
            self._dict_provider = LocalDictionaryProvider()
        return self._dict_provider

    def lookup_gloss(self, word: str) -> Tuple[str, str]:
        """Lookup primary reading and gloss for a word using local dictionary."""
        if not word or not word.strip():
            return ("", "")
        clean_word = word.strip()
        try:
            provider = self._get_dict_provider()
            if provider.check_availability():
                payload = provider.fetch_term_payload(clean_word)
                entries = payload.get("dictionaryEntries", [])
                if entries and isinstance(entries, list):
                    first = entries[0]
                    reading = first.get("reading", "")
                    senses = first.get("senses", [])
                    if senses and isinstance(senses, list):
                        first_sense = senses[0]
                        glosses = first_sense.get("glosses", [])
                        if glosses:
                            return (reading or clean_word, glosses[0])
        except Exception as e:
            logger.debug("[EpisodeService] Dictionary lookup failed for %s: %s", clean_word, e)
        return (clean_word, f"Japanese term: {clean_word}")

    def generate_primer(
        self,
        cues: Optional[List[Dict[str, Any]]] = None,
        cue_hash: Optional[str] = None,
        learner_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate Episode Primer:
        1. Top 20 gap words (frequency in episode x not known x level <= learner + 1).
        2. Top 5 grammar points.
        3. 5-question mini quiz built from those gap words.
        """
        level = (learner_level or get_learner_jlpt_level() or "N4").upper()
        learner_priority = _LEVEL_PRIORITY.get(level, 4)
        # level <= learner + 1: word difficulty at most 1 level higher than learner.
        # In priority: N5=5, N4=4, N3=3, N2=2, N1=1.
        # So minimum priority allowed is learner_priority - 1.
        min_allowed_priority = max(1, learner_priority - 1)

        annotated_cues: List[Dict[str, Any]] = []
        effective_hash = cue_hash or "adhoc"

        # Check if cues exist in link_analysis_service cache
        if cue_hash and not cues:
            cached = link_analysis_service.get_cues_range(cue_hash)
            if cached:
                annotated_cues = cached

        if not annotated_cues:
            raw_cues = cues or []
            annotator = get_subtitle_annotator_service(learner_level=level)
            for idx, c in enumerate(raw_cues):
                if "tokens" in c:
                    annotated_cues.append(c)
                else:
                    cue_dict = {
                        "id": c.get("i", idx),
                        "text": c.get("text", ""),
                        "start": c.get("s", 0.0),
                        "end": c.get("e", 0.0),
                    }
                    ann = annotator.annotate_cue(cue_dict, learner_level=level)
                    annotated_cues.append({
                        "i": cue_dict["id"],
                        "s": cue_dict["start"],
                        "e": cue_dict["end"],
                        "text": cue_dict["text"],
                        "tokens": ann.get("tokens", []),
                    })

        # Count frequencies of gap words
        word_counter: Counter[str] = Counter()
        word_info: Dict[str, Dict[str, Any]] = {}

        for cue in annotated_cues:
            for tok in cue.get("tokens", []):
                surface = tok.get("surface", "").strip()
                lemma = tok.get("lemma", surface).strip() or surface
                status = tok.get("status", "unstyled")
                pos = tok.get("pos", "")
                is_known = tok.get("known", False) or status in ("known", "mined")
                is_punct = pos in ("補助記号", "記号") or not surface or surface in FUNCTION_WORDS

                if is_punct or is_known:
                    continue

                # Determine JLPT level
                tok_level = tok.get("jlpt_level") or self._jlpt_service.lookup_word(lemma)
                if tok_level:
                    w_pri = _LEVEL_PRIORITY.get(tok_level.upper())
                    if w_pri is not None and w_pri < min_allowed_priority:
                        # Too advanced for learner + 1
                        continue

                word_counter[lemma] += 1
                if lemma not in word_info:
                    word_info[lemma] = {
                        "word": lemma,
                        "reading": tok.get("reading", "") or surface,
                        "level": tok_level,
                    }

        # Select top 20 gap words
        top_20_lemmas = [lemma for lemma, _ in word_counter.most_common(20)]
        gap_words_list: List[Dict[str, Any]] = []

        for lemma in top_20_lemmas:
            info = word_info[lemma]
            reading, gloss = self.lookup_gloss(lemma)
            gap_words_list.append({
                "word": lemma,
                "reading": info.get("reading") or reading,
                "meaning": gloss,
                "level": info.get("level"),
                "frequency": word_counter[lemma],
            })

        # Top 5 grammar points across cues
        grammar_counter: Counter[str] = Counter()
        grammar_info: Dict[str, Dict[str, Any]] = {}

        for cue in annotated_cues:
            cue_text = cue.get("text", "").strip()
            if not cue_text:
                continue
            try:
                g_res = self._grammar_service.analyze(cue_text, learner_level=level)
                points = g_res.get("points", []) if isinstance(g_res, dict) else (getattr(g_res, "points", []) or [])
                for pt in points:
                    pkey = pt.get("pattern_key") or pt.get("display", "")
                    if pkey:
                        grammar_counter[pkey] += 1
                        if pkey not in grammar_info:
                            grammar_info[pkey] = {
                                "pattern_key": pkey,
                                "display": pt.get("display", pkey),
                                "level": pt.get("level"),
                            }
            except Exception as exc:
                logger.debug("[EpisodeService] Grammar parse error: %s", exc)

        top_5_grammar = [pkey for pkey, _ in grammar_counter.most_common(5)]
        grammar_points_list: List[Dict[str, Any]] = []
        for pkey in top_5_grammar:
            gi = grammar_info[pkey]
            grammar_points_list.append({
                "pattern_key": gi["pattern_key"],
                "display": gi["display"],
                "level": gi.get("level"),
                "frequency": grammar_counter[pkey],
            })

        # 5-question mini quiz from gap words
        quiz_questions = self._build_mini_quiz(gap_words_list)

        return {
            "hash": effective_hash,
            "learner_level": level,
            "total_cues": len(annotated_cues),
            "gap_words": gap_words_list,
            "grammar_points": grammar_points_list,
            "quiz": quiz_questions,
        }

    def _build_mini_quiz(self, gap_words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Build 5 multiple choice questions from gap words using their dictionary glosses."""
        if not gap_words:
            return []

        # Target words: up to 5
        quiz_targets = gap_words[:5]
        all_meanings = [gw["meaning"] for gw in gap_words if gw.get("meaning")]
        if len(all_meanings) < 4:
            # Add sensible fallbacks to ensure 4 distinct options
            default_distractors = [
                "to understand thoroughly",
                "quiet evening breeze",
                "careful observation",
                "sudden realization",
            ]
            for d in default_distractors:
                if d not in all_meanings:
                    all_meanings.append(d)

        quiz: List[Dict[str, Any]] = []
        for q_idx, item in enumerate(quiz_targets, start=1):
            target_word = item["word"]
            target_reading = item.get("reading", "")
            correct_meaning = item.get("meaning", "")

            # Select 3 distractor meanings different from correct meaning
            other_meanings = [m for m in all_meanings if m != correct_meaning]
            if len(other_meanings) >= 3:
                distractors = random.sample(other_meanings, 3)
            else:
                distractors = other_meanings + [f"Meaning {i}" for i in range(1, 4 - len(other_meanings) + 1)]

            options = [correct_meaning] + distractors[:3]
            # Shuffle options deterministically based on word hash to maintain stable order
            seed = sum(ord(c) for c in target_word) + q_idx
            rnd = random.Random(seed)
            rnd.shuffle(options)
            correct_idx = options.index(correct_meaning)

            quiz.append({
                "id": q_idx,
                "word": target_word,
                "reading": target_reading,
                "prompt": f"What is the meaning of 「{target_word}」({target_reading})?",
                "options": options,
                "correct_index": correct_idx,
                "explanation": f"「{target_word}」({target_reading}) means: {correct_meaning}",
            })

        return quiz

    def generate_recap(
        self,
        cue_hash: str,
        cues: Optional[List[Dict[str, Any]]] = None,
        mined_words: Optional[List[str]] = None,
        minutes: float = 0.0,
        title: str = "",
        site: str = "",
        learner_level: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate Post-Session Recap:
        - lines watched
        - % known (before/after mining)
        - words mined
        - gap words still unseen
        - "Review mined words" -> Study Practice deep link
        - Persist record to link_episode
        """
        mined_set = set(mined_words or [])
        level = (learner_level or get_learner_jlpt_level() or "N4").upper()

        annotated_cues: List[Dict[str, Any]] = []
        if cue_hash and not cues:
            cached = link_analysis_service.get_cues_range(cue_hash)
            if cached:
                annotated_cues = cached

        if not annotated_cues:
            raw_cues = cues or []
            annotator = get_subtitle_annotator_service(learner_level=level)
            for idx, c in enumerate(raw_cues):
                if "tokens" in c:
                    annotated_cues.append(c)
                else:
                    cue_dict = {
                        "id": c.get("i", idx),
                        "text": c.get("text", ""),
                        "start": c.get("s", 0.0),
                        "end": c.get("e", 0.0),
                    }
                    ann = annotator.annotate_cue(cue_dict, learner_level=level)
                    annotated_cues.append({
                        "i": cue_dict["id"],
                        "s": cue_dict["start"],
                        "e": cue_dict["end"],
                        "text": cue_dict["text"],
                        "tokens": ann.get("tokens", []),
                    })

        total_meaningful = 0
        known_before_count = 0
        known_after_count = 0
        all_gap_words: set[str] = set()

        for cue in annotated_cues:
            for tok in cue.get("tokens", []):
                surface = tok.get("surface", "").strip()
                lemma = tok.get("lemma", surface).strip() or surface
                status = tok.get("status", "unstyled")
                pos = tok.get("pos", "")
                is_punct = pos in ("補助記号", "記号") or not surface or surface in FUNCTION_WORDS
                if is_punct:
                    continue

                total_meaningful += 1
                is_known_before = tok.get("known", False) or status in ("known", "mined")
                if is_known_before:
                    known_before_count += 1
                    known_after_count += 1
                else:
                    all_gap_words.add(lemma)
                    if lemma in mined_set or surface in mined_set:
                        known_after_count += 1

        known_pct_before = (
            round((known_before_count / total_meaningful) * 100.0, 1)
            if total_meaningful > 0
            else 100.0
        )
        known_pct_after = (
            round((known_after_count / total_meaningful) * 100.0, 1)
            if total_meaningful > 0
            else 100.0
        )

        unseen_gaps = sorted(list(all_gap_words - mined_set))
        now_ts = datetime.now(timezone.utc).isoformat()

        # Persist per-episode record
        save_episode_record(
            hash_val=cue_hash,
            title=title or "Episode",
            site=site or "local",
            known_pct=known_pct_after,
            mined=len(mined_set),
            minutes=minutes,
            ts=now_ts,
        )

        return {
            "hash": cue_hash,
            "title": title or "Episode",
            "site": site or "local",
            "lines_watched": len(annotated_cues),
            "known_pct_before": known_pct_before,
            "known_pct_after": known_pct_after,
            "words_mined": sorted(list(mined_set)),
            "gap_words_unseen": unseen_gaps,
            "minutes": round(minutes, 1),
            "ts": now_ts,
            "review_link": "#/study?mode=practice&filter=mined",
        }


# Global singleton
episode_service = EpisodeService()

