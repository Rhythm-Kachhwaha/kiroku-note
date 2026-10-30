"""
Data Models and Contracts for Kiroku Study Bank Ingestion Pipeline.
-------------------------------------------------------------------
Represents input payloads, extraction results, structural drafts,
classification, candidate normalization, deterministic validation,
and persistence metadata.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.study.contracts.common import ContentGroupPayload
from app.study.contracts.enums import (
    ChoiceMode,
    JlptLevel,
    QuestionCategory,
    StructuralFamily,
)
from app.study.contracts.families import AnyQuestionPayload
from app.study.ingestion.enums import (
    IngestAdapterKind,
    ReviewReasonCode,
    ReviewStatus,
    StageStatus,
)


class IngestInput(BaseModel):
    """Raw input provided by user or calling process to the ingestion pipeline."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    adapter_kind: IngestAdapterKind
    content: str | bytes | dict[str, Any] | list[Any] | Path
    source_name: str
    source_type: str = "user_capture"
    license_or_permission: str = ""
    citation: str = ""
    url: str | None = None
    default_level: JlptLevel | None = None
    auto_approve: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExtractedPage(BaseModel):
    """Text and visual content extracted from a single document page."""
    page_number: int  # 1-based index
    text: str
    images: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float = 1.0


class ExtractedMediaAsset(BaseModel):
    """Media asset discovered or extracted during document processing."""
    asset_id: int | None = None
    sha256: str | None = None
    kind: str  # 'audio', 'illustration', 'diagram', 'document', 'choice_image'
    mime_type: str
    byte_size: int = 0
    relative_path: str | None = None
    data: bytes | None = None
    filename: str | None = None
    duration_ms: int | None = None
    pixel_width: int | None = None
    pixel_height: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExtractedDocument(BaseModel):
    """Unified document representation produced by any input adapter."""
    adapter_kind: IngestAdapterKind
    raw_text: str
    pages: list[ExtractedPage] = Field(default_factory=list)
    media_assets: list[ExtractedMediaAsset] = Field(default_factory=list)
    source_name: str
    source_type: str = "user_capture"
    license_or_permission: str = ""
    citation: str = ""
    url: str | None = None
    default_level: JlptLevel | None = None
    extraction_method: str = ""
    extraction_confidence: float = 1.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChoiceDraft(BaseModel):
    """Draft representation of a question choice parsed during segmentation."""
    ordinal: int
    label: str
    text: str = ""
    mode: ChoiceMode = ChoiceMode.TEXT
    asset_id: int | None = None
    asset_sha256: str | None = None


class QuestionDraft(BaseModel):
    """Intermediate segmented representation of a single question."""
    draft_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    section_header: str = ""
    instruction_text: str = ""
    raw_stem: str
    raw_choices: list[ChoiceDraft] = Field(default_factory=list)
    source_answer_key: str | int | None = None
    source_answer_rationale: str = ""
    group_reference: str | None = None
    group_ordinal: int | None = None
    anchor_key: str | None = None
    page_number: int | None = None
    line_number: int | None = None
    raw_source_text: str = ""
    attached_assets: list[dict[str, Any]] = Field(default_factory=list)


class GroupDraft(BaseModel):
    """Intermediate segmented representation of a shared passage or audio context."""
    draft_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    group_type: str = "passage"  # 'passage', 'integrated_passage', 'audio_context', 'document_set'
    title: str = ""
    raw_body: str = ""
    parts: list[dict[str, Any]] = Field(default_factory=list)
    anchors: list[dict[str, Any]] = Field(default_factory=list)
    page_number: int | None = None
    raw_source_text: str = ""
    attached_assets: list[dict[str, Any]] = Field(default_factory=list)


class CandidateClassification(BaseModel):
    """Format, family, and level classification determined for a question candidate."""
    format_code: str
    structural_family: StructuralFamily
    category: QuestionCategory
    level: JlptLevel
    confidence: float = 1.0
    reasoning: str = ""
    matched_rules: list[str] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    """Single diagnostic issue discovered during deterministic validation."""
    field: str
    code: str
    message: str
    severity: Literal["error", "warning", "info"] = "error"


class ValidationReport(BaseModel):
    """Aggregated validation output for a question candidate."""
    is_valid: bool
    errors: list[ValidationIssue] = Field(default_factory=list)
    warnings: list[ValidationIssue] = Field(default_factory=list)
    eligibility_codes: list[str] = Field(default_factory=list)


class CandidateQuestion(BaseModel):
    """Normalized question candidate undergoing validation, review, or persistence."""
    candidate_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    draft: QuestionDraft
    classification: CandidateClassification | None = None
    payload: AnyQuestionPayload | None = None
    validation: ValidationReport | None = None
    review_status: ReviewStatus = ReviewStatus.PENDING
    review_reasons: list[ReviewReasonCode] = Field(default_factory=list)
    review_notes: str = ""
    persisted_question_id: int | None = None
    persisted_revision_id: int | None = None


class CandidateGroup(BaseModel):
    """Normalized content group candidate undergoing validation, review, or persistence."""
    candidate_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    draft: GroupDraft
    payload: ContentGroupPayload | None = None
    level: JlptLevel | None = None
    validation: ValidationReport | None = None
    review_status: ReviewStatus = ReviewStatus.PENDING
    persisted_group_id: int | None = None
    persisted_revision_id: int | None = None


class IngestionResult(BaseModel):
    """Complete summary produced at the conclusion of an ingestion pipeline run."""
    batch_id: int | None = None
    source_id: int | None = None
    status: StageStatus
    questions: list[CandidateQuestion] = Field(default_factory=list)
    groups: list[CandidateGroup] = Field(default_factory=list)
    total_questions: int = 0
    approved_questions: int = 0
    needs_review_questions: int = 0
    persisted_questions: int = 0
    failed_questions: int = 0
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

