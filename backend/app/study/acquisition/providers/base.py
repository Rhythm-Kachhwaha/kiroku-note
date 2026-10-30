"""
Base Acquisition Provider Interface.
------------------------------------
Defines the contract for external web extraction providers.
All provider implementations must adhere to this interface without leaking
vendor-specific HTTP or JSON structures.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.study.acquisition.models import FetchOptions, RawFetchResult


class BaseAcquisitionProvider(ABC):
    """Abstract interface for remote web extraction."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g. 'keenable', 'parallel', 'mock')."""
        pass

    @abstractmethod
    def fetch_page(self, url: str, options: FetchOptions | None = None) -> RawFetchResult:
        """
        Fetch an individual page and return clean markdown content.

        Raises:
            ValueError: If URL is invalid or malformed.
            PermissionError: If API authentication fails or provider is blocked (403).
            RuntimeError: If rate limits or transient errors exceed retry limits.
        """
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Verify that provider credentials or configuration are present."""
        pass

