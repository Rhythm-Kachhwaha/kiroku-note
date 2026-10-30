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
    image_url: Optional[str] = None


class GroupContextDTO(StudyAPIBaseModel):
    group_id: int
    group_kind: str
    title: str = ""
    parts: List[GroupPartDTO] = Field(default_factory=list)
    audio_url: Optional[str] = None
    image_url: Optional[str] = None


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
    illustration_url: Optional[str] = None
    diagram_url: Optional[str] = None
    star_position: Optional[int] = None
    anchor_key: Optional[str] = None
    group_ordinal: Optional[int] = None
    presented_at: Optional[str] = None
    is_answered: bool = False
    selected_choice_id: Optional[int] = None
    is_marked_for_review: bool = False
    audio_play_count: int = 0
    section_code: Optional[str] = None
    block_order: Optional[int] = None
    is_bookmarked: bool = False

    # Post-submission revelation fields
    is_correct: Optional[bool] = None
    canonical_choice_id: Optional[int] = None
    canonical_choice_key: Optional[str] = None
    correct_order: Optional[List[int]] = None
    difficulty_rating: Optional[str] = None
    explanation_markup: Optional[str] = None


# =============================================================================
# Practice Schemas
# =============================================================================

class CreatePracticeSessionRequest(StudyAPIBaseModel):
    level: Optional[str] = Field(default=None, pattern=r"^N[1-5]$", description="JLPT Level N1-N5")
    category: Optional[str] = None
    format_code: Optional[str] = None
    question_count: int = Field(default=10, ge=1, le=100)
    session_type: str = Field(
        default="practice",
        pattern=r"^(standard|practice|casual|drill|trouble|review|weak_area|bookmarked)$",
    )
    target_weak_areas: bool = False
    bookmarked_only: bool = False
    incorrect_only: bool = False
    seed: Optional[int] = None
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


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
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


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
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


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
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


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
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


class ToggleReviewFlagRequest(StudyAPIBaseModel):
    is_flagged: bool
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


class CreateDiagnosticRequest(StudyAPIBaseModel):
    level: str = Field(pattern=r"^N[1-5]$")
    seed: Optional[int] = None
    question_limit_per_format: int = Field(default=1, ge=1, le=5)
    client_request_id: Optional[str] = Field(default=None, description="Optional idempotency UUID")


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
    supported: bool = True
    message: str = "Bookmarks supported."
    total: int = 0
    limit: int = 20
    offset: int = 0
    items: List[Any] = Field(default_factory=list)


# =============================================================================
# M14: Bookmarks, Provenance, Reporting & Import Schemas
# =============================================================================

class BookmarkItemDTO(StudyAPIBaseModel):
    id: int
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    prompt_markup: str
    notes: str = ""
    created_at: str
    is_eligible: bool = True


class AddBookmarkRequest(StudyAPIBaseModel):
    question_id: Any  # integer ID or external_id string
    notes: Optional[str] = ""
    client_request_id: Optional[str] = None


class BookmarkListResponse(StudyAPIBaseModel):
    supported: bool = True
    message: str = "Bookmarks supported."
    total: int = 0
    limit: int = 20
    offset: int = 0
    items: List[BookmarkItemDTO] = Field(default_factory=list)


class CreateQuestionReportRequest(StudyAPIBaseModel):
    issue_type: str = Field(
        pattern=r"^(incorrect_answer|bad_explanation|wrong_format|typo_or_content|audio_media_issue|other)$"
    )
    details: str = Field(min_length=3, max_length=2000)
    suggested_correction: Optional[str] = None
    client_request_id: Optional[str] = None


class UpdateQuestionReportRequest(StudyAPIBaseModel):
    status: str = Field(pattern=r"^(open|investigating|resolved|dismissed)$")
    resolution_notes: Optional[str] = None
    client_request_id: Optional[str] = None


class QuestionReportDTO(StudyAPIBaseModel):
    id: int
    external_id: str
    question_id: int
    question_external_id: Optional[str] = None
    question_revision_id: Optional[int] = None
    issue_type: str
    details: str
    suggested_correction: Optional[str] = None
    status: str
    resolution_notes: Optional[str] = None
    reported_at: str
    resolved_at: Optional[str] = None


