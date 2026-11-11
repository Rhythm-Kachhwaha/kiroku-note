"""
Deterministic Parser for GyanMirai JLPT Practice & Listening Papers.
---------------------------------------------------------------------
Supports standard JLPT drills and N5 listening papers featuring:
- Audio track associations (.mp3 / <audio>)
- Picture choices (4 image options per listening item)
- Hidden transcripts revealed only after submit (`transcript_hidden_until_submit=True`)
"""
from __future__ import annotations

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.common import parse_quiz_markdown
from app.study.acquisition.parsers.models import ParsedExercise


class GyanMiraiParser(BaseSourceParser):
    """Deterministic parser for GyanMirai JLPT practice and listening exercises."""

    @property
    def source_name(self) -> str:
        return "GyanMirai"

    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        exercise = parse_quiz_markdown(
            raw_markdown,
            source_name=self.source_name,
            url=url,
            title=title,
            default_level="N5",
            require_listening_transcript=True,
        )
        for q in exercise.questions:
            if q.transcript is not None:
                q.transcript_hidden_until_submit = True
        return exercise
