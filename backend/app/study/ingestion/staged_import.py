"""Bounded filesystem-backed staging for PDF inspection imports."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any
import uuid

from app.study.ingestion.adapters.pdf_text import PdfTextInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import IngestInput


class StagedImportError(ValueError):
    """Raised when an uploaded document cannot be safely staged or inspected."""


class StagedPdfImportService:
    MAX_FILE_SIZE = 25 * 1024 * 1024
    MAX_PAGE_COUNT = 200
    TTL = timedelta(hours=1)
    CHUNK_SIZE = 1024 * 1024

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or (Path(tempfile.gettempdir()) / "kiroku-note-study-imports")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    def inspect_upload(
        self,
        upload: Any,
        *,
        filename: str | None,
        content_type: str | None,
        force_ocr_pages: list[int] | None = None,
    ) -> dict[str, Any]:
        self.cleanup_expired()
        if not filename or Path(filename).suffix.lower() != ".pdf":
            raise StagedImportError("Only files with a .pdf extension are supported.")
        if content_type and content_type.lower() not in {"application/pdf", "application/octet-stream"}:
            raise StagedImportError("The uploaded file MIME type is not supported for PDF inspection.")

        import_id = uuid.uuid4().hex
        pdf_path = self.root / f"{import_id}.pdf"
        digest = hashlib.sha256()
        total_size = 0
        try:
            with pdf_path.open("xb") as destination:
                while True:
                    chunk = upload.file.read(self.CHUNK_SIZE)
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > self.MAX_FILE_SIZE:
                        raise StagedImportError(
                            f"PDF exceeds the maximum upload size of {self.MAX_FILE_SIZE} bytes."
                        )
                    digest.update(chunk)
                    destination.write(chunk)
        except StagedImportError:
            pdf_path.unlink(missing_ok=True)
            raise
        except OSError as exc:
            pdf_path.unlink(missing_ok=True)
            raise StagedImportError("Unable to stage the uploaded PDF.") from exc

        sha256 = digest.hexdigest()
        existing = self._find_by_hash(sha256)
        if existing:
            pdf_path.unlink(missing_ok=True)
            return existing

        try:
            with pdf_path.open("rb") as source:
                signature = source.read(5)
            if signature != b"%PDF-":
                raise StagedImportError("The uploaded file is not a valid PDF signature.")

            input_data = IngestInput(
                adapter_kind=IngestAdapterKind.PDF_TEXT,
                content=pdf_path,
                source_name=filename,
                source_type="pdf_upload",
                license_or_permission="user_provided",
                metadata={"sha256": sha256},
            )
            document = PdfTextInputAdapter().extract(input_data)
        except StagedImportError:
            pdf_path.unlink(missing_ok=True)
            raise
        except ValueError as exc:
            pdf_path.unlink(missing_ok=True)
            raise StagedImportError(str(exc)) from exc

        if document.metadata.get("encrypted"):
            pdf_path.unlink(missing_ok=True)
            raise StagedImportError("Encrypted PDFs are not supported; upload an unlocked PDF.")
        if document.metadata["page_count"] > self.MAX_PAGE_COUNT:
            pdf_path.unlink(missing_ok=True)
            raise StagedImportError(
                f"PDF exceeds the maximum page count of {self.MAX_PAGE_COUNT}."
            )

        forced = set(force_ocr_pages or [])
        invalid_forced = sorted(page for page in forced if page < 1 or page > document.metadata["page_count"])
        if invalid_forced:
            pdf_path.unlink(missing_ok=True)
            raise StagedImportError(f"force_ocr_pages contains invalid page {invalid_forced[0]}.")
        pages = []
        for page in document.pages:
            text = page.text
            char_count = len(text)
            japanese_count = sum(
                1
                for char in text
                if "\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff"
            )
            replacement_count = text.count("\ufffd") + text.count("(cid:")
            image_count = int(page.metadata.get("image_count", 0))
            if char_count == 0:
                route = "image_only" if image_count else "poor_text_layer"
            elif replacement_count or page.confidence < 0.5:
                route = "garbled_text_layer"
            elif image_count:
                route = "mixed"
            else:
                route = "selectable_text"
            pages.append(
                {
                    "page_number": page.page_number,
                    "text_char_count": char_count,
                    "japanese_ratio": round(japanese_count / char_count, 4) if char_count else 0.0,
                    "replacement_indicators": replacement_count,
                    "image_coverage_estimate": 1.0 if char_count == 0 and image_count else (0.5 if image_count else 0.0),
                    "page_width": page.metadata.get("width"),
                    "page_height": page.metadata.get("height"),
                    "route": route,
                    "force_ocr": page.page_number in forced,
                }
            )

        result = {
            "import_id": import_id,
            "filename": Path(filename).name,
            "sha256": sha256,
            "page_count": len(pages),
            "pages": pages,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + self.TTL).isoformat(),
        }
        self._write_metadata(import_id, result)
        return result

    def cleanup_expired(self) -> None:
        now = datetime.now(timezone.utc)
        for metadata_path in self.root.glob("*.json"):
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if datetime.fromisoformat(metadata["expires_at"]) <= now:
                    metadata_path.unlink(missing_ok=True)
                    self._pdf_path(metadata["import_id"]).unlink(missing_ok=True)
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
                metadata_path.unlink(missing_ok=True)

    def _find_by_hash(self, sha256: str) -> dict[str, Any] | None:
        for metadata_path in self.root.glob("*.json"):
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                if metadata.get("sha256") == sha256:
                    return metadata
            except (OSError, json.JSONDecodeError):
                continue
        return None

    def _pdf_path(self, import_id: str) -> Path:
        return self.root / f"{import_id}.pdf"

    def _write_metadata(self, import_id: str, metadata: dict[str, Any]) -> None:
        path = self.root / f"{import_id}.json"
        path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
