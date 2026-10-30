"""
Asset and Content Group Associator.
-----------------------------------
Associates questions with their parent content groups (passages, audio contexts),
resolves text grammar blank anchors, and links binary media assets.
"""
from __future__ import annotations

from typing import Any

from app.study.contracts.enums import StructuralFamily
from app.study.ingestion.enums import ReviewReasonCode
from app.study.ingestion.models import (
    CandidateClassification,
    ExtractedDocument,
    ExtractedMediaAsset,
    GroupDraft,
    QuestionDraft,
)


class AssetAndGroupAssociator:
    """Associates questions with content groups, anchors, and media assets."""

    def associate(
        self,
        questions: list[QuestionDraft],
        groups: list[GroupDraft],
        doc: ExtractedDocument,
        classifications: dict[str, CandidateClassification],
    ) -> list[ReviewReasonCode]:
        """
        Perform all relational associations between questions, groups, anchors, and assets.

        Returns:
            list of system-level review reasons flagged during association.
        """
        review_reasons: list[ReviewReasonCode] = []
        group_map: dict[str, GroupDraft] = {g.draft_id: g for g in groups}

        # 1. Group Ordinal Resolution & Anchor Cross-Validation
        for g_id, group in group_map.items():
            group_questions = [q for q in questions if q.group_reference == g_id]
            # Sort group questions by line number or explicit group_ordinal
            group_questions.sort(key=lambda q: (q.group_ordinal or 0, q.line_number or 0))

            for idx, q in enumerate(group_questions, start=1):
                if q.group_ordinal is None:
                    q.group_ordinal = idx

            # If this is F4 text grammar, validate anchors
            is_f4_group = any(
                classifications.get(q.draft_id) and classifications[q.draft_id].structural_family == StructuralFamily.F4
                for q in group_questions
            )
            if is_f4_group:
                group_anchor_keys = {str(a["anchor_key"]) for a in group.anchors if "anchor_key" in a}
                q_anchor_keys = {str(q.anchor_key) for q in group_questions if q.anchor_key}

                # Missing or mismatched anchors
                missing_in_questions = group_anchor_keys - q_anchor_keys
                missing_in_group = q_anchor_keys - group_anchor_keys

                if missing_in_questions or missing_in_group:
                    review_reasons.append(ReviewReasonCode.ORPHAN_ANCHOR)

        # 2. Media Asset Association
        audio_assets = [a for a in doc.media_assets if a.kind == "audio"]
        image_assets = [a for a in doc.media_assets if a.kind in ("illustration", "diagram")]

        # Audio association
        if audio_assets:
            primary_audio = audio_assets[0]
            for q in questions:
                cls_info = classifications.get(q.draft_id)
                if cls_info and cls_info.structural_family == StructuralFamily.F5:
                    if not q.attached_assets:
                        q.attached_assets.append({
                            "role": "audio",
                            "asset_id": primary_audio.asset_id,
                            "sha256": primary_audio.sha256,
                            "filename": primary_audio.filename,
                            "is_required": True,
                        })

            for g in groups:
                if g.group_type == "audio_context":
                    if not g.attached_assets:
                        g.attached_assets.append({
                            "role": "audio",
                            "asset_id": primary_audio.asset_id,
                            "sha256": primary_audio.sha256,
                            "filename": primary_audio.filename,
                            "is_required": True,
                        })

        # Image association (if single image matches page or question)
        if len(image_assets) == 1 and len(questions) == 1:
            q = questions[0]
            if not q.attached_assets:
                q.attached_assets.append({
                    "role": "illustration",
                    "asset_id": image_assets[0].asset_id,
                    "sha256": image_assets[0].sha256,
                    "filename": image_assets[0].filename,
                    "is_required": True,
                })

        return review_reasons

