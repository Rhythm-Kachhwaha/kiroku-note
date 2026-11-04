"""Schemas for grammar analysis API responses."""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field

from app.schemas import (
    GrammarAnalyzeRequest,
    GrammarPointResponse,
    GrammarSetupCheckResponse,
)


class GrammarTokenItem(BaseModel):
    surface: str
    lemma: str
    reading: str = ""
    pos: str = ""
    level: Optional[str] = None
    known: bool = False


class GrammarAnalyzeResponse(BaseModel):
    sentence: str
    learner_level: str
    points: list[GrammarPointResponse] = Field(default_factory=list)
    tokens: list[GrammarTokenItem] = Field(default_factory=list)
    is_limited_offline: bool = False
    tokenizer_source: str = "none"
    tokenizer_status: str = "unavailable"
    cached: bool = False
