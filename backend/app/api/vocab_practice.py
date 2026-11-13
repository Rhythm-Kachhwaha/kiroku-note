"""FastAPI routes for Phase 3 vocabulary categorization, word sets, practice generation, and grading."""
from __future__ import annotations

from collections import OrderedDict
import sqlite3
from threading import Lock
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.services.vocab_practice import (
    PracticeChoice,
    PracticeQuestion,
    SentenceContext,
    VocabPracticeService,
    WordTarget,
    add_word_set_items,
    analyze_sentence_usage_tags,
    build_word_target_from_dict,
    categorize_and_persist_word,
    create_custom_word_set,
    delete_custom_word_set,
    get_practice_stats,
    get_word_categories,
    get_word_set_detail,
    list_word_sets_with_coverage,
    recommend_practice_queue,
    sync_categories_from_word_states,
)

router = APIRouter(tags=["vocab-practice"])

_MAX_CACHED_QUESTIONS = 512
_QUESTION_CACHE: OrderedDict[str, PracticeQuestion] = OrderedDict()
_CACHE_LOCK = Lock()


def _cache_question(q: PracticeQuestion) -> None:
    with _CACHE_LOCK:
        _QUESTION_CACHE[q.question_id] = q
        _QUESTION_CACHE.move_to_end(q.question_id)
        while len(_QUESTION_CACHE) > _MAX_CACHED_QUESTIONS:
            _QUESTION_CACHE.popitem(last=False)


def _get_cached_question(question_id: str) -> PracticeQuestion | None:
    with _CACHE_LOCK:
        return _QUESTION_CACHE.get(question_id)


class ClassifyWordRequest(BaseModel):
    sequence_id: Optional[int] = Field(default=None, gt=0)
    expression: str = ""
    reading: str = ""
    persist: bool = True


class WordSetItemInput(BaseModel):
    sequence_id: int = Field(gt=0)
    reading: str = ""
    expression: str = ""


class CreateWordSetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    slug: Optional[str] = None
    items: list[WordSetItemInput] = Field(default_factory=list)


class AddWordSetItemsRequest(BaseModel):
    items: list[WordSetItemInput] = Field(default_factory=list)


class GeneratePracticeRequest(BaseModel):
    question_type: str = "typed_recall"
    sequence_id: Optional[int] = Field(default=None, gt=0)
    expression: str = ""
    reading: str = ""
    sentence: str = ""
    target_surface: Optional[str] = None
    mode: Optional[str] = None
    target_conjugation: Optional[str] = None


class GradePracticeRequest(BaseModel):
    question_id: Optional[str] = None
    question: Optional[dict[str, Any]] = None
    answer: str
    persist: bool = True
    response_time_ms: Optional[int] = Field(default=None, ge=0)


class UsageTagsRequest(BaseModel):
    sentence: str = Field(min_length=1, max_length=500)


def _question_from_payload(payload: dict[str, Any]) -> PracticeQuestion:
    target_raw = payload.get("target") or {}
    target = WordTarget(
        sequence_id=int(target_raw.get("sequence_id") or payload.get("expected_sequence_id") or 0),
        expression=str(target_raw.get("expression") or ""),
        reading=str(target_raw.get("reading") or payload.get("expected_reading") or ""),
        glosses=tuple(target_raw.get("glosses") or ()),
        categories=tuple(target_raw.get("categories") or ()),
        subtypes=tuple(target_raw.get("subtypes") or ()),
        rules=str(target_raw.get("rules") or ""),
        def_tags=tuple(target_raw.get("def_tags") or ()),
        term_tags=tuple(target_raw.get("term_tags") or ()),
        pos_codes=tuple(target_raw.get("pos_codes") or ()),
        cross_references=tuple(target_raw.get("cross_references") or ()),
        alternate_forms=tuple(target_raw.get("alternate_forms") or ()),
    )
    choices = tuple(
        PracticeChoice(
            choice_id=str(c.get("choice_id") or ""),
            text=str(c.get("text") or ""),
            reading=str(c.get("reading") or ""),
            sequence_id=int(c["sequence_id"]) if c.get("sequence_id") is not None else None,
        )
        for c in (payload.get("choices") or ())
    )
    return PracticeQuestion(
        question_id=str(payload.get("question_id") or ""),
        question_type=str(payload.get("question_type") or ""),
        target=target,
        prompt=str(payload.get("prompt") or ""),
        sentence=str(payload.get("sentence") or ""),
        blanked_sentence=str(payload.get("blanked_sentence") or ""),
        hint=str(payload.get("hint") or ""),
        choices=choices,
        expected_answers=tuple(payload.get("expected_answers") or ()),
        expected_sequence_id=int(payload.get("expected_sequence_id") or target.sequence_id or 0),
        expected_reading=str(payload.get("expected_reading") or target.reading or ""),
        accepted_forms=tuple(payload.get("accepted_forms") or ()),
        allow_kanji_answer=bool(payload.get("allow_kanji_answer", True)),
        usage_tags=tuple(payload.get("usage_tags") or ()),
        metadata=dict(payload.get("metadata") or {}),
    )


