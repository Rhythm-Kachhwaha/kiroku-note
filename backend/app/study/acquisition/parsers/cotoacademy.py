"""Deterministic Parser for Coto Academy JLPT Quiz Pages."""
from __future__ import annotations

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.common import parse_quiz_markdown
from app.study.acquisition.parsers.models import ParsedExercise


class CotoAcademyParser(BaseSourceParser):
    """Deterministic parser for Coto Academy JLPT grammar/vocab/kanji quizzes."""

    @property
    def source_name(self) -> str:
        return "Coto Academy"

    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        return parse_quiz_markdown(
            raw_markdown,
            source_name=self.source_name,
            url=url,
            title=title,
        )
