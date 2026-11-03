"""
PDF Text-Based Input Adapter for Question Ingestion.
---------------------------------------------------
Extracts text page-by-page from digital PDFs with an existing text layer,
preserving page numbers and layout for traceability back to source pages.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.adapters.pdf_coordinates import (
    extract_page_coordinates,
    markup_for_lines,
    remove_repeated_edge_lines,
)
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import ExtractedDocument, ExtractedPage, IngestInput


class PdfTextInputAdapter(BaseInputAdapter):
    """Adapter for extracting text from digital PDF documents."""

    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        try:
            import pypdf as pdf_lib
        except ImportError:
            try:
                import PyPDF2 as pdf_lib
            except ImportError:
                raise ImportError(
                    "pypdf or PyPDF2 is required for PdfTextInputAdapter. "
                    "Install with: pip install pypdf"
                )

        content = input_data.content
        pdf_file: io.BytesIO

        if isinstance(content, bytes):
            if not content:
                raise ValueError("PDF byte content is empty.")
            pdf_file = io.BytesIO(content)
        elif isinstance(content, (str, Path)):
            p = Path(content)
            if not p.is_file():
                raise ValueError(f"PDF file not found: {p}")
            pdf_file = io.BytesIO(p.read_bytes())
        else:
            raise ValueError(f"PdfTextInputAdapter requires bytes or Path, got {type(content).__name__}")

        try:
            reader = pdf_lib.PdfReader(pdf_file)
        except Exception as exc:
            raise ValueError(f"Failed to open PDF document: {exc}") from exc

        if getattr(reader, "is_encrypted", False):
            raise ValueError("Encrypted PDFs are not supported; upload an unlocked PDF.")
        if len(reader.pages) == 0:
            raise ValueError("PDF document contains 0 pages.")

        pages: list[ExtractedPage] = []
        full_text_parts: list[str] = []
        total_extracted_chars = 0

        for idx, page in enumerate(reader.pages, start=1):
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            spans = []
            lines = []
            vector_lines = []
            coordinate_error = ""
            try:
                spans, lines, vector_lines = extract_page_coordinates(
                    page,
                    page_number=idx,
                    page_width=width,
                    page_height=height,
                )
                page_text = markup_for_lines(lines, vector_lines)
            except (AttributeError, TypeError, ValueError, NotImplementedError) as exc:
                coordinate_error = str(exc)
                spans = []
                lines = []
                vector_lines = []
                try:
                    page_text = page.extract_text() or ""
                except Exception:
                    page_text = ""

            page_text = page_text.replace("\r\n", "\n").replace("\r", "\n").strip()
            char_count = len(page_text)
            total_extracted_chars += char_count

            # If page text is very sparse, it might be a scanned page or blank
            page_confidence = 1.0 if char_count > 10 else (0.2 if char_count > 0 else 0.0)

            pages.append(
                ExtractedPage(
                    page_number=idx,
                    text=page_text,
                    spans=spans,
                    lines=lines,
                    confidence=page_confidence,
                    metadata={
                        "width": width,
                        "height": height,
                        "image_count": len(getattr(page, "images", [])),
                        "coordinate_extraction": "visitor" if spans else "fallback",
                        "coordinate_error": coordinate_error,
                        "vector_line_count": len(vector_lines),
                        "vector_lines": [line.__dict__ for line in vector_lines],
                        "fidelity_flags": (
                            ["ruby_unverified", "underline_unverified"]
                            if not spans
                            else []
                        ),
                    },
                )
            )

            if page_text:
                full_text_parts.append(f"=== Page {idx} ===\n{page_text}")

        remove_repeated_edge_lines(pages)
        full_text_parts = [
            f"=== Page {page.page_number} ===\n{page.text}"
            for page in pages
            if page.text
        ]
        raw_text = "\n\n".join(full_text_parts)

        # Average extraction confidence across pages
        avg_confidence = (
            sum(p.confidence for p in pages) / len(pages)
            if pages
            else 0.0
        )

        return ExtractedDocument(
            adapter_kind=IngestAdapterKind.PDF_TEXT,
            raw_text=raw_text,
            pages=pages,
            media_assets=[],
            source_name=input_data.source_name,
            source_type=input_data.source_type,
            license_or_permission=input_data.license_or_permission,
            citation=input_data.citation,
            url=input_data.url,
            default_level=input_data.default_level,
            extraction_method=(
                "pypdf2_coordinate_text_extraction"
                if any(page.spans for page in pages)
                else "pypdf2_text_extraction"
            ),
            extraction_confidence=round(avg_confidence, 2),
            metadata={
                "page_count": len(pages),
                "total_chars": total_extracted_chars,
                "encrypted": bool(getattr(reader, "is_encrypted", False)),
                "coordinate_aware": any(page.spans for page in pages),
                **input_data.metadata,
            },
        )
