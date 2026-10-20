"""
postgres_store.py -- PostgreSQL implementation of BaseQueueStore for production cloud queue hosting.

Designed for Google Cloud Run + Supabase or any managed PostgreSQL instance.
Uses PostgreSQL's 'SELECT ... FOR UPDATE SKIP LOCKED' to achieve atomic, non-blocking
lease claims across multiple concurrent workers.
"""
from __future__ import annotations

import decimal
import hashlib
import json
import logging
import os
import random
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from queue_adapter import QueueItem, VocabCard
from queue_store import (
    DEFAULT_LEASE_SECONDS,
    MAX_ATTEMPTS,
    BaseQueueStore,
    compute_idempotency_key,
    get_anki_collection_day,
    get_anki_today_start,
)

log = logging.getLogger("kiroku_postgres_store")


def _normalize_json_types(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _normalize_json_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_normalize_json_types(v) for v in obj]
    elif isinstance(obj, tuple):
        return tuple(_normalize_json_types(v) for v in obj)
    elif isinstance(obj, decimal.Decimal):
        return float(obj)
    elif isinstance(obj, (datetime, date)):
        return obj.isoformat()
    elif isinstance(obj, memoryview):
        return bytes(obj)
    return obj


def get_anki_collection_day(dt: datetime, tz: ZoneInfo, rollover_hour: int = 4) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local_dt = dt.astimezone(tz)
    adjusted_dt = local_dt - timedelta(hours=rollover_hour)
    return adjusted_dt.date()


def get_anki_today_start(tz: ZoneInfo, rollover_hour: int = 4) -> datetime:
    now_utc = datetime.now(timezone.utc)
    current_day = get_anki_collection_day(now_utc, tz, rollover_hour)
    local_start = datetime(current_day.year, current_day.month, current_day.day, rollover_hour, 0, 0, tzinfo=tz)
    return local_start.astimezone(timezone.utc)



