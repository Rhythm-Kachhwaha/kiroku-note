from __future__ import annotations

from pathlib import Path

import pypdf
import pytest

from app.study.ingestion.adapters.pdf_text import PdfTextInputAdapter
from app.study.ingestion.staged_import import StagedImportError, StagedPdfImportService


def _pdf_bytes(page_count: int = 1) -> bytes:
    import io

    writer = pypdf.PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=300, height=400)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class _Upload:
    def __init__(self, data: bytes) -> None:
        import io

        self.file = io.BytesIO(data)


def test_pdf_inspection_is_page_scoped_and_idempotent(tmp_path: Path) -> None:
    service = StagedPdfImportService(tmp_path)
    upload = _Upload(_pdf_bytes(2))

    first = service.inspect_upload(upload, filename="../worksheet.pdf", content_type="application/pdf")
    second = service.inspect_upload(_Upload(_pdf_bytes(2)), filename="copy.pdf", content_type="application/pdf")

    assert first["import_id"] == second["import_id"]
    assert first["page_count"] == 2
    assert [page["page_number"] for page in first["pages"]] == [1, 2]
    assert all(page["route"] == "poor_text_layer" for page in first["pages"])
    assert all(page["has_text"] is False for page in first["pages"])
    assert list(tmp_path.glob("*.pdf")) == [tmp_path / f"{first['import_id']}.pdf"]


def test_pdf_inspection_rejects_signature_and_page_limit(tmp_path: Path) -> None:
    service = StagedPdfImportService(tmp_path)

    with pytest.raises(StagedImportError, match="valid PDF signature"):
        service.inspect_upload(_Upload(b"not a pdf"), filename="bad.pdf", content_type="application/pdf")

    service.MAX_PAGE_COUNT = 1
    with pytest.raises(StagedImportError, match="maximum page count"):
        service.inspect_upload(_Upload(_pdf_bytes(2)), filename="too-many.pdf", content_type="application/pdf")


def test_pdf_inspection_supports_force_ocr_without_running_ocr(tmp_path: Path) -> None:
    service = StagedPdfImportService(tmp_path)

    result = service.inspect_upload(
        _Upload(_pdf_bytes()),
        filename="scan.pdf",
        content_type="application/pdf",
        force_ocr_pages=[1],
    )

    assert result["pages"][0]["force_ocr"] is True
    assert result["pages"][0]["route"] == "poor_text_layer"


def test_pdf_inspection_dedupe_refreshes_ttl_and_force_flags(tmp_path: Path) -> None:
    service = StagedPdfImportService(tmp_path)

    first = service.inspect_upload(
        _Upload(_pdf_bytes(1)), filename="a.pdf", content_type="application/pdf", force_ocr_pages=[]
    )
    first_expires = first["expires_at"]
    first_force = first["pages"][0]["force_ocr"]

    # Same content, different filename + new force_ocr flag -> dedupe hit with refresh
    second = service.inspect_upload(
        _Upload(_pdf_bytes(1)), filename="b.pdf", content_type="application/pdf", force_ocr_pages=[1]
    )

    assert second["import_id"] == first["import_id"]
    assert second["expires_at"] != first_expires  # TTL refreshed
    assert second["pages"][0]["force_ocr"] is True  # new force flag applied
    assert first["pages"][0]["force_ocr"] is first_force  # original unchanged before re-read


def test_pdf_import_error_code_when_support_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    service = StagedPdfImportService(tmp_path)

    def _boom(self, input_data):
        raise ImportError("no pdf library")

    monkeypatch.setattr(PdfTextInputAdapter, "extract", _boom)

    with pytest.raises(StagedImportError, match="PDF support not installed") as exc:
        service.inspect_upload(
            _Upload(_pdf_bytes()), filename="x.pdf", content_type="application/pdf"
        )
    assert exc.value.code == "PDF_SUPPORT_MISSING"


def test_page_classification_routes_and_flags(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.study.ingestion.models import ExtractedDocument, ExtractedPage

    doc = ExtractedDocument(
        source_name="test.pdf",
        raw_text="dummy raw text",
        adapter_kind="pdf_text",
        metadata={"page_count": 5},
        pages=[
            # Page 1: 8 chars -> short_text
            ExtractedPage(page_number=1, text="12345678", lines=[], metadata={}, confidence=0.2),
            # Page 2: 0 chars, 1 image -> image_only
            ExtractedPage(page_number=2, text="", lines=[], metadata={"image_count": 1}, confidence=0.0),
            # Page 3: contains replacement char -> garbled_text_layer
            ExtractedPage(page_number=3, text="garbled\ufffdtext", lines=[], metadata={}, confidence=0.8),
            # Page 4: low japanese ratio with >= 40 chars -> non_japanese flag
            ExtractedPage(
                page_number=4,
                text="This is an English sentence with more than forty characters for testing.",
                lines=[],
                metadata={},
                confidence=1.0,
            ),
            # Page 5: force_ocr requested on text page -> ocr_requested_unavailable flag
            ExtractedPage(
                page_number=5,
                text="日本語のテスト文章です。問題なく抽出できます。",
                lines=[],
                metadata={},
                confidence=1.0,
            ),
        ],
    )

    monkeypatch.setattr(PdfTextInputAdapter, "extract", lambda self, inp: doc)
    service = StagedPdfImportService(tmp_path)
    res = service.inspect_upload(
        _Upload(_pdf_bytes(5)),
        filename="test.pdf",
        content_type="application/pdf",
        force_ocr_pages=[5],
    )

    p1 = res["pages"][0]
    assert p1["route"] == "short_text"
    assert p1["has_text"] is True

    p2 = res["pages"][1]
    assert p2["route"] == "image_only"
    assert p2["has_text"] is False

    p3 = res["pages"][2]
    assert p3["route"] == "garbled_text_layer"

    p4 = res["pages"][3]
    assert p4["route"] == "selectable_text"
    assert "non_japanese" in p4["flags"]

    p5 = res["pages"][4]
    assert p5["route"] == "selectable_text"
    assert "ocr_requested_unavailable" in p5["flags"]


def test_cleanup_expired_and_cache_invalidation(tmp_path: Path) -> None:
    from datetime import datetime, timedelta, timezone
    import json

    service = StagedPdfImportService(tmp_path)
    service.clear_cache()

    upload = _Upload(_pdf_bytes(1))
    meta = service.inspect_upload(upload, filename="cleanup_test.pdf", content_type="application/pdf")
    import_id = meta["import_id"]

    # Extract document so it enters the LRU cache
    doc = service.extract_document(import_id)
    assert doc is not None
    assert (import_id, meta["sha256"]) in service._document_cache

    # Now simulate expiration
    meta_file = tmp_path / f"{import_id}.json"
    data = json.loads(meta_file.read_text(encoding="utf-8"))
    data["expires_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    meta_file.write_text(json.dumps(data), encoding="utf-8")

    # Run cleanup
    service.cleanup_expired()

    # Verify files deleted from disk
    assert not meta_file.exists()
    assert not (tmp_path / f"{import_id}.pdf").exists()

    # Verify cache evicted
    assert (import_id, meta["sha256"]) not in service._document_cache
    assert service.extract_document(import_id) is None


