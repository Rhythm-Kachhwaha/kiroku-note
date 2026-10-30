"""
Human Review and Candidate Correction Service.
----------------------------------------------
Provides the backend operational foundation for inspecting, editing,
approving, and rejecting question candidates before database persistence.
"""
from __future__ import annotations

from typing import Any

from app.study.contracts.enums import AnswerOrigin, ChoiceMode, StructuralFamily
from app.study.ingestion.enums import ReviewReasonCode, ReviewStatus
from app.study.ingestion.models import (
    CandidateClassification,
    CandidateQuestion,
    ChoiceDraft,
)
from app.study.ingestion.normalization.normalizer import ContractNormalizer
from app.study.ingestion.validation.validator import DeterministicValidator


class ReviewService:
    """Backend service for human review, correction, and approval workflows."""

    def __init__(self) -> None:
        self._normalizer = ContractNormalizer()
        self._validator = DeterministicValidator()

    def filter_candidates(
        self,
        candidates: list[CandidateQuestion],
        status: ReviewStatus | None = None,
        reason_code: ReviewReasonCode | None = None,
    ) -> list[CandidateQuestion]:
        """Filter candidates by review status or specific review reason code."""
        filtered = candidates
        if status is not None:
            filtered = [c for c in filtered if c.review_status == status]
        if reason_code is not None:
            filtered = [c for c in filtered if reason_code in c.review_reasons]
        return filtered

    def approve_candidate(self, candidate: CandidateQuestion, notes: str = "") -> CandidateQuestion:
        """
        Explicitly approve a question candidate for persistence.
        Requires that candidate has no blocking structural errors.
        """
        # Re-run validation to confirm
        report = self._validator.validate_question(candidate)
        if not report.is_valid:
            error_msgs = "; ".join(e.message for e in report.errors)
            raise ValueError(f"Cannot approve structurally invalid question: {error_msgs}")

        candidate.review_status = ReviewStatus.APPROVED
        candidate.review_reasons = []
        if notes:
            candidate.review_notes = notes
        return candidate

    def reject_candidate(self, candidate: CandidateQuestion, reason: str = "") -> CandidateQuestion:
        """Explicitly reject a question candidate from the question bank."""
        candidate.review_status = ReviewStatus.REJECTED
        if reason:
            candidate.review_notes = f"Rejected: {reason}"
        return candidate

    def approve_all_valid(self, candidates: list[CandidateQuestion]) -> int:
        """Approve all structurally valid candidates in a batch."""
        count = 0
        for c in candidates:
            # Revalidate
            report = self._validator.validate_question(c)
            if report.is_valid:
                c.review_status = ReviewStatus.APPROVED
                c.review_reasons = []
                count += 1
        return count

    def update_candidate(
        self,
        candidate: CandidateQuestion,
        stem: str | None = None,
        choices: list[ChoiceDraft] | None = None,
        answer_key: str | int | None = None,
        classification: CandidateClassification | None = None,
    ) -> CandidateQuestion:
        """
        Apply human corrections to a candidate, re-normalizing and re-validating it.
        """
        draft = candidate.draft

        if stem is not None:
            draft.raw_stem = stem
        if choices is not None:
            draft.raw_choices = choices
        if answer_key is not None:
            draft.source_answer_key = answer_key

        cls_to_use = classification or candidate.classification
        if not cls_to_use:
            raise ValueError("Candidate lacks classification; cannot normalize.")

        # Re-normalize into contract
        updated_candidate = self._normalizer.normalize_question(draft, cls_to_use)
        # Re-validate
        self._validator.validate_question(updated_candidate)

        # Preserve candidate ID and existing review notes
        updated_candidate.candidate_id = candidate.candidate_id
        updated_candidate.review_notes = candidate.review_notes

        return updated_candidate

