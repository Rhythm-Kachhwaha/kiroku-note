"""
Enums for JLPT Examination Simulation Subsystem.
------------------------------------------------
Defines enumeration types for exam section statuses, blueprint evidence levels,
readiness statuses, pass/fail assessments, and threshold statuses.
"""
from __future__ import annotations

from enum import Enum


class ExamSectionStatus(str, Enum):
    """Lifecycle states of an individual test section within an examination attempt."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    EXPIRED = "expired"


class BlueprintEvidenceLevel(str, Enum):
    """
    Categorizes the evidentiary provenance of blueprint question counts and structures.
    Distinguishes official test guidelines, verified past papers, and configurable estimates.
    """
    OFFICIALLY_DOCUMENTED = "officially_documented"
    VERIFIED_PAPERS = "verified_papers"
    CONFIGURABLE_ESTIMATE = "configurable_estimate"
    INFERRED = "inferred"


class ExamMode(str, Enum):
    """Execution mode of an examination attempt."""
    STRICT = "strict"
    RELAXED = "relaxed"


class ReadinessStatus(str, Enum):
    """Readiness evaluation outcomes for a question bank against an exam blueprint."""
    READY = "ready"
    INCOMPLETE_BANK = "incomplete_bank"
    BLOCKED = "blocked"


class PassFailAssessment(str, Enum):
    """Overall examination estimated assessment outcome."""
    PASSED_ESTIMATE = "passed_estimate"
    FAILED_ESTIMATE = "failed_estimate"
    INCOMPLETE = "incomplete"


class ThresholdStatus(str, Enum):
    """Comparison against an official or estimated pass threshold."""
    ABOVE_ESTIMATED_THRESHOLD = "above_estimated_threshold"
    BELOW_ESTIMATED_THRESHOLD = "below_estimated_threshold"
