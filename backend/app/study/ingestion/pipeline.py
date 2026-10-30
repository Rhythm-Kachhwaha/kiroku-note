"""
Deterministic Question Ingestion Pipeline Orchestrator.
-------------------------------------------------------
Executes the full pipeline sequence:
Input → Extraction → Segmentation → Classification → Association → Normalization → Deterministic Validation → Persistence

Guarantees 100% deterministic operation with zero AI/LLM dependencies.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from app.study.ingestion.adapters import (
    AudioInputAdapter,
    BaseInputAdapter,
    PastedTextInputAdapter,
    PdfTextInputAdapter,
    ScannedImageInputAdapter,
    StructuredJsonInputAdapter,
)
from app.study.ingestion.association.associator import AssetAndGroupAssociator
from app.study.ingestion.classification.classifier import FormatClassifier
from app.study.ingestion.enums import (
    IngestAdapterKind,
    ReviewStatus,
    StageStatus,
)
from app.study.ingestion.models import (
    CandidateClassification,
    CandidateGroup,
    CandidateQuestion,
    ExtractedDocument,
    IngestInput,
    IngestionResult,
)
from app.study.ingestion.normalization.normalizer import ContractNormalizer
from app.study.ingestion.persistence import PersistenceService
from app.study.ingestion.review import ReviewService
from app.study.ingestion.segmentation.parser import TextSegmenter
from app.study.ingestion.validation.validator import DeterministicValidator
from app.study.media import MediaStore


class IngestionPipeline:
    """The central orchestrator for deterministic question ingestion."""

    def __init__(
        self,
        media_store: MediaStore | None = None,
        segmenter: TextSegmenter | None = None,
        classifier: FormatClassifier | None = None,
        associator: AssetAndGroupAssociator | None = None,
        normalizer: ContractNormalizer | None = None,
        validator: DeterministicValidator | None = None,
        persistence: PersistenceService | None = None,
        review_service: ReviewService | None = None,
    ) -> None:
        self._media_store = media_store
        self._segmenter = segmenter or TextSegmenter()
        self._classifier = classifier or FormatClassifier()
        self._associator = associator or AssetAndGroupAssociator()
        self._normalizer = normalizer or ContractNormalizer()
        self._validator = validator or DeterministicValidator()
        self._persistence = persistence or PersistenceService()
        self._review_service = review_service or ReviewService()

        # Initialize adapters
        self._adapters: dict[IngestAdapterKind, BaseInputAdapter] = {
            IngestAdapterKind.PASTED_TEXT: PastedTextInputAdapter(),
            IngestAdapterKind.STRUCTURED_JSON: StructuredJsonInputAdapter(),
            IngestAdapterKind.PDF_TEXT: PdfTextInputAdapter(),
            IngestAdapterKind.SCANNED_IMAGE: ScannedImageInputAdapter(),
            IngestAdapterKind.AUDIO: AudioInputAdapter(media_store=self._media_store),
        }

    def register_adapter(self, kind: IngestAdapterKind, adapter: BaseInputAdapter) -> None:
        """Register a custom adapter for an input kind."""
        self._adapters[kind] = adapter

    def run(
        self,
        input_data: IngestInput,
        conn: sqlite3.Connection | None = None,
        persist: bool = False,
    ) -> IngestionResult:
        """
        Execute the ingestion pipeline on the provided input.

        Parameters:
            input_data: Raw input parameters and content.
            conn: Optional database connection for persistence.
            persist: Whether to immediately persist approved candidates to study.db.
        """
        errors: list[str] = []
        warnings: list[str] = []

        # ---------------------------------------------------------------------
        # 1. Extraction Stage
        # ---------------------------------------------------------------------
        adapter = self._adapters.get(input_data.adapter_kind)
        if not adapter:
            return IngestionResult(
                status=StageStatus.FAILED,
                errors=[f"Unsupported adapter kind: {input_data.adapter_kind}"],
            )

        try:
            doc = adapter.extract(input_data)
        except Exception as exc:
            return IngestionResult(
                status=StageStatus.FAILED,
                errors=[f"Extraction failed: {exc}"],
            )

        # ---------------------------------------------------------------------
        # 2. Segmentation Stage
        # ---------------------------------------------------------------------
        try:
            q_drafts, g_drafts = self._segmenter.segment(doc)
        except Exception as exc:
            return IngestionResult(
                status=StageStatus.FAILED,
                errors=[f"Segmentation failed: {exc}"],
            )

        if not q_drafts and not g_drafts:
            return IngestionResult(
                status=StageStatus.FAILED,
                errors=["No questions or passages could be segmented from document."],
            )

        # ---------------------------------------------------------------------
        # 3. Classification Stage
        # ---------------------------------------------------------------------
        classifications: dict[str, CandidateClassification] = {}
        for q_draft in q_drafts:
            # Check if linked group exists
            linked_group = next((g for g in g_drafts if g.draft_id == q_draft.group_reference), None)
            group_type = linked_group.group_type if linked_group else None
            has_audio = any(a.kind == "audio" for a in doc.media_assets)

            cls_result = self._classifier.classify(
                draft=q_draft,
                default_level=doc.default_level,
                has_audio=has_audio,
                group_type=group_type,
            )
            classifications[q_draft.draft_id] = cls_result

        # ---------------------------------------------------------------------
        # 4. Association Stage
        # ---------------------------------------------------------------------
        assoc_reasons = self._associator.associate(
            questions=q_drafts,
            groups=g_drafts,
            doc=doc,
            classifications=classifications,
        )

        # ---------------------------------------------------------------------
        # 5. Normalization Stage
        # ---------------------------------------------------------------------
        candidate_groups: list[CandidateGroup] = []
        for g_draft in g_drafts:
            # Find level from questions in group or default
            group_level = doc.default_level
            if group_level is None:
                first_q = next((q for q in q_drafts if q.group_reference == g_draft.draft_id), None)
                if first_q and first_q.draft_id in classifications:
                    group_level = classifications[first_q.draft_id].level
            group_cand = self._normalizer.normalize_group(g_draft, level=group_level or doc.default_level)
            candidate_groups.append(group_cand)

        group_map = {g.candidate_id: g for g in candidate_groups}

        candidate_questions: list[CandidateQuestion] = []
        for q_draft in q_drafts:
            cls_info = classifications[q_draft.draft_id]
            parent_group = group_map.get(q_draft.group_reference) if q_draft.group_reference else None
            q_cand = self._normalizer.normalize_question(
                draft=q_draft,
                classification=cls_info,
                group_candidate=parent_group,
            )
            # Add any association reasons to candidate
            for r in assoc_reasons:
                if r not in q_cand.review_reasons:
                    q_cand.review_reasons.append(r)
            candidate_questions.append(q_cand)

        # ---------------------------------------------------------------------
        # 6. Deterministic Validation Stage
        # ---------------------------------------------------------------------
        for g in candidate_groups:
            self._validator.validate_group(g)

        for q in candidate_questions:
            parent_group = group_map.get(q.draft.group_reference) if q.draft.group_reference else None
            self._validator.validate_question(q, group_candidate=parent_group)

        # ---------------------------------------------------------------------
        # 7. Auto-Approval / Human Review Check
        # ---------------------------------------------------------------------
        if input_data.auto_approve:
            self._review_service.approve_all_valid(candidate_questions)
            for g in candidate_groups:
                if g.validation and g.validation.is_valid:
                    g.review_status = ReviewStatus.APPROVED

        # ---------------------------------------------------------------------
        # 8. Persistence Stage (if requested)
        # ---------------------------------------------------------------------
        batch_id: int | None = None
        source_id: int | None = None
        persisted_count = 0

        if persist and conn is not None:
            try:
                source_id, batch_id = self._persistence.persist_batch(
                    conn=conn,
                    doc=doc,
                    questions=candidate_questions,
                    groups=candidate_groups,
                )
                persisted_count = sum(1 for q in candidate_questions if q.persisted_question_id is not None)
            except Exception as exc:
                errors.append(f"Persistence error: {exc}")

        # ---------------------------------------------------------------------
        # 9. Result Compilation
        # ---------------------------------------------------------------------
        approved_count = sum(1 for q in candidate_questions if q.review_status == ReviewStatus.APPROVED)
        needs_review_count = sum(1 for q in candidate_questions if q.review_status == ReviewStatus.NEEDS_REVIEW)
        failed_count = sum(1 for q in candidate_questions if q.review_status == ReviewStatus.REJECTED or q.payload is None)

        if errors:
            final_status = StageStatus.FAILED
        elif persist and persisted_count > 0:
            final_status = StageStatus.PERSISTED
        elif needs_review_count > 0:
            final_status = StageStatus.NEEDS_REVIEW
        elif approved_count > 0:
            final_status = StageStatus.APPROVED
        else:
            final_status = StageStatus.NORMALIZED

        return IngestionResult(
            batch_id=batch_id,
            source_id=source_id,
            status=final_status,
            questions=candidate_questions,
            groups=candidate_groups,
            total_questions=len(candidate_questions),
            approved_questions=approved_count,
            needs_review_questions=needs_review_count,
            persisted_questions=persisted_count,
            failed_questions=failed_count,
            errors=errors,
            warnings=warnings,
        )

