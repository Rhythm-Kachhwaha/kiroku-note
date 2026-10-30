"""
Format Registry & Level Compatibility for Kiroku Study Database.
-----------------------------------------------------------------
Defines the authoritative code-based registry of all 20 JLPT question formats across
the six structural families (F1–F6), including category, grading type, choice-count
constraints, allowed JLPT levels, and validation functions.

Guarantees 100% agreement with the seeded database schema (0002_seed_formats_and_exams.sql).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


StructuralFamilyType = Literal["F1", "F2", "F3", "F4", "F5", "F6"]
QuestionCategoryType = Literal["vocabulary", "grammar", "reading", "listening"]
JlptLevelType = Literal["N1", "N2", "N3", "N4", "N5"]


class FormatError(ValueError):
    """Base exception for study format registry errors."""


class FormatNotFoundError(FormatError):
    """Raised when an unknown format code is referenced."""


class FormatFamilyMismatchError(FormatError):
    """Raised when a format code does not belong to the expected structural family."""


class FormatLevelMismatchError(FormatError):
    """Raised when a format is unsupported at the specified JLPT level."""


class InvalidChoiceCountError(FormatError):
    """Raised when the number of choices violates format limits."""


@dataclass(frozen=True)
class FormatMetadata:
    code: str
    structural_family: StructuralFamilyType
    category: QuestionCategoryType
    grader_type: str
    min_choices: int
    max_choices: int
    label: str
    allowed_levels: frozenset[JlptLevelType]


FORMAT_REGISTRY: dict[str, FormatMetadata] = {
    # -------------------------------------------------------------------------
    # Family F1: Inline-target Multiple Choice
    # -------------------------------------------------------------------------
    "kanji_reading": FormatMetadata(
        code="kanji_reading",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Kanji Reading",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "orthography": FormatMetadata(
        code="orthography",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Orthography",
        allowed_levels=frozenset({"N2", "N3", "N4", "N5"}),
    ),
    "word_formation": FormatMetadata(
        code="word_formation",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Word Formation",
        allowed_levels=frozenset({"N2"}),
    ),
    "contextual_expressions": FormatMetadata(
        code="contextual_expressions",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Contextually-defined Expressions",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "paraphrases": FormatMetadata(
        code="paraphrases",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Paraphrases",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "usage": FormatMetadata(
        code="usage",
        structural_family="F1",
        category="vocabulary",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Usage",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4"}),
    ),
    "sentential_grammar_1": FormatMetadata(
        code="sentential_grammar_1",
        structural_family="F1",
        category="grammar",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Sentential Grammar 1 (Grammar Form Selection)",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),

    # -------------------------------------------------------------------------
    # Family F2: Sentence Composition (Ordering)
    # -------------------------------------------------------------------------
    "sentence_composition": FormatMetadata(
        code="sentence_composition",
        structural_family="F2",
        category="grammar",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Sentence Composition (Star)",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),

    # -------------------------------------------------------------------------
    # Family F3: Passage-based Reading
    # -------------------------------------------------------------------------
    "comprehension_short": FormatMetadata(
        code="comprehension_short",
        structural_family="F3",
        category="reading",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Comprehension Short",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "comprehension_mid": FormatMetadata(
        code="comprehension_mid",
        structural_family="F3",
        category="reading",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Comprehension Mid",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "comprehension_long": FormatMetadata(
        code="comprehension_long",
        structural_family="F3",
        category="reading",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Comprehension Long",
        allowed_levels=frozenset({"N1", "N3"}),
    ),
    "integrated_thematic_reading": FormatMetadata(
        code="integrated_thematic_reading",
        structural_family="F3",
        category="reading",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Integrated and Thematic Reading",
        allowed_levels=frozenset({"N1", "N2"}),
    ),
    "information_retrieval": FormatMetadata(
        code="information_retrieval",
        structural_family="F3",
        category="reading",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Information Retrieval",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),

    # -------------------------------------------------------------------------
    # Family F4: Text Grammar
    # -------------------------------------------------------------------------
    "text_grammar": FormatMetadata(
        code="text_grammar",
        structural_family="F4",
        category="grammar",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Text Grammar",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),

    # -------------------------------------------------------------------------
    # Family F5: Individual Audio Questions
    # -------------------------------------------------------------------------
    "task_based_listening": FormatMetadata(
        code="task_based_listening",
        structural_family="F5",
        category="listening",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Task-based Listening",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "key_points_listening": FormatMetadata(
        code="key_points_listening",
        structural_family="F5",
        category="listening",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Key Points Listening",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),
    "general_outline_listening": FormatMetadata(
        code="general_outline_listening",
        structural_family="F5",
        category="listening",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="General Outline Listening",
        allowed_levels=frozenset({"N1", "N2", "N3"}),
    ),
    "verbal_expressions": FormatMetadata(
        code="verbal_expressions",
        structural_family="F5",
        category="listening",
        grader_type="single_choice",
        min_choices=3,
        max_choices=4,
        label="Verbal Expressions",
        allowed_levels=frozenset({"N3", "N4", "N5"}),
    ),
    "quick_response": FormatMetadata(
        code="quick_response",
        structural_family="F5",
        category="listening",
        grader_type="single_choice",
        min_choices=3,
        max_choices=3,
        label="Quick Response",
        allowed_levels=frozenset({"N1", "N2", "N3", "N4", "N5"}),
    ),

    # -------------------------------------------------------------------------
    # Family F6: Shared Audio Groups
    # -------------------------------------------------------------------------
    "listening_integrated": FormatMetadata(
        code="listening_integrated",
        structural_family="F6",
        category="listening",
        grader_type="single_choice",
        min_choices=4,
        max_choices=4,
        label="Listening Integrated",
        allowed_levels=frozenset({"N1", "N2"}),
    ),
}


def get_format(code: str) -> FormatMetadata:
    """Retrieve format metadata by format code."""
    meta = FORMAT_REGISTRY.get(code)
    if meta is None:
        raise FormatNotFoundError(f"Unknown format code: '{code}'. Known formats: {sorted(FORMAT_REGISTRY.keys())}")
    return meta


def validate_format_compatibility(
    format_code: str,
    family: StructuralFamilyType | str,
    level: JlptLevelType | str,
    choice_count: int | None = None,
) -> FormatMetadata:
    """
    Validate that format_code exists, matches the expected structural family,
    is supported at the specified JLPT level, and satisfies choice count bounds.
    """
    meta = get_format(format_code)

    family_str = getattr(family, "value", str(family))
    level_str = getattr(level, "value", str(level))

    if meta.structural_family != family_str:
        raise FormatFamilyMismatchError(
            f"Format '{format_code}' belongs to structural family '{meta.structural_family}', "
            f"not requested family '{family_str}'."
        )

    if level_str not in meta.allowed_levels:
        raise FormatLevelMismatchError(
            f"Format '{format_code}' is not supported at JLPT level '{level_str}'. "
            f"Allowed levels: {sorted(meta.allowed_levels)}."
        )

    if choice_count is not None:
        if choice_count < meta.min_choices or choice_count > meta.max_choices:
            raise InvalidChoiceCountError(
                f"Format '{format_code}' requires between {meta.min_choices} and {meta.max_choices} choices, "
                f"but {choice_count} were provided."
            )

    return meta

