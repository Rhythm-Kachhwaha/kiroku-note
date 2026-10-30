"""
Data Contract Models for Learning & Practice Engine.
---------------------------------------------------
Defines strictly typed Pydantic models for practice sessions, question presentations,
answer submissions, deterministic grading results, difficulty feedback, and learning analytics.
"""
from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.study.session.enums import (
    DifficultyRating,
    GradingStatus,
    SessionStatus,
    SessionType,
)


class SessionContractBase(BaseModel):
    """Base model with forbidden extra fields for study session contracts."""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PracticeSessionConfig(SessionContractBase):
    """Configuration used to instantiate a new practice session."""
    level: Optional[str] = Field(default=None, pattern=r"^(N1|N2|N3|N4|N5)$")
    category: Optional[str] = None
    format_code: Optional[str] = None
    question_count: int = Field(default=10, gt=0, le=100)
    seed: Optional[int] = None
    session_type: SessionType = Field(default=SessionType.PRACTICE)
    target_weak_areas: bool = False
    bookmarked_only: bool = False
    incorrect_only: bool = False


class ChoicePresentation(SessionContractBase):
    """
    Choice details presented to the learner.
    Intentionally does NOT reveal correctness or canonical answer status.
    """
    choice_id: int
    choice_key: str
    display_position: int
    label: str
    mode: str
    text_markup: Optional[str] = None
    asset_id: Optional[int] = None


class GroupPartPresentation(SessionContractBase):
    """Individual text or context part of a shared reading passage/audio context."""
    ordinal: int
    role: str
    title: str = ""
    markup: str


class GroupContextPresentation(SessionContractBase):
    """Contextual group details presented for reading passage or shared audio."""
    group_id: int
    group_kind: str
    title: str = ""
    parts: List[GroupPartPresentation] = Field(default_factory=list)


class PracticeItemPresentation(SessionContractBase):
    """A single practice item prepared for learner display."""
    attempt_item_id: int
    position: int
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    prompt_markup: str
    choices: List[ChoicePresentation] = Field(default_factory=list)
    group_context: Optional[GroupContextPresentation] = None
    presented_at: Optional[str] = None
    is_answered: bool = False
    submitted_choice_id: Optional[int] = None
    is_correct: Optional[bool] = None
    difficulty_rating: Optional[DifficultyRating] = None


class PracticeSessionState(SessionContractBase):
    """Full snapshot of an in-progress or completed practice session."""
    session_id: int
    external_id: str
    session_type: SessionType
    status: SessionStatus
    level: Optional[str] = None
    category: Optional[str] = None
    format_code: Optional[str] = None
    total_questions: int
    answered_count: int
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    total_elapsed_ms: int = 0
    current_position: int = 1
    items: List[PracticeItemPresentation] = Field(default_factory=list)


class AnswerSubmission(SessionContractBase):
    """Client submission payload for answering a practice question."""
    attempt_item_id: int
    selected_choice_id: int
    time_spent_ms: int = Field(default=0, ge=0)
    difficulty_rating: Optional[DifficultyRating] = None


class GradingResult(SessionContractBase):
    """Deterministic grading result returned upon answer submission."""
    attempt_item_id: int
    is_correct: bool
    selected_choice_id: int
    canonical_choice_id: int
    canonical_choice_key: str
    rationale_markup: str = ""
    time_spent_ms: int
    difficulty_rating: Optional[DifficultyRating] = None
    grading_status: GradingStatus = GradingStatus.GRADED


class DifficultySubmission(SessionContractBase):
    """Decoupled learner difficulty rating submission."""
    attempt_item_id: int
    difficulty_rating: DifficultyRating


class LearningSummary(SessionContractBase):
    """Overall learning and practice metrics summary."""
    total_sessions: int
    completed_sessions: int
    abandoned_sessions: int
    in_progress_sessions: int
    total_questions_attempted: int
    total_correct: int
    overall_accuracy: float
    total_time_spent_ms: int
    average_time_per_question_ms: float


class AccuracyByGroup(SessionContractBase):
    """Breakdown metric bucket by JLPT level or format/category."""
    group_name: str
    attempted: int
    correct: int
    accuracy: float


class QuestionAnalyticsItem(SessionContractBase):
    """Individual question performance and repetition tracking record."""
    question_id: int
    external_id: str
    level: str
    category: str
    format_code: str
    prompt_markup: str
    attempts_count: int
    correct_count: int
    accuracy: float
    consecutive_correct_easy: int = 0
    last_rating: Optional[str] = None
    last_is_correct: Optional[bool] = None
    last_attempted_at: Optional[str] = None
    priority_score: float = 100.0


class RecentSessionItem(SessionContractBase):
    """Summary of a recently conducted practice session."""
    session_id: int
    external_id: str
    session_type: str
    status: str
    level: Optional[str] = None
    category: Optional[str] = None
    total_questions: int
    answered_count: int
    correct_count: int
    accuracy: float
    total_elapsed_ms: int
    created_at: str
    completed_at: Optional[str] = None

