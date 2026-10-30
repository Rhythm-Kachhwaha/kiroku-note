"""
Database Mapping & Schema Reconciliation for Question Family Contracts.
------------------------------------------------------------------------
Translates between high-level Pydantic family contracts (F1–F6) and the
relational database tables & JSON payloads defined in Milestone 1 schema:
- question
- question_revision (stem_markup, payload_json, content_fingerprint)
- revision_choice
- revision_answer
- question_revision_asset

Guarantees clean separation: Relational data stays in relational columns/tables,
while family-specific non-relational parameters reside in payload_json.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from app.study.contracts.common import (
    AnswerPayload,
    AssetRefPayload,
    ChoicePayload,
)
from app.study.contracts.enums import (
    AnswerOrigin,
    ChoiceMode,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
    ValidationStatus,
)
from app.study.contracts.families import (
    AnyQuestionPayload,
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    parse_question_payload,
)


def _val(x: Any) -> Any:
    return getattr(x, "value", x)


def compute_question_content_fingerprint(
    stem_markup: str,
    choices: list[ChoicePayload],
    payload_dict: dict[str, Any],
) -> str:
    """
    Compute a deterministic SHA-256 fingerprint for a question revision
    based on normalized stem markup, ordered choices, and family payload.
    """
    hasher = hashlib.sha256()
    hasher.update(stem_markup.strip().encode("utf-8"))

    # Choices sorted by ordinal
    for c in sorted(choices, key=lambda x: x.ordinal):
        hasher.update(f":{c.ordinal}:{c.choice_key}:{c.label}:{_val(c.mode)}:".encode("utf-8"))
        if c.text_markup:
            hasher.update(c.text_markup.strip().encode("utf-8"))
        if c.asset_id:
            hasher.update(str(c.asset_id).encode("utf-8"))
        if c.asset_sha256:
            hasher.update(c.asset_sha256.encode("utf-8"))

    # Relevant family payload keys (sorted for determinism)
    canon_payload = json.dumps(payload_dict, sort_keys=True, ensure_ascii=False)
    hasher.update(canon_payload.encode("utf-8"))

    return hasher.hexdigest()


def extract_family_payload_dict(question: AnyQuestionPayload) -> dict[str, Any]:
    """
    Extract the family-specific fields that belong in question_revision.payload_json
    (i.e. those not stored in dedicated relational columns).
    """
    payload: dict[str, Any] = {
        "instruction_text": question.instruction_text,
        "explanation_markup": question.explanation_markup,
        "metadata": question.metadata,
    }

    if isinstance(question, F2QuestionPayload):
        payload["star_position"] = question.star_position
        payload["fragment_order"] = question.fragment_order
        payload["strict_whole_order_grading"] = question.strict_whole_order_grading
        payload["derived_star_choice_key"] = question.derived_star_choice_key

    elif isinstance(question, (F5QuestionPayload, F6QuestionPayload)):
        if question.transcript_markup:
            payload["transcript_markup"] = question.transcript_markup

    return payload


def decompose_question_for_db(
    question: AnyQuestionPayload,
    revision_number: int = 1,
) -> dict[str, Any]:
    """
    Decompose an AnyQuestionPayload contract into rows ready for insertion into:
    - question table
    - question_revision table (with calculated content_fingerprint and payload_json)
    - revision_choice table
    - revision_answer table
    - question_revision_asset table
    """
    family_payload = extract_family_payload_dict(question)
    fingerprint = compute_question_content_fingerprint(
        stem_markup=question.stem_markup,
        choices=question.choices,
        payload_dict=family_payload,
    )

    # 1. Row for `question` table
    question_row: dict[str, Any] = {
        "external_id": question.external_id,
        "format_code": question.format_code,
        "level": _val(question.level),
        "category": _val(question.category),
        "status": _val(question.status),
        "content_group_id": getattr(question, "content_group_id", None),
        "group_ordinal": getattr(question, "group_ordinal", None),
        "anchor_key": getattr(question, "anchor_key", None),
    }

    # 2. Row for `question_revision` table
    revision_row: dict[str, Any] = {
        "format_code": question.format_code,
        "revision_number": revision_number,
        "stem_markup": question.stem_markup,
        "payload_json": json.dumps(family_payload, ensure_ascii=False),
        "validation_status": _val(question.validation_status),
        "content_fingerprint": fingerprint,
        "schema_version": 1,
    }

    # 3. Rows for `revision_choice` table
    choice_rows: list[dict[str, Any]] = []
    for c in sorted(question.choices, key=lambda x: x.ordinal):
        choice_rows.append({
            "choice_key": c.choice_key,
            "label": c.label,
            "ordinal": c.ordinal,
            "text_markup": c.text_markup if c.mode == ChoiceMode.TEXT else "",
            "asset_id": c.asset_id,
            "mode": _val(c.mode),
        })

    # 4. Row for `revision_answer` table (if answer provided)
    answer_row: Optional[dict[str, Any]] = None
    if question.answer is not None:
        answer_row = {
            "choice_key": question.answer.choice_key,
            "answer_origin": _val(question.answer.answer_origin),
            "rationale_markup": question.answer.rationale_markup,
        }

    # 5. Rows for `question_revision_asset` table (e.g. F5 listening audio)
    asset_rows: list[dict[str, Any]] = []
    if isinstance(question, F5QuestionPayload):
        if question.audio_asset:
            asset_rows.append({
                "asset_id": question.audio_asset.asset_id,
                "sha256": question.audio_asset.sha256,
                "role": _val(question.audio_asset.role),
                "ordinal": question.audio_asset.ordinal,
                "is_required": 1 if question.audio_asset.is_required else 0,
            })
        for a in question.assets:
            asset_rows.append({
                "asset_id": a.asset_id,
                "sha256": a.sha256,
                "role": _val(a.role),
                "ordinal": a.ordinal,
                "is_required": 1 if a.is_required else 0,
            })

    return {
        "question": question_row,
        "revision": revision_row,
        "choices": choice_rows,
        "answer": answer_row,
        "assets": asset_rows,
    }


def recompose_question_from_db(
    question_row: dict[str, Any],
    revision_row: dict[str, Any],
    choice_rows: list[dict[str, Any]],
    answer_row: Optional[dict[str, Any]] = None,
    asset_rows: Optional[list[dict[str, Any]]] = None,
) -> AnyQuestionPayload:
    """
    Reconstruct an AnyQuestionPayload instance from relational database records
    and the revision's payload_json.
    """
    payload_dict: dict[str, Any] = {}
    if revision_row.get("payload_json"):
        payload_dict = json.loads(revision_row["payload_json"])

    # Reconstruct choices
    choices: list[dict[str, Any]] = []
    for c in choice_rows:
        choice_dict: dict[str, Any] = {
            "choice_key": c["choice_key"],
            "ordinal": c["ordinal"],
            "label": c["label"],
            "asset_id": c.get("asset_id"),
        }
        # Mode detection
        mode = c.get("mode")
        if mode:
            choice_dict["mode"] = mode
        elif c.get("asset_id") is not None:
            choice_dict["mode"] = "image"
        elif c.get("text_markup"):
            choice_dict["mode"] = "text"
            choice_dict["text_markup"] = c["text_markup"]
        else:
            choice_dict["mode"] = "unprinted"

        if choice_dict["mode"] == "text":
            choice_dict["text_markup"] = c.get("text_markup") or ""

        choices.append(choice_dict)

    # Reconstruct answer
    answer_dict: Optional[dict[str, Any]] = None
    if answer_row:
        answer_dict = {
            "choice_key": answer_row["choice_key"],
            "answer_origin": answer_row.get("answer_origin", "source_explicit"),
            "rationale_markup": answer_row.get("rationale_markup", ""),
        }

    # Determine structural family from format_code
    format_code = question_row["format_code"]
    from app.study.formats import get_format
    fmt_meta = get_format(format_code)

    base_data: dict[str, Any] = {
        "question_id": question_row.get("id"),
        "external_id": question_row.get("external_id"),
        "format_code": format_code,
        "structural_family": fmt_meta.structural_family,
        "level": question_row["level"],
        "category": question_row["category"],
        "status": question_row.get("status", "draft"),
        "validation_status": revision_row.get("validation_status", "valid"),
        "stem_markup": revision_row["stem_markup"],
        "instruction_text": payload_dict.get("instruction_text", ""),
        "explanation_markup": payload_dict.get("explanation_markup", ""),
        "metadata": payload_dict.get("metadata", {}),
        "choices": choices,
        "answer": answer_dict,
    }

    # Family-specific reconstruction
    if fmt_meta.structural_family == "F2":
        base_data["star_position"] = payload_dict.get("star_position", 3)
        base_data["fragment_order"] = payload_dict.get("fragment_order")
        base_data["strict_whole_order_grading"] = payload_dict.get("strict_whole_order_grading", False)

    elif fmt_meta.structural_family in ("F3", "F4", "F6"):
        base_data["content_group_id"] = question_row.get("content_group_id")
        base_data["group_ordinal"] = question_row.get("group_ordinal")
        if fmt_meta.structural_family == "F4":
            base_data["anchor_key"] = question_row.get("anchor_key")

    if fmt_meta.structural_family in ("F5", "F6"):
        base_data["transcript_markup"] = payload_dict.get("transcript_markup")
        if fmt_meta.structural_family == "F5" and asset_rows:
            # Map first audio asset
            audio_assets = [a for a in asset_rows if a.get("role") == "audio"]
            if audio_assets:
                base_data["audio_asset"] = {
                    "role": "audio",
                    "asset_id": audio_assets[0].get("asset_id"),
                    "sha256": audio_assets[0].get("sha256"),
                    "ordinal": audio_assets[0].get("ordinal", 1),
                    "is_required": bool(audio_assets[0].get("is_required", 1)),
                }

    return parse_question_payload(base_data)

