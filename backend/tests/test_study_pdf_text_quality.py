"""
Tests for PDF text quality, layout ordering, and fixture extraction (Slice 18).
Validates horizontal paragraphs, ruby inline markup, two-column flow,
repeating header/footer removal, vertical text detection, and mixed Latin/JP text.
"""
from __future__ import annotations

import io
from pathlib import Path
import pytest

from app.study.ingestion.adapters.pdf_text import PdfTextInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import IngestInput
from app.study.ingestion.staged_import import StagedPdfImportService
from tests.fixtures.pdf_gen import (
    generate_horizontal_paragraphs_pdf,
    generate_mixed_latin_jp_pdf,
    generate_repeating_header_footer_pdf,
    generate_ruby_pdf,
    generate_tategaki_pdf,
    generate_two_column_pdf,
)


class _Upload:
    def __init__(self, data: bytes) -> None:
        self.file = io.BytesIO(data)


def _extract(pdf_bytes: bytes, filename: str = "test.pdf"):
    inp = IngestInput(
        content=pdf_bytes,
        adapter_kind=IngestAdapterKind.PDF_TEXT,
        source_name=filename,
        source_type="pdf_upload",
        license_or_permission="user_provided",
        metadata={"sha256": "quality_test_hash"},
    )
    return PdfTextInputAdapter().extract(inp)


def test_horizontal_paragraphs_reading_order():
    """Verify indented lines in horizontal text preserve natural top-to-bottom reading order."""
    pdf_bytes = generate_horizontal_paragraphs_pdf()
    doc = _extract(pdf_bytes, "horizontal.pdf")
    assert len(doc.pages) == 1
    page = doc.pages[0]

    lines = [line.text.strip() for line in page.lines]
    assert len(lines) == 4
    assert lines[0] == "第一段落の最初の行です。"
    assert lines[1] == "第一段落の字下げされた二行目です。"
    assert lines[2] == "第二段落の最初の行です。"
    assert lines[3] == "第二段落の二行目です。"


def test_two_column_reading_order():
    """Verify that multi-column pages order column 1 top-to-bottom before column 2."""
    pdf_bytes = generate_two_column_pdf()
    doc = _extract(pdf_bytes, "two_column.pdf")
    page = doc.pages[0]

    lines = [line.text.strip() for line in page.lines]
    assert len(lines) == 4
    assert lines[0] == "左列の第一行です。"
    assert lines[1] == "左列の第二行です。"
    assert lines[2] == "右列の第一行です。"
    assert lines[3] == "右列の第二行です。"


def test_ruby_inline_markup():
    """Verify that furigana above kanji is consolidated into canonical [base|reading] markup."""
    pdf_bytes = generate_ruby_pdf()
    doc = _extract(pdf_bytes, "ruby.pdf")
    page = doc.pages[0]

    assert "[漢字|かんじ]" in page.text
    assert "練習する" in page.text


def test_repeating_header_footer_strip():
    """Verify that identical headers and footers across pages are stripped from body text."""
    pdf_bytes = generate_repeating_header_footer_pdf()
    doc = _extract(pdf_bytes, "header_footer.pdf")
    assert len(doc.pages) == 2

    p1_text = doc.pages[0].text
    p2_text = doc.pages[1].text

    assert "共通模試ヘッダー：第1回" not in p1_text
    assert "共通模試ヘッダー：第1回" not in p2_text
    assert "共通ページフッター" not in p1_text
    assert "共通ページフッター" not in p2_text

    assert "1ページ目の本文問題文です。" in p1_text
    assert "2ページ目の本文問題文です。" in p2_text


def test_vertical_text_detection_and_flag(tmp_path: Path):
    """Verify that tategaki layout is detected and flagged as vertical_text_suspected."""
    pdf_bytes = generate_tategaki_pdf()
    doc = _extract(pdf_bytes, "tategaki.pdf")
    page = doc.pages[0]
    assert page.metadata.get("vertical_text_suspected") is True

    # Check that staged import also flags the page
    service = StagedPdfImportService(tmp_path)
    res = service.inspect_upload(_Upload(pdf_bytes), filename="tategaki.pdf", content_type="application/pdf")
    staged_page = res["pages"][0]
    assert "vertical_text_suspected" in staged_page.get("flags", [])


def test_mixed_latin_jp_preservation():
    """Verify that mixed Japanese text with English and digits preserves symbols and tokens."""
    pdf_bytes = generate_mixed_latin_jp_pdf()
    doc = _extract(pdf_bytes, "mixed.pdf")
    page = doc.pages[0]

    assert "2024年" in page.text
    assert "JLPT N1" in page.text
    assert "FastAPI" in page.text
    assert "SQLite" in page.text
    assert "HTTP status 200 OK" in page.text
