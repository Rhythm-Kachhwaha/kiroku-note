"""Schemas for subtitle annotation and known words API."""
from __future__ import annotations

from typing import Optional, Union
from pydantic import BaseModel, Field

from app.schemas import (
    SubtitleCueInput,
    SubtitleAnnotateRequest,
    KnownWordsResponse,
    MarkKnownWordRequest,
    MarkKnownWordResponse,
)


class AnnotatedTokenResponse(BaseModel):
    start: int = 0
    end: int = 0
    surface: str
    lemma: str
    reading: str = ""
    status: str = "unstyled"
    jlpt_level: Optional[str] = None
    known: bool = False
    word_state: str = "unseen"
    pos: str = ""
    level_source: Optional[str] = None
    est_level: Optional[str] = None
    model_config = {"extra": "allow"}


class AnnotatedCueResponse(BaseModel):
    id: Optional[Union[str, int]] = None
    tokens: list[AnnotatedTokenResponse] = Field(default_factory=list)
    model_config = {"extra": "allow"}


class SubtitleAnnotateResponse(BaseModel):
    version: int = 1
    cues: list[AnnotatedCueResponse] = Field(default_factory=list)
    model_config = {"extra": "allow"}
