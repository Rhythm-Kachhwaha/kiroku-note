"""
postgres_store.py -- PostgreSQL implementation of BaseQueueStore for production cloud queue hosting.

Designed for Google Cloud Run + Supabase or any managed PostgreSQL instance.
Uses PostgreSQL's 'SELECT ... FOR UPDATE SKIP LOCKED' to achieve atomic, non-blocking
lease claims across multiple concurrent workers.
"""
from __future__ import annotations

import json
import logging
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from queue_adapter import QueueItem, VocabCard
from queue_store import (
    DEFAULT_LEASE_SECONDS,
    MAX_ATTEMPTS,
    BaseQueueStore,
    compute_idempotency_key,
)

log = logging.getLogger("kiroku_postgres_store")


class PostgresQueueStore(BaseQueueStore):
    def __init__(self, connection_url: str):
        # Normalize postgres:// to postgresql:// for modern psycopg/SQL drivers
        if connection_url.startswith("postgres://"):
            connection_url = "postgresql://" + connection_url[len("postgres://"):]
        self.connection_url = connection_url
        self._pool = None
        try:
            import psycopg  # psycopg 3
            self._driver = "psycopg"
            try:
                from psycopg_pool import ConnectionPool
                self._pool = ConnectionPool(
                    self.connection_url,
                    min_size=1,
                    max_size=10,
                    open=True,
                    timeout=30.0,
                )
            except Exception as pool_err:
                log.debug("psycopg_pool not available or failed to initialize: %s", pool_err)
        except ImportError:
            try:
                import psycopg2  # psycopg 2 fallback
                self._driver = "psycopg2"
                try:
                    from psycopg2.pool import SimpleConnectionPool
                    self._pool = SimpleConnectionPool(1, 10, self.connection_url)
                except Exception as pool_err:
                    log.debug("psycopg2 SimpleConnectionPool failed to initialize: %s", pool_err)
            except ImportError:
                raise ImportError(
                    "PostgresQueueStore requires 'psycopg' or 'psycopg2-binary'. "
                    "Install it via: pip install 'psycopg[binary,pool]'"
                )

    def close(self) -> None:
        """Close connection pool if open."""
        if self._pool is not None:
            try:
                self._pool.close()
            except Exception:
                pass
            self._pool = None

    @contextmanager
    def _get_connection(self):
        """Context manager providing an active connection, preferring the connection pool."""
        if self._pool is not None:
            if self._driver == "psycopg":
                with self._pool.connection() as conn:
                    yield conn
            else:
                conn = self._pool.getconn()
                try:
                    yield conn
                finally:
                    self._pool.putconn(conn)
        elif self._driver == "psycopg":
            import psycopg
            with psycopg.connect(self.connection_url) as conn:
                yield conn
        else:
            import psycopg2
            conn = psycopg2.connect(self.connection_url)
            try:
                yield conn
            finally:
                conn.close()

    def init_db(self) -> None:
        """
        Idempotently create queued_cards table and performance indexes if they don't already exist.
        Safe for zero-config deployments on Neon, Supabase, Render PostgreSQL, or AWS RDS.
        """
        create_sql = """
        CREATE TABLE IF NOT EXISTS queued_cards (
            id VARCHAR(64) PRIMARY KEY,
            idempotency_key VARCHAR(128) UNIQUE NOT NULL,
            expression TEXT NOT NULL,
            reading TEXT DEFAULT '',
            meaning TEXT DEFAULT '',
            sentence TEXT DEFAULT '',
            sentence_meaning TEXT DEFAULT '',
            deck_name TEXT DEFAULT 'N3 vocabs',
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            attempts INT NOT NULL DEFAULT 0,
            claim_token VARCHAR(64) DEFAULT NULL,
            claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
            lease_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
            error TEXT DEFAULT '',
            payload_json TEXT DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- Self-healing migration for existing tables created before claimed_at was added
        ALTER TABLE queued_cards ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

        CREATE TABLE IF NOT EXISTS anki_stats (
            id VARCHAR(64) PRIMARY KEY,
            payload_json TEXT DEFAULT '{}',
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_queued_cards_status_attempts
            ON queued_cards (status, attempts);

        CREATE INDEX IF NOT EXISTS idx_queued_cards_lease
            ON queued_cards (status, lease_expires_at);

        CREATE INDEX IF NOT EXISTS idx_queued_cards_created
            ON queued_cards (created_at DESC);
        """
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(create_sql)
            conn.commit()
        log.info("PostgresQueueStore database initialized successfully.")

    def enqueue(self, card: VocabCard, idempotency_key: Optional[str] = None) -> tuple[str, bool]:
        key = idempotency_key or compute_idempotency_key(card)
        item_id = str(uuid.uuid4())
        payload_json = json.dumps(card.to_dict(), ensure_ascii=False)

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                # Atomic INSERT with ON CONFLICT to eliminate TOCTOU race conditions
                cur.execute(
                    """
                    INSERT INTO queued_cards (
                        id, idempotency_key, expression, reading, meaning,
                        sentence, sentence_meaning, deck_name, status, attempts,
                        error, payload_json, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', 0, '', %s, NOW(), NOW())
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING id
                    """,
                    (
                        item_id,
                        key,
                        card.expression,
                        card.reading,
                        card.meaning,
                        card.sentence,
                        card.sentence_meaning,
                        card.deck_name,
                        payload_json,
                    ),
                )
                inserted = cur.fetchone()
                if inserted:
                    conn.commit()
                    return str(inserted[0]), False

                # Conflict occurred -- fetch the existing item's ID
                cur.execute(
                    "SELECT id FROM queued_cards WHERE idempotency_key = %s LIMIT 1",
                    (key,),
                )
                existing = cur.fetchone()
                conn.commit()
                if existing:
                    return str(existing[0]), True
                return item_id, False

    def claim_pending(self, limit: int = 20, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> list[QueueItem]:
        now_dt = datetime.now(timezone.utc)
        lease_expires = now_dt + timedelta(seconds=lease_seconds)

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                # Use FOR UPDATE SKIP LOCKED for atomic concurrent claims without race conditions
                cur.execute(
                    """
                    SELECT id FROM queued_cards
                    WHERE (status = 'pending' AND attempts < %s)
                       OR (status = 'claimed' AND lease_expires_at < NOW() AND attempts < %s)
                    ORDER BY created_at ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                    """,
                    (MAX_ATTEMPTS, MAX_ATTEMPTS, limit),
                )
                rows = cur.fetchall()
                if not rows:
                    conn.commit()
                    return []

                claimed_items: list[QueueItem] = []
                for (item_id,) in rows:
                    claim_token = str(uuid.uuid4())
                    cur.execute(
                        """
                        UPDATE queued_cards
                        SET status = 'claimed',
                            claim_token = %s,
                            claimed_at = NOW(),
                            lease_expires_at = %s,
                            attempts = attempts + 1,
                            updated_at = NOW()
                        WHERE id = %s
                        RETURNING id, expression, reading, meaning, sentence,
                                  sentence_meaning, deck_name, status, attempts,
                                  claim_token, error, created_at, updated_at, payload_json
                        """,
                        (claim_token, lease_expires, item_id),
                    )
                    r = cur.fetchone()
                    if r:
                        claimed_items.append(self._row_to_item(r))

                conn.commit()
                return claimed_items

    def ack(self, item_id: str, claim_token: Optional[str] = None) -> bool:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                if claim_token:
                    cur.execute(
                        """
                        UPDATE queued_cards
                        SET status = 'completed',
                            claim_token = NULL,
                            lease_expires_at = NULL,
                            updated_at = NOW()
                        WHERE id = %s AND claim_token = %s
                        """,
                        (item_id, claim_token),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE queued_cards
                        SET status = 'completed',
                            claim_token = NULL,
                            lease_expires_at = NULL,
                            updated_at = NOW()
                        WHERE id = %s AND status = 'claimed'
                        """,
                        (item_id,),
                    )
                conn.commit()
                return cur.rowcount > 0

    def nack(self, item_id: str, error: str = "", claim_token: Optional[str] = None) -> bool:
        clean_err = error[:1000]
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                # Atomic status calculation inside SQL CASE to eliminate read-modify-write race
                if claim_token:
                    cur.execute(
                        """
                        UPDATE queued_cards
                        SET status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'pending' END,
                            error = %s,
                            claim_token = NULL,
                            lease_expires_at = NULL,
                            updated_at = NOW()
                        WHERE id = %s AND claim_token = %s
                        """,
                        (MAX_ATTEMPTS, clean_err, item_id, claim_token),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE queued_cards
                        SET status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'pending' END,
                            error = %s,
                            claim_token = NULL,
                            lease_expires_at = NULL,
                            updated_at = NOW()
                        WHERE id = %s
                        """,
                        (MAX_ATTEMPTS, clean_err, item_id),
                    )
                conn.commit()
                return cur.rowcount > 0

    def stats(self) -> dict[str, int]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status, COUNT(*) FROM queued_cards GROUP BY status")
                rows = cur.fetchall()
                return {r[0]: int(r[1]) for r in rows}

    def _row_to_item(self, r: tuple) -> QueueItem:
        raw_payload = r[13] if len(r) > 13 else None
        if raw_payload and isinstance(raw_payload, dict):
            card = VocabCard.from_dict(raw_payload)
        elif raw_payload and isinstance(raw_payload, str) and raw_payload != "{}":
            try:
                card = VocabCard.from_dict(json.loads(raw_payload))
            except Exception:
                card = VocabCard(
                    expression=r[1],
                    reading=r[2],
                    meaning=r[3],
                    sentence=r[4],
                    sentence_meaning=r[5] or "",
                    deck_name=r[6] or "N3 vocabs",
                )
        else:
            card = VocabCard(
                expression=r[1],
                reading=r[2],
                meaning=r[3],
                sentence=r[4],
                sentence_meaning=r[5] or "",
                deck_name=r[6] or "N3 vocabs",
            )
        return QueueItem(
            id=str(r[0]),
            card=card,
            status=r[7],
            attempts=r[8],
            claim_token=str(r[9] or ""),
            error=r[10] or "",
            created_at=str(r[11]),
            updated_at=str(r[12]),
        )

    def get_item(self, item_id: str) -> Optional[QueueItem]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, expression, reading, meaning, sentence,
                           sentence_meaning, deck_name, status, attempts,
                           claim_token, error, created_at, updated_at, payload_json
                    FROM queued_cards WHERE id = %s
                    """,
                    (item_id,),
                )
                r = cur.fetchone()
                if not r:
                    return None
                return self._row_to_item(r)

    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        limit = min(max(1, limit), 50)
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, expression, reading, meaning, deck_name,
                           status, created_at, error
                    FROM queued_cards
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                cols = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                results = []
                for row in rows:
                    item_dict = dict(zip(cols, row))
                    if "created_at" in item_dict and item_dict["created_at"] is not None:
                        item_dict["created_at"] = str(item_dict["created_at"])
                    if "id" in item_dict and item_dict["id"] is not None:
                        item_dict["id"] = str(item_dict["id"])
                    results.append(item_dict)
                return results

    def save_anki_stats(self, payload: dict[str, Any]) -> None:
        payload_str = json.dumps(payload, ensure_ascii=False)
        upsert_sql = """
        INSERT INTO anki_stats (id, payload_json, updated_at)
        VALUES ('latest', %s, NOW())
        ON CONFLICT (id) DO UPDATE SET
            payload_json = EXCLUDED.payload_json,
            updated_at = NOW();
        """
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(upsert_sql, (payload_str,))
            conn.commit()

    def get_anki_stats(self) -> Optional[dict[str, Any]]:
        query = "SELECT payload_json, updated_at FROM anki_stats WHERE id = 'latest';"
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query)
                row = cur.fetchone()
                if not row:
                    return None
                payload_val = row[0]
                updated_at_val = row[1]
                if isinstance(payload_val, dict):
                    data = payload_val
                else:
                    try:
                        data = json.loads(payload_val)
                    except Exception:
                        return None
                if isinstance(data, dict):
                    data.setdefault("updated_at", str(updated_at_val))
                    return data
                return {"data": data, "updated_at": str(updated_at_val)}
