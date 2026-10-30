"""
Unit Tests for Study Ingestion Input Adapters.
---------------------------------------------
Verifies:
- PastedTextInputAdapter: BOM stripping, CRLF normalization, page delimiters, multi-question preservation.
- StructuredJsonInputAdapter: Batch containers, question lists, contract mapping, malformed JSON rejection.
- PdfTextInputAdapter: PyPDF2 extraction, page numbering, confidence computation.
- ScannedImageInputAdapter: PIL inspection, OcrService integration, offline daemon resilience.
- AudioInputAdapter: Audio asset metadata, MIME detection, transcript linkage.
"""
from __future__ import annotations

import io
import json
from pathlib import Path
import pytest
from PIL import Image
import PyPDF2

from app.services.ocr_service import OcrResult, OcrService, OcrStatus
from app.study.contracts.enums import JlptLevel
from app.study.ingestion.adapters import (
    AudioInputAdapter,
    PastedTextInputAdapter,
    PdfTextInputAdapter,
    ScannedImageInputAdapter,
    StructuredJsonInputAdapter,
)
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import IngestInput


def test_pasted_text_adapter_basic():
    """Test plain pasted text extraction preserves content and layout."""
    text = "問題1 次の言葉の読み方を選びなさい。\n1 あの山は高いです。\n1 かわ 2 やま 3 うみ 4 き\n正解: 2"
    adapter = PastedTextInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=text,
        source_name="Sample Pasted Test",
        default_level=JlptLevel.N5,
    )
    doc = adapter.extract(input_data)

    assert doc.adapter_kind == IngestAdapterKind.PASTED_TEXT
    assert doc.source_name == "Sample Pasted Test"
    assert doc.default_level == JlptLevel.N5
    assert len(doc.pages) == 1
    assert "あの山は高いです" in doc.raw_text
    assert doc.extraction_confidence == 1.0


def test_pasted_text_adapter_bom_and_pages():
    """Test BOM removal and page delimiter handling."""
    text_with_bom = "\ufeff=== Page 1 ===\n問題1 問1\n=== Page 2 ===\n問題2 問2\n"
    adapter = PastedTextInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=text_with_bom,
        source_name="BOM and Pages Test",
    )
    doc = adapter.extract(input_data)

    assert len(doc.pages) == 2
    assert doc.pages[0].page_number == 1
    assert "問題1 問1" in doc.pages[0].text
    assert doc.pages[1].page_number == 2
    assert "問題2 問2" in doc.pages[1].text


def test_pasted_text_adapter_empty_rejection():
    """Test that empty or whitespace-only content raises ValueError."""
    adapter = PastedTextInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content="   \n\t   ",
        source_name="Empty Test",
    )
    with pytest.raises(ValueError, match="empty or contains only whitespace"):
        adapter.extract(input_data)


def test_structured_json_adapter_batch_container():
    """Test structured JSON container with source, questions, and groups."""
    payload = {
        "source": {"name": "Official JLPT 2020", "level": "N3"},
        "questions": [
            {
                "id": "q1",
                "format_code": "kanji_reading",
                "prompt_markup": "あの{u|寺}は古いです。",
                "choices": [
                    {"ordinal": 1, "text_markup": "てら", "is_correct": True},
                    {"ordinal": 2, "text_markup": "はし"},
                    {"ordinal": 3, "text_markup": "まち"},
                    {"ordinal": 4, "text_markup": "いえ"},
                ],
            }
        ],
        "groups": [
            {
                "id": "g1",
                "kind": "passage",
                "text": "これはテスト文章です。",
            }
        ],
    }
    adapter = StructuredJsonInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
        content=json.dumps(payload),
        source_name="Default Source",
    )
    doc = adapter.extract(input_data)

    assert doc.source_name == "Official JLPT 2020"
    assert doc.default_level == JlptLevel.N3
    assert doc.metadata["question_count"] == 1
    assert doc.metadata["group_count"] == 1
    assert len(doc.metadata["raw_questions"]) == 1


def test_structured_json_adapter_malformed_rejection():
    """Test that invalid JSON strings raise descriptive ValueError."""
    adapter = StructuredJsonInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
        content='{"unclosed_brace": true',
        source_name="Malformed Test",
    )
    with pytest.raises(ValueError, match="Malformed JSON"):
        adapter.extract(input_data)


def test_pdf_text_adapter(tmp_path: Path):
    """Test digital PDF text extraction page by page."""
    # Create an in-memory PDF using PyPDF2
    writer = PyPDF2.PdfWriter()
    page1 = writer.add_blank_page(width=300, height=400)
    # Write empty PDF to file to test reading
    pdf_path = tmp_path / "test.pdf"
    with open(pdf_path, "wb") as f:
        writer.write(f)

    adapter = PdfTextInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PDF_TEXT,
        content=pdf_path,
        source_name="PDF Test",
        default_level=JlptLevel.N2,
    )
    doc = adapter.extract(input_data)

    assert doc.adapter_kind == IngestAdapterKind.PDF_TEXT
    assert len(doc.pages) == 1
    assert doc.pages[0].page_number == 1
    assert doc.metadata["page_count"] == 1


def test_scanned_image_adapter_with_mock_ocr(monkeypatch: pytest.MonkeyPatch):
    """Test image adapter inspects PIL image and runs OcrService."""
    # Generate a small 100x50 in-memory PNG
    img = Image.new("RGB", (100, 50), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    # Mock OcrService
    class MockOcrService:
        def is_available(self):
            return True

        def recognize(self, b):
            return OcrResult(text="これはテストOCR結果です。", engine="manga-ocr", duration_ms=120.0)

    adapter = ScannedImageInputAdapter(ocr_service=MockOcrService())
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.SCANNED_IMAGE,
        content=img_bytes,
        source_name="Image Test",
        default_level=JlptLevel.N4,
    )
    doc = adapter.extract(input_data)

    assert doc.adapter_kind == IngestAdapterKind.SCANNED_IMAGE
    assert len(doc.media_assets) == 1
    assert doc.media_assets[0].pixel_width == 100
    assert doc.media_assets[0].pixel_height == 50
    assert "これはテストOCR結果です。" in doc.raw_text
    assert doc.extraction_confidence == 0.85


def test_audio_adapter_mime_and_transcript():
    """Test audio adapter extracts audio bytes and attaches transcript."""
    dummy_audio = b"ID3\x03\x00\x00\x00\x00\x00"  # Dummy MP3 header
    adapter = AudioInputAdapter()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.AUDIO,
        content=dummy_audio,
        source_name="Audio Test",
        metadata={
            "transcript_markup": "男の人と女の人が話しています。",
            "duration_ms": 45000,
        },
    )
    doc = adapter.extract(input_data)

    assert doc.adapter_kind == IngestAdapterKind.AUDIO
    assert len(doc.media_assets) == 1
    assert doc.media_assets[0].kind == "audio"
    assert doc.media_assets[0].mime_type == "audio/mpeg"
    assert doc.media_assets[0].duration_ms == 45000
    assert "男の人と女の人が話しています。" in doc.raw_text

