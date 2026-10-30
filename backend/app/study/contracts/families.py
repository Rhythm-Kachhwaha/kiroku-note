"""
Question Family Contracts (F1–F6) with Pydantic Discriminated Unions.
---------------------------------------------------------------------
Defines explicit, strictly typed models for all six JLPT question families:
- F1: Inline-target MCQ (Kanji Reading, Orthography, Word Formation, Contextual Expressions, Paraphrases, Usage, Grammar 1)
- F2: Sentence Composition (Ordering with Star Position & Permutation Validation)
- F3: Reading Passage Groups (Short, Mid, Long, Integrated, Information Retrieval)
- F4: Text Grammar (Anchored Fill-in-the-blank in Passages)
- F5: Individual Audio Questions (Task, Key Points, Outline, Verbal Expressions, Quick Response)
- F6: Shared Audio Groups (Integrated Listening)
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import (
    Field,
    TypeAdapter,
    model_validator,
)

from app.study.contracts.common import (
    AnswerPayload,
    AssetRefPayload,
    ChoicePayload,
    ContractBase,
)
from app.study.contracts.enums import (
    AnswerOrigin,
    AssetRole,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
    ValidationStatus,
)
from app.study.formats import (
    get_format,
    validate_format_compatibility,
)
from app.study.markup.parser import parse_markup
from app.study.markup.validator import (
    count_stars,
    has_blank,
    has_star,
    has_underline,
)


class BaseQuestionPayload(ContractBase):
    """
    Shared attributes and validation logic for all JLPT question families.
    """

    question_id: Optional[int] = None
    external_id: Optional[str] = None
    format_code: str
    level: JlptLevel
    category: QuestionCategory
    status: QuestionStatus = QuestionStatus.DRAFT
    validation_status: ValidationStatus = ValidationStatus.VALID
    stem_markup: str
    instruction_text: str = ""
    explanation_markup: str = ""
    choices: list[ChoicePayload]
    answer: Optional[AnswerPayload] = None
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_aliases_before(cls, data: dict) -> dict:
        if not isinstance(data, dict):
            return data
        data = dict(data)

        # Support prompt_markup alias for stem_markup
        if "prompt_markup" in data:
            prompt = data.pop("prompt_markup")
            if not data.get("stem_markup"):
                data["stem_markup"] = str(prompt)

        # Infer category from format_code if not provided
        if not data.get("category") and data.get("format_code"):
            try:
                fmt = get_format(data["format_code"])
                data["category"] = fmt.category
            except Exception:
                pass

        return data

    @model_validator(mode="after")
    def validate_shared_question_semantics(self) -> BaseQuestionPayload:
        # 1. Validate format, family, level, and choice count against format registry
        validate_format_compatibility(
            format_code=self.format_code,
            family=self.structural_family,  # type: ignore[attr-defined]
            level=self.level,
            choice_count=len(self.choices),
        )

        # 2. Validate stem markup is well-formed
        parse_markup(self.stem_markup)

        # 3. Validate explanation markup if provided
        if self.explanation_markup:
            parse_markup(self.explanation_markup)

        # 4. Validate choices uniqueness and ordinals
        ordinals = [c.ordinal for c in self.choices]
        if len(ordinals) != len(set(ordinals)):
            raise ValueError(f"Duplicate choice ordinals found: {ordinals}.")
        expected_ordinals = list(range(1, len(self.choices) + 1))
        if sorted(ordinals) != expected_ordinals:
            raise ValueError(
                f"Choice ordinals must be sequential integers from 1 to {len(self.choices)}, got {ordinals}."
            )

        choice_keys = [c.choice_key for c in self.choices]
        if len(choice_keys) != len(set(choice_keys)):
            raise ValueError(f"Duplicate choice keys found: {choice_keys}.")

        # 5. Reconcile answer and choices is_correct
        correct_choices = [c for c in self.choices if c.is_correct is True]
        if len(correct_choices) > 1:
            raise ValueError(
                f"Multiple choices are marked is_correct=True: {[c.choice_key for c in correct_choices]}. "
                "Only one choice may be marked correct."
            )

        if len(correct_choices) == 1:
            c = correct_choices[0]
            if self.answer is None:
                self.answer = AnswerPayload(
                    choice_key=c.choice_key,
                    answer_origin=c.answer_origin or AnswerOrigin.SOURCE_EXPLICIT,
                )
            elif self.answer.choice_key != c.choice_key:
                raise ValueError(
                    f"Choice '{c.choice_key}' has is_correct=True, which contradicts "
                    f"the specified answer choice_key '{self.answer.choice_key}'."
                )

        # 6. Verify answer references an existing choice
        if self.answer is not None:
            if self.answer.choice_key not in choice_keys:
                raise ValueError(
                    f"Answer references choice_key '{self.answer.choice_key}', which does not exist in choices: {choice_keys}."
                )

        return self


# =============================================================================
# Family F1: Inline-target Multiple Choice
# =============================================================================
class F1QuestionPayload(BaseQuestionPayload):
    """
    Family F1: Single-question multiple choice with inline target.
    Covers Kanji Reading, Orthography, Word Formation, Contextually-defined Expressions,
    Paraphrases, Usage, and Sentential Grammar 1.
    """

    structural_family: Literal[StructuralFamily.F1, "F1"] = StructuralFamily.F1
    content_group_id: None = None
    group_ordinal: None = None
    anchor_key: None = None

    @model_validator(mode="after")
    def validate_f1_target(self) -> F1QuestionPayload:
        # Formats with mandatory inline target markup
        # Note: 'usage' questions present a complete sentence without an underline target,
        # with the target vocabulary word specified in the section instruction.
        if self.format_code in ("kanji_reading", "orthography", "word_formation", "paraphrases"):
            ast = parse_markup(self.stem_markup)
            if not has_underline(ast) and not has_blank(ast):
                raise ValueError(
                    f"Question stem for format '{self.format_code}' must contain an inline target "
                    "markup: underline '{u|...}' or blank '{blank|...}'."
                )
        return self


# =============================================================================
# Family F2: Sentence Composition (Ordering)
# =============================================================================
class F2QuestionPayload(BaseQuestionPayload):
    """
    Family F2: Sentence Composition (Ordering with Star Position).
    Covers Sentence Grammar 2 (文の組み立て).
    Stores 4 fragments, the reconstructed sentence permutation, star position,
    and automatically derives the official star answer.
    """

    structural_family: Literal[StructuralFamily.F2, "F2"] = StructuralFamily.F2
    format_code: Literal["sentence_composition"] = "sentence_composition"
    category: Literal[QuestionCategory.GRAMMAR, "grammar"] = QuestionCategory.GRAMMAR
    content_group_id: None = None
    group_ordinal: None = None
    anchor_key: None = None

    star_position: int = Field(default=3, ge=1, le=4)
    fragment_order: Optional[list[int]] = None
    strict_whole_order_grading: bool = False
    derived_star_choice_key: Optional[str] = None

    @model_validator(mode="after")
    def validate_f2_ordering(self) -> F2QuestionPayload:
        # 1. Exactly 4 choices required
        if len(self.choices) != 4:
            raise ValueError(f"F2 Sentence Composition requires exactly 4 choices, got {len(self.choices)}.")

        # 2. Prompt stem must contain {star}
        ast = parse_markup(self.stem_markup)
        if not has_star(ast):
            raise ValueError("F2 Question stem must contain the target star marker '{star}'.")
        if count_stars(ast) > 1:
            raise ValueError(f"F2 Question stem must contain exactly one '{{star}}' marker, found {count_stars(ast)}.")

        # 3. Resolve fragment permutation
        # If fragment_order was not given, check if choices have fragment_order_position
        if self.fragment_order is None:
            choice_positions = {c.ordinal: c.fragment_order_position for c in self.choices}
            if all(pos is not None for pos in choice_positions.values()):
                # Reconstruct fragment_order: list of choice ordinals for blanks 1, 2, 3, 4
                pos_to_ord = {pos: ord_val for ord_val, pos in choice_positions.items()}
                if sorted(pos_to_ord.keys()) == [1, 2, 3, 4]:
                    self.fragment_order = [pos_to_ord[i] for i in range(1, 5)]

        # If still None, we cannot validate or derive order
        if self.fragment_order is None:
            # Valid incomplete question (e.g. pending manual review)
            return self

        # 4. Validate that fragment_order is a strict permutation of [1, 2, 3, 4]
        if sorted(self.fragment_order) != [1, 2, 3, 4]:
            raise ValueError(
                f"F2 fragment_order must be a strict permutation of [1, 2, 3, 4], got {self.fragment_order}."
            )

        # 5. Derive the official star answer
        # star_position is 1-based: blank 1, 2, 3, 4
        star_choice_ordinal = self.fragment_order[self.star_position - 1]
        matching_choice = next(c for c in self.choices if c.ordinal == star_choice_ordinal)
        self.derived_star_choice_key = matching_choice.choice_key

        # 6. Reconcile with answer
        if self.answer is None:
            self.answer = AnswerPayload(
                choice_key=self.derived_star_choice_key,
                answer_origin=AnswerOrigin.SOURCE_DERIVED,
            )
        elif self.answer.choice_key != self.derived_star_choice_key:
            raise ValueError(
                f"Answer choice '{self.answer.choice_key}' contradicts the derived star choice "
                f"'{self.derived_star_choice_key}' (star position {self.star_position}, "
                f"choice ordinal {star_choice_ordinal})."
            )

        return self


# =============================================================================
# Family F3: Reading Passage Groups
# =============================================================================
class F3QuestionPayload(BaseQuestionPayload):
    """
    Family F3: Passage-based reading comprehension questions.
    Questions belong to a shared ContentGroupPayload (passage, document set)
    without duplicating the passage text in each question revision.
    """

    structural_family: Literal[StructuralFamily.F3, "F3"] = StructuralFamily.F3
    category: Literal[QuestionCategory.READING, "reading"] = QuestionCategory.READING
    content_group_id: Optional[int] = None
    group_external_id: Optional[str] = None
    group_ordinal: Optional[int] = Field(default=None, gt=0)
    anchor_key: None = None

    @model_validator(mode="after")
    def validate_f3_format(self) -> F3QuestionPayload:
        if self.format_code not in (
            "comprehension_short",
            "comprehension_mid",
            "comprehension_long",
            "integrated_thematic_reading",
            "information_retrieval",
        ):
            raise ValueError(f"Invalid format code '{self.format_code}' for reading family F3.")
        if self.content_group_id is not None and self.group_ordinal is None:
            raise ValueError("group_ordinal is required when content_group_id is set.")
        return self


# =============================================================================
# Family F4: Text Grammar
# =============================================================================
class F4QuestionPayload(BaseQuestionPayload):
    """
    Family F4: Text Grammar (文章の文法).
    Questions associate directly to an anchor_key (e.g. blank_35) defined
    within the shared passage revision.
    """

    structural_family: Literal[StructuralFamily.F4, "F4"] = StructuralFamily.F4
    format_code: Literal["text_grammar"] = "text_grammar"
    category: Literal[QuestionCategory.GRAMMAR, "grammar"] = QuestionCategory.GRAMMAR
    content_group_id: Optional[int] = None
    group_external_id: Optional[str] = None
    group_ordinal: Optional[int] = Field(default=None, gt=0)
    anchor_key: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_f4_anchor(self) -> F4QuestionPayload:
        if not self.anchor_key or not self.anchor_key.strip():
            raise ValueError("F4 Text Grammar questions must provide a non-empty anchor_key.")
        if self.content_group_id is not None and self.group_ordinal is None:
            raise ValueError("group_ordinal is required when content_group_id is set.")
        return self


# =============================================================================
# Family F5: Individual Audio Questions
# =============================================================================
class F5QuestionPayload(BaseQuestionPayload):
    """
    Family F5: Standalone listening questions with individual audio assets.
    Covers Task-based, Key Points, General Outline, Verbal Expressions, and Quick Response.
    Supports text, image, and unprinted choice modes.
    """

    structural_family: Literal[StructuralFamily.F5, "F5"] = StructuralFamily.F5
    category: Literal[QuestionCategory.LISTENING, "listening"] = QuestionCategory.LISTENING
    content_group_id: None = None
    group_ordinal: None = None
    anchor_key: None = None

    audio_asset: Optional[AssetRefPayload] = None
    assets: list[AssetRefPayload] = Field(default_factory=list)
    transcript_markup: Optional[str] = None

    @model_validator(mode="after")
    def validate_f5_audio(self) -> F5QuestionPayload:
        if self.format_code not in (
            "task_based_listening",
            "key_points_listening",
            "general_outline_listening",
            "verbal_expressions",
            "quick_response",
        ):
            raise ValueError(f"Invalid format code '{self.format_code}' for listening family F5.")

        # Ensure at least one audio asset is present
        has_audio = (
            self.audio_asset is not None and self.audio_asset.role == AssetRole.AUDIO
        ) or any(a.role == AssetRole.AUDIO for a in self.assets)

        if not has_audio and self.status == QuestionStatus.ACTIVE:
            raise ValueError("Active F5 listening questions must reference at least one audio asset.")

        if self.transcript_markup:
            parse_markup(self.transcript_markup)

        return self


# =============================================================================
# Family F6: Shared Audio Groups
# =============================================================================
class F6QuestionPayload(BaseQuestionPayload):
    """
    Family F6: Shared Audio Groups (Integrated Listening / 統合理解).
    Multiple questions link to a shared audio_context content group without
    duplicating the audio asset into each question.
    """

    structural_family: Literal[StructuralFamily.F6, "F6"] = StructuralFamily.F6
    format_code: Literal["listening_integrated"] = "listening_integrated"
    category: Literal[QuestionCategory.LISTENING, "listening"] = QuestionCategory.LISTENING
    content_group_id: Optional[int] = None
    group_external_id: Optional[str] = None
    group_ordinal: Optional[int] = Field(default=None, gt=0)
    transcript_markup: Optional[str] = None

    @model_validator(mode="after")
    def validate_f6_level(self) -> F6QuestionPayload:
        if self.level not in (JlptLevel.N1, JlptLevel.N2):
            raise ValueError(f"Listening integrated (F6) is only available at N1 and N2, got {self.level}.")
        if self.content_group_id is not None and self.group_ordinal is None:
            raise ValueError("group_ordinal is required when content_group_id is set.")
        if self.transcript_markup:
            parse_markup(self.transcript_markup)
        return self


# Discriminated Union for polymorphic deserialization
AnyQuestionPayload = Annotated[
    Union[
        F1QuestionPayload,
        F2QuestionPayload,
        F3QuestionPayload,
        F4QuestionPayload,
        F5QuestionPayload,
        F6QuestionPayload,
    ],
    Field(discriminator="structural_family"),
]

_QUESTION_PAYLOAD_ADAPTER = TypeAdapter(AnyQuestionPayload)


def parse_question_payload(data: Union[dict, str]) -> AnyQuestionPayload:
    """
    Polymorphically parse a question dictionary or JSON string into its
    corresponding structural family contract (F1–F6).
    """
    if isinstance(data, str):
        return _QUESTION_PAYLOAD_ADAPTER.validate_json(data)
    return _QUESTION_PAYLOAD_ADAPTER.validate_python(data)

