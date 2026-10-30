"""
Audio Input Adapter for Question Ingestion.
-------------------------------------------
Handles listening exam audio files, tracks duration and formats,
and stages or persists assets into MediaStore for F5/F6 listening questions.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import (
    ExtractedDocument,
    ExtractedMediaAsset,
    ExtractedPage,
    IngestInput,
)
from app.study.media import MediaStore


class AudioInputAdapter(BaseInputAdapter):
    """Adapter for ingesting listening questions with associated audio."""

    def __init__(self, media_store: MediaStore | None = None) -> None:
        self._media_store = media_store

    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        content = input_data.content
        audio_bytes: bytes
        filename = "listening_audio.mp3"
        ext = ".mp3"

        if isinstance(content, bytes):
            if not content:
                raise ValueError("Audio byte content is empty.")
            audio_bytes = content
        elif isinstance(content, (str, Path)):
            p = Path(content)
            if not p.is_file():
                raise ValueError(f"Audio file not found: {p}")
            audio_bytes = p.read_bytes()
            filename = p.name
            ext = p.suffix.lower()
        else:
            raise ValueError(f"AudioInputAdapter requires bytes or Path, got {type(content).__name__}")

        # Guess MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type or not mime_type.startswith("audio/"):
            ext_map = {
                ".mp3": "audio/mpeg",
                ".wav": "audio/wav",
                ".m4a": "audio/mp4",
                ".webm": "audio/webm",
                ".ogg": "audio/ogg",
                ".aac": "audio/aac",
            }
            mime_type = ext_map.get(ext, "audio/mpeg")
        if mime_type == "audio/mp3" or ext == ".mp3":
            mime_type = "audio/mpeg"

        # Check for transcript or text in metadata
        transcript = input_data.metadata.get("transcript_markup") or input_data.metadata.get("transcript") or ""
        question_text = input_data.metadata.get("question_text", "")
        raw_text = question_text or transcript

        asset = ExtractedMediaAsset(
            kind="audio",
            mime_type=mime_type,
            byte_size=len(audio_bytes),
            data=audio_bytes,
            filename=filename,
            duration_ms=input_data.metadata.get("duration_ms"),
            metadata=input_data.metadata,
        )

        page = ExtractedPage(
            page_number=1,
            text=raw_text,
            images=[],
            confidence=1.0,
        )

        return ExtractedDocument(
            adapter_kind=IngestAdapterKind.AUDIO,
            raw_text=raw_text,
            pages=[page],
            media_assets=[asset],
            source_name=input_data.source_name,
            source_type=input_data.source_type,
            license_or_permission=input_data.license_or_permission,
            citation=input_data.citation,
            url=input_data.url,
            default_level=input_data.default_level,
            extraction_method="audio_ingest",
            extraction_confidence=1.0,
            metadata={
                "filename": filename,
                "mime_type": mime_type,
                "has_transcript": bool(transcript),
                **input_data.metadata,
            },
        )
