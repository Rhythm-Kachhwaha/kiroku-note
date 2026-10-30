"""
Base Input Adapter Interface for Question Ingestion.
----------------------------------------------------
Defines the contract for transforming raw external inputs into unified ExtractedDocument objects.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.study.ingestion.models import ExtractedDocument, IngestInput


class BaseInputAdapter(ABC):
    """Abstract base class for all question ingestion input adapters."""

    @abstractmethod
    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        """
        Extract document content, text, pages, and media from raw input.

        Raises:
            ValueError: If input payload is empty, invalid, or malformed.
        """
        raise NotImplementedError

