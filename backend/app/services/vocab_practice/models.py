"""Data models and unified interfaces for Phase 3 vocabulary practice."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Protocol


BLANK_TOKEN = "____"


@dataclass(frozen=True)
class CategoryTag:
    """Single deterministic learner category assignment for a JMdict entry."""

    category: str
    subtype: str = ""
    source: str = "jmdict"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class WordTarget:
    """Canonical JMdict word identity with extracted learner categories and glosses."""

    sequence_id: int
    expression: str
    reading: str
    glosses: tuple[str, ...] = ()
    categories: tuple[str, ...] = ()
    subtypes: tuple[str, ...] = ()
    rules: str = ""
    def_tags: tuple[str, ...] = ()
    term_tags: tuple[str, ...] = ()
    pos_codes: tuple[str, ...] = ()
    cross_references: tuple[str, ...] = ()
    alternate_forms: tuple[str, ...] = ()

    @property
    def canonical_id(self) -> tuple[int, str]:
        return (self.sequence_id, self.reading)

    def has_category(self, category: str) -> bool:
        return category in self.categories

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence_id": self.sequence_id,
            "expression": self.expression,
            "reading": self.reading,
            "glosses": list(self.glosses),
            "categories": list(self.categories),
            "subtypes": list(self.subtypes),
            "rules": self.rules,
            "def_tags": list(self.def_tags),
            "term_tags": list(self.term_tags),
            "pos_codes": list(self.pos_codes),
            "cross_references": list(self.cross_references),
            "alternate_forms": list(self.alternate_forms),
        }


@dataclass(frozen=True)
class SentenceContext:
    """Sentence and optional metadata used to ground a generated practice question."""

    sentence: str = ""
    target_surface: str | None = None
    source_media: str = ""
    usage_tags: tuple[str, ...] = ()
    candidate_distractors: tuple[WordTarget, ...] = ()
    mode: str | None = None
    target_conjugation: str | None = None
    paired_counterpart: WordTarget | None = None


@dataclass(frozen=True)
class PracticeChoice:
    """Single multiple-choice option for cloze, pattern, or vt/vi drills."""

    choice_id: str
    text: str
    reading: str = ""
    sequence_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PracticeQuestion:
    """Deterministic, invariant-verified practice question."""

    question_id: str
    question_type: str
    target: WordTarget
    prompt: str
    sentence: str = ""
    blanked_sentence: str = ""
    hint: str = ""
    choices: tuple[PracticeChoice, ...] = ()
    expected_answers: tuple[str, ...] = ()
    expected_sequence_id: int = 0
    expected_reading: str = ""
    accepted_forms: tuple[str, ...] = ()
    allow_kanji_answer: bool = True
    usage_tags: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "question_id": self.question_id,
            "question_type": self.question_type,
            "target": self.target.to_dict(),
            "prompt": self.prompt,
            "sentence": self.sentence,
            "blanked_sentence": self.blanked_sentence,
            "hint": self.hint,
            "choices": [c.to_dict() for c in self.choices],
            "expected_answers": list(self.expected_answers),
            "expected_sequence_id": self.expected_sequence_id,
            "expected_reading": self.expected_reading,
            "accepted_forms": list(self.accepted_forms),
            "allow_kanji_answer": self.allow_kanji_answer,
            "usage_tags": list(self.usage_tags),
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class PracticeResult:
    """Deterministic grading outcome for a PracticeQuestion."""

    question_id: str
    question_type: str
    is_correct: bool
    normalized_user_answer: str
    normalized_expected: str
    expected_answer: str
    matched_variant: str = ""
    feedback: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AbstentionRecord:
    """Structured explanation recorded whenever a generator abstains rather than guessing."""

    generator: str
    reason_code: str
    reason: str
    sequence_id: int | None = None
    expression: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class WordSetCoverage:
    """Coverage summary for a tag-based or custom word set."""

    slug: str
    name: str
    set_type: str
    description: str
    known_count: int
    learning_count: int
    total_count: int
    coverage_ratio: float
    filter_category: str = ""
    filter_subtype: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PracticeRecommendation:
    """Ranked recommendation item for the What-Next practice queue."""

    sequence_id: int
    expression: str
    reading: str
    recommended_question_type: str
    priority_score: float
    word_state: str
    encounter_count: int
    accuracy: float | None
    attempt_count: int
    categories: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence_id": self.sequence_id,
            "expression": self.expression,
            "reading": self.reading,
            "recommended_question_type": self.recommended_question_type,
            "priority_score": round(self.priority_score, 4),
            "word_state": self.word_state,
            "encounter_count": self.encounter_count,
            "accuracy": self.accuracy,
            "attempt_count": self.attempt_count,
            "categories": list(self.categories),
            "reasons": list(self.reasons),
        }


class QuestionGenerator(Protocol):
    """Unified generator/grader contract shared across all Phase 3 question types."""

    question_type: str

    def generate(self, word: WordTarget, context: SentenceContext | None = None) -> PracticeQuestion | None:
        ...

    def grade(self, question: PracticeQuestion, answer: str) -> PracticeResult:
        ...
