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


async def capture_term(text: str, deck_name: str = "Default") -> dict[str, Any]:
    """
    POST /api/capture — invoke Kiroku's Yomitan enrichment pipeline.
    Returns CaptureResponse dict containing synthesized meanings, reading, examples, and JLPT level.
    """
    payload = {"text": text, "deck_name": deck_name, "auto_save": False}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_kiroku_url()}/api/capture",
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


async def save_card(
    expression: str,
    reading: str = "",
    meaning: str = "",
    sentence: str = "",
    deck_name: str = "N3 vocabs",
    sentence_meaning: str = "",
    notes: str = "",
    hint: str = "",
    context: str = "",
    jlpt_level: str = "",
    tags: str = "",
    model_name: str = "",
    source_type: str = "cloud",
    source_url: str = "",
    extra_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    POST /api/cards/save — persist a card in Kiroku's SQLite.
    Passes all supported textual and metadata fields.
    Explicitly excludes media (image and audio).
    Returns the SaveCardResponse dict from Kiroku.
    """
    payload: dict[str, Any] = {
        "expression": expression,
        "reading": reading,
        "meaning": meaning,
        "example_sentence": sentence,
        "example_translation": sentence_meaning,
        "deck_name": deck_name,
        "notes": notes,
        "hint": hint,
        "source_text": context,
        "source_type": source_type,
        "source_url": source_url,
        "tags": tags,
        "model_name": model_name,
        # Media strictly excluded from cloud pipeline
        "image": "",
        "audio": "",
    }
    if jlpt_level:
        payload["jlpt_level"] = jlpt_level

    if extra_data and isinstance(extra_data, dict):
        if "entries" in extra_data:
            payload["entries"] = extra_data["entries"]
        if "kanji_entries" in extra_data:
            payload["kanji_entries"] = extra_data["kanji_entries"]
        if "card_settings" in extra_data:
            payload["card_settings"] = extra_data["card_settings"]
        if "verb_metadata" in extra_data:
            payload["verb_metadata"] = extra_data["verb_metadata"]

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


async def sync_cards_bulk(card_ids: list[int]) -> dict[str, Any]:
    """
    POST /api/cards/bulk-sync -- push a specific list of saved cards to Anki.
    Syncs only the requested card IDs; never touches unrelated local cards.
    """
    payload = {"card_ids": card_ids}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_kiroku_url()}/api/cards/bulk-sync",
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


async def list_cards(
    search: str | None = None,
    deck_name: str | None = None,
    sync_status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """
    GET /api/cards -- list cards from Kiroku's SQLite database.
    """
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if search:
        params["search"] = search
    if deck_name:
        params["deck_name"] = deck_name
    if sync_status:
        params["sync_status"] = sync_status

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                f"{_kiroku_url()}/api/cards",
                params=params,
                headers=_headers(),
            )
    except httpx.ConnectError as exc:
        raise KirokuUnavailableError(f"Cannot connect to Kiroku: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise KirokuUnavailableError(f"Kiroku timed out: {exc}") from exc

    if r.status_code == 200:
        return r.json()
    raise KirokuAPIError(r.status_code, r.text[:300])


async def get_card(card_id: int) -> dict[str, Any]:
    """
    GET /api/cards/{card_id} -- retrieve single card detail.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                f"{_kiroku_url()}/api/cards/{card_id}",
                headers=_headers(),
            )
    except httpx.ConnectError as exc:
        raise KirokuUnavailableError(f"Cannot connect to Kiroku: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise KirokuUnavailableError(f"Kiroku timed out: {exc}") from exc

    if r.status_code == 200:
        return r.json()
    raise KirokuAPIError(r.status_code, r.text[:300])

