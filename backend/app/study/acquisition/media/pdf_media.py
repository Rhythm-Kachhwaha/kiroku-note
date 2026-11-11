"""
Optional PyMuPDF (fitz) PDF Media Extraction & Page Cropping Helper.
--------------------------------------------------------------------
Uses lazy `import fitz` with dependency injection support so callers and
tests can operate deterministically without requiring PyMuPDF at import time.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any


def _resolve_fitz(fitz_module: Any = None) -> Any:
    if fitz_module is not None:
        return fitz_module
    try:
        import fitz  # type: ignore[import-not-found]

        return fitz
    except ImportError as exc:
        raise ImportError(
            "PyMuPDF (fitz) is required for PDF media extraction; install pymupdf or inject fitz_module."
        ) from exc


def _open_pdf_document(pdf_source: Path | str | bytes, fitz_module: Any = None) -> Any:
    fitz = _resolve_fitz(fitz_module)
    if isinstance(pdf_source, bytes):
        return fitz.open(stream=pdf_source, filetype="pdf")
    return fitz.open(str(pdf_source))


def extract_pdf_pages_text(
    pdf_source: Path | str | bytes,
    *,
    fitz_module: Any = None,
) -> list[dict[str, Any]]:
    """Extract per-page plain text and bounding blocks from a PDF booklet."""
    doc = _open_pdf_document(pdf_source, fitz_module=fitz_module)
    pages: list[dict[str, Any]] = []
    try:
        for idx, page in enumerate(doc, start=1):
            text = page.get_text("text") or ""
            blocks = page.get_text("blocks") if hasattr(page, "get_text") else []
            pages.append({
                "page_number": idx,
                "text": text,
                "blocks": blocks,
            })
    finally:
        if hasattr(doc, "close"):
            doc.close()
    return pages


def render_pdf_page_png(
    pdf_source: Path | str | bytes,
    page_index: int = 0,
    *,
    dpi: int = 150,
    crop_rect: tuple[float, float, float, float] | None = None,
    fitz_module: Any = None,
) -> bytes:
    """Render a PDF page (or cropped region) into PNG bytes."""
    fitz = _resolve_fitz(fitz_module)
    doc = _open_pdf_document(pdf_source, fitz_module=fitz)
    try:
        page = doc[page_index]
        clip = fitz.Rect(*crop_rect) if crop_rect is not None and hasattr(fitz, "Rect") else crop_rect
        kwargs: dict[str, Any] = {"dpi": dpi}
        if clip is not None:
            kwargs["clip"] = clip
        pixmap = page.get_pixmap(**kwargs)
        return bytes(pixmap.tobytes("png"))
    finally:
        if hasattr(doc, "close"):
            doc.close()
