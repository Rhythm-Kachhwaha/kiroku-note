"""
Tests for PDF-2 text extraction + preview bridge (slice 17).
Covers GET /pages and POST /preview for staged PDF imports.
"""
from __future__ import annotations

import io
from pathlib import Path

import pypdf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.study.auth import clear_study_api_token, set_study_api_token
from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.ingestion.staged_import import StagedPdfImportService


def _make_text_pdf(text: str) -> bytes:
    """Create a minimal valid PDF with one page containing the given text."""
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content = f"BT /F1 12 Tf 50 700 Td ({escaped}) Tj ET"
    content_bytes = content.encode("latin-1")
    content_len = len(content_bytes)

    parts: list[bytes] = []
    parts.append(b"%PDF-1.4\n")
    offset = len(parts[0])

    obj1 = f"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".encode("latin-1")
    parts.append(obj1)
    off1 = offset
    offset += len(obj1)

    obj2 = f"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".encode("latin-1")
    parts.append(obj2)
    off2 = offset
    offset += len(obj2)

    obj3 = (
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font "
        b"/Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n"
    )
    parts.append(obj3)
    off3 = offset
    offset += len(obj3)

    header = f"4 0 obj\n<< /Length {content_len} >>\nstream\n".encode("latin-1")
    parts.append(header)
    off4 = offset
    offset += len(header)
    parts.append(content_bytes)
    offset += len(content_bytes)
    parts.append(b"\nendstream\nendobj\n")
    offset += len(b"\nendstream\nendobj\n")

    xref_offset = offset
    xref: list[bytes] = [b"xref\n", b"0 5\n", b"0000000000 65535 f \n"]
    for off in (off1, off2, off3, off4):
        xref.append(f"{off:010d} 00000 n \n".encode("ascii"))

    trailer = b"trailer\n<< /Size 5 /Root 1 0 R >>\n"
    startxref = f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    return b"".join(parts) + b"".join(xref) + trailer + startxref


class _Upload:
    def __init__(self, data: bytes) -> None:
        self.file = io.BytesIO(data)


