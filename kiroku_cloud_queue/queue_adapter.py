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
import asyncio
import os
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

import queue_db as qdb
from env_utils import load_env_file

log = logging.getLogger("kiroku_queue_adapter")

_load_env_file = load_env_file
load_env_file()



# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class VocabCard:
    expression: str
    reading: str = ""
    meaning: str = ""
    sentence: str = ""
    sentence_meaning: str = ""
    notes: str = ""
    hint: str = ""
    context: str = ""
    jlpt_level: str = ""
    tags: str = ""
    deck_name: str = "N3 vocabs"
    model_name: str = ""
    extra_data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if not d.get("extra_data"):
            d.pop("extra_data", None)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VocabCard":
        if not isinstance(data, dict):
            return cls(expression="")

        # Aliases
        sentence_val = data.get("sentence") or data.get("example_sentence") or ""
        sentence_meaning_val = data.get("sentence_meaning") or data.get("example_translation") or ""
        context_val = data.get("context") or data.get("source_text") or ""
        jlpt_val = data.get("jlpt_level") or data.get("jlpt") or ""

        # Tags normalization (string or list[str])
        tags_raw = data.get("tags", "")
        if isinstance(tags_raw, list):
            tags_val = ", ".join(str(t).strip() for t in tags_raw if str(t).strip())
        else:
            tags_val = str(tags_raw or "").strip()

        # Schema policy: capture any unknown fields into extra_data, excluding media
        known_keys = {
            "expression", "reading", "meaning", "sentence", "example_sentence",
            "sentence_meaning", "example_translation", "notes", "hint",
            "context", "source_text", "jlpt_level", "jlpt", "tags",
            "deck_name", "model_name", "extra_data",
            # Excluded media keys:
            "image", "audio", "image_data", "audio_data", "media_mime_type",
        }
        extra_data = {
            k: v for k, v in data.items()
            if k not in known_keys
        }
        if isinstance(data.get("extra_data"), dict):
            extra_data.update(data["extra_data"])

        return cls(
            expression=str(data.get("expression", "")).strip(),
            reading=str(data.get("reading", "")).strip(),
            meaning=str(data.get("meaning", "")).strip(),
            sentence=str(sentence_val).strip(),
            sentence_meaning=str(sentence_meaning_val).strip(),
            notes=str(data.get("notes", "")).strip(),
            hint=str(data.get("hint", "")).strip(),
            context=str(context_val).strip(),
            jlpt_level=str(jlpt_val).strip(),
            tags=tags_val,
            deck_name=str(data.get("deck_name", "N3 vocabs")).strip() or "N3 vocabs",
            model_name=str(data.get("model_name", "")).strip(),
            extra_data=extra_data,
        )