class SourceProvenanceDTO(StudyAPIBaseModel):
    source_id: int
    name: str
    source_type: str
    citation: str = ""
    url: Optional[str] = None
    external_question_ref: Optional[str] = None
    paper_year: Optional[str] = None


class VerificationProvenanceDTO(StudyAPIBaseModel):
    status: str
    comparison_scenario: Optional[str] = None
    model_a_choice_key: Optional[str] = None
    model_b_choice_key: Optional[str] = None
    source_answer_keys: List[str] = Field(default_factory=list)
    is_ambiguous: bool = False
    human_decision: Optional[str] = None
    human_choice_key: Optional[str] = None
    verified_at: Optional[str] = None


class AnswerClaimDTO(StudyAPIBaseModel):
    source_name: str
    choice_key: Optional[str] = None
    source_label: Optional[str] = None
    answer_origin: str
    rationale: str = ""
    is_conflict: bool = False


class IngestionProvenanceDTO(StudyAPIBaseModel):
    adapter_name: Optional[str] = None
    extraction_confidence: Optional[float] = None
    review_status: Optional[str] = None
    imported_at: Optional[str] = None


class QuestionProvenanceResponse(StudyAPIBaseModel):
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    sources: List[SourceProvenanceDTO] = Field(default_factory=list)
    verification: Optional[VerificationProvenanceDTO] = None
    answer_claims: List[AnswerClaimDTO] = Field(default_factory=list)
    ingestion: Optional[IngestionProvenanceDTO] = None


class ImportPreviewItemDTO(StudyAPIBaseModel):
    index: int
    level: str
    format_code: str
    category: str
    stem_markup: str
    choices: List[Dict[str, Any]] = Field(default_factory=list)
    canonical_choice_key: Optional[str] = None
    explanation_markup: Optional[str] = None
    is_valid: bool = True
    is_duplicate: bool = False
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ImportPreviewGroupDTO(StudyAPIBaseModel):
    index: int
    group_type: str
    level: str
    parts: List[Dict[str, Any]] = Field(default_factory=list)
    is_valid: bool = True
    errors: List[str] = Field(default_factory=list)


class ImportPreviewRequest(StudyAPIBaseModel):
    content: str = Field(min_length=1, description="Raw text or JSON content pasted by user or external agent")
    format: str = Field(default="auto", pattern=r"^(auto|text|json)$")
    default_level: Optional[str] = Field(default=None, pattern=r"^(N[1-5])?$")
    source_name: Optional[str] = "agent_import"
    source_type: Optional[str] = "user_pasted"
    citation: Optional[str] = ""
    url: Optional[str] = None
    client_request_id: Optional[str] = None


class ImportPreviewResponse(StudyAPIBaseModel):
    preview_id: str
    status: str  # valid | needs_review | invalid
    total_questions: int
    valid_questions: int
    invalid_questions: int
    duplicate_questions: int
    questions: List[ImportPreviewItemDTO] = Field(default_factory=list)
    groups: List[ImportPreviewGroupDTO] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ImportCommitRequest(StudyAPIBaseModel):
    preview_id: Optional[str] = None
    approved: bool = True
    content: Optional[str] = None
    format: str = Field(default="auto", pattern=r"^(auto|text|json)$")
    default_level: Optional[str] = None
    source_name: Optional[str] = "agent_import"
    source_type: Optional[str] = "user_pasted"
    citation: Optional[str] = ""
    url: Optional[str] = None
    client_request_id: Optional[str] = None


class ImportCommitResponse(StudyAPIBaseModel):
    status: str
    batch_id: Optional[int] = None
    source_id: Optional[int] = None
    imported_count: int
    duplicate_count: int
    imported_question_ids: List[int] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class QuestionDetailDTO(StudyAPIBaseModel):
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
    illustration_url: Optional[str] = None
    diagram_url: Optional[str] = None
    star_position: Optional[int] = None
    anchor_key: Optional[str] = None
    group_ordinal: Optional[int] = None
    canonical_choice_id: Optional[int] = None
    canonical_choice_key: Optional[str] = None
    correct_order: Optional[List[int]] = None
    explanation_markup: Optional[str] = None
    is_bookmarked: bool = False
    is_eligible: bool = True
    attempts_count: int = 0
    correct_count: int = 0
    last_accuracy: Optional[float] = None
    sources: List[SourceProvenanceDTO] = Field(default_factory=list)


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
