"""
PDF import text extraction and preview bridge for Study Bank.
-------------------------------------------------------------
Exposes staged PDF page contents and builds import previews
from selected pages without committing to the question bank.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from app.api.study.auth import verify_study_auth
from app.api.study.deps import get_media_store, get_study_db
from app.api.study.errors import (
    StudyAPIError,
    StudyBadRequestError,
    StudyNotFoundError,
    map_domain_exception,
)
from app.api.study.schemas import ImportPreviewResponse
from app.study.ingestion.enums import IngestAdapterKind, PdfPageSkipReason
from app.study.ingestion.models import IngestInput
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.ingestion.staged_import import StagedPdfImportService
from app.study.media import MediaStore

import sqlite3

router = APIRouter(
    prefix="/api/study/v1",
    dependencies=[Depends(verify_study_auth)],
)

# Routes that require OCR and are not performed at staging.
_OCR_ROUTES = {
    PdfPageSkipReason.IMAGE_ONLY.value,
    PdfPageSkipReason.GARBLED_TEXT_LAYER.value,
    PdfPageSkipReason.POOR_TEXT_LAYER.value,
    "skipped_ocr",
}


class PdfPreviewRequest(BaseModel):
    """Request body for building a PDF import preview from selected pages."""

    pages: list[int] = Field(default_factory=list, description="1-based page numbers to include")
    default_level: Optional[str] = Field(default=None, pattern=r"^(N[1-5])?$")
    source_name: Optional[str] = Field(default="pdf_import")


@router.get("/bank/import/pdf/{import_id}/pages")
def get_pdf_pages(
    import_id: str,
    from_page: int = Query(default=1, ge=1, alias="from"),
    to_page: Optional[int] = Query(default=None, ge=1, alias="to"),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> dict[str, Any]:
    """
    Return per-page markup text, line list with bbox, flags, and route
    for a staged PDF import. Capped at 20 pages per request.
    """
    try:
        _svc = StagedPdfImportService()
        metadata = _svc.get_metadata(import_id)
        if metadata is None:
            raise StudyNotFoundError(
                message="Import expired or unknown.", code="IMPORT_EXPIRED"
            )

        document = _svc.extract_document(import_id)
        if document is None:
            raise StudyBadRequestError(
                message="Unable to extract PDF text.", code="PDF_EXTRACTION_FAILED"
            )

        page_map = {p.page_number: p for p in document.pages}
        total_pages = int(metadata.get("page_count", 0))

        start = max(1, from_page)
        end = to_page if to_page is not None else total_pages
        end = min(end, total_pages)
        if end < start:
            end = start
        if end - start + 1 > 20:
            end = start + 19

        staged_routes = {
            p["page_number"]: p.get("route", "selectable_text")
            for p in metadata.get("pages", [])
        }
        staged_flags_map = {
            p["page_number"]: p.get("flags", [])
            for p in metadata.get("pages", [])
        }

        pages_out: list[dict[str, Any]] = []
        for pnum in range(start, end + 1):
            page = page_map.get(pnum)
            if page is None:
                continue
            route = staged_routes.get(pnum, "selectable_text")
            is_ocr = route in _OCR_ROUTES or not page.text
            page_flags = staged_flags_map.get(pnum, [])

            lines_out = []
            if not is_ocr:
                for line in page.lines:
                    lines_out.append(
                        {
                            "text": line.text,
                            "bbox": list(line.bbox),
                            "direction": line.direction,
                            "confidence": line.confidence,
                        }
                    )

            pages_out.append(
                {
                    "page_number": pnum,
                    "markup": page.text if not is_ocr else "",
                    "lines": lines_out,
                    "flags": {
                        "has_text": len(page.text) > 0,
                        "image_count": len(page.images),
                        "coordinate_extraction": page.metadata.get(
                            "coordinate_extraction", "fallback"
                        ),
                        "non_japanese": "non_japanese" in page_flags,
                        "ocr_requested_unavailable": "ocr_requested_unavailable" in page_flags,
                        "vertical_text_suspected": "vertical_text_suspected" in page_flags,
                        "flag_list": page_flags,
                    },
                    "route": route,
                    "skipped_ocr": is_ocr,
                }
            )

        return {
            "import_id": import_id,
            "page_count": total_pages,
            "returned": len(pages_out),
            "pages": pages_out,
        }
    except StudyAPIError:
        raise
    except Exception as exc:
        raise map_domain_exception(exc)


@router.post("/bank/import/pdf/{import_id}/preview", response_model=ImportPreviewResponse)
def preview_pdf_import(
    import_id: str,
    request: PdfPreviewRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> ImportPreviewResponse:
    """
    Build an import preview from selected PDF pages.
    Returns ImportPreviewResponse; never commits to the bank.
    """
    try:
        _svc = StagedPdfImportService()
        metadata = _svc.get_metadata(import_id)
        if metadata is None:
            raise StudyNotFoundError(
                message="Import expired or unknown.", code="IMPORT_EXPIRED"
            )

        document = _svc.extract_document(import_id)
        if document is None:
            raise StudyBadRequestError(
                message="Unable to extract PDF text.", code="PDF_EXTRACTION_FAILED"
            )

        page_map = {p.page_number: p for p in document.pages}
        requested_pages = request.pages or list(range(1, int(metadata.get("page_count", 0)) + 1))

        staged_routes = {
            p["page_number"]: p.get("route", "selectable_text")
            for p in metadata.get("pages", [])
        }

        skipped: list[dict[str, Any]] = []
        parts: list[str] = []
        for pnum in requested_pages:
            page = page_map.get(pnum)
            if page is None:
                skipped.append({"page_number": pnum, "reason": PdfPageSkipReason.NOT_FOUND.value})
                continue
            route = staged_routes.get(pnum, "selectable_text")
            if route in _OCR_ROUTES or not page.text:
                skipped.append(
                    {
                        "page_number": pnum,
                        "reason": route if route in _OCR_ROUTES else PdfPageSkipReason.NO_TEXT.value,
                    }
                )
                continue
            parts.append(f"=== Page {pnum} ===\n{page.text}")

        if not parts:
            raise StudyBadRequestError(
                message="No readable pages selected for preview.", code="NO_READABLE_PAGES"
            )

        content = "\n\n".join(parts)
        ingest_input = IngestInput(
            content=content,
            adapter_kind=IngestAdapterKind.PASTED_TEXT,
            source_name=request.source_name or metadata.get("filename", "pdf_import"),
            source_type="pdf_upload",
            license_or_permission="user_provided",
            default_level=request.default_level,
            auto_approve=False,
        )

        pipeline = IngestionPipeline(media_store=media_store)
        result = pipeline.run(input_data=ingest_input, conn=conn, persist=False)

        preview_questions: list[dict[str, Any]] = []
        dup_count = 0
        valid_count = 0
        invalid_count = 0

        for idx, q_cand in enumerate(result.questions):
            is_valid = bool(q_cand.validation and q_cand.validation.is_valid)
            val_errors = [
                e.message if hasattr(e, "message") else str(e)
                for e in (q_cand.validation.errors or [])
            ] if q_cand.validation else []
            val_warnings = [
                w.message if hasattr(w, "message") else str(w)
                for w in (q_cand.validation.warnings or [])
            ] if q_cand.validation else []

            is_dup = False
            if q_cand.payload and hasattr(q_cand.payload, "stem_markup"):
                rev_row = conn.execute(
                    """
                    SELECT qr.question_id
                    FROM question_revision qr
                    JOIN question q ON qr.question_id = q.id
                    WHERE qr.stem_markup = ?;
                    """,
                    (q_cand.payload.stem_markup,),
                ).fetchone()
                if rev_row:
                    is_dup = True
                    dup_count += 1
                    val_warnings.append(
                        f"Question text matches existing bank record (ID: {rev_row['question_id']})."
                    )

            if is_valid and not is_dup:
                valid_count += 1
            elif not is_valid:
                invalid_count += 1

            choices_data = []
            canon_key = None
            explanation_markup = ""
            if q_cand.payload:
                if hasattr(q_cand.payload, "choices"):
                    choices_data = [c.model_dump() for c in q_cand.payload.choices]
                if hasattr(q_cand.payload, "answer") and q_cand.payload.answer:
                    canon_key = (
                        getattr(q_cand.payload.answer, "choice_key", None)
                        or getattr(q_cand.payload.answer, "canonical_choice_key", None)
                    )
                if hasattr(q_cand.payload, "explanation_markup"):
                    explanation_markup = q_cand.payload.explanation_markup

            lvl_str = (
                str(q_cand.classification.level.value if hasattr(q_cand.classification.level, "value") else q_cand.classification.level)
                if q_cand.classification and q_cand.classification.level
                else (request.default_level or "N5")
            )
            cat_str = (
                str(q_cand.classification.category.value if hasattr(q_cand.classification.category, "value") else q_cand.classification.category)
                if q_cand.classification and q_cand.classification.category
                else "vocabulary"
            )
            fmt_str = (
                q_cand.classification.format_code
                if q_cand.classification and q_cand.classification.format_code
                else "kanji_reading"
            )
            stem_markup = (
                q_cand.payload.stem_markup if q_cand.payload else q_cand.draft.raw_stem
            )

            preview_questions.append(
                {
                    "index": idx,
                    "level": lvl_str,
                    "format_code": fmt_str,
                    "category": cat_str,
                    "stem_markup": stem_markup,
                    "choices": choices_data,
                    "canonical_choice_key": canon_key,
                    "explanation_markup": explanation_markup,
                    "is_valid": is_valid,
                    "is_duplicate": is_dup,
                    "errors": val_errors,
                    "warnings": val_warnings,
                }
            )

        preview_groups: list[dict[str, Any]] = []
        for g_idx, g_cand in enumerate(result.groups):
            g_valid = bool(g_cand.validation and g_cand.validation.is_valid)
            g_errors = [
                e.message if hasattr(e, "message") else str(e)
                for e in (g_cand.validation.errors or [])
            ] if g_cand.validation else []
            g_lvl = (
                str(g_cand.level.value if hasattr(g_cand.level, "value") else g_cand.level)
                if g_cand.level
                else (request.default_level or "N5")
            )
            preview_groups.append(
                {
                    "index": g_idx,
                    "group_type": g_cand.draft.group_type or "passage",
                    "level": g_lvl,
                    "parts": list(g_cand.draft.parts),
                    "is_valid": g_valid,
                    "errors": g_errors,
                }
            )

        status_str = "valid" if (invalid_count == 0 and len(result.errors) == 0) else (
            "needs_review" if valid_count > 0 else "invalid"
        )

        skipped_counts: dict[str, int] = {}
        for s in skipped:
            r = str(s.get("reason", "unknown"))
            skipped_counts[r] = skipped_counts.get(r, 0) + 1

        return ImportPreviewResponse(
            preview_id="",
            status=status_str,
            total_questions=len(preview_questions),
            valid_questions=valid_count,
            invalid_questions=invalid_count,
            duplicate_questions=dup_count,
            questions=preview_questions,
            groups=preview_groups,
            errors=list(result.errors),
            warnings=list(result.warnings),
            skipped=skipped,
            skipped_count=len(skipped),
            skipped_counts=skipped_counts,
        )
    except StudyAPIError:
        raise
    except Exception as exc:
        raise map_domain_exception(exc)
