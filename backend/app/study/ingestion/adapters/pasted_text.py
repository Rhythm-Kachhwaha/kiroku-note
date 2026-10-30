"""
Pasted Text Input Adapter for Question Ingestion.
-------------------------------------------------
Accepts raw text pasted by a user or script. Preserves line breaks,
meaningful Japanese punctuation, and optional page/section delimiters.
"""
from __future__ import annotations

import re
from typing import Any

from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import ExtractedDocument, ExtractedPage, IngestInput


class PastedTextInputAdapter(BaseInputAdapter):
    """Adapter for extracting questions from plain pasted text."""

    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        content = input_data.content
        if isinstance(content, bytes):
            raw_text = content.decode("utf-8-sig", errors="replace")
        elif isinstance(content, str):
            # Strip UTF-8 BOM if present
            raw_text = content.lstrip("\ufeff")
        else:
            raise ValueError(f"PastedTextInputAdapter requires str or bytes, got {type(content).__name__}")

        raw_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
        if not raw_text.strip():
            raise ValueError("Pasted text content is empty or contains only whitespace.")

        # Check for explicit page markers, e.g. "=== Page 1 ===" or "--- 1 ---"
        page_pattern = re.compile(r"^(?:={3,}|-{3,})\s*(?:Page\s*)?([0-9０-９]+)\s*(?:={3,}|-{3,})$", re.MULTILINE | re.IGNORECASE)
        splits = page_pattern.split(raw_text)

        pages: list[ExtractedPage] = []
        if len(splits) > 1:
            # First element is preamble before first page marker (if any)
            preamble = splits[0].strip()
            if preamble:
                pages.append(ExtractedPage(page_number=1, text=preamble, confidence=1.0))

            for i in range(1, len(splits), 2):
                pg_num_str = splits[i].translate(str.maketrans("０１２３４５６７８９", "0123456789"))
                try:
                    pg_num = int(pg_num_str)
                except ValueError:
                    pg_num = len(pages) + 1
                page_text = splits[i + 1].strip() if (i + 1) < len(splits) else ""
                if page_text:
                    pages.append(ExtractedPage(page_number=pg_num, text=page_text, confidence=1.0))
        else:
            pages.append(ExtractedPage(page_number=1, text=raw_text.strip(), confidence=1.0))

        return ExtractedDocument(
            adapter_kind=IngestAdapterKind.PASTED_TEXT,
            raw_text=raw_text,
            pages=pages,
            media_assets=[],
            source_name=input_data.source_name,
            source_type=input_data.source_type,
            license_or_permission=input_data.license_or_permission,
            citation=input_data.citation,
            url=input_data.url,
            default_level=input_data.default_level,
            extraction_method="direct_text",
            extraction_confidence=1.0,
            metadata={"character_count": len(raw_text), **input_data.metadata},
        )

