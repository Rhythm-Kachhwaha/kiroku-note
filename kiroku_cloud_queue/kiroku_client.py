"""
kiroku_client.py -- Async HTTP client for the Kiroku local backend.

Calls only documented Kiroku API routes over loopback (127.0.0.1).
No existing Kiroku file is modified.

Host header is always set to match the loopback address so Kiroku's
validate_request_security middleware accepts the request.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

# Default Kiroku backend URL.  Override with KIROKU_URL env var.
_DEFAULT_KIROKU_URL = "http://127.0.0.1:21828"
# Timeout for calls to Kiroku backend (seconds)
_TIMEOUT = 10.0


def _kiroku_url() -> str:
    return os.getenv("KIROKU_URL", _DEFAULT_KIROKU_URL).rstrip("/")


def _headers() -> dict[str, str]:
    """
    Set Host to the loopback address so Kiroku's Host-header check passes.
    The Origin header is omitted on non-browser calls; Kiroku's middleware
    only checks Origin on POST/PUT/PATCH/DELETE when Origin is present.
    Omitting it from a Python client is safe.
    """
    host = _kiroku_url().removeprefix("http://").removeprefix("https://")
    return {"Host": host}


class KirokuUnavailableError(Exception):
    """Raised when Kiroku backend is not reachable."""


class KirokuAPIError(Exception):
    """Raised when Kiroku returns an HTTP error response."""
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Kiroku API error {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail


async def is_kiroku_alive() -> bool:
    """Return True if the Kiroku backend is reachable."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                f"{_kiroku_url()}/api/health",
                headers=_headers(),
            )
            return r.status_code == 200
    except Exception:
        return False


async def save_card(
    expression: str,
    reading: str,
    meaning: str,
    sentence: str,
    deck_name: str,
) -> dict[str, Any]:
    """
    POST /api/cards/save — persist a card in Kiroku's SQLite.
    Returns the SaveCardResponse dict from Kiroku.
    """
    payload: dict[str, Any] = {
        "expression": expression,
        "reading": reading,
        "meaning": meaning,
        "example_sentence": sentence,
        "deck_name": deck_name,
        "source_type": "chatgpt_mcp",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_kiroku_url()}/api/cards/save",
                json=payload,
                headers=_headers(),
            )
    except httpx.ConnectError as exc:
        raise KirokuUnavailableError(f"Cannot connect to Kiroku: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise KirokuUnavailableError(f"Kiroku timed out: {exc}") from exc

    if r.status_code == 200:
        return r.json()
    raise KirokuAPIError(r.status_code, r.text[:300])


async def sync_card(card_id: int) -> dict[str, Any]:
    """
    POST /api/cards/{card_id}/sync -- push a saved card to Anki.
    Returns the SyncCardResponse dict from Kiroku.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_kiroku_url()}/api/cards/{card_id}/sync",
                headers=_headers(),
            )
    except httpx.ConnectError as exc:
        raise KirokuUnavailableError(f"Cannot connect to Kiroku: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise KirokuUnavailableError(f"Kiroku timed out: {exc}") from exc

    if r.status_code == 200:
        return r.json()
    raise KirokuAPIError(r.status_code, r.text[:300])
