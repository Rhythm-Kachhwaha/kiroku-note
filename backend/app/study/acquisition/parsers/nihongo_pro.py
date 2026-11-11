"""Deterministic Parser for Nihongo-Pro JLPT Quiz Pages."""
from __future__ import annotations

import re

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.common import parse_quiz_markdown
from app.study.acquisition.parsers.models import ParsedExercise


class NihongoProParser(BaseSourceParser):
    """Deterministic parser for Nihongo-Pro JLPT quiz pages."""

    @property
    def source_name(self) -> str:
        return "Nihongo-Pro"

    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        # Normalize HTML radio button choice lines before delegating to shared parser
        preprocessed = re.sub(
            r'<input[^>]*type=[\'"]radio[\'"][^>]*>\s*',
            "- ",
            raw_markdown,
            flags=re.IGNORECASE,
        )
        return parse_quiz_markdown(
            preprocessed,
            source_name=self.source_name,
            url=url,
            title=title,
        )
