"""
Enumerations and Status Types for Kiroku Study Bank Ingestion Pipeline.
-----------------------------------------------------------------------
Defines adapters, pipeline processing stages, review statuses, and review reason codes.
"""
from __future__ import annotations

from enum import Enum


class IngestAdapterKind(str, Enum):
    """Supported input source adapters for question ingestion."""
    PASTED_TEXT = "pasted_text"
    STRUCTURED_JSON = "structured_json"
    PDF_TEXT = "pdf_text"
    SCANNED_IMAGE = "scanned_image"
    AUDIO = "audio"


class StageStatus(str, Enum):
    """Lifecycle stage statuses for document and question candidate processing."""
    RECEIVED = "received"
    EXTRACTED = "extracted"
    SEGMENTED = "segmented"
    CLASSIFIED = "classified"
    ASSOCIATED = "associated"
    NORMALIZED = "normalized"
    VALIDATED = "validated"
    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"
    PERSISTED = "persisted"
    FAILED = "failed"


class ReviewStatus(str, Enum):
    """Human review decision states for question candidates and import items."""
    PENDING = "pending"
    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class ReviewReasonCode(str, Enum):
    """Structured reason codes explaining why a candidate requires human review."""
    UNCERTAIN_CLASSIFICATION = "UNCERTAIN_CLASSIFICATION"
    MISSING_ANSWER_KEY = "MISSING_ANSWER_KEY"
    INCOMPLETE_CHOICES = "INCOMPLETE_CHOICES"
    INVALID_CHOICE_COUNT = "INVALID_CHOICE_COUNT"
    MALFORMED_MARKUP = "MALFORMED_MARKUP"
    ORPHAN_ANCHOR = "ORPHAN_ANCHOR"
    REQUIRED_ASSET_MISSING = "REQUIRED_ASSET_MISSING"
    LOW_EXTRACTION_CONFIDENCE = "LOW_EXTRACTION_CONFIDENCE"
    CONFLICTING_SOURCE_ANSWER = "CONFLICTING_SOURCE_ANSWER"
    F2_PERMUTATION_INVALID = "F2_PERMUTATION_INVALID"
    UNRESOLVED_GROUP_ASSOCIATION = "UNRESOLVED_GROUP_ASSOCIATION"
    MANUAL_CORRECTION_REQUIRED = "MANUAL_CORRECTION_REQUIRED"