@router.get("/api/vocab-practice/categories")
def list_word_categories(
    sequence_id: Optional[int] = Query(default=None),
    category: Optional[str] = Query(default=None),
    subtype: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """List persisted word_categories rows with optional filters."""
    items = get_word_categories(
        sequence_id=sequence_id,
        category=category,
        subtype=subtype,
    )
    return {"items": items, "total": len(items)}


@router.post("/api/vocab-practice/categories/sync")
def sync_word_categories() -> dict[str, Any]:
    """Classify and persist word_categories for tracked word_states using local JMdict."""
    service = VocabPracticeService()
    if service.dict_engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local dictionary database is not available.",
        )
    written = sync_categories_from_word_states(service.dict_engine)
    return {"ok": True, "categories_written": written}


@router.post("/api/vocab-practice/categories/classify")
def classify_single_word(request: ClassifyWordRequest) -> dict[str, Any]:
    """Resolve a word in the dictionary, classify its JMdict tags, and optionally persist."""
    if request.sequence_id is None and not request.expression.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide sequence_id or expression.",
        )
    service = VocabPracticeService()
    if service.dict_engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local dictionary database is not available.",
        )
    if request.persist:
        target = categorize_and_persist_word(
            service.dict_engine,
            sequence_id=request.sequence_id,
            expression=request.expression,
            reading=request.reading,
        )
    else:
        target = build_word_target_from_dict(
            service.dict_engine,
            expression=request.expression,
            reading=request.reading,
            sequence_id=request.sequence_id,
        )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Word could not be resolved in local dictionary.",
        )
    return {"word": target.to_dict()}


@router.get("/api/vocab-practice/word-sets")
def get_word_sets() -> dict[str, Any]:
    """List built-in tag-based word sets and custom word sets with coverage metrics."""
    sets = list_word_sets_with_coverage()
    return {"word_sets": [s.to_dict() for s in sets], "total": len(sets)}


