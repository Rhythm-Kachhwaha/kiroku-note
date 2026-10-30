"""
Converters for Domain Presentation Models to Unified Question DTOs.
--------------------------------------------------------------------
Ensures consistent DTO structure across practice sessions, exam sessions,
and review history, with strict concealment of canonical answers during
active attempts.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Optional

from app.api.study.schemas import (
    ChoiceDTO,
    GroupContextDTO,
    GroupPartDTO,
    QuestionDTO,
)
from app.study.exam.models import ExamItemPresentation
from app.study.formats import FORMAT_REGISTRY, get_format
from app.study.session.models import PracticeItemPresentation


def _get_question_media_url(conn: sqlite3.Connection, question_id: int, role: str) -> Optional[str]:
    """Retrieve question-specific media asset URL for given role."""
    try:
        row = conn.execute(
            """
            SELECT qra.asset_id
            FROM question q
            JOIN question_revision_asset qra ON q.current_revision_id = qra.question_revision_id
            WHERE q.id = ? AND qra.role = ?
            ORDER BY qra.ordinal ASC LIMIT 1;
            """,
            (question_id, role),
        ).fetchone()
        if row and row["asset_id"]:
            return f"/api/study/v1/media/{row['asset_id']}"
    except Exception:
        pass
    return None


def _get_question_audio_url(conn: sqlite3.Connection, question_id: int) -> Optional[str]:
    """Retrieve question-specific audio asset URL if available."""
    return _get_question_media_url(conn, question_id, "audio")


def _is_question_bookmarked(conn: sqlite3.Connection, question_id: int) -> bool:
    """Check if question is currently bookmarked."""
    try:
        row = conn.execute("SELECT 1 FROM question_bookmark WHERE question_id = ?;", (question_id,)).fetchone()
        return bool(row)
    except Exception:
        return False


def _get_group_audio_url(conn: sqlite3.Connection, group_id: int) -> Optional[str]:
    """Retrieve group-level audio asset URL if available."""
    try:
        row = conn.execute(
            """
            SELECT gra.asset_id
            FROM content_group cg
            JOIN group_revision_asset gra ON cg.current_revision_id = gra.group_revision_id
            WHERE cg.id = ? AND gra.role = 'audio'
            ORDER BY gra.ordinal ASC LIMIT 1;
            """,
            (group_id,),
        ).fetchone()
        if row and row["asset_id"]:
            return f"/api/study/v1/media/{row['asset_id']}"
    except Exception:
        pass
    return None


def _get_structural_family(format_code: str) -> Optional[str]:
    """Look up structural family code (F1-F6) for format."""
    try:
        meta = get_format(format_code)
        return meta.structural_family
    except Exception:
        return None


def practice_item_to_dto(
    conn: sqlite3.Connection,
    item: PracticeItemPresentation,
    reveal_answers: bool = False,
) -> QuestionDTO:
    """
    Convert PracticeItemPresentation to unified QuestionDTO.
    Reveals answers and explanations only if the item has been answered or explicitly requested.
    """
    # 1. Choices
    choices_dto = []
    for c in item.choices:
        img_url = f"/api/study/v1/media/{c.asset_id}" if c.asset_id else None
        choices_dto.append(
            ChoiceDTO(
                choice_id=c.choice_id,
                choice_key=c.choice_key,
                display_position=c.display_position,
                label=c.label,
                mode=c.mode,
                text_markup=c.text_markup,
                image_url=img_url,
                asset_id=c.asset_id,
            )
        )

    # 2. Group Context
    group_dto = None
    if item.group_context:
        grp_audio = _get_group_audio_url(conn, item.group_context.group_id)
        parts_dto = [
            GroupPartDTO(
                ordinal=p.ordinal,
                role=p.role,
                title=p.title,
                markup=p.markup,
            )
            for p in item.group_context.parts
        ]
        group_dto = GroupContextDTO(
            group_id=item.group_context.group_id,
            group_kind=item.group_context.group_kind,
            title=item.group_context.title,
            parts=parts_dto,
            audio_url=grp_audio,
        )

    # 3. Media Assets & Bookmarks
    audio_url = _get_question_audio_url(conn, item.question_id)
    illustration_url = _get_question_media_url(conn, item.question_id, "illustration")
    diagram_url = _get_question_media_url(conn, item.question_id, "diagram")
    is_bookmarked = _is_question_bookmarked(conn, item.question_id)

    # 4. Canonical revelation & format-specific fields
    can_reveal = reveal_answers or item.is_answered
    is_correct = item.is_correct if can_reveal else None
    canonical_choice_id = None
    canonical_choice_key = None
    explanation_markup = None
    star_position = None
    correct_order = None
    anchor_key = None
    group_ordinal = None
    instruction_text = ""

    # Fetch format-specific details and payload
    try:
        q_row = conn.execute(
            "SELECT anchor_key, group_ordinal FROM question WHERE id = ?;",
            (item.question_id,),
        ).fetchone()
        if q_row:
            anchor_key = q_row["anchor_key"]
            group_ordinal = q_row["group_ordinal"]

        row = conn.execute(
            """
            SELECT
                ra.choice_id,
                rc.choice_key,
                qr.payload_json,
                ra.rationale_markup
            FROM attempt_item ai
            JOIN question_revision qr ON ai.pinned_question_revision_id = qr.id
            LEFT JOIN revision_answer ra ON qr.id = ra.question_revision_id
            LEFT JOIN revision_choice rc ON ra.choice_id = rc.id
            WHERE ai.id = ?;
            """,
            (item.attempt_item_id,),
        ).fetchone()
        if row:
            if row["payload_json"]:
                payload = json.loads(row["payload_json"])
                star_position = payload.get("star_position")
                instruction_text = payload.get("instruction_text", "")
                if not anchor_key:
                    anchor_key = payload.get("anchor_key")
                if not group_ordinal:
                    group_ordinal = payload.get("group_ordinal")

            if can_reveal:
                canonical_choice_id = row["choice_id"]
                canonical_choice_key = row["choice_key"]
                explanation_markup = row["rationale_markup"] or ""
                if not explanation_markup and row["payload_json"]:
                    explanation_markup = payload.get("explanation_markup", "")
                if row["payload_json"]:
                    correct_order = payload.get("correct_order")
    except Exception:
        pass

    return QuestionDTO(
        attempt_item_id=item.attempt_item_id,
        position=item.position,
        question_id=item.question_id,
        external_id=item.external_id,
        level=item.level,
        category=item.category,
        format_code=item.format_code,
        structural_family=_get_structural_family(item.format_code),
        instruction_text=instruction_text,
        prompt_markup=item.prompt_markup,
        choices=choices_dto,
        group_context=group_dto,
        audio_url=audio_url,
        illustration_url=illustration_url,
        diagram_url=diagram_url,
        star_position=star_position,
        correct_order=correct_order,
        anchor_key=anchor_key,
        group_ordinal=group_ordinal,
        presented_at=item.presented_at,
        is_answered=item.is_answered,
        selected_choice_id=item.submitted_choice_id,
        is_marked_for_review=False,
        audio_play_count=0,
        section_code=None,
        block_order=None,
        is_correct=is_correct,
        canonical_choice_id=canonical_choice_id,
        canonical_choice_key=canonical_choice_key,
        difficulty_rating=item.difficulty_rating.value if item.difficulty_rating else None,
        explanation_markup=explanation_markup,
        is_bookmarked=is_bookmarked,
    )


def exam_item_to_dto(
    conn: sqlite3.Connection,
    item: ExamItemPresentation,
    is_exam_completed: bool = False,
) -> QuestionDTO:
    """
    Convert ExamItemPresentation to unified QuestionDTO.
    Canonical answers and rationales are strictly masked unless the exam is complete.
    """
    choices_dto = []
    for c in item.choices:
        img_url = f"/api/study/v1/media/{c.asset_id}" if c.asset_id else None
        choices_dto.append(
            ChoiceDTO(
                choice_id=c.choice_id,
                choice_key=c.choice_key,
                display_position=c.display_position,
                label=c.label,
                mode=c.mode,
                text_markup=c.text_markup,
                image_url=img_url,
                asset_id=c.asset_id,
            )
        )

    group_dto = None
    if item.group_context:
        grp_audio = _get_group_audio_url(conn, item.group_context.group_id)
        parts_dto = [
            GroupPartDTO(
                ordinal=p.ordinal,
                role=p.role,
                title=p.title,
                markup=p.markup,
            )
            for p in item.group_context.parts
        ]
        group_dto = GroupContextDTO(
            group_id=item.group_context.group_id,
            group_kind=item.group_context.group_kind,
            title=item.group_context.title,
            parts=parts_dto,
            audio_url=grp_audio,
        )

    audio_url = _get_question_audio_url(conn, item.question_id)
    illustration_url = _get_question_media_url(conn, item.question_id, "illustration")
    diagram_url = _get_question_media_url(conn, item.question_id, "diagram")
    is_bookmarked = _is_question_bookmarked(conn, item.question_id)

    # Format-specific metadata from question & revision payload
    star_position = None
    correct_order = None
    anchor_key = None
    group_ordinal = None
    instruction_text = ""

    try:
        q_row = conn.execute(
            "SELECT anchor_key, group_ordinal FROM question WHERE id = ?;",
            (item.question_id,),
        ).fetchone()
        if q_row:
            anchor_key = q_row["anchor_key"]
            group_ordinal = q_row["group_ordinal"]

        row = conn.execute(
            """
            SELECT qr.payload_json
            FROM exam_item ei
            JOIN question_revision qr ON ei.pinned_question_revision_id = qr.id
            WHERE ei.id = ?;
            """,
            (item.attempt_item_id,),
        ).fetchone()
        if row and row["payload_json"]:
            payload = json.loads(row["payload_json"])
            star_position = payload.get("star_position")
            instruction_text = payload.get("instruction_text", "")
            if not anchor_key:
                anchor_key = payload.get("anchor_key")
            if not group_ordinal:
                group_ordinal = payload.get("group_ordinal")
            if is_exam_completed:
                correct_order = payload.get("correct_order")
    except Exception:
        pass

    # Strictly mask answer key if exam is not completed
    is_correct = item.is_correct if is_exam_completed else None
    canonical_choice_id = item.canonical_choice_id if is_exam_completed else None
    canonical_choice_key = item.canonical_choice_key if is_exam_completed else None
    explanation_markup = item.rationale_markup if is_exam_completed else None

    return QuestionDTO(
        attempt_item_id=item.attempt_item_id,
        position=item.position,
        question_id=item.question_id,
        external_id=item.external_id,
        level=item.level,
        category=item.category,
        format_code=item.format_code,
        structural_family=_get_structural_family(item.format_code),
        instruction_text=instruction_text,
        prompt_markup=item.prompt_markup,
        choices=choices_dto,
        group_context=group_dto,
        audio_url=audio_url,
        illustration_url=illustration_url,
        diagram_url=diagram_url,
        star_position=star_position,
        correct_order=correct_order,
        anchor_key=anchor_key,
        group_ordinal=group_ordinal,
        presented_at=item.presented_at,
        is_answered=item.is_answered,
        selected_choice_id=item.selected_choice_id,
        is_marked_for_review=item.is_marked_for_review,
        audio_play_count=item.audio_play_count,
        section_code=item.section_code,
        block_order=item.block_order,
        is_correct=is_correct,
        canonical_choice_id=canonical_choice_id,
        canonical_choice_key=canonical_choice_key,
        difficulty_rating=None,
        explanation_markup=explanation_markup,
        is_bookmarked=is_bookmarked,
    )

