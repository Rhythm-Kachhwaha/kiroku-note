"""
Scanned Image Input Adapter for Question Ingestion.
---------------------------------------------------
Ingests image-based questions, diagrams, and scanned documents.
Leverages Pillow for image verification/metadata and OcrService
for deterministic OCR extraction without hard coupling.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from PIL import Image

from app.services.ocr_service import OcrError, OcrService
from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import (
    ExtractedDocument,
    ExtractedMediaAsset,
    ExtractedPage,
    IngestInput,
)


class ScannedImageInputAdapter(BaseInputAdapter):
    """Adapter for scanned images, diagrams, and OCR question capture."""

    def __init__(self, ocr_service: OcrService | None = None) -> None:
        self._ocr_service = ocr_service or OcrService()

    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        content = input_data.content
        images_to_process: list[tuple[bytes, str, str | None]] = []  # (data, filename, ext)

        if isinstance(content, bytes):
            if not content:
                raise ValueError("Image byte content is empty.")
            images_to_process.append((content, "scanned_image.png", ".png"))
        elif isinstance(content, (str, Path)):
            p = Path(content)
            if not p.is_file():
                raise ValueError(f"Image file not found: {p}")
            data = p.read_bytes()
            images_to_process.append((data, p.name, p.suffix.lower()))
        elif isinstance(content, list):
            for idx, item in enumerate(content, start=1):
                if isinstance(item, bytes):
                    images_to_process.append((item, f"image_page_{idx}.png", ".png"))
                elif isinstance(item, (str, Path)):
                    p = Path(item)
                    if p.is_file():
                        images_to_process.append((p.read_bytes(), p.name, p.suffix.lower()))
        else:
            raise ValueError(f"ScannedImageInputAdapter requires bytes, Path, or list of images, got {type(content).__name__}")

        if not images_to_process:
            raise ValueError("No valid image data found in input payload.")

        pages: list[ExtractedPage] = []
        media_assets: list[ExtractedMediaAsset] = []
        full_text_parts: list[str] = []
        total_confidence = 0.0

        for idx, (img_bytes, filename, ext) in enumerate(images_to_process, start=1):
            # Verify and inspect image via PIL
            try:
                with Image.open(io.BytesIO(img_bytes)) as pil_img:
                    width, height = pil_img.size
                    img_format = (pil_img.format or "PNG").lower()
                    mime_type = f"image/{img_format}"
            except Exception as exc:
                raise ValueError(f"Invalid image format for {filename}: {exc}") from exc

            # Media asset metadata
            media_assets.append(
                ExtractedMediaAsset(
                    kind="illustration" if "diagram" not in filename.lower() else "diagram",
                    mime_type=mime_type,
                    byte_size=len(img_bytes),
                    data=img_bytes,
                    filename=filename,
                    pixel_width=width,
                    pixel_height=height,
                    metadata={"page_number": idx},
                )
            )

            # Perform OCR recognition if available
            ocr_text = ""
            page_confidence = 0.5  # default if OCR unavailable
            ocr_status = "unavailable"

            try:
                if self._ocr_service.is_available():
                    result = self._ocr_service.recognize(img_bytes)
                    ocr_text = (result.text or "").strip()
                    page_confidence = 0.85 if ocr_text else 0.3
                    ocr_status = "recognized"
                else:
                    ocr_status = "daemon_offline"
            except OcrError as exc:
                ocr_status = f"ocr_error: {exc}"
                page_confidence = 0.2
            except Exception as exc:
                ocr_status = f"error: {exc}"
                page_confidence = 0.2

            pages.append(
                ExtractedPage(
                    page_number=idx,
                    text=ocr_text,
                    images=[{"filename": filename, "width": width, "height": height, "mime_type": mime_type}],
                    confidence=page_confidence,
                )
            )

            total_confidence += page_confidence
            if ocr_text:
                full_text_parts.append(f"=== Page {idx} ===\n{ocr_text}")

        raw_text = "\n\n".join(full_text_parts) if full_text_parts else ""
        avg_confidence = total_confidence / len(pages) if pages else 0.0

        return ExtractedDocument(
            adapter_kind=IngestAdapterKind.SCANNED_IMAGE,
            raw_text=raw_text,
            pages=pages,
            media_assets=media_assets,
            source_name=input_data.source_name,
            source_type=input_data.source_type,
            license_or_permission=input_data.license_or_permission,
            citation=input_data.citation,
            url=input_data.url,
            default_level=input_data.default_level,
            extraction_method="manga_ocr" if any(p.text for p in pages) else "image_metadata_only",
            extraction_confidence=round(avg_confidence, 2),
            metadata={
                "image_count": len(images_to_process),
                "ocr_status": ocr_status,
                **input_data.metadata,
            },
        )