@router.post("/api/vocab-practice/word-sets", status_code=status.HTTP_201_CREATED)
def create_word_set(request: CreateWordSetRequest) -> dict[str, Any]:
    """Create a custom word set."""
    try:
        created = create_custom_word_set(
            request.name,
            description=request.description,
            slug=request.slug,
            items=[item.model_dump() for item in request.items],
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Word set slug already exists: {exc}") from exc
    detail = get_word_set_detail(created["slug"])
    return detail or created


@router.get("/api/vocab-practice/word-sets/{slug_or_id}")
def get_word_set(slug_or_id: str) -> dict[str, Any]:
    """Get word set details, constituent items, and coverage metrics."""
    detail = get_word_set_detail(slug_or_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Word set '{slug_or_id}' not found.")
    return detail


@router.post("/api/vocab-practice/word-sets/{slug_or_id}/items")
def add_items_to_word_set(slug_or_id: str, request: AddWordSetItemsRequest) -> dict[str, Any]:
    """Add canonical items to a custom word set."""
    try:
        added = add_word_set_items(slug_or_id, [item.model_dump() for item in request.items])
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    detail = get_word_set_detail(slug_or_id)
    return {"added": added, "word_set": detail}


@router.delete("/api/vocab-practice/word-sets/{slug_or_id}")
def remove_word_set(slug_or_id: str) -> dict[str, Any]:
    """Delete a custom word set."""
    deleted = delete_custom_word_set(slug_or_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Custom word set '{slug_or_id}' not found.")
    return {"deleted": True, "slug_or_id": slug_or_id}


@router.post("/api/vocab-practice/generate")
def generate_practice_question(request: GeneratePracticeRequest) -> dict[str, Any]:
    """Deterministically generate a practice question or return explicit abstention reasons."""
    if request.sequence_id is None and not request.expression.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide sequence_id or expression.",
        )

    service = VocabPracticeService()
    if service.dict_engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local dictionary database is not available.",
        )

    word = build_word_target_from_dict(
        service.dict_engine,
        expression=request.expression,
        reading=request.reading,
        sequence_id=request.sequence_id,
    )
    if word is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target word could not be resolved to a canonical JMdict entry.",
        )

    ctx = SentenceContext(
        sentence=request.sentence,
        target_surface=request.target_surface,
        mode=request.mode,
        target_conjugation=request.target_conjugation,
    )
    try:
        question, abstentions = service.generate(request.question_type, word, ctx)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if question is not None:
        _cache_question(question)

    return {
        "generated": question is not None,
        "question": question.to_dict() if question is not None else None,
        "abstained": [a.to_dict() for a in abstentions],
    }


@router.post("/api/vocab-practice/grade")
def grade_practice_answer(request: GradePracticeRequest) -> dict[str, Any]:
    """Grade an answer deterministically and optionally persist to vocab_practice_results."""
    question: PracticeQuestion | None = None
    if request.question is not None:
        try:
            question = _question_from_payload(request.question)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    elif request.question_id:
        question = _get_cached_question(request.question_id)

    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question payload or cached question_id not found.",
        )

    service = VocabPracticeService()
    try:
        result = service.grade(
            question,
            request.answer,
            persist=request.persist,
            response_time_ms=request.response_time_ms,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return result.to_dict()


@router.get("/api/vocab-practice/stats")
def get_vocab_practice_stats(
    limit: int = Query(default=20, ge=1, le=200),
    category: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """Return practice accuracy stats and deterministic What-Next recommendations."""
    stats = get_practice_stats()
    recs = recommend_practice_queue(limit=limit, category=category)
    return {
        **stats,
        "recommendations": [r.to_dict() for r in recs],
    }


@router.post("/api/vocab-practice/usage-tags")
def compute_sentence_usage_tags(request: UsageTagsRequest) -> dict[str, Any]:
    """Compute per-sentence usage tags (e.g. na-adj + に, mimetic + と)."""
    service = VocabPracticeService()
    tags = analyze_sentence_usage_tags(request.sentence, dict_engine=service.dict_engine)
    return {"sentence": request.sentence, "usage_tags": tags}


@router.get("/api/vocab-practice/transitive-pairs")
def list_transitive_pairs(
    level: Optional[str] = Query(default=None),
    pattern: Optional[str] = Query(default=None),
    mastery: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    """Return curated transitive <-> intransitive verb pairs with learner mastery and usage hints."""
    from app.services.vocab_practice.transitive_pairs import (
        get_transitive_pairs,
        get_transitive_pairs_summary,
    )

    pairs = get_transitive_pairs(
        level=level,
        pattern=pattern,
        mastery_filter=mastery,
    )
    summary = get_transitive_pairs_summary()
    return {
        "pairs": [p.model_dump() for p in pairs],
        "total": len(pairs),
        "summary": summary.model_dump(),
    }


@router.get("/api/vocab-practice/gap-breakdown")
def get_gap_breakdown(
    level: str = Query(default="N4"),
    limit_per_category: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    """Return unseen JLPT gap words categorized into adverbs, nouns, katakana loanwords, verbs, adjectives."""
    from app.services.vocab_practice.categories import get_gap_breakdown_by_category

    return get_gap_breakdown_by_category(level=level, limit_per_category=limit_per_category)

