"""
Keenable Acquisition Provider.
------------------------------
Primary web extraction provider using Keenable REST API (https://api.keenable.ai).
Features:
- Secure API key resolution (environment or DPAPI SecretStore)
- Keyed (`/v1/fetch`) and keyless (`/v1/fetch/public`) endpoint support
- Exponential backoff with jitter on transient failures (429, 5xx)
- Fail-fast on 403 Forbidden without retrying
- Complete character fidelity, image reference retention, and header preservation
- Absolute redaction of secrets in logging and exception messages
"""
from __future__ import annotations

import logging
import os
import random
import time
from typing import Any
import urllib.parse

import httpx

from app.services.secret_store import get_secret_store
from app.study.acquisition.enums import ProviderKind
from app.study.acquisition.models import FetchOptions, RawFetchResult
from app.study.acquisition.providers.base import BaseAcquisitionProvider

logger = logging.getLogger(__name__)

KEENABLE_BASE_URL = "https://api.keenable.ai"
KEENABLE_TITLE = "kiroku-note"


class KeenableProvider(BaseAcquisitionProvider):
    """Keenable implementation for clean markdown web extraction."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = KEENABLE_BASE_URL,
        client: httpx.Client | None = None,
    ) -> None:
        self._explicit_api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = client

    @property
    def provider_name(self) -> str:
        return ProviderKind.KEENABLE.value

    def _resolve_api_key(self) -> str | None:
        """Resolve API key from explicit arg, environment, or DPAPI SecretStore."""
        if self._explicit_api_key:
            return self._explicit_api_key

        env_key = os.environ.get("KEENABLE_API_KEY")
        if env_key and env_key.strip():
            return env_key.strip()

        try:
            store = get_secret_store()
            stored = store.get_secret("KEENABLE_API_KEY")
            if stored and stored.strip():
                return stored.strip()
        except Exception as exc:
            logger.debug("Failed to read KEENABLE_API_KEY from SecretStore: %s", exc)

        return None

    def is_configured(self) -> bool:
        """Keenable is always configured since it provides both keyed and public tiers."""
        return True

    def fetch_page(self, url: str, options: FetchOptions | None = None) -> RawFetchResult:
        """
        Fetch web page content as markdown via Keenable API.
        Enforces retry and backoff semantics.
        """
        if not url or not url.startswith(("http://", "https://")):
            raise ValueError(f"Invalid URL for acquisition: {url}")

        opts = options or FetchOptions()
        api_key = self._resolve_api_key()

        # Select endpoint: authenticated /v1/fetch or public /v1/fetch/public
        endpoint = f"{self._base_url}/v1/fetch" if api_key else f"{self._base_url}/v1/fetch/public"

        headers = {
            "User-Agent": "KirokuStudyAcquisition/1.0",
            "X-Keenable-Title": KEENABLE_TITLE,
            "Accept": "application/json",
        }
        if api_key:
            headers["X-API-Key"] = api_key

        params: dict[str, Any] = {
            "url": url,
            "max_chars": opts.max_chars,
            "live": str(opts.force_live).lower(),
        }
        if opts.prompt:
            params["prompt"] = opts.prompt

        max_attempts = max(1, opts.max_retries) + (1 if opts.allow_live_fetch else 0)
        last_error: Exception | None = None
        live_retry_used = False

        client = self._client or httpx.Client(timeout=opts.timeout_seconds)
        should_close_client = self._client is None

        try:
            for attempt in range(1, max_attempts + 1):
                start_time = time.perf_counter()
                try:
                    response = client.get(endpoint, headers=headers, params=params)
                    latency_ms = int((time.perf_counter() - start_time) * 1000)

                    # 1. Permanent forbidden / client error check
                    if response.status_code == 403:
                        msg = f"Keenable API access forbidden (HTTP 403) for target URL {url}. Terminating immediately."
                        logger.error(msg)
                        raise PermissionError(msg)

                    # 2. Rate limit (429) or Server error (5xx) -> Backoff and retry
                    if response.status_code in (429, 500, 502, 503, 504):
                        if attempt == max_attempts:
                            response.raise_for_status()

                        retry_after = _retry_after_seconds(
                            response.headers.get("Retry-After"),
                            opts.max_retry_after_seconds,
                        )
                        base_backoff = 2 ** (attempt - 1)
                        jitter = random.uniform(-opts.rate_limit_jitter, opts.rate_limit_jitter)
                        backoff = retry_after if retry_after is not None else max(0.5, base_backoff + jitter)
                        logger.warning(
                            "Keenable HTTP %d on attempt %d/%d for %s. Retrying in %.2fs",
                            response.status_code,
                            attempt,
                            max_attempts,
                            url,
                            backoff,
                        )
                        time.sleep(min(backoff, opts.max_retry_after_seconds))
                        continue

                    response.raise_for_status()

                    # Parse JSON response
                    data = response.json()
                    content = data.get("content", "")
                    title = data.get("title", "")
                    meta = {k: v for k, v in data.items() if k not in ("content", "title")}
                    provider_truncated = bool(
                        data.get("truncated")
                        or data.get("is_truncated")
                        or meta.get("truncation")
                    )
                    not_indexed = bool(data.get("not_indexed") or data.get("indexed") is False)
                    if not_indexed and opts.allow_live_fetch and not opts.force_live and not live_retry_used:
                        live_retry_used = True
                        params["live"] = "true"
                        continue
                    if opts.force_live or live_retry_used:
                        meta["live_fetch_used"] = True

                    # If title wasn't returned in json, extract from first line if markdown Title: header
                    if not title and content.startswith("Title: "):
                        first_line = content.splitlines()[0]
                        title = first_line.replace("Title: ", "").strip()

                    res_headers = {k.lower(): v for k, v in response.headers.items()}

                    return RawFetchResult(
                        url=url,
                        title=title,
                        raw_markdown=content,
                        status_code=response.status_code,
                        headers=res_headers,
                        fetch_latency_ms=latency_ms,
                        provider=self.provider_name,
                        metadata=meta,
                        max_chars=opts.max_chars,
                        truncated=provider_truncated or len(content) >= opts.max_chars,
                    )

                except PermissionError:
                    raise
                except httpx.HTTPStatusError as exc:
                    last_error = exc
                    if exc.response.status_code == 403:
                        raise PermissionError(f"Keenable API 403 Forbidden for {url}") from exc
                    if attempt == max_attempts:
                        break
                    time.sleep(min(2 ** (attempt - 1), opts.max_retry_after_seconds))
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    last_error = exc
                    logger.warning("Keenable network error on attempt %d/%d: %s", attempt, max_attempts, exc)
                    if attempt == max_attempts:
                        break
                    time.sleep(min(2 ** (attempt - 1), opts.max_retry_after_seconds))

            raise RuntimeError(f"Keenable fetch failed after {max_attempts} attempts for {url}: {last_error}") from last_error

        finally:
            if should_close_client:
                client.close()


def _retry_after_seconds(value: str | None, maximum: float) -> float | None:
    """Parse a bounded numeric Retry-After value without exposing request data."""
    if not value:
        return None
    try:
        return max(0.0, min(float(value), maximum))
    except ValueError:
        return None
