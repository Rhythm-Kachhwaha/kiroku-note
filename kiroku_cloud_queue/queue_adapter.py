"""
queue_adapter.py -- Queue abstraction for the ChatGPT MCP -> Kiroku pipeline.

Architecture role:
  - Decouples the MCP ingestion layer (which can run in the cloud while the PC is off)
    from the local worker (which runs on the user's PC when Kiroku is active).
  - The queue is the source of truth for pending card submissions.

Implementations:
  - LocalDevQueueAdapter: SQLite-backed queue for local testing and offline development.
  - CloudQueueAdapter:    Client for a persistent remote queue (e.g. REST/HTTP, Upstash, SQS).
                          Raises CloudQueueNotConfiguredError if required cloud settings are absent.
"""
from __future__ import annotations

import abc
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

import queue_db as qdb


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class VocabCard:
    expression: str
    reading: str = ""
    meaning: str = ""
    sentence: str = ""
    deck_name: str = "N3 vocabs"

    def to_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VocabCard":
        return cls(
            expression=str(data.get("expression", "")).strip(),
            reading=str(data.get("reading", "")).strip(),
            meaning=str(data.get("meaning", "")).strip(),
            sentence=str(data.get("sentence", "")).strip(),
            deck_name=str(data.get("deck_name", "N3 vocabs")).strip() or "N3 vocabs",
        )



@dataclass
class QueueItem:
    id: str
    card: VocabCard
    status: str = "pending"
    attempts: int = 0
    error: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class QueueError(Exception):
    """Base exception for queue operations."""


class CloudQueueNotConfiguredError(QueueError):
    """
    Raised when CloudQueueAdapter is accessed without required cloud credentials or endpoints.

    This ensures the user or system is immediately aware that cloud services
    have not yet been provisioned or configured in the environment.
    """
    def __init__(self, message: Optional[str] = None):
        default_msg = (
            "Cloud queue is not configured. To use the cloud queue backend, set the following "
            "environment variables:\n"
            "  - CLOUD_QUEUE_URL: The HTTPS endpoint of the cloud queue service\n"
            "  - CLOUD_QUEUE_API_KEY: Authentication key / Bearer token for the cloud queue\n"
            "For local testing without cloud services, set QUEUE_BACKEND=local."
        )
        super().__init__(message or default_msg)


# ---------------------------------------------------------------------------
# Abstract Queue Adapter Interface
# ---------------------------------------------------------------------------