@dataclass
class QueueItem:
    id: str
    card: VocabCard
    status: str = "pending"
    attempts: int = 0
    claim_token: str = ""
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
    async def ack(self, item_id: str, claim_token: Optional[str] = None) -> None:
        """
        Acknowledge successful processing.
        The item is marked as sent/processed or removed from the queue.
        Must only be called AFTER Kiroku successfully saves/syncs the card.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def nack(self, item_id: str, error: str, claim_token: Optional[str] = None) -> None:
        """
        Record processing failure, increment attempts, and log error message.
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def stats(self) -> dict[str, int]:
        """Return diagnostic metrics (e.g. pending, sent, failed counts)."""
        raise NotImplementedError

    async def push_anki_stats(self, stats: dict[str, Any]) -> bool:
        """Push local Anki study metrics snapshot to cloud queue service."""
        return False

    async def push_anki_cards(self, cards: list[dict[str, Any]], schema_version: int = 1) -> bool:
        """Push a batch of mirrored Anki cards to cloud queue service."""
        return False

    async def push_anki_daily(self, days: list[dict[str, Any]], schema_version: int = 1) -> bool:
        """Push a batch of historical daily study series to cloud queue service."""
        return False

    async def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        """Reconcile mirrored cards with the full list of active Anki card IDs. Returns count of deleted cards."""
        return 0

    async def push_anki_meta(self, meta: dict[str, str]) -> bool:
        """Push collection metadata key-values to cloud queue service."""
        return False

    async def push_anki_media(self, media_items: list[dict[str, Any]]) -> bool:
        """Push a batch of card media (compressed WebP images) to cloud queue service."""
        return False

    async def clear_anki_cards(self, include_stats: bool = False) -> bool:
        """Wipe all mirrored cards, media, and cloud study history to allow a fresh start."""
        return False


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

    async def ack(self, item_id: str, claim_token: Optional[str] = None) -> None:
        try:
            int_id = int(item_id)
        except (ValueError, TypeError):
            log.warning("LocalDevQueueAdapter received non-integer item_id %r; ignoring", item_id)
            return
        qdb.mark_sent(int_id, db_path=self.db_path)

    async def nack(self, item_id: str, error: str, claim_token: Optional[str] = None) -> None:
        try:
            int_id = int(item_id)
        except (ValueError, TypeError):
            log.warning("LocalDevQueueAdapter received non-integer item_id %r; ignoring", item_id)
            return
        qdb.mark_failed(int_id, error=error, db_path=self.db_path)

    async def stats(self) -> dict[str, int]:
        return qdb.queue_stats(db_path=self.db_path)

    async def push_anki_stats(self, stats: dict[str, Any]) -> bool:
        try:
            import json
            now = datetime.now(timezone.utc).isoformat()
            payload_str = json.dumps(stats, ensure_ascii=False)
            with qdb._conn(self.db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS anki_stats (
                        id TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL DEFAULT '{}',
                        updated_at TEXT NOT NULL
                    );
                    """
                )
                conn.execute(
                    """
                    INSERT INTO anki_stats (id, payload_json, updated_at)
                    VALUES ('latest', ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    (payload_str, now),
                )
                conn.commit()
            return True
        except Exception as exc:
            log.warning("Failed to save local Anki stats: %s", exc)
            return False

    @property
    def _store(self):
        if getattr(self, "_lazy_store", None) is None:
            from queue_store import SqliteQueueStore
            self._lazy_store = SqliteQueueStore(db_path=self.db_path)
        return self._lazy_store

    async def push_anki_cards(self, cards: list[dict[str, Any]], schema_version: int = 1) -> bool:
        try:
            self._store.upsert_anki_cards(cards)
            return True
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to upsert anki cards: %s", exc)
            return False

    async def push_anki_daily(self, days: list[dict[str, Any]], schema_version: int = 1) -> bool:
        try:
            self._store.upsert_anki_daily(days)
            return True
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to upsert anki daily: %s", exc)
            return False

    async def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        try:
            return int(self._store.reconcile_anki_cards(all_card_ids))
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to reconcile anki cards: %s", exc)
            return 0

    async def push_anki_meta(self, meta: dict[str, str]) -> bool:
        try:
            for k, v in meta.items():
                self._store.set_anki_meta(k, v)
            return True
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to push anki meta: %s", exc)
            return False

    async def push_anki_media(self, media_items: list[dict[str, Any]]) -> bool:
        try:
            import base64
            for item in media_items:
                cid = int(item["card_id"])
                name = str(item.get("media_name", "image.webp"))
                mime = str(item.get("mime_type", "image/webp"))
                img_b64 = item.get("image_webp_b64") or item.get("image_b64", "")
                if img_b64:
                    raw_bytes = base64.b64decode(img_b64)
                    self._store.save_card_media(cid, name, raw_bytes, mime_type=mime)
            return True
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to save anki media: %s", exc)
            return False

    async def clear_anki_cards(self, include_stats: bool = False) -> bool:
        try:
            self._store.clear_all_cards(include_stats=include_stats)
            return True
        except Exception as exc:
            log.warning("LocalDevQueueAdapter: failed to clear anki cards: %s", exc)
            return False


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
        timeout: float = 25.0,
    ):
        self.queue_url = (queue_url if queue_url is not None else os.getenv("CLOUD_QUEUE_URL", "")).rstrip("/")
        self.api_key = api_key if api_key is not None else (
            os.getenv("CLOUD_QUEUE_API_KEY") or os.getenv("WORKER_TOKEN") or os.getenv("MCP_SECRET") or ""
        )
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
                        claim_token=str(item.get("claim_token", "")),
                        error=item.get("error", ""),
                        created_at=item.get("created_at", ""),
                        updated_at=item.get("updated_at", ""),
                    ))
                return items
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def ack(self, item_id: str, claim_token: Optional[str] = None) -> None:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                body = {"claim_token": claim_token} if claim_token else None
                resp = await client.post(
                    f"{self.queue_url}/ack/{item_id}",
                    json=body,
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise QueueError(self._sanitize_error(f"Cloud queue ack failed ({resp.status_code}): {resp.text}"))
        except QueueError:
            raise
        except httpx.HTTPError as exc:
            raise QueueError(self._sanitize_error(f"Cloud queue network error: {exc}")) from exc

    async def nack(self, item_id: str, error: str, claim_token: Optional[str] = None) -> None:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                payload: dict[str, Any] = {"error": error}
                if claim_token:
                    payload["claim_token"] = claim_token
                resp = await client.post(
                    f"{self.queue_url}/nack/{item_id}",
                    json=payload,
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

    async def push_anki_stats(self, stats: dict[str, Any]) -> bool:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.queue_url}/api/stats/anki",
                    json=stats,
                    headers=self._headers(),
                )
                return resp.status_code == 200
        except Exception as exc:
            log.warning("Failed to push Anki stats to cloud queue: %s", exc)
            return False

    async def _post_json_with_retry(self, path: str, payload: dict[str, Any], max_retries: int = 3) -> Optional[dict[str, Any]]:
        self._ensure_configured()
        url = f"{self.queue_url}{path}"
        headers = self._headers()
        backoff = 1.0
        for attempt in range(1, max_retries + 1):
            try:
                # Use a generous timeout for batch operations
                batch_timeout = max(self.timeout, 35.0)
                async with httpx.AsyncClient(timeout=batch_timeout) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    if resp.status_code == 200:
                        try:
                            return resp.json()
                        except Exception:
                            return {}
                    if resp.status_code < 500:
                        log.warning(
                            "Cloud queue rejected %s with HTTP %d: %s",
                            path, resp.status_code, self._sanitize_error(resp.text)
                        )
                        return None
                    log.warning(
                        "Cloud queue returned HTTP %d for %s (attempt %d/%d)",
                        resp.status_code, path, attempt, max_retries
                    )
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPError) as exc:
                log.warning(
                    "Network error during %s (attempt %d/%d): %s",
                    path, attempt, max_retries, self._sanitize_error(str(exc))
                )
            if attempt < max_retries:
                await asyncio.sleep(backoff)
                backoff *= 2.0
        return None

    async def _post_with_retry(self, path: str, payload: dict[str, Any], max_retries: int = 3) -> bool:
        res = await self._post_json_with_retry(path, payload, max_retries=max_retries)
        return res is not None

    async def push_anki_cards(self, cards: list[dict[str, Any]], schema_version: int = 1) -> bool:
        return await self._post_with_retry("/api/anki/cards", {"schema_version": schema_version, "cards": cards})

    async def push_anki_daily(self, days: list[dict[str, Any]], schema_version: int = 1) -> bool:
        return await self._post_with_retry("/api/anki/daily", {"schema_version": schema_version, "days": days})

    async def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        res = await self._post_json_with_retry("/api/anki/reconcile", {"card_ids": all_card_ids, "total": len(all_card_ids)})
        if isinstance(res, dict):
            return int(res.get("deleted", 0))
        return 0

    async def push_anki_meta(self, meta: dict[str, str]) -> bool:
        return await self._post_with_retry("/api/anki/meta", {"meta": meta})

    async def push_anki_media(self, media_items: list[dict[str, Any]]) -> bool:
        return await self._post_with_retry("/api/anki/media", {"media": media_items})

    async def clear_anki_cards(self, include_stats: bool = False) -> bool:
        return await self._post_with_retry("/api/anki/cards/clear", {"include_stats": include_stats})



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
