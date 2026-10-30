"""
Normalization Subsystem for JLPT Question Ingestion.
----------------------------------------------------
Transforms raw question and group drafts into fully typed M2 contracts:
- F1QuestionPayload through F6QuestionPayload
- ContentGroupPayload
- ChoicePayload, AnswerPayload, AssetRefPayload
Normalizes inline markup via app.study.markup parser and AST.
"""
from __future__ import annotations

import re
from typing import Any

from app.study.contracts.common import (
    AnswerPayload,
    AssetRefPayload,
    ChoicePayload,
    ContentGroupPayload,
    GroupAnchorPayload,
    GroupAssetRefPayload,
    GroupPartPayload,
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
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    parse_question_payload,
)
from app.study.ingestion.enums import ReviewReasonCode, ReviewStatus
from app.study.ingestion.models import (
    CandidateClassification,
    CandidateGroup,
    CandidateQuestion,
    GroupDraft,
    QuestionDraft,
)
from app.study.markup import parse_markup, to_markup
from app.study.markup.errors import MarkupError
from app.study.ulid import generate_ulid


class ContractNormalizer:
    """Normalizes candidate drafts into authoritative M2 Pydantic contracts."""

    def normalize_question(
        self,
        draft: QuestionDraft,
        classification: CandidateClassification,
        group_candidate: CandidateGroup | None = None,
    ) -> CandidateQuestion:
        """
        Normalize a QuestionDraft and classification into a CandidateQuestion.
        """
        review_reasons: list[ReviewReasonCode] = []
        family = classification.structural_family

        # Check classification confidence
        if classification.confidence < 0.8:
            review_reasons.append(ReviewReasonCode.UNCERTAIN_CLASSIFICATION)

        # 1. Normalize prompt/stem markup
        normalized_stem = self._clean_and_validate_markup(draft.raw_stem, review_reasons)

        # 2. Normalize choices
        normalized_choices = self._normalize_choices(draft, review_reasons)

        # 3. Normalize answer
        normalized_answer = self._normalize_answer(draft, normalized_choices, family, review_reasons)

        # 4. Construct family-specific contract dict
        contract_dict: dict[str, Any] = {
            "external_id": generate_ulid(),
            "format_code": classification.format_code,
            "structural_family": family.value,
            "level": classification.level.value,
            "category": classification.category.value,
            "prompt_markup": normalized_stem,
            "instruction_text": draft.instruction_text,
            "status": QuestionStatus.DRAFT.value,
            "validation_status": ValidationStatus.VALID.value,
            "choices": [c.model_dump() for c in normalized_choices],
            "answer": normalized_answer.model_dump() if normalized_answer else None,
            "metadata": {
                "source_line": draft.line_number,
                "source_page": draft.page_number,
                "classification_reasoning": classification.reasoning,
                "classification_confidence": classification.confidence,
                "raw_source_text": draft.raw_source_text,
            },
        }

        # Family-specific fields
        if family == StructuralFamily.F1:
            if classification.format_code in ("kanji_reading", "orthography", "word_formation", "paraphrases"):
                if "{u|" not in normalized_stem and "{blank|" not in normalized_stem:
                    m = re.match(r"【(.*?)】\s*(.+)", normalized_stem)
                    if m:
                        ctx, target = m.group(1), m.group(2).strip()
                        if target in ctx:
                            normalized_stem = f"【{ctx.replace(target, f'{{u|{target}}}', 1)}】"
                        else:
                            normalized_stem = f"【{ctx}】 {{u|{target}}}"
                    else:
                        target = ""
                        if draft.source_answer_rationale:
                            rat = draft.source_answer_rationale.strip()
                            if "=>" in rat:
                                target = rat.split("=>")[0].strip()
                            elif ":" in rat:
                                target = rat.split(":")[0].strip()
                        if target and target in normalized_stem:
                            idx = normalized_stem.rfind(target)
                            normalized_stem = (
                                normalized_stem[:idx]
                                + f"{{u|{target}}}"
                                + normalized_stem[idx + len(target):]
                            )
                        else:
                            normalized_stem = f"{{u|{normalized_stem}}}"
                    contract_dict["prompt_markup"] = normalized_stem

        elif family == StructuralFamily.F2:
            # Sentence composition
            contract_dict["star_position"] = 3
            contract_dict["fragment_order"] = None
            contract_dict["strict_whole_order_grading"] = False
            # Check for star in stem
            if "{star}" not in normalized_stem:
                if "★" in normalized_stem or "☆" in normalized_stem:
                    normalized_stem = normalized_stem.replace("★", "{star}").replace("☆", "{star}")
                else:
                    normalized_stem = f"{normalized_stem} {{star}}"
                contract_dict["prompt_markup"] = normalized_stem

        elif family in (StructuralFamily.F3, StructuralFamily.F4, StructuralFamily.F6):
            if group_candidate:
                contract_dict["content_group_id"] = 1  # Placeholder ID for relational validation
                contract_dict["group_ordinal"] = draft.group_ordinal or 1
            if family == StructuralFamily.F4:
                anchor_key = draft.anchor_key or "1"
                contract_dict["anchor_key"] = anchor_key
                # Ensure blank anchor exists in stem or set default
                if "{blank|" not in normalized_stem:
                    normalized_stem = f"{{blank|{anchor_key}}} {normalized_stem}".strip()
                    contract_dict["prompt_markup"] = normalized_stem

        elif family == StructuralFamily.F5:
            # Listening question audio
            audio_att = next((a for a in draft.attached_assets if a.get("role") == "audio" or a.get("kind") == "audio"), None)
            if audio_att:
                a_sha = audio_att.get("sha256") or (audio_att.get("asset_id") if isinstance(audio_att.get("asset_id"), str) and len(str(audio_att.get("asset_id"))) == 64 else "e" * 64)
                contract_dict["audio_asset"] = {
                    "role": AssetRole.AUDIO.value,
                    "asset_id": audio_att.get("asset_id") if isinstance(audio_att.get("asset_id"), int) else 1,
                    "sha256": a_sha,
                    "is_required": True,
                }
            else:
                review_reasons.append(ReviewReasonCode.REQUIRED_ASSET_MISSING)

            # Diagram or illustration attachments
            diagram_atts = [a for a in draft.attached_assets if a.get("role") in ("diagram", "illustration") or a.get("kind") in ("diagram", "illustration")]
            if diagram_atts:
                contract_dict.setdefault("assets", [])
                for idx, da in enumerate(diagram_atts, start=1):
                    da_sha = da.get("sha256") or (da.get("asset_id") if isinstance(da.get("asset_id"), str) and len(str(da.get("asset_id"))) == 64 else "e" * 64)
                    role_str = da.get("role") or da.get("kind") or "diagram"
                    role_enum = AssetRole.DIAGRAM if role_str == "diagram" else AssetRole.ILLUSTRATION
                    contract_dict["assets"].append({
                        "role": role_enum.value,
                        "asset_id": da.get("asset_id") if isinstance(da.get("asset_id"), int) else 1,
                        "sha256": da_sha,
                        "ordinal": idx,
                        "is_required": True,
                    })

        # 5. Parse contract via Pydantic
        payload: AnyQuestionPayload | None = None
        try:
            payload = parse_question_payload(contract_dict)
        except Exception as exc:
            review_reasons.append(ReviewReasonCode.MANUAL_CORRECTION_REQUIRED)

        review_status = ReviewStatus.NEEDS_REVIEW if review_reasons else ReviewStatus.PENDING

        return CandidateQuestion(
            candidate_id=draft.draft_id,
            draft=draft,
            classification=classification,
            payload=payload,
            validation=None,
            review_status=review_status,
            review_reasons=review_reasons,
            review_notes="",
        )

    def normalize_group(
        self,
        draft: GroupDraft,
        level: JlptLevel,
    ) -> CandidateGroup:
        """
        Normalize a GroupDraft into a CandidateGroup with ContentGroupPayload.
        """
        # Group parts
        parts: list[GroupPartPayload] = []
        for idx, p in enumerate(draft.parts, start=1):
            parts.append(
                GroupPartPayload(
                    ordinal=p.get("ordinal", idx),
                    role=GroupPartRole(p.get("role", "text")),
                    markup=p.get("markup", draft.raw_body),
                    title=p.get("title", ""),
                )
            )

        if not parts:
            parts.append(
                GroupPartPayload(
                    ordinal=1,
                    role=GroupPartRole.TEXT,
                    markup=draft.raw_body,
                    title=draft.title,
                )
            )

        # Group anchors
        anchors: list[GroupAnchorPayload] = []
        for idx, a in enumerate(draft.anchors, start=1):
            anchors.append(
                GroupAnchorPayload(
                    ordinal=a.get("ordinal", idx),
                    anchor_key=str(a.get("anchor_key", idx)),
                    kind=a.get("kind", "blank"),
                    part_ordinal=a.get("part_ordinal", 1),
                )
            )

        # Group assets
        assets: list[GroupAssetRefPayload] = []
        for idx, att in enumerate(draft.attached_assets, start=1):
            role_str = att.get("role") or att.get("kind") or "diagram"
            role_val = AssetRole(role_str) if role_str in [r.value for r in AssetRole] else AssetRole.DIAGRAM
            g_sha = att.get("sha256") or (att.get("asset_id") if isinstance(att.get("asset_id"), str) and len(str(att.get("asset_id"))) == 64 else "e" * 64)
            assets.append(
                GroupAssetRefPayload(
                    role=role_val,
                    asset_id=att.get("asset_id") if isinstance(att.get("asset_id"), int) else 1,
                    sha256=g_sha,
                    ordinal=idx,
                    is_required=att.get("is_required", True),
                )
            )

        group_kind = GroupKind.PASSAGE
        try:
            group_kind = GroupKind(draft.group_type.lower())
        except ValueError:
            pass

        group_payload = ContentGroupPayload(
            external_id=generate_ulid(),
            kind=group_kind,
            level=level,
            parts=parts,
            anchors=anchors,
            assets=assets,
        )

        return CandidateGroup(
            candidate_id=draft.draft_id,
            draft=draft,
            payload=group_payload,
            level=level,
            validation=None,
            review_status=ReviewStatus.PENDING,
        )

    def _clean_and_validate_markup(self, text: str, review_reasons: list[ReviewReasonCode]) -> str:
        """Parse markup to validate AST and return canonical string."""
        if not text.strip():
            return ""

        # Convert raw bracket numbers like [ 25 ] or [25] to {blank|25} before parse_markup
        cleaned = re.sub(r"\[\s*([0-9０-９]+)\s*\]", r"{blank|\1}", text)

        # Convert bare {blank} without pipe to {blank|1}, {blank|2}, etc.
        if "{blank}" in cleaned:
            blank_idx = 1
            while "{blank}" in cleaned:
                cleaned = cleaned.replace("{blank}", f"{{blank|{blank_idx}}}", 1)
                blank_idx += 1

        # Convert raw underscore blanks (3 or more) to {blank|...}
        if re.search(r"_{3,}|＿{3,}", cleaned):
            und_idx = 1
            while re.search(r"_{3,}|＿{3,}", cleaned):
                cleaned = re.sub(r"_{3,}|＿{3,}", f"{{blank|{und_idx}}}", cleaned, count=1)
                und_idx += 1

        try:
            ast = parse_markup(cleaned)
            return to_markup(ast)
        except MarkupError:
            # If markup syntax error occurs, keep raw text and flag for review
            review_reasons.append(ReviewReasonCode.MALFORMED_MARKUP)
            return text

    def _normalize_choices(
        self,
        draft: QuestionDraft,
        review_reasons: list[ReviewReasonCode],
    ) -> list[ChoicePayload]:
        """Normalize raw choices into validated ChoicePayload list."""
        if not draft.raw_choices:
            review_reasons.append(ReviewReasonCode.INCOMPLETE_CHOICES)
            return []

        choices: list[ChoicePayload] = []
        seen_ordinals: set[int] = set()

        for idx, c in enumerate(draft.raw_choices, start=1):
            ord_val = c.ordinal or idx
            if ord_val in seen_ordinals:
                review_reasons.append(ReviewReasonCode.INVALID_CHOICE_COUNT)
            seen_ordinals.add(ord_val)

            c_key = f"c_{draft.draft_id}_{ord_val}"
            cleaned_text = self._clean_and_validate_markup(c.text, review_reasons)

            choices.append(
                ChoicePayload(
                    choice_key=c_key,
                    label=c.label or str(ord_val),
                    ordinal=ord_val,
                    text_markup=cleaned_text if c.mode == ChoiceMode.TEXT else None,
                    mode=c.mode,
                    asset_id=c.asset_id,
                    asset_sha256=c.asset_sha256,
                )
            )

        return sorted(choices, key=lambda c: c.ordinal)

    def _normalize_answer(
        self,
        draft: QuestionDraft,
        choices: list[ChoicePayload],
        family: StructuralFamily,
        review_reasons: list[ReviewReasonCode],
    ) -> AnswerPayload | None:
        """Resolve answer payload from source answer key or derived star."""
        if draft.source_answer_key is None:
            # Incomplete questions are valid as candidates, but marked for review
            review_reasons.append(ReviewReasonCode.MISSING_ANSWER_KEY)
            return None

        key_str = str(draft.source_answer_key).strip()

        # Find matching choice
        matched_choice: ChoicePayload | None = None
        for c in choices:
            if str(c.ordinal) == key_str or c.label == key_str or c.choice_key == key_str:
                matched_choice = c
                break

        if not matched_choice:
            # Could not match answer key to a choice
            review_reasons.append(ReviewReasonCode.MISSING_ANSWER_KEY)
            return None

        origin = (
            AnswerOrigin.SOURCE_DERIVED
            if family == StructuralFamily.F2
            else AnswerOrigin.SOURCE_EXPLICIT
        )

        raw_rationale = (draft.source_answer_rationale or "").strip()
        safe_rationale = ""
        if raw_rationale:
            try:
                parse_markup(raw_rationale)
                safe_rationale = raw_rationale
            except Exception:
                clean = re.sub(r"<\s*[/!]?[a-zA-Z][^>]*>", "", raw_rationale)
                escaped = "".join(f"\\{ch}" if ch in ("[", "]", "{", "}") else ch for ch in clean)
                try:
                    parse_markup(escaped)
                    safe_rationale = escaped
                except Exception:
                    safe_rationale = ""

        return AnswerPayload(
            choice_key=matched_choice.choice_key,
            answer_origin=origin,
            rationale_markup=safe_rationale,
        )
