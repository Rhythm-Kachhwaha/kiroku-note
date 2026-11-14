"""
turso_adapter.py -- Direct libSQL / Turso queue adapter for Kiroku Cloud Worker.
Provides sub-millisecond edge queue access with durable lease management and atomic acknowledgements.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import libsql_client

from queue_adapter import (
    QueueAdapter,
    QueueError,
    QueueItem,
    VocabCard,
)

log = logging.getLogger("kiroku_turso_adapter")

OP_LOG_TABLE = """
CREATE TABLE IF NOT EXISTS op_log (
    id               TEXT PRIMARY KEY,
    payload          TEXT NOT NULL,
    lease_id         TEXT DEFAULT NULL,
    lease_expires_at TEXT DEFAULT NULL,
    ack              INTEGER NOT NULL DEFAULT 0,
    error            TEXT NOT NULL DEFAULT '',
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    acked_at         TEXT DEFAULT NULL
)
"""
OP_LOG_INDEX = "CREATE INDEX IF NOT EXISTS idx_oplog_lease ON op_log (lease_id, ack, created_at)"


class TursoQueueAdapter(QueueAdapter):
    """
    Direct Turso (libSQL) queue adapter.
    Interacts with Turso edge database directly using libsql-client.
    """

    def __init__(
        self,
        db_url: Optional[str] = None,
        auth_token: Optional[str] = None,
        lease_duration: int = 60,
    ):
        self.db_url = (db_url or os.getenv("TURSO_DATABASE_URL", "")).strip()
        self.auth_token = (auth_token or os.getenv("TURSO_AUTH_TOKEN", "")).strip()
        self.lease_duration = lease_duration
        self._schema_initialized = False

        if not self.db_url:
            raise QueueError(
                "TursoQueueAdapter requires TURSO_DATABASE_URL to be set."
            )

    async def _get_client(self):
        return libsql_client.create_client(
            url=self.db_url,
            auth_token=self.auth_token if self.auth_token else None,
        )

    async def init_schema(self) -> None:
        """Create op_log table and indexes if they do not exist."""
        if self._schema_initialized:
            return
        async with await self._get_client() as client:
            await client.execute(OP_LOG_TABLE)
            await client.execute(OP_LOG_INDEX)
        self._schema_initialized = True

    async def enqueue(self, card: VocabCard) -> str:
        """Insert a card into op_log queue."""
        await self.init_schema()
        item_id = str(uuid.uuid4())
        payload_str = json.dumps(card.to_dict(), ensure_ascii=False)
        now_str = datetime.now(timezone.utc).isoformat()

        async with await self._get_client() as client:
            await client.execute(
                "INSERT INTO op_log (id, payload, created_at) VALUES (?, ?, ?)",
                [item_id, payload_str, now_str],
            )
        return item_id

    async def fetch_pending(self, limit: int = 20) -> list[QueueItem]:
        """
        Lease up to `limit` pending unacked items from op_log.
        Uses atomic lease claim with lease_id and expiration.
        """
        await self.init_schema()
        now_iso = datetime.now(timezone.utc).isoformat()
        claim_token = str(uuid.uuid4())
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=self.lease_duration)).isoformat()

        items: list[QueueItem] = []
        async with await self._get_client() as client:
            # 1. Query unleased or expired pending items
            res = await client.execute(
                """
                SELECT id, payload, attempts
                FROM op_log
                WHERE ack = 0
                  AND (lease_id IS NULL OR lease_expires_at < ?)
                ORDER BY created_at ASC
                LIMIT ?
                """,
                [now_iso, limit],
            )

            for row in res.rows:
                row_id = str(row[0])
                payload_raw = row[1]
                attempts = int(row[2] or 0)

                # 2. Attempt atomic lease acquisition
                update_res = await client.execute(
                    """
                    UPDATE op_log
                    SET lease_id = ?,
                        lease_expires_at = ?,
                        attempts = attempts + 1
                    WHERE id = ?
                      AND ack = 0
                      AND (lease_id IS NULL OR lease_expires_at < ?)
                    """,
                    [claim_token, expires_at, row_id, now_iso],
                )

                if update_res.rows_affected > 0:
                    try:
                        card_dict = json.loads(payload_raw) if isinstance(payload_raw, str) else dict(payload_raw)
                        card = VocabCard.from_dict(card_dict)
                    except Exception as err:
                        log.warning("Corrupt payload in op_log id=%s: %s", row_id, err)
                        card = VocabCard(expression="[corrupted_payload]")

                    items.append(
                        QueueItem(
                            id=row_id,
                            card=card,
                            status="claimed",
                            attempts=attempts + 1,
                            claim_token=claim_token,
                        )
                    )

        return items

    async def ack(self, item_id: str, claim_token: Optional[str] = None) -> None:
        """Acknowledge completed item."""
        await self.init_schema()
        now_iso = datetime.now(timezone.utc).isoformat()
        async with await self._get_client() as client:
            if claim_token:
                res = await client.execute(
                    """
                    UPDATE op_log
                    SET ack = 1,
                        acked_at = ?
                    WHERE id = ? AND lease_id = ?
                    """,
                    [now_iso, item_id, claim_token],
                )
            else:
                res = await client.execute(
                    """
                    UPDATE op_log
                    SET ack = 1,
                        acked_at = ?
                    WHERE id = ?
                    """,
                    [now_iso, item_id],
                )
            if res.rows_affected == 0:
                log.warning("op_log ack affected 0 rows for item_id=%s (lease mismatch or already acked)", item_id)

    async def nack(self, item_id: str, error: str, claim_token: Optional[str] = None) -> None:
        """Release lease on failed processing and record error."""
        await self.init_schema()
        async with await self._get_client() as client:
            if claim_token:
                await client.execute(
                    """
                    UPDATE op_log
                    SET lease_id = NULL,
                        lease_expires_at = NULL,
                        error = ?
                    WHERE id = ? AND lease_id = ?
                    """,
                    [error, item_id, claim_token],
                )
            else:
                await client.execute(
                    """
                    UPDATE op_log
                    SET lease_id = NULL,
                        lease_expires_at = NULL,
                        error = ?
                    WHERE id = ?
                    """,
                    [error, item_id],
                )

    async def stats(self) -> dict[str, int]:
        """Return diagnostic metrics from op_log."""
        await self.init_schema()
        async with await self._get_client() as client:
            res = await client.execute(
                """
                SELECT
                    COUNT(CASE WHEN ack = 0 AND lease_id IS NULL THEN 1 END) as pending,
                    COUNT(CASE WHEN ack = 0 AND lease_id IS NOT NULL THEN 1 END) as leased,
                    COUNT(CASE WHEN ack = 1 THEN 1 END) as acked,
                    COUNT(*) as total
                FROM op_log
                """
            )
            if res.rows:
                r = res.rows[0]
                return {
                    "pending": int(r[0] or 0),
                    "leased": int(r[1] or 0),
                    "acked": int(r[2] or 0),
                    "total": int(r[3] or 0),
                }
            return {"pending": 0, "leased": 0, "acked": 0, "total": 0}
