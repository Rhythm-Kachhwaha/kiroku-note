"""
Parallel Dormant Acquisition Provider.
--------------------------------------
Optional, secondary provider adapter. Retained solely for architectural flexibility
behind the BaseAcquisitionProvider seam.
Per Decision 1:
- Parallel is dormant and disabled by default.
- It will NOT make any network requests unless explicitly configured with
  KIROKU_ACQUISITION_PROVIDER="parallel" and a valid PARALLEL_API_KEY.
"""
from __future__ import annotations

import logging
import os
import time

import httpx

from app.study.acquisition.enums import ProviderKind
from app.study.acquisition.models import FetchOptions, RawFetchResult
from app.study.acquisition.providers.base import BaseAcquisitionProvider

logger = logging.getLogger(__name__)

PARALLEL_BASE_URL = "https://api.parallel.ai"


class ParallelProvider(BaseAcquisitionProvider):
    """Secondary dormant provider for Parallel API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = PARALLEL_BASE_URL,
        enabled: bool = False,
    ) -> None:
        self._explicit_key = api_key
        self._base_url = base_url.rstrip("/")
        self._explicit_enabled = enabled

    @property
    def provider_name(self) -> str:
        return ProviderKind.PARALLEL.value

    def is_configured(self) -> bool:
        """Check if Parallel is explicitly enabled and has an API key."""
        is_active = (
            self._explicit_enabled
            or os.environ.get("KIROKU_ACQUISITION_PROVIDER", "").lower() == "parallel"
        )
        has_key = bool(self._resolve_api_key())
        return is_active and has_key

    def _resolve_api_key(self) -> str | None:
        if self._explicit_key:
            return self._explicit_key
        return os.environ.get("PARALLEL_API_KEY")

    def fetch_page(self, url: str, options: FetchOptions | None = None) -> RawFetchResult:
        """Fetch content using Parallel API if enabled."""
        if not self.is_configured():
            raise RuntimeError(
                "Parallel provider is dormant and disabled by default. "
                "To enable it, set KIROKU_ACQUISITION_PROVIDER=parallel and provide PARALLEL_API_KEY."
            )

        opts = options or FetchOptions()
        api_key = self._resolve_api_key()
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "urls": [url],
            "full_content": True,
            "allow_live_fetch": opts.force_live,
        }

        start_time = time.perf_counter()
        with httpx.Client(timeout=opts.timeout_seconds) as client:
            resp = client.post(f"{self._base_url}/v1/extract", headers=headers, json=payload)
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            resp.raise_for_status()
            data = resp.json()

            results = data.get("results", [])
            if not results:
                raise RuntimeError(f"Parallel returned empty results for {url}")

            first = results[0]
            return RawFetchResult(
                url=url,
                title=first.get("title", ""),
                raw_markdown=first.get("markdown", "") or first.get("content", ""),
                status_code=resp.status_code,
                headers={k.lower(): v for k, v in resp.headers.items()},
                fetch_latency_ms=latency_ms,
                provider=self.provider_name,
                metadata={"parallel_id": data.get("id")},
            )

