"""
Study Session & Practice Subsystem.
-----------------------------------
Provides practice session creation, candidate selection, deterministic answer grading,
attempt timing, difficulty feedback, adaptive repetition, and learning analytics.
"""
from app.study.session.adaptive import (
    calculate_priority_score,
    select_practice_candidates,
    update_question_adaptive_state,
)
from app.study.session.analytics import PracticeAnalyticsService
from app.study.session.enums import (
    DifficultyRating,
    GradingStatus,
    SessionStatus,
    SessionType,
)
from app.study.session.grading import (
    DeterministicGrader,
    GradingError,
    InvalidChoiceError,
    MissingAnswerKeyError,
    UnsupportedGraderError,
)
from app.study.session.models import (
    AccuracyByGroup,
    AnswerSubmission,
    ChoicePresentation,
    DifficultySubmission,
    GradingResult,
    GroupContextPresentation,
    GroupPartPresentation,
    LearningSummary,
    PracticeItemPresentation,
    PracticeSessionConfig,
    PracticeSessionState,
    QuestionAnalyticsItem,
    RecentSessionItem,
)
from app.study.session.service import (
    AlreadyAnsweredError,
    NoEligibleQuestionsError,
    PracticeSessionService,
    SessionLifecycleError,
    SessionNotFoundError,
    SessionServiceError,
)

__all__ = [
    "AccuracyByGroup",
    "AlreadyAnsweredError",
    "AnswerSubmission",
    "ChoicePresentation",
    "DeterministicGrader",
    "DifficultyRating",
    "DifficultySubmission",
    "GradingError",
    "GradingResult",
    "GradingStatus",
    "GroupContextPresentation",
    "GroupPartPresentation",
    "InvalidChoiceError",
    "LearningSummary",
    "MissingAnswerKeyError",
    "NoEligibleQuestionsError",
    "PracticeAnalyticsService",
    "PracticeItemPresentation",
    "PracticeSessionConfig",
    "PracticeSessionService",
    "PracticeSessionState",
    "QuestionAnalyticsItem",
    "RecentSessionItem",
    "SessionLifecycleError",
    "SessionNotFoundError",
    "SessionServiceError",
    "SessionStatus",
    "SessionType",
    "UnsupportedGraderError",
    "calculate_priority_score",
    "select_practice_candidates",
    "update_question_adaptive_state",
]

