"""
Deterministic Validator for Question Candidates.
------------------------------------------------
Validates question and group candidates against:
- Authoritative format registry constraints (FORMAT_REGISTRY)
- Pydantic contract rules for families F1–F6
- Inline Japanese markup syntax (app.study.markup)
- Anchor consistency for F4 text grammar
- Eligibility evaluation reason codes (app.study.eligibility)
"""
from __future__ import annotations

from typing import Any

from app.study.contracts.enums import StructuralFamily, ValidationStatus
from app.study.contracts.families import (
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
)
from app.study.eligibility import (
    REASON_ANSWER_CONFLICT,
    REASON_GROUP_INCONSISTENT,
    REASON_NO_ANSWER,
    REASON_REQUIRED_ASSET_MISSING,
    REASON_VALIDATION_FAILED,
)
from app.study.formats import (
    FORMAT_REGISTRY,
    FormatError,
    validate_format_compatibility,
)
from app.study.ingestion.enums import ReviewReasonCode, ReviewStatus
from app.study.ingestion.models import (
    CandidateGroup,
    CandidateQuestion,
    ValidationIssue,
    ValidationReport,
)
from app.study.markup import parse_markup
from app.study.markup.errors import MarkupError


class DeterministicValidator:
    """Validates candidate questions and evaluates question bank eligibility."""

    def validate_question(
        self,
        candidate: CandidateQuestion,
        group_candidate: CandidateGroup | None = None,
    ) -> ValidationReport:
        """
        Validate a CandidateQuestion and produce a ValidationReport.
        """
        errors: list[ValidationIssue] = []
        warnings: list[ValidationIssue] = []
        eligibility_codes: list[str] = []

        cls_info = candidate.classification
        payload = candidate.payload

        if not cls_info:
            errors.append(
                ValidationIssue(
                    field="classification",
                    code="MISSING_CLASSIFICATION",
                    message="Question has not been classified.",
                    severity="error",
                )
            )
            return ValidationReport(is_valid=False, errors=errors, warnings=warnings, eligibility_codes=[REASON_VALIDATION_FAILED])

        # 1. Format Registry & Choice Count Validation
        format_code = cls_info.format_code
        choice_count = len(candidate.draft.raw_choices)
        try:
            validate_format_compatibility(
                format_code=format_code,
                family=cls_info.structural_family.value,
                level=cls_info.level.value,
                choice_count=choice_count,
            )
        except FormatError as exc:
            errors.append(
                ValidationIssue(
                    field="format_code",
                    code="FORMAT_INCOMPATIBLE",
                    message=str(exc),
                    severity="error",
                )
            )

        # 2. Markup Syntax Validation
        prompt_markup = (
            getattr(payload, "stem_markup", None)
            or getattr(payload, "prompt_markup", None)
            or candidate.draft.raw_stem
        )
        try:
            parse_markup(prompt_markup)
        except MarkupError as exc:
            errors.append(
                ValidationIssue(
                    field="prompt_markup",
                    code="MARKUP_SYNTAX_ERROR",
                    message=f"Prompt markup syntax error: {exc}",
                    severity="error",
                )
            )

        choices_to_validate = payload.choices if payload is not None else candidate.draft.raw_choices
        for c in choices_to_validate:
            c_text = getattr(c, "text_markup", None) or getattr(c, "text", "")
            if c_text:
                try:
                    parse_markup(c_text)
                except MarkupError as exc:
                    errors.append(
                        ValidationIssue(
                            field=f"choices[{c.ordinal}].text_markup",
                            code="MARKUP_SYNTAX_ERROR",
                            message=f"Choice {c.ordinal} markup syntax error: {exc}",
                            severity="error",
                        )
                    )

        # 3. Payload Integrity
        if payload is None:
            errors.append(
                ValidationIssue(
                    field="payload",
                    code="CONTRACT_PAYLOAD_MISSING",
                    message="Could not construct valid M2 contract payload from draft.",
                    severity="error",
                )
            )
            eligibility_codes.append(REASON_VALIDATION_FAILED)
        else:
            # Answer checks
            if payload.answer is None:
                warnings.append(
                    ValidationIssue(
                        field="answer",
                        code="MISSING_ANSWER_KEY",
                        message="Question has no source answer key. Incomplete candidate.",
                        severity="warning",
                    )
                )
                eligibility_codes.append(REASON_NO_ANSWER)
            else:
                # Choice key match
                valid_choice_keys = {c.choice_key for c in payload.choices}
                if payload.answer.choice_key not in valid_choice_keys:
                    errors.append(
                        ValidationIssue(
                            field="answer.choice_key",
                            code="ORPHAN_ANSWER_KEY",
                            message=f"Answer references unknown choice key '{payload.answer.choice_key}'.",
                            severity="error",
                        )
                    )

            # Family-specific structural checks
            if isinstance(payload, F2QuestionPayload):
                if "{star}" not in payload.stem_markup:
                    errors.append(
                        ValidationIssue(
                            field="stem_markup",
                            code="F2_MISSING_STAR",
                            message="F2 sentence composition requires exactly one {star} in prompt markup.",
                            severity="error",
                        )
                    )
                if payload.fragment_order is not None:
                    if len(payload.fragment_order) != 4 or set(payload.fragment_order) != {1, 2, 3, 4}:
                        errors.append(
                            ValidationIssue(
                                field="fragment_order",
                                code="F2_INVALID_PERMUTATION",
                                message="F2 fragment order must be a valid permutation of [1, 2, 3, 4].",
                                severity="error",
                            )
                        )

            elif isinstance(payload, F4QuestionPayload):
                if not payload.anchor_key:
                    errors.append(
                        ValidationIssue(
                            field="anchor_key",
                            code="F4_MISSING_ANCHOR",
                            message="F4 text grammar question must specify an anchor_key.",
                            severity="error",
                        )
                    )
                elif group_candidate and group_candidate.payload:
                    group_anchors = {a.anchor_key for a in group_candidate.payload.anchors}
                    if payload.anchor_key not in group_anchors:
                        warnings.append(
                            ValidationIssue(
                                field="anchor_key",
                                code="ORPHAN_GROUP_ANCHOR",
                                message=f"Anchor '{payload.anchor_key}' not found in passage anchors {group_anchors}.",
                                severity="warning",
                            )
                        )
                        eligibility_codes.append(REASON_GROUP_INCONSISTENT)

            elif isinstance(payload, F5QuestionPayload):
                if not payload.audio_asset:
                    warnings.append(
                        ValidationIssue(
                            field="audio_asset",
                            code="F5_MISSING_AUDIO",
                            message="F5 listening question does not have an audio asset attached.",
                            severity="warning",
                        )
                    )
                    eligibility_codes.append(REASON_REQUIRED_ASSET_MISSING)

        is_valid = len(errors) == 0

        # Sync review status
        if not is_valid:
            candidate.review_status = ReviewStatus.NEEDS_REVIEW
            if REASON_VALIDATION_FAILED not in eligibility_codes:
                eligibility_codes.append(REASON_VALIDATION_FAILED)
        elif candidate.review_reasons:
            candidate.review_status = ReviewStatus.NEEDS_REVIEW
        else:
            candidate.review_status = ReviewStatus.APPROVED

        report = ValidationReport(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            eligibility_codes=eligibility_codes,
        )
        candidate.validation = report
        return report

    def validate_group(self, group_candidate: CandidateGroup) -> ValidationReport:
        """Validate a CandidateGroup."""
        errors: list[ValidationIssue] = []
        warnings: list[ValidationIssue] = []

        payload = group_candidate.payload
        if not payload:
            errors.append(
                ValidationIssue(
                    field="payload",
                    code="GROUP_PAYLOAD_MISSING",
                    message="Group payload could not be constructed.",
                    severity="error",
                )
            )
            return ValidationReport(is_valid=False, errors=errors, warnings=warnings)

        if not payload.parts:
            errors.append(
                ValidationIssue(
                    field="parts",
                    code="GROUP_EMPTY_PARTS",
                    message="Content group must contain at least one part.",
                    severity="error",
                )
            )

        for p in payload.parts:
            if p.markup:
                try:
                    parse_markup(p.markup)
                except MarkupError as exc:
                    warnings.append(
                        ValidationIssue(
                            field=f"parts[{p.ordinal}].markup",
                            code="MARKUP_SYNTAX_WARNING",
                            message=f"Group part {p.ordinal} markup syntax issue: {exc}",
                            severity="warning",
                        )
                    )

        is_valid = len(errors) == 0
        group_candidate.review_status = ReviewStatus.APPROVED if is_valid else ReviewStatus.NEEDS_REVIEW
        report = ValidationReport(is_valid=is_valid, errors=errors, warnings=warnings)
        group_candidate.validation = report
        return report

