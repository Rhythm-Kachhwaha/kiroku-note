from __future__ import annotations

from pathlib import Path

import PyPDF2
import pytest

from app.study.ingestion.staged_import import StagedImportError, StagedPdfImportService


def _pdf_bytes(page_count: int = 1) -> bytes:
    import io

    writer = PyPDF2.PdfWriter()
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
