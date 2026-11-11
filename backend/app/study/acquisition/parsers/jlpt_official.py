"""
Deterministic Parser for Official JLPT Sample Workbooks & Audio/PDF Booklets.
----------------------------------------------------------------------------
Supports:
- Structured / markdown transcriptions of official JLPT sample questions
- Official listening MP3 + script transcripts (`transcript_hidden_until_submit=True`)
- Official PDF question booklets via lazy PyMuPDF (`fitz`) or injected extractor
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from app.study.acquisition.media.pdf_media import extract_pdf_pages_text
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.common import parse_quiz_markdown
from app.study.acquisition.parsers.models import ParsedExercise


class JlptOfficialParser(BaseSourceParser):
    """Deterministic parser for official jlpt.jp sample workbooks and PDFs."""

    @property
    def source_name(self) -> str:
        return "JLPT Official"

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

    def parse_pdf(
        self,
        pdf_source: Path | str | bytes,
        *,
        url: str = "",
        title: str = "",
        audio_urls: list[str] | None = None,
        script_text: str = "",
        answer_key_text: str = "",
        fitz_module: Any = None,
        pdf_extractor: Callable[[Path | str | bytes], list[dict[str, Any]]] | None = None,
    ) -> ParsedExercise:
        """
        Extract text from an official JLPT PDF booklet and parse deterministically.
        Supports optional injected `fitz_module` or `pdf_extractor` for testing.
        """
        if pdf_extractor is not None:
            pages = pdf_extractor(pdf_source)
        else:
            pages = extract_pdf_pages_text(pdf_source, fitz_module=fitz_module)

        parts = [str(p.get("text", "")).strip() for p in pages if str(p.get("text", "")).strip()]
        if audio_urls:
            audio_lines = [f"[Audio]({u})" for u in audio_urls]
            parts.insert(0, "\n".join(audio_lines))
        if script_text.strip():
            parts.append(f"<details><summary>Transcript</summary>\n{script_text.strip()}\n</details>")
        if answer_key_text.strip():
            parts.append(f"**Answer Key:**\n{answer_key_text.strip()}")

        combined_md = "\n\n".join(parts)
        return self.parse(combined_md, url=url, title=title)
