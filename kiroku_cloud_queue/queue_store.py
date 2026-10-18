"""
queue_store.py -- Durable storage abstraction for the Kiroku Cloud Queue.

Supports:
  - SQLite (cloud_queue.db: local development, testing, and unified queue storage)
  - PostgreSQL (hosted cloud deployment, e.g. Neon, Render, Supabase)

Note on queue schemas:
  `queue_store.py` defines the canonical BaseQueueStore interface and schema (UUID keys,
  idempotency hashing, lease management, payload_json) used by server.py and CloudQueueAdapter.
  `queue_db.py` is a separate lightweight local-dev SQLite helper (mcp.db) used by LocalDevQueueAdapter.

Key features:
  - Idempotency via content-hashed keys (expression + reading + meaning + sentence + deck)
  - Atomic job claim with recoverable leases (protects against worker crashes)
  - Conditional acknowledgement (ensures only active claim holder can ack)
  - Dead-letter state transition on MAX_ATTEMPTS
"""
from __future__ import annotations

import abc
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from queue_adapter import QueueItem, VocabCard

MAX_ATTEMPTS = 5
DEFAULT_LEASE_SECONDS = 60

# Default SQLite path inside this package
_DEFAULT_DB_PATH = Path(__file__).parent / "cloud_queue.db"


