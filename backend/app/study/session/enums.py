"""
Session and Practice Enumerations.
----------------------------------
Defines strict StrEnum types for session lifecycle states, user difficulty ratings,
deterministic grading outcomes, and session modes.
"""
from __future__ import annotations

from enum import Enum


class SessionStatus(str, Enum):
    CREATED = "created"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class SessionType(str, Enum):
    PRACTICE = "practice"
    CASUAL = "casual"
    EXAM = "exam"


class DifficultyRating(str, Enum):
    EASY = "easy"
    NORMAL = "normal"
    HARD = "hard"


class GradingStatus(str, Enum):
    GRADED = "graded"
    INVALID = "invalid"
    UNSUPPORTED = "unsupported"

