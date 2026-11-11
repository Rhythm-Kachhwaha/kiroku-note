"""Deterministic Parser for Nihongo Master JLPT Practice Pages."""
from __future__ import annotations

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.common import parse_quiz_markdown
from app.study.acquisition.parsers.models import ParsedExercise


class NihongoMasterParser(BaseSourceParser):
    """Deterministic parser for Nihongo Master JLPT study drills."""

    @property
    def source_name(self) -> str:
        return "Nihongo Master"

    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        return parse_quiz_markdown(
            raw_markdown,
            source_name=self.source_name,
            url=url,
            title=title,
        )
