"""
Pydantic Data Contract Models for JLPT Examination Subsystem.
-------------------------------------------------------------
Defines strictly typed models for blueprints, readiness reports, examination lifecycle,
section tracking, draft item states, scoring results, and examination analytics.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.study.exam.enums import (
    BlueprintEvidenceLevel,
    ExamSectionStatus,
    PassFailAssessment,
    ReadinessStatus,
    ThresholdStatus,
)
from app.study.session.models import (
    ChoicePresentation,
    GroupContextPresentation,
)


class ExamContractBase(BaseModel):
    """Base model with forbidden extra fields for exam subsystem contracts."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExamItemQuota(ExamContractBase):
    """Target quota for a specific format code within a test section."""
    format_code: str
    target_count: int = Field(gt=0)
    source_evidence: BlueprintEvidenceLevel
    description: str = ""


class ExamSectionBlueprint(ExamContractBase):
    """Configuration for an individual timed test section within an examination."""
    section_code: str
    label: str
    block_order: int = Field(gt=0)
    time_limit_minutes: int = Field(gt=0)
    categories: List[str]
    item_quotas: List[ExamItemQuota]


class ScoringSectionBlueprint(ExamContractBase):
    """Configuration for an official JLPT scoring section."""
    code: str
    label: str
    categories: List[str]
    max_score: int = Field(gt=0)
    pass_threshold: int = Field(gt=0)


class ExamBlueprint(ExamContractBase):
    """Authoritative, versioned specification for a full JLPT examination simulation."""
    level: str = Field(pattern=r"^N[1-5]$")
    version: str
    name: str
    test_sections: List[ExamSectionBlueprint]
    scoring_sections: List[ScoringSectionBlueprint]
    overall_max_score: int = Field(default=180, gt=0)
    overall_pass_threshold: int = Field(gt=0)


# -----------------------------------------------------------------------------
# Readiness Models
# -----------------------------------------------------------------------------

class FormatReadiness(ExamContractBase):
    """Readiness status for an individual format quota."""
    format_code: str
    category: str
    required_count: int
    available_count: int
    is_satisfied: bool
    missing_count: int


class SectionReadiness(ExamContractBase):
    """Readiness status for a test section."""
    section_code: str
    label: str
    block_order: int
    required_count: int
    available_count: int
    is_satisfied: bool
    formats: List[FormatReadiness]


class ExamReadinessReport(ExamContractBase):
    """Comprehensive readiness report validating bank readiness for an exam blueprint."""
    level: str
    blueprint_version: str
    is_ready: bool
    status: ReadinessStatus
    total_required: int
    total_available: int
    sections: List[SectionReadiness]
    blocked_reasons: List[str] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# Runtime State Models
# -----------------------------------------------------------------------------

class ExamSectionState(ExamContractBase):
    """Runtime timing and progress snapshot of a test section."""
    section_id: int
    section_code: str
    block_order: int
    label: str
    status: ExamSectionStatus
    allocated_time_seconds: int
    remaining_time_seconds: int
    started_at: Optional[str] = None
    deadline_at: Optional[str] = None
    paused_at: Optional[str] = None
    completed_at: Optional[str] = None
    total_elapsed_ms: int = 0


class ExamItemPresentation(ExamContractBase):
    """A single exam question prepared for presentation during testing or review."""
    attempt_item_id: int
    position: int
    section_code: str
    block_order: int
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    prompt_markup: str
    choices: List[ChoicePresentation] = Field(default_factory=list)
    group_context: Optional[GroupContextPresentation] = None
    presented_at: Optional[str] = None
    is_marked_for_review: bool = False
    is_answered: bool = False
    selected_choice_id: Optional[int] = None
    # Post-exam revelation fields (revealed only after exam completion)
    is_correct: Optional[bool] = None
    canonical_choice_id: Optional[int] = None
    canonical_choice_key: Optional[str] = None
    rationale_markup: Optional[str] = None


class ExamSessionState(ExamContractBase):
    """Comprehensive snapshot of an examination attempt."""
    session_id: int
    external_id: str
    level: str
    status: str
    blueprint_version: str
    total_questions: int
    answered_count: int
    marked_count: int
    active_section_order: int
    sections: List[ExamSectionState]
    current_section_items: List[ExamItemPresentation] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# Scoring & Result Models
# -----------------------------------------------------------------------------

class ScoringSectionResult(ExamContractBase):
    """Scoring calculation result for an individual official scoring section."""
    code: str
    label: str
    max_score: int
    pass_threshold: int
    total_questions: int
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    raw_accuracy: float
    estimated_score: int
    passed_threshold: bool
    threshold_status: ThresholdStatus
    calculation_explanation: str


class ExamResult(ExamContractBase):
    """Immutable scoring snapshot and pass/fail assessment for a completed exam."""
    session_id: int
    external_id: str
    level: str
    blueprint_version: str
    scoring_algorithm_version: str
    is_complete: bool
    total_questions: int
    raw_correct: int
    raw_incorrect: int
    raw_unanswered: int
    raw_accuracy: float
    scoring_sections: List[ScoringSectionResult]
    estimated_total_score: int
    overall_max_score: int = 180
    overall_pass_threshold: int
    passed_overall: bool
    passed_sectional: bool
    passed_overall_estimate: bool
    readiness_assessment: PassFailAssessment
    result_labels: Dict[str, str]
    completed_at: str


# -----------------------------------------------------------------------------
# Analytics Models
# -----------------------------------------------------------------------------

class SectionTimingDetail(ExamContractBase):
    """Detailed timing analytics for a single section."""
    section_code: str
    block_order: int
    allocated_seconds: int
    remaining_seconds: int
    elapsed_ms: int
    questions_count: int
    answered_count: int
    unanswered_count: int
    marked_count: int
    accuracy: float


class FormatPerformanceDetail(ExamContractBase):
    """Performance metrics aggregated per format code."""
    format_code: str
    category: str
    total_items: int
    correct_items: int
    accuracy: float
    total_time_ms: int
    avg_time_ms_per_question: float


class ExamAnalytics(ExamContractBase):
    """Deep timing and diagnostic analytics for an examination attempt."""
    session_id: int
    level: str
    total_elapsed_ms: int
    total_questions: int
    answered_count: int
    unanswered_count: int
    marked_count: int
    section_timings: List[SectionTimingDetail]
    format_performance: List[FormatPerformanceDetail]
    slow_formats: List[str]
    high_time_questions: List[int]
    weak_sections: List[str]
    weak_formats: List[str]
    time_expired_unanswered_count: int
