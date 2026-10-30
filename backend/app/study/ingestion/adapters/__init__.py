"""
Input Adapters for Question Ingestion.
--------------------------------------
Exports all input adapters:
- PastedTextInputAdapter
- StructuredJsonInputAdapter
- PdfTextInputAdapter
- ScannedImageInputAdapter
- AudioInputAdapter
"""
from __future__ import annotations

from app.study.ingestion.adapters.audio import AudioInputAdapter
from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.adapters.pasted_text import PastedTextInputAdapter
from app.study.ingestion.adapters.pdf_text import PdfTextInputAdapter
from app.study.ingestion.adapters.scanned_image import ScannedImageInputAdapter
from app.study.ingestion.adapters.structured_json import StructuredJsonInputAdapter

__all__ = [
    "BaseInputAdapter",
    "PastedTextInputAdapter",
    "StructuredJsonInputAdapter",
    "PdfTextInputAdapter",
    "ScannedImageInputAdapter",
    "AudioInputAdapter",
]

