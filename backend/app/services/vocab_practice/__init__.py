"""Phase 3 deterministic vocabulary practice engine, categorization, and safety invariants."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.vocab_practice.categories import (
    BUILTIN_TAG_SETS,
    CAT_ADJECTIVE_I,
    CAT_ADJECTIVE_NA,
    CAT_ADVERB,
    CAT_EXPRESSION,
    CAT_NOUN,
    CAT_ONOMATOPOEIA,
    CAT_SURU_VERB,
    CAT_VERB_GODAN,
    CAT_VERB_ICHIDAN,
    CAT_VERB_INTRANSITIVE,
    CAT_VERB_KURU,
    CAT_VERB_TRANSITIVE,
    ON_MIM_SUBTYPES,
    add_word_set_items,
    analyze_sentence_usage_tags,
    build_word_target_from_dict,
    categorize_and_persist_word,
    classify_tags_to_categories,
    create_custom_word_set,
    delete_custom_word_set,
    extract_jmdict_tags,
    get_practice_stats,
    get_word_categories,
    get_word_set_detail,
    list_word_sets_with_coverage,
    record_practice_result,
    resolve_onomatopoeia_subtype,
    sync_categories_from_word_states,
    upsert_word_categories,
)
from app.services.vocab_practice.conjugation_drill import (
    ADJ_I_CONJUGATIONS,
    CONJUGATION_LABELS,
    ConjugationDrillGenerator,
    VERB_CONJUGATIONS,
    inflect_word,
    resolve_inflection_rule,
    verify_inflection_roundtrip,
)
from app.services.vocab_practice.contrast_cloze import ContrastClozeGenerator
from app.services.vocab_practice.invariants import (
    glosses_overlap,
    locate_target_span,
    validate_distractor_safety,
    verify_sentence_roundtrip,
)
from app.services.vocab_practice.models import (
    AbstentionRecord,
    BLANK_TOKEN,
    CategoryTag,
    PracticeChoice,
    PracticeQuestion,
    PracticeRecommendation,
    PracticeResult,
    QuestionGenerator,
    SentenceContext,
    WordSetCoverage,
    WordTarget,
)
from app.services.vocab_practice.normalizer import (
    check_lenient_answer,
    normalize_japanese_answer,
    romaji_to_hiragana,
)
from app.services.vocab_practice.recommender import recommend_practice_queue
from app.services.vocab_practice.typed_recall import TypedRecallGenerator
from app.services.vocab_practice.vt_vi_drill import (
    CURATED_VT_VI_PAIRS,
    VtViDrillGenerator,
)


def _default_dict_engine() -> Any:
    try:
        from app.services.dictionary_provider import resolve_dictionary_db_path
        from kiroku_dictionary import DictionaryEngine

        db_path = resolve_dictionary_db_path()
        if db_path.is_file():
            return DictionaryEngine(str(db_path))
    except Exception:
        return None
    return None


class VocabPracticeService:
    """Unified facade for Phase 3 vocabulary categorization, question generation, grading, and stats."""

    def __init__(
        self,
        *,
        db_path: Path | str | None = None,
        dict_engine: Any = None,
    ):
        self._db_path = db_path
        self._dict_engine = dict_engine
        self._dict_checked = dict_engine is not None

    @property
    def dict_engine(self) -> Any:
        if not self._dict_checked:
            self._dict_checked = True
            self._dict_engine = _default_dict_engine()
        return self._dict_engine

    def get_generator(self, question_type: str) -> QuestionGenerator:
        qtype = str(question_type or "").strip().lower()
        if qtype in ("typed_recall", "typed_recall_reading", "typed_recall_meaning"):
            return TypedRecallGenerator(dict_engine=self.dict_engine)
        if qtype in ("contrast_cloze", "pattern_fill"):
            return ContrastClozeGenerator(dict_engine=self.dict_engine)
        if qtype == "vt_vi_drill":
            return VtViDrillGenerator(dict_engine=self.dict_engine)
        if qtype == "conjugation_drill":
            return ConjugationDrillGenerator(dict_engine=self.dict_engine)
        raise ValueError(f"Unsupported question_type: {question_type!r}")

    def generate(
        self,
        question_type: str,
        word: WordTarget,
        context: SentenceContext | None = None,
    ) -> tuple[PracticeQuestion | None, list[AbstentionRecord]]:
        gen = self.get_generator(question_type)
        ctx = context
        if question_type == "typed_recall_reading":
            ctx = SentenceContext(
                sentence=context.sentence if context else "",
                target_surface=context.target_surface if context else None,
                source_media=context.source_media if context else "",
                usage_tags=context.usage_tags if context else (),
                candidate_distractors=context.candidate_distractors if context else (),
                mode="reading",
            )
        elif question_type == "typed_recall_meaning":
            ctx = SentenceContext(
                sentence=context.sentence if context else "",
                target_surface=context.target_surface if context else None,
                source_media=context.source_media if context else "",
                usage_tags=context.usage_tags if context else (),
                candidate_distractors=context.candidate_distractors if context else (),
                mode="meaning",
            )
        elif question_type == "pattern_fill":
            ctx = SentenceContext(
                sentence=context.sentence if context else "",
                target_surface=context.target_surface if context else None,
                source_media=context.source_media if context else "",
                usage_tags=context.usage_tags if context else (),
                candidate_distractors=context.candidate_distractors if context else (),
                mode="pattern_fill",
            )
        question = gen.generate(word, ctx)
        abstentions = list(getattr(gen, "abstentions", ()))
        return question, abstentions

    def grade(
        self,
        question: PracticeQuestion,
        answer: str,
        *,
        persist: bool = False,
        response_time_ms: int | None = None,
    ) -> PracticeResult:
        gen = self.get_generator(question.question_type)
        result = gen.grade(question, answer)
        if persist and question.expected_sequence_id:
            primary_cat = question.target.categories[0] if question.target.categories else ""
            record_practice_result(
                sequence_id=question.expected_sequence_id,
                reading=question.target.reading,
                expression=question.target.expression,
                question_type=question.question_type,
                category=primary_cat,
                is_correct=result.is_correct,
                user_answer=answer,
                expected_answer=result.expected_answer,
                response_time_ms=response_time_ms,
                db_path=self._db_path,
            )
        return result


__all__ = [
    "ADJ_I_CONJUGATIONS",
    "AbstentionRecord",
    "BLANK_TOKEN",
    "BUILTIN_TAG_SETS",
    "CAT_ADJECTIVE_I",
    "CAT_ADJECTIVE_NA",
    "CAT_ADVERB",
    "CAT_EXPRESSION",
    "CAT_NOUN",
    "CAT_ONOMATOPOEIA",
    "CAT_SURU_VERB",
    "CAT_VERB_GODAN",
    "CAT_VERB_ICHIDAN",
    "CAT_VERB_INTRANSITIVE",
    "CAT_VERB_KURU",
    "CAT_VERB_TRANSITIVE",
    "CONJUGATION_LABELS",
    "CURATED_VT_VI_PAIRS",
    "CategoryTag",
    "ConjugationDrillGenerator",
    "ContrastClozeGenerator",
    "ON_MIM_SUBTYPES",
    "PracticeChoice",
    "PracticeQuestion",
    "PracticeRecommendation",
    "PracticeResult",
    "QuestionGenerator",
    "SentenceContext",
    "TypedRecallGenerator",
    "VERB_CONJUGATIONS",
    "VocabPracticeService",
    "VtViDrillGenerator",
    "WordSetCoverage",
    "WordTarget",
    "add_word_set_items",
    "analyze_sentence_usage_tags",
    "build_word_target_from_dict",
    "categorize_and_persist_word",
    "check_lenient_answer",
    "classify_tags_to_categories",
    "create_custom_word_set",
    "delete_custom_word_set",
    "extract_jmdict_tags",
    "get_practice_stats",
    "get_word_categories",
    "get_word_set_detail",
    "glosses_overlap",
    "inflect_word",
    "list_word_sets_with_coverage",
    "locate_target_span",
    "normalize_japanese_answer",
    "recommend_practice_queue",
    "record_practice_result",
    "resolve_inflection_rule",
    "resolve_onomatopoeia_subtype",
    "romaji_to_hiragana",
    "sync_categories_from_word_states",
    "upsert_word_categories",
    "validate_distractor_safety",
    "verify_inflection_roundtrip",
    "verify_sentence_roundtrip",
]
