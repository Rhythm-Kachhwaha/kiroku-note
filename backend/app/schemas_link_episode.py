"""
Pydantic schemas for Link Episode Primer and Recap (Slice 44).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class GapWordItem(BaseModel):
    word: str
    reading: str = ""
    meaning: str = ""
    level: Optional[str] = None
    frequency: int = 1


class GrammarPointItem(BaseModel):
    pattern_key: str
    display: str
    level: Optional[str] = None
    frequency: int = 1


class QuizQuestion(BaseModel):
    id: int
    word: str
    reading: str = ""
    prompt: str
    options: List[str]
    correct_index: int
    explanation: str = ""


class PrimerRequest(BaseModel):
    hash: Optional[str] = None
    cues: Optional[List[Dict[str, Any]]] = None
    learner_level: Optional[str] = None


class PrimerResponse(BaseModel):
    hash: str
    learner_level: str
    total_cues: int
    gap_words: List[GapWordItem]
    grammar_points: List[GrammarPointItem]
    quiz: List[QuizQuestion]


class RecapRequest(BaseModel):
    hash: str
    title: str = ""
    site: str = ""
    mined_words: List[str] = Field(default_factory=list)
    minutes: float = 0.0
    last_position_ms: Optional[int] = 0
    cues: Optional[List[Dict[str, Any]]] = None
    learner_level: Optional[str] = None


class RecapResponse(BaseModel):
    hash: str
    title: str
    site: str
    lines_watched: int
    known_pct_before: float
    known_pct_after: float
    words_mined: List[str]
    gap_words_unseen: List[str]
    minutes: float
    ts: str
    review_link: str


class EpisodeRecord(BaseModel):
    hash: str
    title: str
    site: str
    known_pct: float
    mined: int
    minutes: float
    ts: str
    last_position_ms: int = 0
    series: str = ""
    episode_key: Optional[str] = None


class UpdatePositionRequest(BaseModel):
    last_position_ms: int = Field(ge=0)
    title: str = ""
    site: str = ""
    series: Optional[str] = None
    episode_key: Optional[str] = None


class SeriesGroup(BaseModel):
    series: str
    episodes: List[EpisodeRecord]

