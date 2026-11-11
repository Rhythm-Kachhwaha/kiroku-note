"""Typed Recall question generator and grader (reading recall and meaning/cloze recall)."""
from __future__ import annotations

import hashlib
from typing import Any

from app.repositories.word_state_repository import normalize_word_reading
from app.services.vocab_practice.categories import analyze_sentence_usage_tags
from app.services.vocab_practice.invariants import (
    locate_target_span,
    make_abstention,
    verify_sentence_roundtrip,
)
from app.services.vocab_practice.models import (
    AbstentionRecord,
    BLANK_TOKEN,
    PracticeQuestion,
    PracticeResult,
    SentenceContext,
    WordTarget,
)
from app.services.vocab_practice.normalizer import check_lenient_answer
from kiroku_dictionary.lookup import is_kana_only


def _has_kanji(text: str) -> bool:
    return bool(text) and not is_kana_only(text)


def _stable_question_id(prefix: str, *parts: Any) -> str:
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


class TypedRecallGenerator:
    """Deterministic Typed Recall generator (WanaKana-compatible romaji/kana/kanji grading)."""

    question_type = "typed_recall"

    def __init__(self, dict_engine: Any = None):
        self.dict_engine = dict_engine
        self.abstentions: list[AbstentionRecord] = []

    def _abstain(self, code: str, reason: str, target: WordTarget | None) -> None:
        self.abstentions.append(make_abstention(self.question_type, code, reason, target))

    def generate(
        self,
        word: WordTarget,
        context: SentenceContext | None = None,
    ) -> PracticeQuestion | None:
        if not word.sequence_id or int(word.sequence_id) <= 0:
            self._abstain("missing_sequence_id", "Target word must have a canonical JMdict sequence_id.", word)
            return None
        if not word.reading and not word.expression:
            self._abstain("empty_target", "Target word has no expression or reading.", word)
            return None

        ctx = context or SentenceContext()
        requested_mode = ctx.mode
        if requested_mode is None:
            requested_mode = "meaning" if ctx.sentence else ("reading" if _has_kanji(word.expression) else "meaning")

        if requested_mode == "reading":
            return self._generate_reading_recall(word, ctx)
        if requested_mode == "meaning":
            return self._generate_meaning_recall(word, ctx)

        self._abstain("unsupported_mode", f"Unsupported typed recall mode: {requested_mode}", word)
        return None

    def _generate_reading_recall(
        self,
        word: WordTarget,
        ctx: SentenceContext,
    ) -> PracticeQuestion | None:
        if not _has_kanji(word.expression):
            self._abstain(
                "reading_recall_requires_kanji",
                "Reading recall requires a kanji headword; kana-only words would leak the answer.",
                word,
            )
            return None

        target_reading = normalize_word_reading(word.reading)
        if not target_reading:
            self._abstain("missing_reading", "Target word lacks a canonical reading.", word)
            return None

        sentence = (ctx.sentence or "").strip()
        usage_tags: tuple[str, ...] = tuple(ctx.usage_tags)
        if sentence and not usage_tags:
            usage_tags = tuple(
                item["tag"]
                for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
            )

        q_id = _stable_question_id("tr_read", word.sequence_id, word.expression, target_reading, sentence)
        gloss_hint = "; ".join(word.glosses[:2]) if word.glosses else ""
        return PracticeQuestion(
            question_id=q_id,
            question_type="typed_recall_reading",
            target=word,
            prompt=f"Type the reading for {word.expression}",
            sentence=sentence,
            blanked_sentence="",
            hint=gloss_hint,
            choices=(),
            expected_answers=(target_reading,),
            expected_sequence_id=int(word.sequence_id),
            expected_reading=target_reading,
            accepted_forms=(),
            allow_kanji_answer=False,
            usage_tags=usage_tags,
            metadata={"mode": "reading"},
        )

    def _generate_meaning_recall(
        self,
        word: WordTarget,
        ctx: SentenceContext,
    ) -> PracticeQuestion | None:
        if not word.glosses:
            self._abstain("missing_gloss", "Meaning/cloze recall requires at least one English gloss.", word)
            return None

        sentence = (ctx.sentence or "").strip()
        blanked_sentence = ""
        target_surface = word.expression or word.reading
        usage_tags: tuple[str, ...] = tuple(ctx.usage_tags)

        if sentence:
            if self.dict_engine is None:
                self._abstain(
                    "missing_dictionary_engine",
                    "Dictionary engine is required for sentence cloze roundtrip verification.",
                    word,
                )
                return None

            span = locate_target_span(
                sentence,
                word,
                target_surface=ctx.target_surface,
                dict_engine=self.dict_engine,
            )
            if span is None:
                self._abstain(
                    "target_not_uniquely_located",
                    f"Could not uniquely locate canonical target ({word.sequence_id}, {word.reading}) in sentence.",
                    word,
                )
                return None

            start, end, found_surface, _morph = span
            target_surface = found_surface
            blanked_sentence = sentence[:start] + BLANK_TOKEN + sentence[end:]

            ok, err = verify_sentence_roundtrip(
                original_sentence=sentence,
                blanked_sentence=blanked_sentence,
                target_surface=target_surface,
                target=word,
                dict_engine=self.dict_engine,
            )
            if not ok:
                self._abstain("roundtrip_failed", err, word)
                return None

            if not usage_tags:
                usage_tags = tuple(
                    item["tag"]
                    for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
                )

        gloss_prompt = "; ".join(word.glosses[:3])
        expected = tuple(
            dict.fromkeys(
                x for x in (target_surface, word.expression, normalize_word_reading(word.reading)) if x
            )
        )
        accepted = tuple(
            dict.fromkeys(
                x for x in (*word.alternate_forms, word.expression, word.reading, target_surface) if x
            )
        )
        q_id = _stable_question_id("tr_mean", word.sequence_id, word.expression, word.reading, blanked_sentence)
        return PracticeQuestion(
            question_id=q_id,
            question_type="typed_recall_meaning",
            target=word,
            prompt=f"Type the Japanese word matching: {gloss_prompt}",
            sentence=sentence,
            blanked_sentence=blanked_sentence,
            hint=f"{len(word.reading or word.expression)} kana" if (word.reading or word.expression) else "",
            choices=(),
            expected_answers=expected,
            expected_sequence_id=int(word.sequence_id),
            expected_reading=normalize_word_reading(word.reading),
            accepted_forms=accepted,
            allow_kanji_answer=True,
            usage_tags=usage_tags,
            metadata={"mode": "meaning", "target_surface": target_surface},
        )

    def grade(self, question: PracticeQuestion, answer: str) -> PracticeResult:
        is_correct, norm_user, matched_variant = check_lenient_answer(
            answer,
            expected_answers=question.expected_answers,
            accepted_forms=question.accepted_forms,
            expected_sequence_id=question.expected_sequence_id,
            allow_kanji=question.allow_kanji_answer,
            dict_engine=self.dict_engine,
        )
        primary_expected = question.expected_answers[0] if question.expected_answers else question.expected_reading
        return PracticeResult(
            question_id=question.question_id,
            question_type=question.question_type,
            is_correct=is_correct,
            normalized_user_answer=norm_user,
            normalized_expected=question.expected_reading or primary_expected,
            expected_answer=primary_expected,
            matched_variant=matched_variant,
            feedback="Correct." if is_correct else f"Expected: {primary_expected}",
        )