@pytest.fixture
def pdf_api_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolated study DB, media store, and authenticated TestClient."""
    study_dir = tmp_path / "study_pdf_api_env"
    study_dir.mkdir(parents=True, exist_ok=True)
    media_dir = study_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    token = "pdf_text_test_bearer_token"
    monkeypatch.setenv("KIROKU_STUDY_API_TOKEN", token)
    set_study_api_token(token)
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)
    MediaStore(media_dir)

    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})

    yield {"client": client, "conn": conn, "tmp_path": tmp_path, "study_dir": study_dir}

    manager.close_all()
    reset_study_db_manager()
    clear_study_api_token()


def _stage_pdf(data: bytes, filename: str = "doc.pdf") -> str:
    service = StagedPdfImportService()
    result = service.inspect_upload(
        _Upload(data), filename=filename, content_type="application/pdf"
    )
    return result["import_id"]


# ---------------------------------------------------------------------------
# GET /pages
# ---------------------------------------------------------------------------

def test_pdf_pages_returns_structure_and_flags(pdf_api_env):
    client = pdf_api_env["client"]
    tmp_path = pdf_api_env["tmp_path"]

    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=300, height=400)
    buf = io.BytesIO()
    writer.write(buf)
    import_id = _stage_pdf(buf.getvalue())

    res = client.get(f"/api/study/v1/bank/import/pdf/{import_id}/pages")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["import_id"] == import_id
    assert body["page_count"] == 1
    assert len(body["pages"]) == 1
    page = body["pages"][0]
    assert page["page_number"] == 1
    assert page["markup"] == ""
    assert page["lines"] == []
    assert page["flags"]["has_text"] is False
    assert page["route"] == "poor_text_layer"


def test_pdf_pages_with_text(pdf_api_env):
    client = pdf_api_env["client"]
    tmp_path = pdf_api_env["tmp_path"]

    pdf_data = _make_text_pdf("Hello World")
    import_id = _stage_pdf(pdf_data, filename="text.pdf")

    res = client.get(f"/api/study/v1/bank/import/pdf/{import_id}/pages")
    assert res.status_code == 200, res.text
    body = res.json()
    page = body["pages"][0]
    assert page["page_number"] == 1
    assert "Hello" in page["markup"]
    assert page["flags"]["has_text"] is True
    assert page["route"] == "selectable_text"


def test_pdf_pages_caps_at_20(pdf_api_env):
    client = pdf_api_env["client"]

    # Multi-page blank PDF
    writer = pypdf.PdfWriter()
    for _ in range(25):
        writer.add_blank_page(width=300, height=400)
    buf = io.BytesIO()
    writer.write(buf)
    import_id = _stage_pdf(buf.getvalue())

    res = client.get(f"/api/study/v1/bank/import/pdf/{import_id}/pages?from=1&to=25")
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["pages"]) == 20  # capped at 20


def test_pdf_pages_unknown_import_returns_import_expired(pdf_api_env):
    client = pdf_api_env["client"]
    res = client.get("/api/study/v1/bank/import/pdf/unknown-id/pages")
    assert res.status_code == 404, res.text
    body = res.json()
    assert body["error"]["code"] == "IMPORT_EXPIRED"


# ---------------------------------------------------------------------------
# POST /preview
# ---------------------------------------------------------------------------

def test_pdf_preview_blank_pages_no_readable(pdf_api_env):
    client = pdf_api_env["client"]
    tmp_path = pdf_api_env["tmp_path"]

    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=300, height=400)
    buf = io.BytesIO()
    writer.write(buf)
    import_id = _stage_pdf(buf.getvalue())

    res = client.post(
        f"/api/study/v1/bank/import/pdf/{import_id}/preview",
        json={"pages": [1], "default_level": "N5", "source_name": "test"},
    )
    assert res.status_code == 400, res.text
    body = res.json()
    assert body["error"]["code"] == "NO_READABLE_PAGES"


def test_pdf_preview_with_text(pdf_api_env):
    client = pdf_api_env["client"]
    tmp_path = pdf_api_env["tmp_path"]

    pdf_data = _make_text_pdf("Hello World")
    import_id = _stage_pdf(pdf_data, filename="text.pdf")

    res = client.post(
        f"/api/study/v1/bank/import/pdf/{import_id}/preview",
        json={"pages": [1], "default_level": "N5", "source_name": "test"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] in {"valid", "needs_review", "invalid"}
    assert "total_questions" in body
    assert "questions" in body


def test_pdf_preview_unknown_import_returns_import_expired(pdf_api_env):
    client = pdf_api_env["client"]
    res = client.post(
        "/api/study/v1/bank/import/pdf/unknown-id/preview",
        json={"pages": [1], "default_level": "N5", "source_name": "test"},
    )
    assert res.status_code == 404, res.text
    body = res.json()
    assert body["error"]["code"] == "IMPORT_EXPIRED"


def test_pdf_preview_short_text_included_and_image_only_skipped(pdf_api_env, monkeypatch: pytest.MonkeyPatch):
    from app.study.ingestion.adapters.pdf_text import PdfTextInputAdapter
    from app.study.ingestion.models import ExtractedDocument, ExtractedPage
    client = pdf_api_env["client"]

    doc = ExtractedDocument(
        source_name="mixed.pdf",
        raw_text="dummy raw text",
        adapter_kind="pdf_text",
        metadata={"page_count": 3},
        pages=[
            # Page 1: 8-char short text (should be included, not skipped!)
            ExtractedPage(page_number=1, text="12345678", lines=[], metadata={}, confidence=0.2),
            # Page 2: 0 chars, 1 image -> image_only (should be skipped with reason image_only)
            ExtractedPage(page_number=2, text="", lines=[], metadata={"image_count": 1}, confidence=0.0),
            # Page 3: garbled text (should be skipped with reason garbled_text_layer)
            ExtractedPage(page_number=3, text="bad\ufffdtext", lines=[], metadata={}, confidence=0.8),
        ],
    )

    monkeypatch.setattr(PdfTextInputAdapter, "extract", lambda self, inp: doc)
    writer = pypdf.PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=300, height=400)
    buf = io.BytesIO()
    writer.write(buf)
    import_id = _stage_pdf(buf.getvalue(), filename="mixed.pdf")

    # Inspect pages first to verify routes
    res_pages = client.get(f"/api/study/v1/bank/import/pdf/{import_id}/pages")
    assert res_pages.status_code == 200
    pages_data = res_pages.json()["pages"]
    assert pages_data[0]["route"] == "short_text"
    assert pages_data[0]["skipped_ocr"] is False
    assert pages_data[1]["route"] == "image_only"
    assert pages_data[1]["skipped_ocr"] is True

    # Now preview all 3 pages
    res_preview = client.post(
        f"/api/study/v1/bank/import/pdf/{import_id}/preview",
        json={"pages": [1, 2, 3], "default_level": "N5", "source_name": "test"},
    )
    assert res_preview.status_code == 200, res_preview.text
    body = res_preview.json()

    assert "skipped" in body
    assert body["skipped_count"] == 2
    assert body["skipped_counts"]["image_only"] == 1
    assert body["skipped_counts"]["garbled_text_layer"] == 1

    skipped_reasons = {s["page_number"]: s["reason"] for s in body["skipped"]}
    assert 1 not in skipped_reasons  # Page 1 is included!
    assert skipped_reasons[2] == "image_only"
    assert skipped_reasons[3] == "garbled_text_layer"

