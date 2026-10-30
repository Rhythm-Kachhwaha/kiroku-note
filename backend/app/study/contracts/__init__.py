"""
Kiroku Study Question Contracts & Discriminated Unions.
-------------------------------------------------------
Pydantic contracts for JLPT Question Families F1–F6, choices, answers,
content groups, format compatibility, and database decomposition.
"""
from __future__ import annotations

from app.study.contracts.common import (
    AnswerPayload,
    AssetRefPayload,
    ChoicePayload,
    ContentGroupPayload,
    GroupAnchorPayload,
    GroupAssetRefPayload,
    GroupPartPayload,
)
from app.study.contracts.db_mapping import (
    compute_group_content_fingerprint,
    compute_question_content_fingerprint,
    decompose_group_for_db,
    decompose_question_for_db,
    extract_family_payload_dict,
    recompose_group_from_db,
    recompose_question_from_db,
)
from app.study.contracts.enums import (
    AnswerOrigin,
    AssetRole,
    ChoiceMode,
    GroupKind,
    GroupPartRole,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
    ValidationStatus,
)
from app.study.contracts.families import (
    AnyQuestionPayload,
    BaseQuestionPayload,
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    parse_question_payload,
)

__all__ = [
    "AnswerOrigin",
    "AnswerPayload",
    "AnyQuestionPayload",
    "AssetRefPayload",
    "AssetRole",
    "BaseQuestionPayload",
    "ChoiceMode",
    "ChoicePayload",
    "ContentGroupPayload",
    "F1QuestionPayload",
    "F2QuestionPayload",
    "F3QuestionPayload",
    "F4QuestionPayload",
    "F5QuestionPayload",
    "F6QuestionPayload",
    "GroupAnchorPayload",
    "GroupAssetRefPayload",
    "GroupKind",
    "GroupPartPayload",
    "GroupPartRole",
    "JlptLevel",
    "QuestionCategory",
    "QuestionStatus",
    "StructuralFamily",
    "ValidationStatus",
    "compute_group_content_fingerprint",
    "compute_question_content_fingerprint",
    "decompose_group_for_db",
    "decompose_question_for_db",
    "extract_family_payload_dict",
    "parse_question_payload",
    "recompose_group_from_db",
    "recompose_question_from_db",
]

