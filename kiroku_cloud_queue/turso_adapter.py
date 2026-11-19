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
CREATE TABLE IF NOT EXISTS user_op_log (
    id               TEXT NOT NULL,
    user_id          TEXT NOT NULL DEFAULT 'api-client',
    op_type          TEXT NOT NULL DEFAULT 'card_save',
    payload          TEXT NOT NULL,
    lease_id         TEXT DEFAULT NULL,
    lease_expires_at TEXT DEFAULT NULL,
    ack              INTEGER NOT NULL DEFAULT 0,
    error            TEXT NOT NULL DEFAULT '',
    attempts         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    acked_at         TEXT DEFAULT NULL,
    PRIMARY KEY (user_id, id)
)
"""
OP_LOG_INDEX = "CREATE INDEX IF NOT EXISTS idx_uol_lease ON user_op_log (lease_id, ack, created_at)"
OP_LOG_USER_INDEX = "CREATE INDEX IF NOT EXISTS idx_uol_user_ack ON user_op_log (user_id, ack, created_at)"


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
        if self.db_url.startswith("libsql://"):
            self.db_url = "https://" + self.db_url[9:]
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
            await client.execute(OP_LOG_USER_INDEX)
            try:
                await client.execute("ALTER TABLE user_op_log ADD COLUMN error TEXT NOT NULL DEFAULT ''")
            except Exception:
                pass
        self._schema_initialized = True

    async def enqueue(self, card: VocabCard, user_id: str = "api-client") -> str:
        """Insert a card into op_log queue scoped by user_id."""
        await self.init_schema()
        item_id = str(uuid.uuid4())
        payload_str = json.dumps(card.to_dict(), ensure_ascii=False)
        now_str = datetime.now(timezone.utc).isoformat()

        async with await self._get_client() as client:
            await client.execute(
                "INSERT INTO user_op_log (id, user_id, payload, created_at) VALUES (?, ?, ?, ?)",
                [item_id, user_id, payload_str, now_str],
            )
        return item_id

    async def fetch_pending(self, limit: int = 20, user_id: Optional[str] = None) -> list[QueueItem]:
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
            # 1. Query unleased or expired pending items (excluding dead-lettered items exceeding 5 attempts)
            user_clause = " AND user_id = ?" if user_id else ""
            query_params = [now_iso]
            if user_id:
                query_params.append(user_id)
            query_params.append(limit)

            res = await client.execute(
                f"""
                SELECT id, payload, attempts, user_id
                FROM user_op_log
                WHERE ack = 0
                  AND attempts < 5
                  AND (lease_id IS NULL OR lease_expires_at < ?)
                  {user_clause}
                ORDER BY created_at ASC
                LIMIT ?
                """,
                query_params,
            )

            for row in res.rows:
                row_id = str(row[0])
                payload_raw = row[1]
                attempts = int(row[2] or 0)
                row_user_id = str(row[3]) if len(row) > 3 and row[3] is not None else None

                # Dead-letter if reaching maximum retry attempts
                if attempts + 1 >= 5:
                    user_match = " AND user_id = ?" if row_user_id else ""
                    dl_params = ["max_retries_exceeded", row_id]
                    if row_user_id:
                        dl_params.append(row_user_id)
                    try:
                        await client.execute(
                            f"""
                            UPDATE user_op_log
                            SET ack = 2,
                                lease_id = NULL,
                                lease_expires_at = NULL,
                                error = ?
                            WHERE id = ? {user_match}
                            """,
                            dl_params
                        )
                    except Exception:
                        pass
                    continue

                # 2. Attempt atomic lease acquisition
                user_match = " AND user_id = ?" if row_user_id else ""
                update_params = [claim_token, expires_at, row_id, now_iso]
                if row_user_id:
                    update_params.append(row_user_id)

                update_res = await client.execute(
                    f"""
                    UPDATE user_op_log
                    SET lease_id = ?,
                        lease_expires_at = ?,
                        attempts = attempts + 1
                    WHERE id = ?
                      AND ack = 0
                      AND (lease_id IS NULL OR lease_expires_at < ?)
                      {user_match}
                    """,
                    update_params,
                )

                if update_res.rows_affected > 0:
                    try:
                        card_dict = json.loads(payload_raw) if isinstance(payload_raw, str) else dict(payload_raw)
                        card = VocabCard.from_dict(card_dict)
                    except Exception as err:
                        log.warning("Corrupt payload in op_log id=%s: %s", row_id, err)
                        # Dead-letter corrupt payload instead of creating a dummy card and losing original data
                        try:
                            await client.execute(
                                f"""
                                UPDATE user_op_log
                                SET ack = 2,
                                    lease_id = NULL,
                                    lease_expires_at = NULL,
                                    error = ?
                                WHERE id = ? {user_match}
                                """,
                                [f"corrupt_payload: {err}", row_id] + ([row_user_id] if row_user_id else [])
                            )
                        except Exception:
                            pass
                        continue

                    items.append(
                        QueueItem(
                            id=row_id,
                            card=card,
                            status="claimed",
                            attempts=attempts + 1,
                            claim_token=claim_token,
                            user_id=row_user_id,
                        )
                    )

        return items

    async def ack(self, item_id: str, claim_token: Optional[str] = None, user_id: Optional[str] = None) -> None:
        """Acknowledge completed item."""
        await self.init_schema()
        now_iso = datetime.now(timezone.utc).isoformat()
        async with await self._get_client() as client:
            user_clause = " AND user_id = ?" if user_id else ""
            if claim_token:
                params = [now_iso, item_id, claim_token]
                if user_id:
                    params.append(user_id)
                res = await client.execute(
                    f"""
                    UPDATE user_op_log
                    SET ack = 1,
                        acked_at = ?
                    WHERE id = ? AND lease_id = ? {user_clause}
                    """,
                    params,
                )
            else:
                params = [now_iso, item_id]
                if user_id:
                    params.append(user_id)
                res = await client.execute(
                    f"""
                    UPDATE user_op_log
                    SET ack = 1,
                        acked_at = ?
                    WHERE id = ? {user_clause}
                    """,
                    params,
                )
            if res.rows_affected == 0:
                log.warning("user_op_log ack affected 0 rows for item_id=%s (lease mismatch or already acked)", item_id)

    async def nack(self, item_id: str, error: str, claim_token: Optional[str] = None, user_id: Optional[str] = None) -> None:
        """Release lease on failed processing and record error."""
        await self.init_schema()
        async with await self._get_client() as client:
            user_clause = " AND user_id = ?" if user_id else ""
            try:
                if claim_token:
                    params = [error, item_id, claim_token]
                    if user_id:
                        params.append(user_id)
                    await client.execute(
                        f"""
                        UPDATE user_op_log
                        SET lease_id = NULL,
                            lease_expires_at = NULL,
                            error = ?
                        WHERE id = ? AND lease_id = ? {user_clause}
                        """,
                        params,
                    )
                else:
                    params = [error, item_id]
                    if user_id:
                        params.append(user_id)
                    await client.execute(
                        f"""
                        UPDATE user_op_log
                        SET lease_id = NULL,
                            lease_expires_at = NULL,
                            error = ?
                        WHERE id = ? {user_clause}
                        """,
                        params,
                    )
            except Exception as e:
                err_str = str(e).lower()
                if "no such column: error" in err_str or "has no column named error" in err_str:
                    try:
                        await client.execute("ALTER TABLE user_op_log ADD COLUMN error TEXT NOT NULL DEFAULT ''")
                    except Exception:
                        pass
                    if claim_token:
                        fb_params = [item_id, claim_token]
                        if user_id:
                            fb_params.append(user_id)
                        await client.execute(
                            f"UPDATE user_op_log SET lease_id = NULL, lease_expires_at = NULL WHERE id = ? AND lease_id = ? {user_clause}",
                            fb_params
                        )
                    else:
                        fb_params = [item_id]
                        if user_id:
                            fb_params.append(user_id)
                        await client.execute(
                            f"UPDATE user_op_log SET lease_id = NULL, lease_expires_at = NULL WHERE id = ? {user_clause}",
                            fb_params
                        )
                else:
                    log.warning("nack failed for item_id=%s: %s", item_id, e)

    async def stats(self, user_id: Optional[str] = None) -> dict[str, int]:
        """Return diagnostic metrics from user_op_log."""
        await self.init_schema()
        async with await self._get_client() as client:
            user_clause = " WHERE user_id = ?" if user_id else ""
            query_params = [user_id] if user_id else []
            res = await client.execute(
                f"""
                SELECT
                    COUNT(CASE WHEN ack = 0 AND lease_id IS NULL THEN 1 END) as pending,
                    COUNT(CASE WHEN ack = 0 AND lease_id IS NOT NULL THEN 1 END) as leased,
                    COUNT(CASE WHEN ack = 1 THEN 1 END) as acked,
                    COUNT(*) as total
                FROM user_op_log
                {user_clause}
                """,
                query_params,
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
