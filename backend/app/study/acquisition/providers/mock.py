"""
Mock Acquisition Provider for Offline Unit & Integration Testing.
-----------------------------------------------------------------
Allows registering simulated or fixture responses for specific URLs.
Enables comprehensive testing without consuming external API credits.
"""
from __future__ import annotations

from pathlib import Path

from app.study.acquisition.enums import ProviderKind
from app.study.acquisition.models import FetchOptions, RawFetchResult
from app.study.acquisition.providers.base import BaseAcquisitionProvider


class MockAcquisitionProvider(BaseAcquisitionProvider):
    """In-memory mock provider for deterministic offline testing."""

    def __init__(self) -> None:
        self._pages: dict[str, RawFetchResult] = {}
        self.recorded_calls: list[str] = []

    @property
    def provider_name(self) -> str:
        return ProviderKind.MOCK.value

    def is_configured(self) -> bool:
        return True

    def register_page(
        self,
        url: str,
        raw_markdown: str,
        title: str = "",
        status_code: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        """Register a canned response for a specific URL."""
        res = RawFetchResult(
            url=url,
            title=title,
            raw_markdown=raw_markdown,
            status_code=status_code,
            headers=headers or {"content-type": "text/markdown"},
            fetch_latency_ms=10,
            provider=self.provider_name,
        )
        self._pages[url] = res
        self._pages[url.rstrip("/")] = res
        self._pages[f"{url.rstrip('/')}/"] = res

    def register_fixture(self, url: str, fixture_path: Path, title: str = "") -> None:
        """Load canned markdown from a local fixture file."""
        content = fixture_path.read_text(encoding="utf-8")
        self.register_page(url=url, raw_markdown=content, title=title)

    def fetch_page(self, url: str, options: FetchOptions | None = None) -> RawFetchResult:
        """Return registered response or raise ValueError."""
        self.recorded_calls.append(url)
        norm = url.rstrip("/")
        if url in self._pages:
            return self._pages[url]
        elif norm in self._pages:
            return self._pages[norm]
        elif f"{norm}/" in self._pages:
            return self._pages[f"{norm}/"]
        raise ValueError(f"MockAcquisitionProvider: No registered response for URL: {url}")

