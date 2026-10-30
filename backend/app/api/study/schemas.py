"""
Data Transfer Objects & Schemas for Study HTTP API.
---------------------------------------------------
Provides consistent, frontend-friendly question contracts, session representations,
and request/response validations for practice, examination, and diagnostics.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class StudyAPIBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Question & Presentation Contracts
# =============================================================================

class ChoiceDTO(StudyAPIBaseModel):
    choice_id: int
    choice_key: str
    display_position: int
    label: str
    mode: str = "text"  # text | image | unprinted
    text_markup: Optional[str] = None
    image_url: Optional[str] = None
    asset_id: Optional[int] = None


class GroupPartDTO(StudyAPIBaseModel):
    ordinal: int
    role: str
    title: str = ""
    markup: str


class GroupContextDTO(StudyAPIBaseModel):
    group_id: int
    group_kind: str
    title: str = ""
    parts: List[GroupPartDTO] = Field(default_factory=list)
    audio_url: Optional[str] = None


class QuestionDTO(StudyAPIBaseModel):
    attempt_item_id: int
    position: int
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    structural_family: Optional[str] = None
    instruction_text: Optional[str] = None
    prompt_markup: str
    choices: List[ChoiceDTO] = Field(default_factory=list)
    group_context: Optional[GroupContextDTO] = None
    audio_url: Optional[str] = None
    presented_at: Optional[str] = None
    is_answered: bool = False
    selected_choice_id: Optional[int] = None
    is_marked_for_review: bool = False
    audio_play_count: int = 0
    section_code: Optional[str] = None
    block_order: Optional[int] = None

    # Post-submission revelation fields
    is_correct: Optional[bool] = None
    canonical_choice_id: Optional[int] = None
    canonical_choice_key: Optional[str] = None
    difficulty_rating: Optional[str] = None
    explanation_markup: Optional[str] = None


# =============================================================================
# Practice Schemas
# =============================================================================

class CreatePracticeSessionRequest(StudyAPIBaseModel):
    level: str = Field(pattern=r"^N[1-5]$", description="JLPT Level N1-N5")
    category: Optional[str] = None
    format_code: Optional[str] = None
    question_count: int = Field(default=10, ge=1, le=100)
    session_type: str = Field(default="practice", pattern=r"^(standard|practice|casual|drill|trouble|review)$")
    seed: Optional[int] = None


class PracticeSessionResponse(StudyAPIBaseModel):
    session_id: int
    external_id: str
    session_type: str
    status: str
    level: str
    category: Optional[str] = None
    format_code: Optional[str] = None
    total_questions: int
    answered_count: int
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    total_elapsed_ms: int
    current_position: int
    items: List[QuestionDTO] = Field(default_factory=list)


class SubmitAnswerRequest(StudyAPIBaseModel):
    attempt_item_id: int
    selected_choice_id: int
    time_spent_ms: int = Field(ge=0)
    difficulty_rating: Optional[str] = Field(default=None, pattern=r"^(easy|normal|hard)$")


class SubmitAnswerResponse(StudyAPIBaseModel):
    attempt_item_id: int
    selected_choice_id: int
    is_correct: bool
    grading_status: str
    canonical_choice_id: int
    explanation_markup: Optional[str] = None
    time_spent_ms: int


class SubmitFeedbackRequest(StudyAPIBaseModel):
    attempt_item_id: int
    difficulty_rating: str = Field(pattern=r"^(easy|normal|hard)$")


class GenericStatusResponse(StudyAPIBaseModel):
    status: str = "ok"
    message: str = ""


# =============================================================================
# Exam Schemas
# =============================================================================

class CreateExamSessionRequest(StudyAPIBaseModel):
    level: str = Field(pattern=r"^N[1-5]$")
    blueprint_version: Optional[str] = None
    strict_timing: bool = True
    enforce_readiness: bool = True
    seed: Optional[int] = None


class ExamSectionStateDTO(StudyAPIBaseModel):
    section_id: int
    section_code: str
    block_order: int
    label: str
    status: str
    allocated_time_seconds: int
    remaining_time_seconds: int
    started_at: Optional[str] = None
    deadline_at: Optional[str] = None
    paused_at: Optional[str] = None
    completed_at: Optional[str] = None
    total_elapsed_ms: int = 0


class ExamSessionResponse(StudyAPIBaseModel):
    session_id: int
    external_id: str
    level: str
    status: str
    blueprint_version: str
    total_questions: int
    answered_count: int
    marked_count: int
    active_section_order: int
    sections: List[ExamSectionStateDTO]
    current_section_items: List[QuestionDTO] = Field(default_factory=list)
    server_time: Optional[str] = None
    deadline_at: Optional[str] = None
    remaining_seconds: Optional[int] = None
    exam_mode: str = "strict"


class SelectDraftChoiceRequest(StudyAPIBaseModel):
    selected_choice_id: Optional[int] = None


class ToggleReviewFlagRequest(StudyAPIBaseModel):
    is_flagged: bool


class CreateDiagnosticRequest(StudyAPIBaseModel):
    level: str = Field(pattern=r"^N[1-5]$")
    seed: Optional[int] = None
    question_limit_per_format: int = Field(default=1, ge=1, le=5)


# =============================================================================
# Bank & Readiness Schemas
# =============================================================================

class FormatSummaryItem(StudyAPIBaseModel):
    format_code: str
    category: str
    total_count: int
    eligible_count: int


class LevelSummaryItem(StudyAPIBaseModel):
    level: str
    total_count: int
    eligible_count: int
    formats: List[FormatSummaryItem] = Field(default_factory=list)


class BankSummaryResponse(StudyAPIBaseModel):
    total_questions: int
    active_questions: int
    eligible_questions: int
    levels: Dict[str, LevelSummaryItem] = Field(default_factory=dict)


# =============================================================================
# Supporting & Analytics Schemas
# =============================================================================

class LearningOverviewResponse(StudyAPIBaseModel):
    learning_summary: Dict[str, Any]
    accuracy_by_level: List[Dict[str, Any]]
    accuracy_by_family: List[Dict[str, Any]]
    recent_activity: List[Dict[str, Any]]


class WeakAreaItem(StudyAPIBaseModel):
    format_code: str
    category: str
    level: str
    attempted_count: int
    accuracy: float
    description: str = ""


class TroubleQuestionItem(StudyAPIBaseModel):
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    prompt_markup: str
    attempts_count: int
    correct_count: int
    accuracy: float
    consecutive_correct_easy: int
    priority_score: float
    last_rating: Optional[str] = None
    last_attempted_at: Optional[str] = None


class BookmarkReportResponse(StudyAPIBaseModel):
    supported: bool = False
    message: str = "Bookmarks are not currently supported by the local study domain."
    items: List[Dict[str, Any]] = Field(default_factory=list)


class StudySettingsDTO(StudyAPIBaseModel):
    default_exam_mode: str = "strict"
    strict_timing_enabled: bool = True
    enforce_readiness: bool = True
    adaptive_scheduling_enabled: bool = True
    max_question_time_ms: int = 1800000


class PaginatedResponse(StudyAPIBaseModel):
    total: int
    limit: int
    offset: int
    items: List[Any] = Field(default_factory=list)