def compute_idempotency_key(card: VocabCard) -> str:
    """Generate a stable SHA-256 digest from normalized card content including meaning."""
    raw = f"{card.expression.strip()}:{card.reading.strip()}:{card.meaning.strip()}:{card.sentence.strip()}:{card.deck_name.strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS queued_cards (
    id               TEXT PRIMARY KEY,
    idempotency_key  TEXT UNIQUE,
    expression       TEXT NOT NULL,
    reading          TEXT NOT NULL DEFAULT '',
    meaning          TEXT NOT NULL DEFAULT '',
    sentence         TEXT NOT NULL DEFAULT '',
    sentence_meaning TEXT NOT NULL DEFAULT '',
    deck_name        TEXT NOT NULL DEFAULT 'N3 vocabs',
    status           TEXT NOT NULL DEFAULT 'pending',
    attempts         INTEGER NOT NULL DEFAULT 0,
    claim_token      TEXT,
    claimed_at       TEXT,
    lease_expires_at TEXT,
    error            TEXT NOT NULL DEFAULT '',
    payload_json     TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_status_lease ON queued_cards (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_qc_idempotency ON queued_cards (idempotency_key);
"""


class BaseQueueStore(abc.ABC):
    @abc.abstractmethod
    def enqueue(self, card: VocabCard, idempotency_key: Optional[str] = None) -> tuple[str, bool]:
        """
        Store card durably. Returns (item_id, is_duplicate).
        """
        raise NotImplementedError

    @abc.abstractmethod
    def claim_pending(self, limit: int = 20, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> list[QueueItem]:
        """
        Atomically claim pending or expired-lease jobs.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def ack(self, item_id: str, claim_token: Optional[str] = None) -> bool:
        """
        Mark card as completed. Conditional on claim_token if provided.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def nack(self, item_id: str, error: str = "", claim_token: Optional[str] = None) -> bool:
        """
        Record failure. Transitions to failed if attempts >= MAX_ATTEMPTS, otherwise pending.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def stats(self) -> dict[str, int]:
        """
        Return status counts.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def get_item(self, item_id: str) -> Optional[QueueItem]:
        """
        Retrieve item by ID.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        """
        Return the most recently submitted cards, newest first.
        Each dict contains: id, expression, reading, meaning, deck_name,
        status, created_at, error.
        Limit is clamped to max 50.
        """
        raise NotImplementedError

    def init_db(self) -> None:
        """
        Idempotently initialize storage tables and indexes.
        """
        pass


class SqliteQueueStore(BaseQueueStore):
    def __init__(self, db_path: Optional[Path | str] = None):
        self.db_path = Path(db_path) if db_path else _DEFAULT_DB_PATH
        self.init_schema()

    def init_db(self) -> None:
        self.init_schema()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        try:
            yield conn
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(_SQLITE_SCHEMA)
            # Migration check for existing DBs
            cursor = conn.execute("PRAGMA table_info(queued_cards);")
            cols = [row["name"] for row in cursor.fetchall()]
            if "payload_json" not in cols:
                conn.execute("ALTER TABLE queued_cards ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';")
            conn.commit()

    def enqueue(self, card: VocabCard, idempotency_key: Optional[str] = None) -> tuple[str, bool]:
        key = idempotency_key or compute_idempotency_key(card)
        now = datetime.now(timezone.utc).isoformat()
        item_id = str(uuid.uuid4())
        payload_json = json.dumps(card.to_dict(), ensure_ascii=False)

        with self._conn() as conn:
            # Fast-path check for existing card by idempotency_key
            row = conn.execute(
                "SELECT id, status FROM queued_cards WHERE idempotency_key = ?",
                (key,),
            ).fetchone()
            if row:
                return str(row["id"]), True

            try:
                conn.execute(
                    """
                    INSERT INTO queued_cards (
                        id, idempotency_key, expression, reading, meaning,
                        sentence, sentence_meaning, deck_name, status, attempts,
                        error, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', ?, ?, ?)
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
                        now,
                        now,
                    ),
                )
                conn.commit()
                return item_id, False
            except sqlite3.IntegrityError:
                # Concurrent insert hit unique constraint on idempotency_key
                row = conn.execute(
                    "SELECT id, status FROM queued_cards WHERE idempotency_key = ?",
                    (key,),
                ).fetchone()
                if row:
                    return str(row["id"]), True
                raise

    def claim_pending(self, limit: int = 20, lease_seconds: int = DEFAULT_LEASE_SECONDS) -> list[QueueItem]:
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        lease_expires_iso = (now_dt + timedelta(seconds=lease_seconds)).isoformat()

        with self._conn() as conn:
            # Atomic claim inside transaction
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """
                SELECT id FROM queued_cards
                WHERE (status = 'pending' AND attempts < ?)
                   OR (status = 'claimed' AND lease_expires_at < ? AND attempts < ?)
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (MAX_ATTEMPTS, now_iso, MAX_ATTEMPTS, limit),
            ).fetchall()

            if not rows:
                conn.commit()
                return []

            claimed_items: list[QueueItem] = []
            for r in rows:
                item_id = r["id"]
                token = str(uuid.uuid4())
                conn.execute(
                    """
                    UPDATE queued_cards
                    SET status = 'claimed',
                        claim_token = ?,
                        claimed_at = ?,
                        lease_expires_at = ?,
                        attempts = attempts + 1,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (token, now_iso, lease_expires_iso, now_iso, item_id),
                )
                full_row = conn.execute(
                    "SELECT * FROM queued_cards WHERE id = ?", (item_id,)
                ).fetchone()
                if full_row:
                    claimed_items.append(self._row_to_item(full_row))

            conn.commit()
            return claimed_items

    def ack(self, item_id: str, claim_token: Optional[str] = None) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            if claim_token:
                cur = conn.execute(
                    """
                    UPDATE queued_cards
                    SET status = 'completed',
                        claim_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?
                    WHERE id = ? AND claim_token = ?
                    """,
                    (now, item_id, claim_token),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE queued_cards
                    SET status = 'completed',
                        claim_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?
                    WHERE id = ? AND status = 'claimed'
                    """,
                    (now, item_id),
                )
            conn.commit()
            return cur.rowcount > 0

    def nack(self, item_id: str, error: str = "", claim_token: Optional[str] = None) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        clean_err = error[:1000]
        with self._conn() as conn:
            # Atomic update using CASE WHEN to eliminate read-modify-write race
            if claim_token:
                cur = conn.execute(
                    """
                    UPDATE queued_cards
                    SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
                        error = ?,
                        claim_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?
                    WHERE id = ? AND claim_token = ?
                    """,
                    (MAX_ATTEMPTS, clean_err, now, item_id, claim_token),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE queued_cards
                    SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
                        error = ?,
                        claim_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (MAX_ATTEMPTS, clean_err, now, item_id),
                )
            conn.commit()
            return cur.rowcount > 0

    def stats(self) -> dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute("SELECT status, COUNT(*) as c FROM queued_cards GROUP BY status").fetchall()
            return {r["status"]: r["c"] for r in rows}

    def get_item(self, item_id: str) -> Optional[QueueItem]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM queued_cards WHERE id = ?", (item_id,)).fetchone()
            return self._row_to_item(row) if row else None

    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        limit = min(max(1, limit), 50)
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT id, expression, reading, meaning, deck_name,
                       status, created_at, error
                FROM queued_cards
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    def _row_to_item(r: sqlite3.Row) -> QueueItem:
        if "payload_json" in r.keys() and r["payload_json"] and r["payload_json"] != "{}":
            try:
                card = VocabCard.from_dict(json.loads(r["payload_json"]))
            except Exception:
                card = VocabCard(
                    expression=r["expression"],
                    reading=r["reading"],
                    meaning=r["meaning"],
                    sentence=r["sentence"],
                    sentence_meaning=r["sentence_meaning"] if "sentence_meaning" in r.keys() else "",
                    deck_name=r["deck_name"],
                )
        else:
            card = VocabCard(
                expression=r["expression"],
                reading=r["reading"],
                meaning=r["meaning"],
                sentence=r["sentence"],
                sentence_meaning=r["sentence_meaning"] if "sentence_meaning" in r.keys() else "",
                deck_name=r["deck_name"],
            )
        claim_token = str(r["claim_token"]) if "claim_token" in r.keys() and r["claim_token"] else ""
        return QueueItem(
            id=str(r["id"]),
            card=card,
            status=r["status"],
            attempts=r["attempts"],
            claim_token=claim_token,
            error=r["error"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )


def get_queue_store(db_path: Optional[Path | str] = None) -> BaseQueueStore:
    """
    Factory for queue store: returns SqliteQueueStore by default.
    If POSTGRES_URL / DATABASE_URL is set (and starts with postgres:// or postgresql://)
    or QUEUE_STORAGE=postgres, returns PostgresQueueStore.
    """
    pg_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
    engine_type = os.getenv("QUEUE_STORAGE", "").lower()
    is_pg = (
        engine_type == "postgres"
        or bool(pg_url and (pg_url.startswith("postgres://") or pg_url.startswith("postgresql://")))
    )
    if pg_url and is_pg:
        # Import lazily to keep SQLite-only environments dependency-free
        from postgres_store import PostgresQueueStore
        return PostgresQueueStore(pg_url)
    return SqliteQueueStore(db_path=db_path)