def _to_pg_timestamp(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        try:
            return datetime.fromisoformat(val)
        except Exception:
            return None
    return None


class PostgresQueueStore(BaseQueueStore):
    def __init__(self, connection_url: str, schema: Optional[str] = None):
        # Normalize postgres:// to postgresql:// for modern psycopg/SQL drivers
        if connection_url.startswith("postgres://"):
            connection_url = "postgresql://" + connection_url[len("postgres://"):]
        self.connection_url = connection_url
        self.schema = schema
        self._pool = None
        try:
            import psycopg  # psycopg 3
            self._driver = "psycopg"
            try:
                from psycopg_pool import ConnectionPool
                pool_kwargs: dict[str, Any] = {
                    "min_size": 1,
                    "max_size": 10,
                    "open": True,
                    "timeout": 30.0,
                }
                if hasattr(ConnectionPool, "check_connection"):
                    pool_kwargs["check"] = ConnectionPool.check_connection
                pool_kwargs["max_idle"] = 300.0
                try:
                    self._pool = ConnectionPool(self.connection_url, **pool_kwargs)
                except TypeError:
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
        if self.schema:
            try:
                import psycopg
                with psycopg.connect(self.connection_url) as conn:
                    with conn.cursor() as cur:
                        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}";')
                    conn.commit()
            except Exception as e:
                log.debug("Schema creation in init: %s", e)

    def close(self) -> None:
        """Close connection pool if open."""
        if self._pool is not None:
            try:
                self._pool.close()
            except Exception:
                pass
            self._pool = None

    def drop_schema(self) -> None:
        """Drop isolated test schema if configured."""
        if self.schema:
            import psycopg
            with psycopg.connect(self.connection_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE;')
                conn.commit()

    def _prepare_conn(self, conn: Any) -> None:
        if self.schema:
            with conn.cursor() as cur:
                cur.execute(f'SET search_path = "{self.schema}", public;')

    @contextmanager
    def _get_connection(self):
        """Context manager providing an active connection, preferring the connection pool."""
        conn = None
        pool_ctx = None
        is_direct = False

        if self._pool is not None:
            if self._driver == "psycopg":
                try:
                    pool_ctx = self._pool.connection()
                    conn = pool_ctx.__enter__()
                except Exception as exc:
                    log.warning("Pooled connection acquisition failed (%s); falling back to direct connection", exc)
                    conn = None
                    pool_ctx = None
            else:
                try:
                    conn = self._pool.getconn()
                except Exception as exc:
                    log.warning("psycopg2 pool getconn failed (%s); falling back to direct", exc)
                    conn = None

        if conn is None:
            if self._driver == "psycopg":
                import psycopg
                conn = psycopg.connect(self.connection_url)
            else:
                import psycopg2
                conn = psycopg2.connect(self.connection_url)
            is_direct = True

        try:
            self._prepare_conn(conn)
            yield conn
        finally:
            if is_direct:
                try:
                    conn.close()
                except Exception:
                    pass
            elif self._pool is not None:
                if self._driver == "psycopg" and pool_ctx is not None:
                    try:
                        pool_ctx.__exit__(*sys.exc_info())
                    except Exception:
                        pass
                elif self._driver != "psycopg":
                    try:
                        self._pool.putconn(conn)
                    except Exception:
                        pass


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

        CREATE TABLE IF NOT EXISTS anki_cards (
            card_id             BIGINT PRIMARY KEY,
            note_id             BIGINT NOT NULL,
            deck_name           TEXT NOT NULL,
            model_name          TEXT NOT NULL,
            expression          TEXT NOT NULL,
            reading             TEXT NOT NULL DEFAULT '',
            meaning             TEXT NOT NULL DEFAULT '',
            sentence            TEXT NOT NULL DEFAULT '',
            sentence_meaning    TEXT NOT NULL DEFAULT '',
            jlpt_level          VARCHAR(16) DEFAULT NULL,
            state               VARCHAR(32) NOT NULL,
            queue_code          INTEGER NOT NULL DEFAULT 0,
            interval_days       INTEGER NOT NULL DEFAULT 0,
            reps                INTEGER NOT NULL DEFAULT 0,
            lapses              INTEGER NOT NULL DEFAULT 0,
            again_count_10      INTEGER NOT NULL DEFAULT 0,
            reviews_10          INTEGER NOT NULL DEFAULT 0,
            again_rate_10       REAL NOT NULL DEFAULT 0.0,
            avg_time_ms         INTEGER NOT NULL DEFAULT 0,
            difficulty_score    REAL DEFAULT NULL,
            difficulty_label    VARCHAR(32) NOT NULL DEFAULT 'new',
            is_leech            BOOLEAN NOT NULL DEFAULT FALSE,
            fsrs_difficulty     REAL DEFAULT NULL,
            fsrs_stability      REAL DEFAULT NULL,
            fsrs_retrievability REAL DEFAULT NULL,
            due_in_days         INTEGER DEFAULT NULL,
            due_date            VARCHAR(10) DEFAULT NULL,
            raw_html            TEXT NOT NULL DEFAULT '',
            has_media           BOOLEAN NOT NULL DEFAULT FALSE,
            created_at          TIMESTAMPTZ NOT NULL,
            first_review_at     TIMESTAMPTZ DEFAULT NULL,
            last_review_at      TIMESTAMPTZ DEFAULT NULL,
            mod_at              TIMESTAMPTZ NOT NULL,
            synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Self-healing migrations for existing tables
        ALTER TABLE anki_cards ADD COLUMN IF NOT EXISTS due_date VARCHAR(10) DEFAULT NULL;
        ALTER TABLE anki_cards ADD COLUMN IF NOT EXISTS raw_html TEXT NOT NULL DEFAULT '';
        ALTER TABLE anki_cards ADD COLUMN IF NOT EXISTS has_media BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE TABLE IF NOT EXISTS anki_card_media (
            card_id     BIGINT PRIMARY KEY REFERENCES anki_cards(card_id) ON DELETE CASCADE,
            media_name  TEXT NOT NULL,
            mime_type   VARCHAR(32) NOT NULL DEFAULT 'image/webp',
            image_webp  BYTEA NOT NULL,
            size_bytes  INTEGER NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_ac_diff_label ON anki_cards (difficulty_label);
        CREATE INDEX IF NOT EXISTS idx_ac_state ON anki_cards (state);
        CREATE INDEX IF NOT EXISTS idx_ac_deck ON anki_cards (deck_name);
        CREATE INDEX IF NOT EXISTS idx_ac_jlpt ON anki_cards (jlpt_level);
        CREATE INDEX IF NOT EXISTS idx_ac_diff_score ON anki_cards (difficulty_score);
        CREATE INDEX IF NOT EXISTS idx_ac_lapses ON anki_cards (lapses);
        CREATE INDEX IF NOT EXISTS idx_ac_due ON anki_cards (due_in_days);
        CREATE INDEX IF NOT EXISTS idx_ac_due_date ON anki_cards (due_date);
        CREATE INDEX IF NOT EXISTS idx_ac_created ON anki_cards (created_at);

        CREATE TABLE IF NOT EXISTS anki_daily (
            day                  VARCHAR(10) PRIMARY KEY,
            reviews              INTEGER NOT NULL DEFAULT 0,
            again                INTEGER NOT NULL DEFAULT 0,
            hard                 INTEGER NOT NULL DEFAULT 0,
            good                 INTEGER NOT NULL DEFAULT 0,
            easy                 INTEGER NOT NULL DEFAULT 0,
            time_ms              BIGINT NOT NULL DEFAULT 0,
            true_retention_num   INTEGER NOT NULL DEFAULT 0,
            true_retention_den   INTEGER NOT NULL DEFAULT 0,
            mature_retention_num INTEGER NOT NULL DEFAULT 0,
            mature_retention_den INTEGER NOT NULL DEFAULT 0,
            new_cards_added      INTEGER NOT NULL DEFAULT 0,
            total_cards          INTEGER NOT NULL DEFAULT 0,
            n_new                INTEGER NOT NULL DEFAULT 0,
            n_learning           INTEGER NOT NULL DEFAULT 0,
            n_young              INTEGER NOT NULL DEFAULT 0,
            n_mature             INTEGER NOT NULL DEFAULT 0,
            n_suspended          INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS anki_reviews (
            card_id        BIGINT NOT NULL REFERENCES anki_cards(card_id) ON DELETE CASCADE,
            review_id      BIGINT NOT NULL,
            ease           INTEGER NOT NULL DEFAULT 0,
            type           INTEGER NOT NULL DEFAULT 0,
            interval       INTEGER NOT NULL DEFAULT 0,
            last_interval  INTEGER NOT NULL DEFAULT 0,
            time_ms        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (card_id, review_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ar_card_id ON anki_reviews (card_id);

        CREATE TABLE IF NOT EXISTS anki_meta (
            key        VARCHAR(64) PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cloud_study_state (
            card_id      BIGINT PRIMARY KEY REFERENCES anki_cards(card_id) ON DELETE CASCADE,
            box          INTEGER NOT NULL DEFAULT 1,
            due_at       TIMESTAMPTZ NOT NULL,
            times_seen   INTEGER NOT NULL DEFAULT 0,
            again_count  INTEGER NOT NULL DEFAULT 0,
            last_result  INTEGER NOT NULL DEFAULT 0,
            last_seen_at TIMESTAMPTZ DEFAULT NULL,
            streak       INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS cloud_study_reviews (
            id          VARCHAR(64) PRIMARY KEY,
            card_id     BIGINT NOT NULL REFERENCES anki_cards(card_id) ON DELETE CASCADE,
            reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            rating      INTEGER NOT NULL,
            time_ms     INTEGER NOT NULL DEFAULT 0,
            session_id  VARCHAR(64) NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_csr_card_id ON cloud_study_reviews (card_id);
        CREATE INDEX IF NOT EXISTS idx_csr_reviewed_at ON cloud_study_reviews (reviewed_at);

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
                           sentence, sentence_meaning, payload_json,
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

    def upsert_anki_cards(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        norm_rows = []
        for r in rows:
            card_id = int(r["card_id"])
            norm_rows.append((
                card_id,
                int(r.get("note_id", 0)),
                str(r.get("deck_name", "Default")),
                str(r.get("model_name", "Basic")),
                str(r.get("expression", "")),
                str(r.get("reading", "") or ""),
                str(r.get("meaning", "") or ""),
                str(r.get("sentence", "") or ""),
                str(r.get("sentence_meaning", "") or ""),
                str(r.get("jlpt_level", "")).upper() if r.get("jlpt_level") else None,
                str(r.get("state", "new")),
                int(r.get("queue_code", 0)),
                int(r.get("interval_days", 0)),
                int(r.get("reps", 0)),
                int(r.get("lapses", 0)),
                int(r.get("again_count_10", 0)),
                int(r.get("reviews_10", 0)),
                float(r.get("again_rate_10", 0.0)),
                int(r.get("avg_time_ms", 0)),
                float(r["difficulty_score"]) if r.get("difficulty_score") is not None else None,
                str(r.get("difficulty_label", "new")),
                bool(r.get("is_leech")),
                float(r["fsrs_difficulty"]) if r.get("fsrs_difficulty") is not None else None,
                float(r["fsrs_stability"]) if r.get("fsrs_stability") is not None else None,
                float(r["fsrs_retrievability"]) if r.get("fsrs_retrievability") is not None else None,
                int(r["due_in_days"]) if r.get("due_in_days") is not None else None,
                str(r["due_date"]) if r.get("due_date") else None,
                str(r.get("raw_html", "") or ""),
                bool(r.get("has_media")),
                _to_pg_timestamp(r.get("created_at")) or datetime.now(timezone.utc),
                _to_pg_timestamp(r.get("first_review_at")),
                _to_pg_timestamp(r.get("last_review_at")),
                _to_pg_timestamp(r.get("mod_at")) or datetime.now(timezone.utc),
                _to_pg_timestamp(r.get("synced_at")) or datetime.now(timezone.utc),
            ))

        sql = """
        INSERT INTO anki_cards (
            card_id, note_id, deck_name, model_name, expression, reading,
            meaning, sentence, sentence_meaning, jlpt_level, state, queue_code,
            interval_days, reps, lapses, again_count_10, reviews_10, again_rate_10,
            avg_time_ms, difficulty_score, difficulty_label, is_leech,
            fsrs_difficulty, fsrs_stability, fsrs_retrievability, due_in_days, due_date,
            raw_html, has_media,
            created_at, first_review_at, last_review_at, mod_at, synced_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s
        )
        ON CONFLICT(card_id) DO UPDATE SET
            note_id = EXCLUDED.note_id,
            deck_name = EXCLUDED.deck_name,
            model_name = EXCLUDED.model_name,
            expression = EXCLUDED.expression,
            reading = EXCLUDED.reading,
            meaning = EXCLUDED.meaning,
            sentence = EXCLUDED.sentence,
            sentence_meaning = EXCLUDED.sentence_meaning,
            jlpt_level = COALESCE(EXCLUDED.jlpt_level, anki_cards.jlpt_level),
            state = EXCLUDED.state,
            queue_code = EXCLUDED.queue_code,
            interval_days = EXCLUDED.interval_days,
            reps = EXCLUDED.reps,
            lapses = EXCLUDED.lapses,
            again_count_10 = EXCLUDED.again_count_10,
            reviews_10 = EXCLUDED.reviews_10,
            again_rate_10 = EXCLUDED.again_rate_10,
            avg_time_ms = EXCLUDED.avg_time_ms,
            difficulty_score = EXCLUDED.difficulty_score,
            difficulty_label = EXCLUDED.difficulty_label,
            is_leech = EXCLUDED.is_leech,
            fsrs_difficulty = EXCLUDED.fsrs_difficulty,
            fsrs_stability = EXCLUDED.fsrs_stability,
            fsrs_retrievability = EXCLUDED.fsrs_retrievability,
            due_in_days = EXCLUDED.due_in_days,
            due_date = EXCLUDED.due_date,
            raw_html = EXCLUDED.raw_html,
            has_media = EXCLUDED.has_media,
            created_at = EXCLUDED.created_at,
            first_review_at = EXCLUDED.first_review_at,
            last_review_at = EXCLUDED.last_review_at,
            mod_at = EXCLUDED.mod_at,
            synced_at = EXCLUDED.synced_at;
        """
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, norm_rows)
            conn.commit()
        return len(norm_rows)

    def upsert_anki_reviews(self, reviews: list[dict[str, Any]]) -> int:
        if not reviews:
            return 0
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                values = [
                    (
                        int(r["card_id"]),
                        int(r["review_id"]),
                        int(r.get("ease", 0)),
                        int(r.get("type", 0)),
                        int(r.get("interval", 0)),
                        int(r.get("last_interval", 0)),
                        int(r.get("time_ms", 0)),
                    )
                    for r in reviews
                ]
                cur.executemany(
                    """
                    INSERT INTO anki_reviews (
                        card_id, review_id, ease, type, interval, last_interval, time_ms
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s
                    ) ON CONFLICT(card_id, review_id) DO UPDATE SET
                        ease = EXCLUDED.ease,
                        type = EXCLUDED.type,
                        interval = EXCLUDED.interval,
                        last_interval = EXCLUDED.last_interval,
                        time_ms = EXCLUDED.time_ms;
                    """,
                    values,
                )
            conn.commit()
            return len(reviews)

    def get_card_reviews(self, card_id: int) -> list[dict[str, Any]]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT card_id, review_id, ease, type, interval, last_interval, time_ms
                    FROM anki_reviews
                    WHERE card_id = %s
                    ORDER BY review_id ASC;
                    """,
                    (int(card_id),),
                )
                cols = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                return _normalize_json_types([dict(zip(cols, r)) for r in rows])

    def save_card_media(self, card_id: int, media_name: str, image_bytes: bytes, mime_type: str = "image/webp") -> None:
        now_dt = datetime.now(timezone.utc)
        sql = """
        INSERT INTO anki_card_media (card_id, media_name, mime_type, image_webp, size_bytes, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT(card_id) DO UPDATE SET
            media_name = EXCLUDED.media_name,
            mime_type = EXCLUDED.mime_type,
            image_webp = EXCLUDED.image_webp,
            size_bytes = EXCLUDED.size_bytes,
            created_at = EXCLUDED.created_at;
        """
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (int(card_id), media_name, mime_type, image_bytes, len(image_bytes), now_dt))
                cur.execute("UPDATE anki_cards SET has_media = TRUE WHERE card_id = %s;", (int(card_id),))
            conn.commit()

    def get_card_media(self, card_id: int) -> Optional[dict[str, Any]]:
        sql = "SELECT card_id, media_name, mime_type, image_webp, size_bytes, created_at FROM anki_card_media WHERE card_id = %s;"
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (int(card_id),))
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "card_id": row[0],
                    "media_name": row[1],
                    "mime_type": row[2],
                    "image_webp": bytes(row[3]),
                    "size_bytes": row[4],
                    "created_at": str(row[5]),
                }

    def delete_card_media(self, card_id: int) -> bool:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM anki_card_media WHERE card_id = %s;", (int(card_id),))
                rc = cur.rowcount
                cur.execute("UPDATE anki_cards SET has_media = FALSE WHERE card_id = %s;", (int(card_id),))
            conn.commit()
            return rc > 0

    def flush_mature_card_media(self, min_interval_days: int = 21) -> int:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT m.card_id FROM anki_card_media m
                    JOIN anki_cards c ON m.card_id = c.card_id
                    WHERE c.interval_days >= %s;
                    """,
                    (int(min_interval_days),),
                )
                rows = cur.fetchall()
                if not rows:
                    return 0
                flushed_ids = [r[0] for r in rows]
                cur.execute("DELETE FROM anki_card_media WHERE card_id = ANY(%s);", (flushed_ids,))
                cur.execute("UPDATE anki_cards SET has_media = FALSE WHERE card_id = ANY(%s);", (flushed_ids,))
            conn.commit()
            return len(flushed_ids)

    def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                if not all_card_ids:
                    cur.execute("SELECT COUNT(*) FROM anki_cards;")
                    total = cur.fetchone()[0]
                    cur.execute("DELETE FROM anki_card_media;")
                    cur.execute("DELETE FROM anki_reviews;")
                    cur.execute("DELETE FROM cloud_study_reviews;")
                    cur.execute("DELETE FROM cloud_study_state;")
                    cur.execute("DELETE FROM anki_cards;")
                    conn.commit()
                    return total

                cur.execute("CREATE TEMPORARY TABLE IF NOT EXISTS temp_reconcile_ids (id BIGINT PRIMARY KEY) ON COMMIT DROP;")
                cur.execute("DELETE FROM temp_reconcile_ids;")
                cur.executemany("INSERT INTO temp_reconcile_ids (id) VALUES (%s) ON CONFLICT DO NOTHING;", [(int(cid),) for cid in all_card_ids])

                cur.execute("SELECT COUNT(*) FROM anki_cards WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
                del_count = cur.fetchone()[0]

                cur.execute("DELETE FROM anki_card_media WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
                cur.execute("DELETE FROM anki_reviews WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
                cur.execute("DELETE FROM cloud_study_reviews WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
                cur.execute("DELETE FROM cloud_study_state WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
                cur.execute("DELETE FROM anki_cards WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
            conn.commit()
            return del_count

    def clear_all_cards(self, include_stats: bool = False) -> dict[str, int]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM anki_card_media;")
                c_media = cur.rowcount
                cur.execute("DELETE FROM anki_reviews;")
                c_anki_reviews = cur.rowcount
                cur.execute("DELETE FROM cloud_study_reviews;")
                c_reviews = cur.rowcount
                cur.execute("DELETE FROM cloud_study_state;")
                c_state = cur.rowcount
                cur.execute("DELETE FROM anki_cards;")
                c_cards = cur.rowcount
                c_daily = 0
                if include_stats:
                    cur.execute("DELETE FROM anki_daily;")
                    c_daily = cur.rowcount
                    cur.execute("DELETE FROM anki_meta WHERE key NOT IN ('schema_version');")
            conn.commit()
            return {
                "deleted_cards": c_cards,
                "deleted_media": c_media,
                "deleted_study_reviews": c_reviews,
                "deleted_study_state": c_state,
                "deleted_daily": c_daily,
                "deleted_anki_reviews": c_anki_reviews,
            }

    def upsert_anki_daily(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        norm_rows = []
        for r in rows:
            norm_rows.append((
                str(r["day"]),
                int(r.get("reviews", 0)),
                int(r.get("again", 0)),
                int(r.get("hard", 0)),
                int(r.get("good", 0)),
                int(r.get("easy", 0)),
                int(r.get("time_ms", 0)),
                int(r.get("true_retention_num", 0)),
                int(r.get("true_retention_den", 0)),
                int(r.get("mature_retention_num", 0)),
                int(r.get("mature_retention_den", 0)),
                int(r.get("new_cards_added", 0)),
                int(r.get("total_cards", 0)),
                int(r.get("n_new", 0)),
                int(r.get("n_learning", 0)),
                int(r.get("n_young", 0)),
                int(r.get("n_mature", 0)),
                int(r.get("n_suspended", 0)),
            ))

        sql = """
        INSERT INTO anki_daily (
            day, reviews, again, hard, good, easy, time_ms,
            true_retention_num, true_retention_den,
            mature_retention_num, mature_retention_den,
            new_cards_added, total_cards,
            n_new, n_learning, n_young, n_mature, n_suspended
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s,
            %s, %s,
            %s, %s, %s, %s, %s
        )
        ON CONFLICT(day) DO UPDATE SET
            reviews = EXCLUDED.reviews,
            again = EXCLUDED.again,
            hard = EXCLUDED.hard,
            good = EXCLUDED.good,
            easy = EXCLUDED.easy,
            time_ms = EXCLUDED.time_ms,
            true_retention_num = EXCLUDED.true_retention_num,
            true_retention_den = EXCLUDED.true_retention_den,
            mature_retention_num = EXCLUDED.mature_retention_num,
            mature_retention_den = EXCLUDED.mature_retention_den,
            new_cards_added = EXCLUDED.new_cards_added,
            total_cards = EXCLUDED.total_cards,
            n_new = EXCLUDED.n_new,
            n_learning = EXCLUDED.n_learning,
            n_young = EXCLUDED.n_young,
            n_mature = EXCLUDED.n_mature,
            n_suspended = EXCLUDED.n_suspended;
        """
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, norm_rows)
            conn.commit()
        return len(norm_rows)

    def set_anki_meta(self, key: str, value: str) -> None:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO anki_meta (key, value, updated_at) VALUES (%s, %s, NOW())
                    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
                    """,
                    (str(key), str(value)),
                )
            conn.commit()

    def get_anki_meta(self, key: Optional[str] = None) -> dict[str, str]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                if key:
                    cur.execute("SELECT key, value FROM anki_meta WHERE key = %s;", (key,))
                    row = cur.fetchone()
                    return {row[0]: row[1]} if row else {}
                cur.execute("SELECT key, value FROM anki_meta;")
                rows = cur.fetchall()
                return {r[0]: r[1] for r in rows}

    def query_anki_cards(
        self,
        filters: Optional[dict[str, Any]] = None,
        sort: str = "difficulty",
        sort_dir: Optional[str] = None,
        dir: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        t0 = time.perf_counter()
        filters = filters or {}
        limit = max(1, min(500, int(limit)))
        offset = max(0, int(offset))
        effective_dir = str(dir if dir is not None else (sort_dir or "desc")).lower().strip()
        direction = "ASC" if effective_dir == "asc" else "DESC"

        SORT_COLUMNS = {
            "difficulty": "difficulty_score",
            "lapses": "lapses",
            "interval": "interval_days",
            "due": "due_in_days",
            "created": "created_at",
            "last_review": "last_review_at",
            "reps": "reps",
            "expression": "expression",
        }
        clean_sort = str(sort).strip().lower()
        if clean_sort not in SORT_COLUMNS:
            raise ValueError(f"Invalid sort column '{sort}'. Allowed: {list(SORT_COLUMNS.keys())}")
        col = SORT_COLUMNS[clean_sort]

        where_clauses: list[str] = []
        params: list[Any] = []

        q = filters.get("q")
        if q and str(q).strip():
            clean_q = str(q).strip()
            escaped_q = clean_q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where_clauses.append("(expression ILIKE %s OR reading ILIKE %s OR meaning ILIKE %s)")
            pattern = f"%{escaped_q}%"
            params.extend([pattern, pattern, pattern])

        state = filters.get("state")
        if state and str(state).strip():
            where_clauses.append("state = %s")
            params.append(str(state).strip().lower())

        label = filters.get("label") or filters.get("labels")
        if label:
            if isinstance(label, str):
                label_list = [l.strip().lower() for l in label.split(",") if l.strip()]
            elif isinstance(label, (list, tuple)):
                label_list = [str(l).strip().lower() for l in label if str(l).strip()]
            else:
                label_list = []
            if label_list:
                placeholders = ",".join("%s" for _ in label_list)
                where_clauses.append(f"difficulty_label IN ({placeholders})")
                params.extend(label_list)

        deck = filters.get("deck")
        if deck and str(deck).strip():
            where_clauses.append("deck_name = %s")
            params.append(str(deck).strip())

        jlpt = filters.get("jlpt")
        if jlpt and str(jlpt).strip():
            val = str(jlpt).strip().upper()
            if val == "UNKNOWN":
                where_clauses.append("(jlpt_level IS NULL OR jlpt_level = '')")
            else:
                where_clauses.append("UPPER(jlpt_level) = %s")
                params.append(val)

        due_within = filters.get("due_within")
        if due_within is not None and str(due_within).strip() != "":
            try:
                days = int(due_within)
                where_clauses.append("(due_in_days IS NOT NULL AND due_in_days <= %s AND due_in_days >= 0)")
                params.append(days)
            except ValueError:
                pass

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        if col in ("difficulty_score", "due_in_days"):
            order_sql = f"ORDER BY {col} {direction} NULLS LAST, card_id {direction}"
        else:
            order_sql = f"ORDER BY {col} {direction}, card_id {direction}"

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                count_sql = f"SELECT COUNT(*) FROM anki_cards {where_sql};"
                cur.execute(count_sql, tuple(params))
                total = cur.fetchone()[0]

                select_sql = f"SELECT * FROM anki_cards {where_sql} {order_sql} LIMIT %s OFFSET %s;"
                cur.execute(select_sql, tuple(params + [limit, offset]))
                cols = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                items = []
                for r in rows:
                    d = dict(zip(cols, r))
                    if "is_leech" in d:
                        d["is_leech"] = bool(d["is_leech"])
                    for date_col in ("created_at", "first_review_at", "last_review_at", "mod_at", "synced_at"):
                        if d.get(date_col) is not None:
                            d[date_col] = str(d[date_col])
                    items.append(d)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                log.debug("query_anki_cards completed in %.2fms (total=%d, returned=%d)", elapsed_ms, total, len(items))
                return items, total

    def get_anki_card(self, card_id: int) -> Optional[dict[str, Any]]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM anki_cards WHERE card_id = %s;", (card_id,))
                row = cur.fetchone()
                if not row:
                    return None
                cols = [desc[0] for desc in cur.description]
                d = dict(zip(cols, row))
                if "is_leech" in d:
                    d["is_leech"] = bool(d["is_leech"])
                for date_col in ("created_at", "first_review_at", "last_review_at", "mod_at", "synced_at"):
                    if d.get(date_col) is not None:
                        d[date_col] = str(d[date_col])
                return d

    def get_anki_status(self) -> dict[str, Any]:
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM anki_cards;")
                card_count = int(cur.fetchone()[0])
                cur.execute("SELECT key, value FROM anki_meta;")
                meta_rows = cur.fetchall()
                meta = {r[0]: r[1] for r in meta_rows}
                cur.execute("SELECT MAX(synced_at) FROM anki_cards;")
                last_synced_row = cur.fetchone()
                last_synced = str(last_synced_row[0]) if last_synced_row and last_synced_row[0] else None
                last_reconcile = meta.get("last_full_reconcile_at")
                last_success = meta.get("last_mirror_sync_at") or meta.get("last_success_at") or last_synced
                last_attempt = meta.get("last_attempt_at") or last_success
                last_error = meta.get("last_sync_error") or meta.get("last_error") or None
                sync_status = meta.get("sync_status") or ("ok" if last_success else "never_synced")
                pending_cards = int(meta.get("pending_cards", 0))

                days_since_success = None
                if last_success:
                    try:
                        clean_str = str(last_success).replace("Z", "+00:00")
                        ls_dt = datetime.fromisoformat(clean_str)
                        if ls_dt.tzinfo is None:
                            ls_dt = ls_dt.replace(tzinfo=timezone.utc)
                        days_since_success = max(0, (datetime.now(timezone.utc) - ls_dt).days)
                    except Exception:
                        days_since_success = None

                tz_name = os.getenv("USER_TIMEZONE", "Asia/Kolkata")
                rollover_hour = int(meta.get("collection_day_rollover_hour", os.getenv("ANKI_DAY_ROLLOVER_HOUR", "4")))

                return {
                    "last_success_at": last_success,
                    "last_attempt_at": last_attempt,
                    "last_full_at": last_reconcile,
                    "status": sync_status,
                    "last_error": last_error,
                    "pending_cards": pending_cards,
                    "days_since_success": days_since_success,
                    "synced_at": last_success,
                    "last_mirror_sync_at": last_success,
                    "card_count": card_count,
                    "last_full_reconcile": last_reconcile,
                    "last_reconcile_at": last_reconcile,
                    "schema_version": str(meta.get("schema_version", "1")),
                    "collection_day_rollover_hour": rollover_hour,
                    "timezone": tz_name,
                    "active_profile": meta.get("active_profile", ""),
                    "reconcile_skipped_reason": meta.get("reconcile_skipped_reason", ""),
                }


    def get_stats_overview(self, range_filter: Optional[str] = None, range_key: Optional[str] = None) -> dict[str, Any]:
        t0 = time.perf_counter()
        now_dt = datetime.now(timezone.utc)
        now_date = now_dt.date()

        rf = str(range_key or range_filter or "30d").lower().strip()
        if rf == "30d":
            start_date = (now_date - timedelta(days=30)).strftime("%Y-%m-%d")
        elif rf == "90d":
            start_date = (now_date - timedelta(days=90)).strftime("%Y-%m-%d")
        elif rf == "1y":
            start_date = (now_date - timedelta(days=365)).strftime("%Y-%m-%d")
        else:
            start_date = None

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM anki_cards;")
                card_count = cur.fetchone()[0]

                if start_date:
                    cur.execute("SELECT * FROM anki_daily WHERE day >= %s ORDER BY day ASC;", (start_date,))
                else:
                    cur.execute("SELECT * FROM anki_daily ORDER BY day ASC;")
                cols = [desc[0] for desc in cur.description]
                daily_rows = [dict(zip(cols, r)) for r in cur.fetchall()]

                if len(daily_rows) > 365:
                    cutoff_idx = len(daily_rows) - 365
                    sampled_daily = [r for i, r in enumerate(daily_rows[:cutoff_idx]) if i % 7 == 0] + daily_rows[cutoff_idx:]
                else:
                    sampled_daily = daily_rows

                growth_curve = [
                    {
                        "day": r["day"],
                        "total": r["total_cards"],
                        "total_cards": r["total_cards"],
                        "new": r["new_cards_added"],
                        "new_cards_added": r["new_cards_added"],
                    }
                    for r in sampled_daily
                ]

                state_breakdown = [
                    {
                        "day": r["day"],
                        "mature": r["n_mature"],
                        "n_mature": r["n_mature"],
                        "young": r["n_young"],
                        "n_young": r["n_young"],
                        "learning": r["n_learning"],
                        "n_learning": r["n_learning"],
                        "new": r["n_new"],
                        "n_new": r["n_new"],
                        "suspended": r["n_suspended"],
                        "n_suspended": r["n_suspended"],
                    }
                    for r in sampled_daily
                ]

                tot_ret_num = sum(r["true_retention_num"] for r in daily_rows)
                tot_ret_den = sum(r["true_retention_den"] for r in daily_rows)
                tot_mat_num = sum(r["mature_retention_num"] for r in daily_rows)
                tot_mat_den = sum(r["mature_retention_den"] for r in daily_rows)

                weekly_ret_map: dict[str, dict[str, int]] = {}
                for r in daily_rows:
                    day_str = r["day"]
                    try:
                        d_obj = datetime.strptime(day_str, "%Y-%m-%d").date()
                        week_key = f"{d_obj.isocalendar()[0]}-W{d_obj.isocalendar()[1]:02d}"
                    except Exception:
                        week_key = day_str[:7]
                    w = weekly_ret_map.setdefault(week_key, {
                        "num": 0, "den": 0, "mat_num": 0, "mat_den": 0, "week": week_key
                    })
                    w["num"] += r["true_retention_num"]
                    w["den"] += r["true_retention_den"]
                    w["mat_num"] += r["mature_retention_num"]
                    w["mat_den"] += r["mature_retention_den"]

                weekly_retention = []
                for wk, vals in sorted(weekly_ret_map.items()):
                    rate = round(vals["num"] / vals["den"] * 100.0, 1) if vals["den"] > 0 else None
                    mat_rate = round(vals["mat_num"] / vals["mat_den"] * 100.0, 1) if vals["mat_den"] > 0 else None
                    weekly_retention.append({
                        "week": wk,
                        "day": wk,
                        "rate": rate,
                        "n": vals["den"],
                        "mature_rate": mat_rate,
                        "mature_n": vals["mat_den"],
                        "mature_retention_num": vals["mat_num"],
                        "mature_retention_den": vals["mat_den"],
                    })

                tot_again = sum(r["again"] for r in daily_rows)
                tot_hard = sum(r["hard"] for r in daily_rows)
                tot_good = sum(r["good"] for r in daily_rows)
                tot_easy = sum(r["easy"] for r in daily_rows)

                weekly_buttons_map: dict[str, dict[str, int]] = {}
                for r in daily_rows:
                    day_str = r["day"]
                    try:
                        d_obj = datetime.strptime(day_str, "%Y-%m-%d").date()
                        week_key = f"{d_obj.isocalendar()[0]}-W{d_obj.isocalendar()[1]:02d}"
                    except Exception:
                        week_key = day_str[:7]
                    wb = weekly_buttons_map.setdefault(week_key, {
                        "again": 0, "hard": 0, "good": 0, "easy": 0, "week": week_key
                    })
                    wb["again"] += r["again"]
                    wb["hard"] += r["hard"]
                    wb["good"] += r["good"]
                    wb["easy"] += r["easy"]

                weekly_buttons = []
                for wk, bvals in sorted(weekly_buttons_map.items()):
                    total_b = bvals["again"] + bvals["hard"] + bvals["good"] + bvals["easy"]
                    weekly_buttons.append({
                        "week": wk,
                        "again": bvals["again"],
                        "hard": bvals["hard"],
                        "good": bvals["good"],
                        "easy": bvals["easy"],
                        "total": total_b,
                    })

                # 3. due_forecast
                cur.execute(
                    """
                    SELECT
                        CASE
                            WHEN due_in_days < 0 THEN -1
                            WHEN due_in_days BETWEEN 0 AND 30 THEN due_in_days
                            ELSE 31
                        END as due_bucket,
                        COUNT(*) as count
                    FROM anki_cards
                    WHERE due_in_days IS NOT NULL
                    GROUP BY due_bucket
                    ORDER BY due_bucket ASC;
                    """
                )
                due_forecast = [{"day": int(r[0]), "count": int(r[1])} for r in cur.fetchall()]

                # 4. diff_rows
                cur.execute(
                    """
                    SELECT difficulty_label, state, COUNT(*) as count
                    FROM anki_cards
                    GROUP BY difficulty_label, state;
                    """
                )
                diff_rows = cur.fetchall()
                diff_map: dict[str, dict[str, Any]] = {}
                for r in diff_rows:
                    lbl, st, cnt = r[0], r[1], int(r[2])
                    d_entry = diff_map.setdefault(lbl, {
                        "label": lbl,
                        "difficulty_label": lbl,
                        "count": 0,
                        "total": 0,
                        "mature": 0,
                        "young": 0,
                        "other": 0,
                    })
                    d_entry["total"] += cnt
                    d_entry["count"] += cnt
                    if st == "mature":
                        d_entry["mature"] += cnt
                    elif st == "young":
                        d_entry["young"] += cnt
                    else:
                        d_entry["other"] += cnt
                standard_labels = ["leech", "hard", "normal", "easy", "solid", "new"]
                difficulty_distribution = [
                    diff_map.get(lbl, {
                        "label": lbl,
                        "difficulty_label": lbl,
                        "count": 0,
                        "total": 0,
                        "mature": 0,
                        "young": 0,
                        "other": 0,
                    })
                    for lbl in standard_labels
                ]

                # 5. weak_words
                cur.execute(
                    """
                    SELECT card_id, expression, reading, meaning, lapses, again_rate_10,
                           interval_days, difficulty_score, difficulty_label, is_leech
                    FROM anki_cards
                    WHERE reps > 0 OR difficulty_label IN ('hard', 'leech') OR lapses > 0
                    ORDER BY is_leech DESC,
                             CASE WHEN difficulty_label = 'hard' THEN 0 ELSE 1 END,
                             difficulty_score DESC NULLS LAST,
                             lapses DESC
                    LIMIT 25;
                    """
                )
                weak_cols = [desc[0] for desc in cur.description]
                weak_words = [dict(zip(weak_cols, r)) for r in cur.fetchall()]

                # 6. jlpt_rows
                cur.execute(
                    """
                    SELECT COALESCE(NULLIF(jlpt_level, ''), 'unknown') as level, state, COUNT(*) as count
                    FROM anki_cards
                    GROUP BY level, state;
                    """
                )
                jlpt_rows = cur.fetchall()
                jlpt_map: dict[str, dict[str, Any]] = {}
                for r in jlpt_rows:
                    lvl, st, cnt = r[0].upper(), r[1], int(r[2])
                    j_entry = jlpt_map.setdefault(lvl, {
                        "level": lvl,
                        "count": 0,
                        "total": 0,
                        "mature": 0,
                        "young": 0,
                        "other": 0,
                    })
                    j_entry["total"] += cnt
                    j_entry["count"] += cnt
                    if st == "mature":
                        j_entry["mature"] += cnt
                    elif st == "young":
                        j_entry["young"] += cnt
                    else:
                        j_entry["other"] += cnt
                jlpt_levels = ["N5", "N4", "N3", "N2", "N1", "UNKNOWN"]
                jlpt_coverage = [
                    jlpt_map.get(lvl, {
                        "level": lvl,
                        "count": 0,
                        "total": 0,
                        "mature": 0,
                        "young": 0,
                        "other": 0,
                    })
                    for lvl in jlpt_levels if lvl in jlpt_map
                ]

                # 7. queued_cards activity
                cur.execute(
                    """
                    SELECT to_char(created_at, 'YYYY-"W"IW') as week, status, COUNT(*) as count
                    FROM queued_cards
                    GROUP BY week, status
                    ORDER BY week DESC
                    LIMIT 12;
                    """
                )
                q_map: dict[str, dict[str, int]] = {}
                for r in cur.fetchall():
                    wk = r[0] or "unknown"
                    st = r[1]
                    cnt = int(r[2])
                    qe = q_map.setdefault(wk, {"week": wk, "total": 0, "completed": 0, "pending": 0, "failed": 0})
                    qe["total"] += cnt
                    if st in qe:
                        qe[st] += cnt
                queue_activity = [q_map[wk] for wk in sorted(q_map.keys())]

                retention_data = {
                    "range": {
                        "num": tot_ret_num,
                        "den": tot_ret_den,
                        "rate": round(tot_ret_num / tot_ret_den * 100.0, 1) if tot_ret_den > 0 else None,
                        "mature_num": tot_mat_num,
                        "mature_den": tot_mat_den,
                        "mature_rate": round(tot_mat_num / tot_mat_den * 100.0, 1) if tot_mat_den > 0 else None,
                    },
                    "weekly": weekly_retention,
                }

                # 8. Decks breakdown
                cur.execute(
                    """
                    SELECT deck_name,
                           COUNT(*)::int as total,
                           COALESCE(SUM(CASE WHEN state = 'mature' THEN 1 ELSE 0 END), 0)::int as mature,
                           COALESCE(SUM(CASE WHEN state = 'young' THEN 1 ELSE 0 END), 0)::int as young,
                           COALESCE(SUM(CASE WHEN state = 'learning' THEN 1 ELSE 0 END), 0)::int as learning,
                           COALESCE(SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END), 0)::int as new,
                           COALESCE(SUM(CASE WHEN state = 'suspended' THEN 1 ELSE 0 END), 0)::int as suspended,
                           COALESCE(SUM(CASE WHEN due_in_days <= 0 THEN 1 ELSE 0 END), 0)::int as due_today,
                           COALESCE(ROUND(AVG(interval_days), 1)::float, 0.0) as avg_interval
                    FROM anki_cards
                    GROUP BY deck_name
                    ORDER BY total DESC;
                    """
                )
                deck_cols = [desc[0] for desc in cur.description]
                deck_breakdown = [dict(zip(deck_cols, r)) for r in cur.fetchall()]

                res_overview = {
                    "range": rf,
                    "card_count": card_count,
                    "growth_curve": growth_curve,
                    "card_growth": growth_curve,
                    "state_breakdown": state_breakdown,
                    "retention": retention_data,
                    "true_retention": retention_data,
                    "answer_buttons": {
                        "again": tot_again,
                        "hard": tot_hard,
                        "good": tot_good,
                        "easy": tot_easy,
                        "weekly": weekly_buttons,
                    },
                    "due_forecast": due_forecast,
                    "difficulty_distribution": difficulty_distribution,
                    "weak_words": weak_words,
                    "jlpt_coverage": jlpt_coverage,
                    "queue_activity": queue_activity,
                    "deck_breakdown": deck_breakdown,
                }
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                log.debug("get_stats_overview completed in %.2fms (range=%s)", elapsed_ms, rf)
                return _normalize_json_types(res_overview)

    def sync_pseudo_cards_from_queue(self) -> int:
        """Sync pending quick-added cards into anki_cards with negative card_ids so they are immediately studyable during travel."""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                now_dt = datetime.now(timezone.utc)
                now_date = now_dt.strftime("%Y-%m-%d")
                cur.execute(
                    "SELECT id, expression, reading, meaning, sentence, sentence_meaning, deck_name FROM queued_cards WHERE status = 'pending';"
                )
                pending_rows = cur.fetchall()
                synced = 0
                for r in pending_rows:
                    raw_id = str(r[0])
                    try:
                        pseudo_id = -abs(int(raw_id))
                    except ValueError:
                        pseudo_id = -abs(int(hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:14], 16))

                    cur.execute(
                        """
                        INSERT INTO anki_cards (
                            card_id, note_id, deck_name, model_name, expression, reading, meaning,
                            sentence, sentence_meaning, state, difficulty_score,
                            difficulty_label, is_leech, lapses, reps, interval_days,
                            due_in_days, due_date, created_at, mod_at, synced_at
                        ) VALUES (
                            %s, 0, %s, 'Kiroku Note', %s, %s, %s,
                            %s, %s, 'queued', 50.0,
                            'new', FALSE, 0, 0, 0,
                            0, %s, %s, %s, %s
                        )
                        ON CONFLICT(card_id) DO UPDATE SET
                            expression = EXCLUDED.expression,
                            reading = EXCLUDED.reading,
                            meaning = EXCLUDED.meaning,
                            sentence = EXCLUDED.sentence,
                            sentence_meaning = EXCLUDED.sentence_meaning;
                        """,
                        (
                            pseudo_id,
                            r[6] or "N3 vocabs",
                            r[1],
                            r[2] or r[1],
                            r[3],
                            r[4] or "",
                            r[5] or "",
                            now_date,
                            now_dt,
                            now_dt,
                            now_dt,
                        ),
                    )
                    synced += 1
                conn.commit()
                return synced

    def get_study_preset_counts(self) -> dict[str, int]:
        """Return real-time card counts for each study preset."""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                now_dt = datetime.now(timezone.utc)
                cur.execute(
                    """
                    SELECT COUNT(*) FROM cloud_study_state cs
                    JOIN anki_cards ac ON cs.card_id = ac.card_id
                    WHERE ac.state != 'suspended' AND cs.due_at <= %s;
                    """,
                    (now_dt,),
                )
                due_row = cur.fetchone()
                due_count = int(due_row[0]) if due_row else 0

                cur.execute(
                    "SELECT COUNT(*) FROM anki_cards WHERE state != 'suspended' AND (is_leech = TRUE OR lapses >= 4 OR difficulty_score >= 80);",
                )
                leech_row = cur.fetchone()
                leech_count = int(leech_row[0]) if leech_row else 0

                cur.execute(
                    "SELECT COUNT(*) FROM anki_cards WHERE state != 'suspended' AND (difficulty_score >= 60 OR is_leech = TRUE);",
                )
                weak_row = cur.fetchone()
                weak_count = int(weak_row[0]) if weak_row else 0

                cur.execute(
                    "SELECT COUNT(*) FROM queued_cards WHERE status = 'pending';",
                )
                qa_row = cur.fetchone()
                qa_count = int(qa_row[0]) if qa_row else 0

                cur.execute(
                    "SELECT COUNT(*) FROM anki_cards WHERE state != 'suspended';",
                )
                all_row = cur.fetchone()
                all_count = int(all_row[0]) if all_row else 0

                return {
                    "quick10": min(10, all_count + qa_count),
                    "due": due_count,
                    "leech_rescue": leech_count,
                    "weak_week": weak_count,
                    "quick_add": qa_count,
                    "all": all_count,
                }

    def get_travel_plan(self) -> dict[str, Any]:
        """Compute 7-day travel schedule from absolute due dates for studying when Anki is offline."""
        tz_name = os.getenv("USER_TIMEZONE", "Asia/Kolkata")
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Asia/Kolkata")

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM anki_meta WHERE key = 'collection_day_rollover_hour';")
                meta_row = cur.fetchone()
                rollover_hour = int(meta_row[0]) if meta_row and meta_row[0] else int(os.getenv("ANKI_DAY_ROLLOVER_HOUR", "4"))

                status_data = self.get_anki_status()
                days_behind = status_data.get("days_since_success") or 0

                now_utc = datetime.now(timezone.utc)
                today_day = get_anki_collection_day(now_utc, tz, rollover_hour)
                today_str = today_day.isoformat()

                cur.execute(
                    "SELECT COUNT(*) FROM anki_cards WHERE state != 'suspended' AND due_date IS NOT NULL AND due_date < %s;",
                    (today_str,),
                )
                overdue_row = cur.fetchone()
                overdue_count = int(overdue_row[0]) if overdue_row else 0

                schedule = []
                total_7d_due = 0
                for i in range(7):
                    day_dt = today_day + timedelta(days=i)
                    day_str = day_dt.isoformat()
                    cur.execute(
                        "SELECT COUNT(*) FROM anki_cards WHERE state != 'suspended' AND due_date = %s;",
                        (day_str,),
                    )
                    due_row = cur.fetchone()
                    cnt = int(due_row[0]) if due_row else 0
                    total_7d_due += cnt
                    schedule.append({
                        "day_index": i,
                        "date": day_str,
                        "day_label": "Today" if i == 0 else ("Tomorrow" if i == 1 else day_dt.strftime("%a, %b %d")),
                        "due_count": cnt,
                        "cumulative": overdue_count + total_7d_due,
                    })

                total_due_on_return = overdue_count + total_7d_due
                import math
                daily_goal = max(5, math.ceil(total_due_on_return / 7.0)) if total_due_on_return > 0 else 0

                return _normalize_json_types({
                    "days_behind": days_behind,
                    "overdue_cards": overdue_count,
                    "today_due": schedule[0]["due_count"] if schedule else 0,
                    "schedule_7d": schedule,
                    "cards_due_on_return": total_due_on_return,
                    "daily_goal": daily_goal,
                    "timezone": tz_name,
                    "as_of_date": today_str,
                })

    def get_study_session(
        self,
        mode: str = "weakest",
        level: Optional[str] = None,
        limit: int = 20,
        custom_ids: Optional[list[int]] = None,
        custom_card_ids: Optional[list[int]] = None,
    ) -> list[dict[str, Any]]:
        clean_mode = (mode or "weakest").lower().strip()
        now_dt = datetime.now(timezone.utc)
        four_hours_ago = now_dt - timedelta(hours=4)
        effective_ids = custom_ids or custom_card_ids

        # Sync any pending quick-added cards into pseudo-cards so travel mode works immediately
        self.sync_pseudo_cards_from_queue()

        effective_limit = 10 if clean_mode == "quick10" else limit
        pool_limit = max(effective_limit * 3, 60)

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                if effective_ids:
                    placeholders = ",".join("%s" for _ in effective_ids)
                    cur.execute(
                        f"SELECT * FROM anki_cards WHERE card_id IN ({placeholders}) LIMIT %s;",
                        tuple(effective_ids + [effective_limit]),
                    )
                elif clean_mode in ("quick_add", "new_from_quickadd"):
                    cur.execute(
                        "SELECT * FROM anki_cards WHERE card_id < 0 ORDER BY card_id DESC LIMIT %s;",
                        (effective_limit,),
                    )
                elif clean_mode in ("leech_rescue", "leech", "leeches"):
                    cur.execute(
                        """
                        SELECT * FROM anki_cards
                        WHERE state != 'suspended'
                          AND (is_leech = TRUE OR lapses >= 4 OR difficulty_score >= 80)
                        ORDER BY lapses DESC, difficulty_score DESC NULLS LAST
                        LIMIT %s;
                        """,
                        (pool_limit,),
                    )
                elif clean_mode in ("weak_week", "weak_this_week"):
                    cur.execute(
                        """
                        SELECT * FROM anki_cards
                        WHERE state != 'suspended'
                          AND (difficulty_score >= 60 OR is_leech = TRUE OR card_id IN (
                              SELECT DISTINCT card_id FROM cloud_study_reviews WHERE reviewed_at >= %s AND rating = 1
                          ))
                        ORDER BY difficulty_score DESC NULLS LAST
                        LIMIT %s;
                        """,
                        (four_hours_ago, pool_limit),
                    )
                elif clean_mode in ("cloud_due", "due", "due_in_cloud"):
                    cur.execute(
                        """
                        SELECT ac.* FROM anki_cards ac
                        JOIN cloud_study_state cs ON ac.card_id = cs.card_id
                        WHERE ac.state != 'suspended' AND cs.due_at <= %s
                        ORDER BY cs.due_at ASC
                        LIMIT %s;
                        """,
                        (now_dt, effective_limit),
                    )
                elif clean_mode in ("level", "by_jlpt_level", "jlpt") and level:
                    cur.execute(
                        """
                        SELECT * FROM anki_cards
                        WHERE state != 'suspended' AND UPPER(jlpt_level) = %s
                        ORDER BY difficulty_score DESC NULLS LAST
                        LIMIT %s;
                        """,
                        (str(level).strip().upper(), pool_limit),
                    )
                elif clean_mode in ("all", "everything"):
                    cur.execute(
                        """
                        SELECT * FROM anki_cards
                        WHERE state != 'suspended'
                        ORDER BY card_id DESC
                        LIMIT %s;
                        """,
                        (pool_limit,),
                    )
                else:  # default: weakest / quick10
                    cur.execute(
                        """
                        SELECT * FROM anki_cards
                        WHERE state != 'suspended'
                        ORDER BY is_leech DESC,
                                 difficulty_score DESC NULLS LAST,
                                 lapses DESC
                        LIMIT %s;
                        """,
                        (pool_limit,),
                    )

                cols = [desc[0] for desc in cur.description]
                rows = cur.fetchall()
                candidates = []
                for r in rows:
                    d = dict(zip(cols, r))
                    for date_col in ("created_at", "first_review_at", "last_review_at", "mod_at", "synced_at"):
                        if d.get(date_col) is not None:
                            d[date_col] = str(d[date_col])
                    candidates.append(d)

                # If candidates pool exceeds limit, filter out cards practiced in last 4 hours (unless due mode)
                if len(candidates) > effective_limit and clean_mode not in ("due", "cloud_due"):
                    cur.execute(
                        "SELECT DISTINCT card_id FROM cloud_study_reviews WHERE reviewed_at >= %s;",
                        (four_hours_ago,),
                    )
                    recent_cids = {r[0] for r in cur.fetchall()}
                    not_recent = [c for c in candidates if c["card_id"] not in recent_cids]
                    if len(not_recent) >= effective_limit:
                        candidates = not_recent

                # Weighted shuffle: prioritize leeches & higher difficulty while introducing non-deterministic variety
                if len(candidates) > effective_limit:
                    weights = []
                    for c in candidates:
                        diff = float(c.get("difficulty_score") or 50) / 10.0
                        leech_w = 6.0 if c.get("is_leech") else 0.0
                        lapse_w = min(float(c.get("lapses") or 0), 10.0)
                        weights.append(max(1.0, diff + leech_w + lapse_w))

                    chosen_indices = []
                    remaining_indices = list(range(len(candidates)))
                    remaining_weights = list(weights)

                    while len(chosen_indices) < effective_limit and remaining_indices:
                        picked = random.choices(remaining_indices, weights=remaining_weights, k=1)[0]
                        idx = remaining_indices.index(picked)
                        chosen_indices.append(picked)
                        remaining_indices.pop(idx)
                        remaining_weights.pop(idx)

                    items = [candidates[i] for i in chosen_indices]
                else:
                    items = candidates[:effective_limit]

                return _normalize_json_types(items)

    def record_study_review(
        self,
        card_id: int,
        rating: int,
        time_ms: int = 0,
        session_id: str = "",
        review_uuid: Optional[str] = None,
    ) -> dict[str, Any]:
        if not (1 <= int(rating) <= 4):
            raise ValueError(f"Invalid rating {rating}. Must be 1, 2, 3, or 4.")

        now_dt = datetime.now(timezone.utc)
        r_id = str(review_uuid) if review_uuid else str(uuid.uuid4())

        BOX_INTERVALS = {
            1: timedelta(minutes=10),
            2: timedelta(days=1),
            3: timedelta(days=3),
            4: timedelta(days=7),
            5: timedelta(days=21),
        }

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT card_id FROM anki_cards WHERE card_id = %s;", (card_id,))
                if not cur.fetchone():
                    raise KeyError(f"Card {card_id} does not exist in anki_cards.")

                cur.execute("SELECT id FROM cloud_study_reviews WHERE id = %s;", (r_id,))
                if cur.fetchone():
                    cur.execute("SELECT box, due_at, streak, times_seen, again_count FROM cloud_study_state WHERE card_id = %s;", (card_id,))
                    st = cur.fetchone()
                    if st:
                        return {
                            "card_id": card_id,
                            "box": st[0],
                            "due_at": str(st[1]),
                            "streak": st[2],
                            "times_seen": st[3],
                            "again_count": st[4],
                            "duplicate": True,
                        }

                cur.execute("SELECT box, times_seen, again_count, streak FROM cloud_study_state WHERE card_id = %s;", (card_id,))
                state_row = cur.fetchone()

                cur_box = state_row[0] if state_row else 1
                times_seen = (state_row[1] if state_row else 0) + 1
                again_count = (state_row[2] if state_row else 0) + (1 if rating == 1 else 0)
                streak = state_row[3] if state_row else 0

                if rating == 1:
                    new_box = 1
                    streak = 0
                elif rating == 2:
                    new_box = cur_box
                elif rating == 3:
                    new_box = min(5, cur_box + 1)
                    streak += 1
                elif rating == 4:
                    new_box = min(5, cur_box + 2)
                    streak += 1
                else:
                    new_box = cur_box

                due_at = now_dt + BOX_INTERVALS[new_box]

                cur.execute(
                    """
                    INSERT INTO cloud_study_state (
                        card_id, box, due_at, times_seen, again_count, last_result, last_seen_at, streak
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT(card_id) DO UPDATE SET
                        box = EXCLUDED.box,
                        due_at = EXCLUDED.due_at,
                        times_seen = EXCLUDED.times_seen,
                        again_count = EXCLUDED.again_count,
                        last_result = EXCLUDED.last_result,
                        last_seen_at = EXCLUDED.last_seen_at,
                        streak = EXCLUDED.streak;
                    """,
                    (card_id, new_box, due_at, times_seen, again_count, int(rating), now_dt, streak),
                )

                cur.execute(
                    """
                    INSERT INTO cloud_study_reviews (
                        id, card_id, reviewed_at, rating, time_ms, session_id
                    ) VALUES (%s, %s, %s, %s, %s, %s);
                    """,
                    (r_id, card_id, now_dt, int(rating), int(time_ms), str(session_id)),
                )

                conn.commit()
                return {
                    "card_id": card_id,
                    "box": new_box,
                    "due_at": str(due_at),
                    "streak": streak,
                    "times_seen": times_seen,
                    "again_count": again_count,
                    "duplicate": False,
                }

    def get_study_summary(self) -> dict[str, Any]:
        tz_name = os.getenv("USER_TIMEZONE", "Asia/Kolkata")
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Asia/Kolkata")

        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM anki_meta WHERE key = 'collection_day_rollover_hour';")
                meta_row = cur.fetchone()
                rollover_hour = int(meta_row[0]) if meta_row and meta_row[0] else int(os.getenv("ANKI_DAY_ROLLOVER_HOUR", "4"))

                today_start = get_anki_today_start(tz, rollover_hour)
                seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

                cur.execute(
                    "SELECT COUNT(DISTINCT card_id) FROM cloud_study_reviews WHERE reviewed_at >= %s;",
                    (today_start,),
                )
                practiced_today = int(cur.fetchone()[0])

                cur.execute(
                    "SELECT COUNT(DISTINCT card_id) FROM cloud_study_reviews WHERE reviewed_at >= %s;",
                    (seven_days_ago,),
                )
                practiced_7d = int(cur.fetchone()[0])

                cur.execute(
                    "SELECT COUNT(*), COUNT(CASE WHEN rating >= 2 THEN 1 END) FROM cloud_study_reviews;"
                )
                total_rev_row = cur.fetchone()
                total_reviews = int(total_rev_row[0]) if total_rev_row else 0
                passed_reviews = int(total_rev_row[1]) if total_rev_row else 0
                accuracy_pct = round((passed_reviews / total_reviews) * 100.0, 1) if total_reviews > 0 else 100.0

                cur.execute(
                    "SELECT COUNT(*) FROM cloud_study_reviews WHERE reviewed_at >= %s;",
                    (today_start,),
                )
                reviews_today = int(cur.fetchone()[0])

                cur.execute("SELECT COUNT(*) FROM cloud_study_state;")
                cards_in_cloud_study = int(cur.fetchone()[0])

                cur.execute(
                    "SELECT reviewed_at FROM cloud_study_reviews ORDER BY reviewed_at DESC;"
                )
                date_rows = cur.fetchall()
                review_days = set()
                for r in date_rows:
                    if r[0]:
                        rev_dt = r[0] if isinstance(r[0], datetime) else datetime.fromisoformat(str(r[0]))
                        review_days.add(get_anki_collection_day(rev_dt, tz, rollover_hour).isoformat())

                now_utc = datetime.now(timezone.utc)
                today_day = get_anki_collection_day(now_utc, tz, rollover_hour)
                streak_days = 0
                check_date = today_day
                if check_date.isoformat() not in review_days:
                    check_date = check_date - timedelta(days=1)
                while check_date.isoformat() in review_days:
                    streak_days += 1
                    check_date = check_date - timedelta(days=1)

                cur.execute("SELECT box, COUNT(*) as count FROM cloud_study_state GROUP BY box;")
                box_rows = cur.fetchall()
                box_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
                for r in box_rows:
                    b = r[0]
                    if b in box_counts:
                        box_counts[b] = int(r[1])

                cur.execute(
                    """
                    SELECT cs.card_id, ac.expression, ac.reading, ac.meaning,
                           cs.again_count, cs.times_seen, cs.box
                    FROM cloud_study_state cs
                    JOIN anki_cards ac ON cs.card_id = ac.card_id
                    WHERE cs.again_count > 0
                    ORDER BY cs.again_count DESC, cs.times_seen DESC
                    LIMIT 5;
                    """
                )
                hardest_cols = [desc[0] for desc in cur.description]
                hardest_cards = [dict(zip(hardest_cols, r)) for r in cur.fetchall()]

                return _normalize_json_types({
                    "total_reviews": total_reviews,
                    "reviews_today": reviews_today,
                    "practiced_today": practiced_today,
                    "reviewed_today": practiced_today,
                    "practiced_7d": practiced_7d,
                    "reviewed_7d": practiced_7d,
                    "accuracy_pct": accuracy_pct,
                    "streak_days": streak_days,
                    "cards_in_cloud_study": cards_in_cloud_study,
                    "box_counts": box_counts,
                    "boxes": box_counts,
                    "box_distribution": {f"box_{k}": v for k, v in box_counts.items()},
                    "hardest_cards": hardest_cards,
                    "hardest_cloud_cards": hardest_cards,
                })

