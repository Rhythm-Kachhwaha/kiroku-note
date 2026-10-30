"""
Enumerations for Question Bank Data Contracts.
----------------------------------------------
Defines strict StrEnum types for JLPT levels, categories, structural families,
choice presentation modes, answer origins, question statuses, and content group kinds.
"""
from __future__ import annotations

from enum import Enum


class JlptLevel(str, Enum):
    N1 = "N1"
    N2 = "N2"
    N3 = "N3"
    N4 = "N4"
    N5 = "N5"


class QuestionCategory(str, Enum):
    VOCABULARY = "vocabulary"
    GRAMMAR = "grammar"
    READING = "reading"
    LISTENING = "listening"


class StructuralFamily(str, Enum):
    F1 = "F1"
    F2 = "F2"
    F3 = "F3"
    F4 = "F4"
    F5 = "F5"
    F6 = "F6"


class ChoiceMode(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    UNPRINTED = "unprinted"


class AnswerOrigin(str, Enum):
    SOURCE_EXPLICIT = "source_explicit"
    SOURCE_DERIVED = "source_derived"
    USER_ENTERED = "user_entered"
    GENERATED_UNVERIFIED = "generated_unverified"


class QuestionStatus(str, Enum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    ACTIVE = "active"
    RETIRED = "retired"


class ValidationStatus(str, Enum):
    VALID = "valid"
    NEEDS_REVIEW = "needs_review"
    INVALID = "invalid"


class GroupKind(str, Enum):
    PASSAGE = "passage"
    INTEGRATED_PASSAGE = "integrated_passage"
    AUDIO_CONTEXT = "audio_context"
    DOCUMENT_SET = "document_set"


class GroupPartRole(str, Enum):
    TEXT = "text"
    HEADING = "heading"
    DIALOGUE_SCRIPT = "dialogue_script"
    TABLE = "table"
    IMAGE_REFERENCE = "image_reference"


class AssetRole(str, Enum):
    AUDIO = "audio"
    ILLUSTRATION = "illustration"
    DIAGRAM = "diagram"
    DOCUMENT = "document"
    CHOICE_IMAGE = "choice_image"