class QueueAdapter(abc.ABC):
    """
    Abstract interface for queue storage.

    Both the MCP ingestion service and the local PC worker interact with
    this interface, never directly coupling to each other or to specific storage.
    """

    @abc.abstractmethod
    async def enqueue(self, card: VocabCard) -> str:
        """
        Add a vocabulary card to the queue.
        Returns the unique queue item ID.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def fetch_pending(self, limit: int = 20) -> list[QueueItem]:
        """
        Retrieve up to `limit` pending cards awaiting processing.
        Items returned should not exceed max retry attempts.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def ack(self, item_id: str) -> None:
        """
        Acknowledge successful processing.
        The item is marked as sent/processed or removed from the queue.
        Must only be called AFTER Kiroku successfully saves/syncs the card.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def nack(self, item_id: str, error: str) -> None:
        """
        Record processing failure, increment attempts, and log error message.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def stats(self) -> dict[str, int]:
        """Return diagnostic metrics (e.g. pending, sent, failed counts)."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Local Development Adapter (Offline Testing Only)
# ---------------------------------------------------------------------------

class LocalDevQueueAdapter(QueueAdapter):
    """
    SQLite-backed queue adapter for offline local development and unit tests.

    IMPORTANT: This adapter is strictly for local prototyping. In the final target
    architecture, the cloud queue is the source of truth so cards can be queued
    while the PC is powered off.
    """

    def __init__(self, db_path: Optional[Path | str] = None):
        self.db_path = Path(db_path) if db_path else qdb._DEFAULT_DB_PATH
        qdb.init_queue(self.db_path)

    async def enqueue(self, card: VocabCard) -> str:
        row_id = qdb.enqueue(
            expression=card.expression,
            reading=card.reading,
            meaning=card.meaning,
            sentence=card.sentence,
            deck_name=card.deck_name,
            db_path=self.db_path,
        )
        return str(row_id)

    async def fetch_pending(self, limit: int = 20) -> list[QueueItem]:
        rows = qdb.list_pending(limit=limit, db_path=self.db_path)
        items = []
        for r in rows:
            card = VocabCard(
                expression=r["expression"],
                reading=r["reading"],
                meaning=r["meaning"],
                sentence=r["sentence"],
                deck_name=r["deck_name"],
            )
            items.append(QueueItem(
                id=str(r["id"]),
                card=card,
                status=r["status"],
                attempts=r["attempts"],
                error=r["error"],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
            ))
        return items

    async def ack(self, item_id: str) -> None:
        qdb.mark_sent(int(item_id), db_path=self.db_path)

    async def nack(self, item_id: str, error: str) -> None:
        qdb.mark_failed(int(item_id), error=error, db_path=self.db_path)

    async def stats(self) -> dict[str, int]:
        return qdb.queue_stats(db_path=self.db_path)


# ---------------------------------------------------------------------------
# Cloud Queue Adapter (Target Architecture Placeholder & Client)
# ---------------------------------------------------------------------------

class CloudQueueAdapter(QueueAdapter):
    """
    Adapter for a future cloud-hosted persistent queue service.

    Target workflow:
      1. Cloud MCP server receives card from ChatGPT and calls `enqueue()`.
      2. Cloud queue stores card in persistent storage (e.g. AWS SQS, Upstash Redis,
         Cloudflare KV/D1, Supabase, or a lightweight FastAPI queue endpoint).
      3. User's PC boots up and launches `worker.py`.
      4. `worker.py` polls `fetch_pending()` from this adapter over HTTPS.
      5. Once Kiroku saves the card, `worker.py` calls `ack(item_id)`.

    Configuration:
      - CLOUD_QUEUE_URL: HTTPS base URL of the remote queue API
      - CLOUD_QUEUE_API_KEY: Secret key/token for Bearer auth
      - CLOUD_QUEUE_TIMEOUT: HTTP timeout in seconds (default: 10.0)

    If configuration is absent, all methods raise `CloudQueueNotConfiguredError`.
    """

    def __init__(
        self,
        queue_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 10.0,
    ):
        self.queue_url = (queue_url or os.getenv("CLOUD_QUEUE_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("CLOUD_QUEUE_API_KEY", "")
        self.timeout = timeout

    @property
    def is_configured(self) -> bool:
        return bool(self.queue_url and self.api_key)

    def _ensure_configured(self) -> None:
        if not self.is_configured:
            raise CloudQueueNotConfiguredError()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _sanitize_error(self, text: str) -> str:
        """Strip sensitive API tokens if they appear in error strings."""
        if self.api_key and self.api_key in text:
            return text.replace(self.api_key, "***")
        return text

    async def enqueue(self, card: VocabCard) -> str:
        self._ensure_configured()
        payload = card.to_dict()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.queue_url}/enqueue",
                    json=payload,
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue enqueue failed ({resp.status_code}): {resp.text}"))
                data = resp.json()
                return str(data.get("id", data.get("item_id", "")))
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def fetch_pending(self, limit: int = 20) -> list[QueueItem]:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{self.queue_url}/pending",
                    params={"limit": limit},
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue fetch failed ({resp.status_code}): {resp.text}"))
                items_raw = resp.json()
                if isinstance(items_raw, dict) and "items" in items_raw:
                    items_raw = items_raw["items"]

                items = []
                for item in items_raw:
                    card = VocabCard.from_dict(item.get("card", item))
                    items.append(QueueItem(
                        id=str(item.get("id")),
                        card=card,
                        status=item.get("status", "pending"),
                        attempts=item.get("attempts", 0),
                        error=item.get("error", ""),
                        created_at=item.get("created_at", ""),
                        updated_at=item.get("updated_at", ""),
                    ))
                return items
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def ack(self, item_id: str) -> None:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.queue_url}/ack/{item_id}",
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue ack failed ({resp.status_code}): {resp.text}"))
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def nack(self, item_id: str, error: str) -> None:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.queue_url}/nack/{item_id}",
                    json={"error": error},
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue nack failed ({resp.status_code}): {resp.text}"))
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def stats(self) -> dict[str, int]:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{self.queue_url}/stats",
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue stats failed ({resp.status_code}): {resp.text}"))
                return resp.json()
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc



# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_queue_adapter(
    backend: Optional[str] = None,
    db_path: Optional[Path | str] = None,
) -> QueueAdapter:
    """
    Factory to obtain the configured queue adapter.

    Backend selection:
      - QUEUE_BACKEND="cloud": Returns CloudQueueAdapter
      - QUEUE_BACKEND="local" (default): Returns LocalDevQueueAdapter
    """
    selected = (backend or os.getenv("QUEUE_BACKEND", "local")).strip().lower()
    if selected == "cloud":
        return CloudQueueAdapter()
    return LocalDevQueueAdapter(db_path=db_path)
