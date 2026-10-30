"""
Base Source Parser Interface for Study Bank Acquisition.
--------------------------------------------------------
Contract for deterministic, rule-based web parsers converting raw markdown
into normalized ParsedExercise structures.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.study.acquisition.parsers.models import ParsedExercise


class BaseSourceParser(ABC):
    """Abstract base class for source-specific deterministic parsers."""

    @property
    @abstractmethod
    def source_name(self) -> str:
        """Name of the source repository (e.g. 'JapaneseTest4You')."""
        pass

    @abstractmethod
    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        """
        Parse raw markdown into a structured ParsedExercise object.

        Guarantees:
        - 100% deterministic operation with zero AI/LLM calls
        - Pristine preservation of original Japanese text
        - Faithful association of questions to passages and diagrams
        - Separation of answer keys into verifiable claims
        """
        pass

