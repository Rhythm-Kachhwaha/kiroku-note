"""
Kiroku Study Bank Deterministic Question Ingestion Subsystem.
-------------------------------------------------------------
Provides a multi-adapter, deterministic ingestion pipeline:
Input → Extraction → Segmentation → Classification → Association → Normalization → Deterministic Validation → Persistence

Reuses M1 relational schema, immutability triggers, and M2 Pydantic family contracts (F1–F6).
Completely free of LLM or external AI dependencies.
"""
from __future__ import annotations

from app.study.ingestion.adapters import (
    AudioInputAdapter,
    BaseInputAdapter,
    PastedTextInputAdapter,
    PdfTextInputAdapter,
    ScannedImageInputAdapter,
    StructuredJsonInputAdapter,
)
from app.study.ingestion.association import AssetAndGroupAssociator
from app.study.ingestion.classification import FormatClassifier
from app.study.ingestion.enums import (
    IngestAdapterKind,
    ReviewReasonCode,
    ReviewStatus,
    StageStatus,
)
from app.study.ingestion.models import (
    CandidateClassification,
    CandidateGroup,
    CandidateQuestion,
    ChoiceDraft,
    ExtractedDocument,
    ExtractedMediaAsset,
    ExtractedPage,
    GroupDraft,
    IngestInput,
    IngestionResult,
    QuestionDraft,
    ValidationIssue,
    ValidationReport,
)
from app.study.ingestion.normalization import ContractNormalizer
from app.study.ingestion.persistence import PersistenceService
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.ingestion.review import ReviewService
from app.study.ingestion.segmentation import AnswerKeyParser, TextSegmenter

__all__ = [
    # Pipeline & Services
    "IngestionPipeline",
    "ReviewService",
    "PersistenceService",
    "DeterministicValidator",
    "ContractNormalizer",
    "AssetAndGroupAssociator",
    "FormatClassifier",
    "TextSegmenter",
    "AnswerKeyParser",
    # Adapters
    "BaseInputAdapter",
    "PastedTextInputAdapter",
    "StructuredJsonInputAdapter",
    "PdfTextInputAdapter",
    "ScannedImageInputAdapter",
    "AudioInputAdapter",
    # Models & Enums
    "IngestInput",
    "ExtractedDocument",
    "ExtractedPage",
    "ExtractedMediaAsset",
    "QuestionDraft",
    "GroupDraft",
    "ChoiceDraft",
    "CandidateClassification",
    "CandidateQuestion",
    "CandidateGroup",
    "ValidationReport",
    "ValidationIssue",
    "IngestionResult",
    "IngestAdapterKind",
    "StageStatus",
    "ReviewStatus",
    "ReviewReasonCode",
]

