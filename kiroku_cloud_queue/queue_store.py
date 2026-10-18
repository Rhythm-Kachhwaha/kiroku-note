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
CREATE TABLE IF NOT EXISTS anki_stats (
    id               TEXT PRIMARY KEY,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qc_status_lease ON queued_cards (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_qc_idempotency ON queued_cards (idempotency_key);

CREATE TABLE IF NOT EXISTS anki_cards (
    card_id             INTEGER PRIMARY KEY,
    note_id             INTEGER NOT NULL,
    deck_name           TEXT NOT NULL,
    model_name          TEXT NOT NULL,
    expression          TEXT NOT NULL,
    reading             TEXT NOT NULL DEFAULT '',
    meaning             TEXT NOT NULL DEFAULT '',
    sentence            TEXT NOT NULL DEFAULT '',
    sentence_meaning    TEXT NOT NULL DEFAULT '',
    jlpt_level          TEXT DEFAULT NULL,
    state               TEXT NOT NULL,
    queue_code          INTEGER NOT NULL DEFAULT 0,
    interval_days       INTEGER NOT NULL DEFAULT 0,
    reps                INTEGER NOT NULL DEFAULT 0,
    lapses              INTEGER NOT NULL DEFAULT 0,
    again_count_10      INTEGER NOT NULL DEFAULT 0,
    reviews_10          INTEGER NOT NULL DEFAULT 0,
    again_rate_10       REAL NOT NULL DEFAULT 0.0,
    avg_time_ms         INTEGER NOT NULL DEFAULT 0,
    difficulty_score    REAL DEFAULT NULL,
    difficulty_label    TEXT NOT NULL DEFAULT 'new',
    is_leech            INTEGER NOT NULL DEFAULT 0,
    fsrs_difficulty     REAL DEFAULT NULL,
    fsrs_stability      REAL DEFAULT NULL,
    fsrs_retrievability REAL DEFAULT NULL,
    due_in_days         INTEGER DEFAULT NULL,
    created_at          TEXT NOT NULL,
    first_review_at     TEXT DEFAULT NULL,
    last_review_at      TEXT DEFAULT NULL,
    mod_at              TEXT NOT NULL,
    synced_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ac_diff_label ON anki_cards (difficulty_label);
CREATE INDEX IF NOT EXISTS idx_ac_state ON anki_cards (state);
CREATE INDEX IF NOT EXISTS idx_ac_deck ON anki_cards (deck_name);
CREATE INDEX IF NOT EXISTS idx_ac_jlpt ON anki_cards (jlpt_level);
CREATE INDEX IF NOT EXISTS idx_ac_diff_score ON anki_cards (difficulty_score);
CREATE INDEX IF NOT EXISTS idx_ac_lapses ON anki_cards (lapses);
CREATE INDEX IF NOT EXISTS idx_ac_due ON anki_cards (due_in_days);
CREATE INDEX IF NOT EXISTS idx_ac_created ON anki_cards (created_at);

CREATE TABLE IF NOT EXISTS anki_daily (
    day                  TEXT PRIMARY KEY,
    reviews              INTEGER NOT NULL DEFAULT 0,
    again                INTEGER NOT NULL DEFAULT 0,
    hard                 INTEGER NOT NULL DEFAULT 0,
    good                 INTEGER NOT NULL DEFAULT 0,
    easy                 INTEGER NOT NULL DEFAULT 0,
    time_ms              INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS anki_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_study_state (
    card_id      INTEGER PRIMARY KEY,
    box          INTEGER NOT NULL DEFAULT 1,
    due_at       TEXT NOT NULL,
    times_seen   INTEGER NOT NULL DEFAULT 0,
    again_count  INTEGER NOT NULL DEFAULT 0,
    last_result  INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT DEFAULT NULL,
    streak       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (card_id) REFERENCES anki_cards(card_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cloud_study_reviews (
    id          TEXT PRIMARY KEY,
    card_id     INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    rating      INTEGER NOT NULL,
    time_ms     INTEGER NOT NULL DEFAULT 0,
    session_id  TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (card_id) REFERENCES anki_cards(card_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_csr_card_id ON cloud_study_reviews (card_id);
CREATE INDEX IF NOT EXISTS idx_csr_reviewed_at ON cloud_study_reviews (reviewed_at);
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

    @abc.abstractmethod
    def save_anki_stats(self, payload: dict[str, Any]) -> None:
        """
        Store latest Anki stats snapshot durably.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def get_anki_stats(self) -> Optional[dict[str, Any]]:
        """
        Retrieve latest Anki stats snapshot.
        """
        raise NotImplementedError

    def upsert_anki_cards(self, rows: list[dict[str, Any]]) -> int:
        return 0

    def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        return 0

    def upsert_anki_daily(self, rows: list[dict[str, Any]]) -> int:
        return 0

    def set_anki_meta(self, key: str, value: str) -> None:
        pass

    def get_anki_meta(self, key: Optional[str] = None) -> dict[str, str]:
        return {}

    def query_anki_cards(
        self,
        filters: Optional[dict[str, Any]] = None,
        sort: str = "difficulty",
        sort_dir: Optional[str] = None,
        dir: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        return [], 0

    def get_anki_card(self, card_id: int) -> Optional[dict[str, Any]]:
        return None

    def get_anki_status(self) -> dict[str, Any]:
        return {
            "synced_at": None,
            "card_count": 0,
            "last_full_reconcile": None,
            "last_reconcile_at": None,
            "schema_version": 1,
            "collection_day_rollover_hour": 4,
        }

    def get_stats_overview(self, range_filter: Optional[str] = None, range_key: Optional[str] = None) -> dict[str, Any]:
        rf = range_key or range_filter or "30d"
        return {
            "growth_curve": [],
            "state_breakdown": [],
            "retention": {
                "range": {"num": 0, "den": 0, "mature_num": 0, "mature_den": 0},
                "weekly": [],
            },
            "answer_buttons": {"again": 0, "hard": 0, "good": 0, "easy": 0, "weekly": []},
            "due_forecast": [],
            "difficulty_distribution": [],
            "weak_words": [],
            "jlpt_coverage": [],
            "queue_activity": [],
            "range": rf,
            "card_count": 0,
        }

    def get_study_session(
        self,
        mode: str = "weakest",
        level: Optional[str] = None,
        limit: int = 20,
        custom_ids: Optional[list[int]] = None,
        custom_card_ids: Optional[list[int]] = None,
    ) -> list[dict[str, Any]]:
        return []

    def record_study_review(
        self,
        card_id: int,
        rating: int,
        time_ms: int = 0,
        session_id: str = "",
        review_uuid: Optional[str] = None,
    ) -> dict[str, Any]:
        return {}

    def get_study_summary(self) -> dict[str, Any]:
        return {
            "practiced_today": 0,
            "practiced_7d": 0,
            "box_counts": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
            "hardest_cards": [],
        }

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
            # Migration check for existing legacy tables (e.g. from queue_db.py) before running script
            cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='queued_cards';")
            if cursor.fetchone():
                cursor_cols = conn.execute("PRAGMA table_info(queued_cards);")
                cols = {row["name"] for row in cursor_cols.fetchall()}
                if "idempotency_key" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN idempotency_key TEXT;")
                if "sentence_meaning" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN sentence_meaning TEXT NOT NULL DEFAULT '';")
                if "claim_token" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN claim_token TEXT;")
                if "claimed_at" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN claimed_at TEXT;")
                if "lease_expires_at" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN lease_expires_at TEXT;")
                if "payload_json" not in cols:
                    conn.execute("ALTER TABLE queued_cards ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';")
                conn.commit()

            conn.executescript(_SQLITE_SCHEMA)
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
                       sentence, sentence_meaning, payload_json,
                       status, created_at, error
                FROM queued_cards
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def save_anki_stats(self, payload: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload_str = json.dumps(payload, ensure_ascii=False)
        with self._conn() as conn:
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

    def get_anki_stats(self) -> Optional[dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT payload_json, updated_at FROM anki_stats WHERE id = 'latest'"
            ).fetchone()
            if not row:
                return None
            try:
                data = json.loads(row["payload_json"])
                if isinstance(data, dict):
                    data.setdefault("updated_at", row["updated_at"])
                    return data
                return {"data": data, "updated_at": row["updated_at"]}
            except Exception:
                return None

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
                1 if r.get("is_leech") else 0,
                float(r["fsrs_difficulty"]) if r.get("fsrs_difficulty") is not None else None,
                float(r["fsrs_stability"]) if r.get("fsrs_stability") is not None else None,
                float(r["fsrs_retrievability"]) if r.get("fsrs_retrievability") is not None else None,
                int(r["due_in_days"]) if r.get("due_in_days") is not None else None,
                str(r.get("created_at") or datetime.now(timezone.utc).isoformat()),
                str(r["first_review_at"]) if r.get("first_review_at") else None,
                str(r["last_review_at"]) if r.get("last_review_at") else None,
                str(r.get("mod_at") or datetime.now(timezone.utc).isoformat()),
                str(r.get("synced_at") or datetime.now(timezone.utc).isoformat()),
            ))

        sql = """
        INSERT INTO anki_cards (
            card_id, note_id, deck_name, model_name, expression, reading,
            meaning, sentence, sentence_meaning, jlpt_level, state, queue_code,
            interval_days, reps, lapses, again_count_10, reviews_10, again_rate_10,
            avg_time_ms, difficulty_score, difficulty_label, is_leech,
            fsrs_difficulty, fsrs_stability, fsrs_retrievability, due_in_days,
            created_at, first_review_at, last_review_at, mod_at, synced_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?
        )
        ON CONFLICT(card_id) DO UPDATE SET
            note_id = excluded.note_id,
            deck_name = excluded.deck_name,
            model_name = excluded.model_name,
            expression = excluded.expression,
            reading = excluded.reading,
            meaning = excluded.meaning,
            sentence = excluded.sentence,
            sentence_meaning = excluded.sentence_meaning,
            jlpt_level = COALESCE(excluded.jlpt_level, anki_cards.jlpt_level),
            state = excluded.state,
            queue_code = excluded.queue_code,
            interval_days = excluded.interval_days,
            reps = excluded.reps,
            lapses = excluded.lapses,
            again_count_10 = excluded.again_count_10,
            reviews_10 = excluded.reviews_10,
            again_rate_10 = excluded.again_rate_10,
            avg_time_ms = excluded.avg_time_ms,
            difficulty_score = excluded.difficulty_score,
            difficulty_label = excluded.difficulty_label,
            is_leech = excluded.is_leech,
            fsrs_difficulty = excluded.fsrs_difficulty,
            fsrs_stability = excluded.fsrs_stability,
            fsrs_retrievability = excluded.fsrs_retrievability,
            due_in_days = excluded.due_in_days,
            created_at = excluded.created_at,
            first_review_at = excluded.first_review_at,
            last_review_at = excluded.last_review_at,
            mod_at = excluded.mod_at,
            synced_at = excluded.synced_at;
        """
        with self._conn() as conn:
            conn.executemany(sql, norm_rows)
            conn.commit()
        return len(norm_rows)

    def reconcile_anki_cards(self, all_card_ids: list[int]) -> int:
        with self._conn() as conn:
            if not all_card_ids:
                total_row = conn.execute("SELECT COUNT(*) FROM anki_cards;").fetchone()
                total = total_row[0] if total_row else 0
                conn.execute("DELETE FROM cloud_study_reviews;")
                conn.execute("DELETE FROM cloud_study_state;")
                conn.execute("DELETE FROM anki_cards;")
                conn.commit()
                return total

            conn.execute("CREATE TEMPORARY TABLE IF NOT EXISTS temp_reconcile_ids (id INTEGER PRIMARY KEY);")
            conn.execute("DELETE FROM temp_reconcile_ids;")
            conn.executemany("INSERT OR IGNORE INTO temp_reconcile_ids (id) VALUES (?);", [(int(cid),) for cid in all_card_ids])

            del_count_row = conn.execute(
                "SELECT COUNT(*) FROM anki_cards WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);"
            ).fetchone()
            del_count = del_count_row[0] if del_count_row else 0

            conn.execute("DELETE FROM cloud_study_reviews WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
            conn.execute("DELETE FROM cloud_study_state WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
            conn.execute("DELETE FROM anki_cards WHERE card_id NOT IN (SELECT id FROM temp_reconcile_ids);")
            conn.execute("DROP TABLE IF EXISTS temp_reconcile_ids;")
            conn.commit()
            return del_count

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
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?, ?, ?
        )
        ON CONFLICT(day) DO UPDATE SET
            reviews = excluded.reviews,
            again = excluded.again,
            hard = excluded.hard,
            good = excluded.good,
            easy = excluded.easy,
            time_ms = excluded.time_ms,
            true_retention_num = excluded.true_retention_num,
            true_retention_den = excluded.true_retention_den,
            mature_retention_num = excluded.mature_retention_num,
            mature_retention_den = excluded.mature_retention_den,
            new_cards_added = excluded.new_cards_added,
            total_cards = excluded.total_cards,
            n_new = excluded.n_new,
            n_learning = excluded.n_learning,
            n_young = excluded.n_young,
            n_mature = excluded.n_mature,
            n_suspended = excluded.n_suspended;
        """
        with self._conn() as conn:
            conn.executemany(sql, norm_rows)
            conn.commit()
        return len(norm_rows)

    def set_anki_meta(self, key: str, value: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO anki_meta (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
                """,
                (str(key), str(value), now),
            )
            conn.commit()

    def get_anki_meta(self, key: Optional[str] = None) -> dict[str, str]:
        with self._conn() as conn:
            if key:
                row = conn.execute("SELECT key, value FROM anki_meta WHERE key = ?;", (key,)).fetchone()
                return {row["key"]: row["value"]} if row else {}
            rows = conn.execute("SELECT key, value FROM anki_meta;").fetchall()
            return {r["key"]: r["value"] for r in rows}

    def query_anki_cards(
        self,
        filters: Optional[dict[str, Any]] = None,
        sort: str = "difficulty",
        sort_dir: Optional[str] = None,
        dir: Optional[str] = None,
        limit: int = 30,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        filters = filters or {}
        limit = max(1, min(100, int(limit)))
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
            where_clauses.append("(expression LIKE ? ESCAPE '\\' OR reading LIKE ? ESCAPE '\\' OR meaning LIKE ? ESCAPE '\\')")
            pattern = f"%{escaped_q}%"
            params.extend([pattern, pattern, pattern])

        state = filters.get("state")
        if state and str(state).strip():
            where_clauses.append("state = ?")
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
                placeholders = ",".join("?" for _ in label_list)
                where_clauses.append(f"difficulty_label IN ({placeholders})")
                params.extend(label_list)

        deck = filters.get("deck")
        if deck and str(deck).strip():
            where_clauses.append("deck_name = ?")
            params.append(str(deck).strip())

        jlpt = filters.get("jlpt")
        if jlpt and str(jlpt).strip():
            val = str(jlpt).strip().upper()
            if val == "UNKNOWN":
                where_clauses.append("(jlpt_level IS NULL OR jlpt_level = '')")
            else:
                where_clauses.append("jlpt_level = ?")
                params.append(val)

        due_within = filters.get("due_within")
        if due_within is not None and str(due_within).strip() != "":
            try:
                days = int(due_within)
                where_clauses.append("(due_in_days IS NOT NULL AND due_in_days <= ? AND due_in_days >= 0)")
                params.append(days)
            except ValueError:
                pass

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        if col in ("difficulty_score", "due_in_days"):
            order_sql = f"ORDER BY CASE WHEN {col} IS NULL THEN 1 ELSE 0 END, {col} {direction}, card_id {direction}"
        else:
            order_sql = f"ORDER BY {col} {direction}, card_id {direction}"

        with self._conn() as conn:
            count_sql = f"SELECT COUNT(*) FROM anki_cards {where_sql};"
            total = conn.execute(count_sql, params).fetchone()[0]

            select_sql = f"SELECT * FROM anki_cards {where_sql} {order_sql} LIMIT ? OFFSET ?;"
            rows = conn.execute(select_sql, params + [limit, offset]).fetchall()
            items = []
            for r in rows:
                d = dict(r)
                if "is_leech" in d:
                    d["is_leech"] = bool(d["is_leech"])
                items.append(d)
            return items, total

    def get_anki_card(self, card_id: int) -> Optional[dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM anki_cards WHERE card_id = ?;", (card_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            if "is_leech" in d:
                d["is_leech"] = bool(d["is_leech"])
            return d

    def get_anki_status(self) -> dict[str, Any]:
        with self._conn() as conn:
            card_count = conn.execute("SELECT COUNT(*) FROM anki_cards;").fetchone()[0]
            meta_rows = conn.execute("SELECT key, value FROM anki_meta;").fetchall()
            meta = {r["key"]: r["value"] for r in meta_rows}
            last_synced_row = conn.execute("SELECT MAX(synced_at) FROM anki_cards;").fetchone()
            last_synced = last_synced_row[0] if last_synced_row else None
            last_reconcile = meta.get("last_full_reconcile_at")
            return {
                "synced_at": meta.get("last_mirror_sync_at") or last_synced,
                "card_count": card_count,
                "last_full_reconcile": last_reconcile,
                "last_reconcile_at": last_reconcile,
                "schema_version": str(meta.get("schema_version", "1")),
                "collection_day_rollover_hour": int(meta.get("collection_day_rollover_hour", 4)),
            }

    def get_stats_overview(self, range_filter: Optional[str] = None, range_key: Optional[str] = None) -> dict[str, Any]:
        now_dt = datetime.now()
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

        with self._conn() as conn:
            card_count = conn.execute("SELECT COUNT(*) FROM anki_cards;").fetchone()[0]

            # 1. Daily rows query
            if start_date:
                daily_rows = conn.execute(
                    "SELECT * FROM anki_daily WHERE day >= ? ORDER BY day ASC;",
                    (start_date,),
                ).fetchall()
            else:
                daily_rows = conn.execute("SELECT * FROM anki_daily ORDER BY day ASC;").fetchall()

            # Downsample if daily rows > 365
            if len(daily_rows) > 365:
                # Keep every 7th day for older entries
                cutoff_idx = len(daily_rows) - 365
                sampled_daily = [r for i, r in enumerate(daily_rows[:cutoff_idx]) if i % 7 == 0] + list(daily_rows[cutoff_idx:])
            else:
                sampled_daily = list(daily_rows)

            growth_curve = [
                {"day": r["day"], "total": r["total_cards"], "new": r["new_cards_added"]}
                for r in sampled_daily
            ]

            state_breakdown = [
                {
                    "day": r["day"],
                    "mature": r["n_mature"],
                    "young": r["n_young"],
                    "learning": r["n_learning"],
                    "new": r["n_new"],
                    "suspended": r["n_suspended"],
                }
                for r in sampled_daily
            ]

            # 2. Retention calculation
            tot_ret_num = sum(r["true_retention_num"] for r in daily_rows)
            tot_ret_den = sum(r["true_retention_den"] for r in daily_rows)
            tot_mat_num = sum(r["mature_retention_num"] for r in daily_rows)
            tot_mat_den = sum(r["mature_retention_den"] for r in daily_rows)

            # Weekly retention points
            weekly_ret_map: dict[str, dict[str, int]] = {}
            for r in daily_rows:
                # Group by week (ISO year-week)
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
                    "rate": rate,
                    "n": vals["den"],
                    "mature_rate": mat_rate,
                    "mature_n": vals["mat_den"],
                })

            # 3. Answer buttons
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

            # 4. Due forecast (from anki_cards)
            due_rows = conn.execute(
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
            ).fetchall()
            due_forecast = [{"day": int(r["due_bucket"]), "count": int(r["count"])} for r in due_rows]

            # 5. Difficulty distribution (from anki_cards)
            diff_rows = conn.execute(
                """
                SELECT difficulty_label, state, COUNT(*) as count
                FROM anki_cards
                GROUP BY difficulty_label, state;
                """
            ).fetchall()
            diff_map: dict[str, dict[str, int]] = {}
            for r in diff_rows:
                lbl = r["difficulty_label"]
                st = r["state"]
                cnt = int(r["count"])
                d_entry = diff_map.setdefault(lbl, {"label": lbl, "total": 0, "mature": 0, "young": 0, "other": 0})
                d_entry["total"] += cnt
                if st == "mature":
                    d_entry["mature"] += cnt
                elif st == "young":
                    d_entry["young"] += cnt
                else:
                    d_entry["other"] += cnt
            standard_labels = ["leech", "hard", "normal", "easy", "solid", "new"]
            difficulty_distribution = [
                diff_map.get(lbl, {"label": lbl, "total": 0, "mature": 0, "young": 0, "other": 0})
                for lbl in standard_labels
            ]

            # 6. Weak words (top 20)
            weak_rows = conn.execute(
                """
                SELECT card_id, expression, reading, meaning, lapses, again_rate_10,
                       interval_days, difficulty_score, difficulty_label, is_leech
                FROM anki_cards
                WHERE reps > 0
                ORDER BY is_leech DESC,
                         CASE WHEN difficulty_score IS NULL THEN 1 ELSE 0 END,
                         difficulty_score DESC,
                         lapses DESC
                LIMIT 20;
                """
            ).fetchall()
            weak_words = [dict(r) for r in weak_rows]

            # 7. JLPT coverage
            jlpt_rows = conn.execute(
                """
                SELECT COALESCE(NULLIF(jlpt_level, ''), 'unknown') as level, state, COUNT(*) as count
                FROM anki_cards
                GROUP BY level, state;
                """
            ).fetchall()
            jlpt_map: dict[str, dict[str, int]] = {}
            for r in jlpt_rows:
                lvl = r["level"].upper()
                st = r["state"]
                cnt = int(r["count"])
                j_entry = jlpt_map.setdefault(lvl, {"level": lvl, "total": 0, "mature": 0, "young": 0, "other": 0})
                j_entry["total"] += cnt
                if st == "mature":
                    j_entry["mature"] += cnt
                elif st == "young":
                    j_entry["young"] += cnt
                else:
                    j_entry["other"] += cnt
            jlpt_levels = ["N5", "N4", "N3", "N2", "N1", "UNKNOWN"]
            jlpt_coverage = [
                jlpt_map.get(lvl, {"level": lvl, "total": 0, "mature": 0, "young": 0, "other": 0})
                for lvl in jlpt_levels if lvl in jlpt_map
            ]

            # 8. Mining / Queue activity
            queue_rows = conn.execute(
                """
                SELECT strftime('%Y-W%W', created_at) as week, status, COUNT(*) as count
                FROM queued_cards
                GROUP BY week, status
                ORDER BY week DESC
                LIMIT 12;
                """
            ).fetchall()
            q_map: dict[str, dict[str, int]] = {}
            for r in queue_rows:
                wk = r["week"] or "unknown"
                st = r["status"]
                cnt = int(r["count"])
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

            return {
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
            }

    def get_study_session(
        self,
        mode: str = "weakest",
        level: Optional[str] = None,
        limit: int = 20,
        custom_ids: Optional[list[int]] = None,
        custom_card_ids: Optional[list[int]] = None,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(100, int(limit)))
        now_iso = datetime.now(timezone.utc).isoformat()
        effective_ids = custom_ids or custom_card_ids

        with self._conn() as conn:
            if effective_ids:
                placeholders = ",".join("?" for _ in effective_ids)
                rows = conn.execute(
                    f"SELECT * FROM anki_cards WHERE card_id IN ({placeholders}) LIMIT ?;",
                    effective_ids + [limit],
                ).fetchall()
                items = []
                for r in rows:
                    d = dict(r)
                    if "is_leech" in d:
                        d["is_leech"] = bool(d["is_leech"])
                    items.append(d)
                return items

            clean_mode = str(mode).lower().strip()
            if clean_mode == "leeches":
                rows = conn.execute(
                    """
                    SELECT * FROM anki_cards
                    WHERE is_leech = 1 OR difficulty_label = 'leech'
                    ORDER BY lapses DESC, card_id DESC
                    LIMIT ?;
                    """,
                    (limit,),
                ).fetchall()
            elif clean_mode == "level" and level:
                rows = conn.execute(
                    """
                    SELECT * FROM anki_cards
                    WHERE state != 'suspended' AND jlpt_level = ?
                    ORDER BY CASE WHEN difficulty_score IS NULL THEN 1 ELSE 0 END,
                             difficulty_score DESC, lapses DESC
                    LIMIT ?;
                    """,
                    (str(level).strip().upper(), limit),
                ).fetchall()
            elif clean_mode == "recent":
                fourteen_days_ago = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
                rows = conn.execute(
                    """
                    SELECT * FROM anki_cards
                    WHERE state != 'suspended' AND created_at >= ?
                    ORDER BY created_at DESC
                    LIMIT ?;
                    """,
                    (fourteen_days_ago, limit),
                ).fetchall()
            elif clean_mode == "never_practiced" or clean_mode == "unseen":
                rows = conn.execute(
                    """
                    SELECT ac.* FROM anki_cards ac
                    WHERE ac.state != 'suspended'
                      AND ac.card_id NOT IN (SELECT card_id FROM cloud_study_state)
                    ORDER BY CASE WHEN ac.difficulty_score IS NULL THEN 1 ELSE 0 END,
                             ac.difficulty_score DESC, ac.card_id DESC
                    LIMIT ?;
                    """,
                    (limit,),
                ).fetchall()
            elif clean_mode == "cloud_due":
                rows = conn.execute(
                    """
                    SELECT ac.* FROM anki_cards ac
                    JOIN cloud_study_state cs ON ac.card_id = cs.card_id
                    WHERE ac.state != 'suspended' AND cs.due_at <= ?
                    ORDER BY cs.due_at ASC
                    LIMIT ?;
                    """,
                    (now_iso, limit),
                ).fetchall()
            else:  # default: weakest
                rows = conn.execute(
                    """
                    SELECT * FROM anki_cards
                    WHERE state != 'suspended'
                    ORDER BY is_leech DESC,
                             CASE WHEN difficulty_score IS NULL THEN 1 ELSE 0 END,
                             difficulty_score DESC, lapses DESC
                    LIMIT ?;
                    """,
                    (limit,),
                ).fetchall()

            items = []
            for r in rows:
                d = dict(r)
                if "is_leech" in d:
                    d["is_leech"] = bool(d["is_leech"])
                items.append(d)
            return items

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
        now_iso = now_dt.isoformat()
        r_id = str(review_uuid) if review_uuid else str(uuid.uuid4())

        BOX_INTERVALS = {
            1: timedelta(minutes=10),
            2: timedelta(days=1),
            3: timedelta(days=3),
            4: timedelta(days=7),
            5: timedelta(days=21),
        }

        with self._conn() as conn:
            card_row = conn.execute("SELECT card_id FROM anki_cards WHERE card_id = ?;", (card_id,)).fetchone()
            if not card_row:
                raise KeyError(f"Card {card_id} does not exist in anki_cards.")

            # Idempotency check for double tap
            existing_rev = conn.execute(
                "SELECT id FROM cloud_study_reviews WHERE id = ?;",
                (r_id,),
            ).fetchone()
            if existing_rev:
                state_row = conn.execute(
                    "SELECT box, due_at, streak, times_seen, again_count FROM cloud_study_state WHERE card_id = ?;",
                    (card_id,),
                ).fetchone()
                if state_row:
                    return {
                        "card_id": card_id,
                        "box": state_row["box"],
                        "due_at": state_row["due_at"],
                        "streak": state_row["streak"],
                        "times_seen": state_row["times_seen"],
                        "again_count": state_row["again_count"],
                        "duplicate": True,
                    }

            # Fetch current state
            state_row = conn.execute(
                "SELECT box, times_seen, again_count, streak FROM cloud_study_state WHERE card_id = ?;",
                (card_id,),
            ).fetchone()

            cur_box = state_row["box"] if state_row else 1
            times_seen = (state_row["times_seen"] if state_row else 0) + 1
            again_count = (state_row["again_count"] if state_row else 0) + (1 if rating == 1 else 0)
            streak = state_row["streak"] if state_row else 0

            if rating == 1:  # Again
                new_box = 1
                streak = 0
            elif rating == 2:  # Hard
                new_box = cur_box
            elif rating == 3:  # Good
                new_box = min(5, cur_box + 1)
                streak += 1
            elif rating == 4:  # Easy
                new_box = min(5, cur_box + 2)
                streak += 2
            else:
                new_box = cur_box

            due_at = (now_dt + BOX_INTERVALS[new_box]).isoformat()

            conn.execute(
                """
                INSERT INTO cloud_study_state (
                    card_id, box, due_at, times_seen, again_count, last_result, last_seen_at, streak
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(card_id) DO UPDATE SET
                    box = excluded.box,
                    due_at = excluded.due_at,
                    times_seen = excluded.times_seen,
                    again_count = excluded.again_count,
                    last_result = excluded.last_result,
                    last_seen_at = excluded.last_seen_at,
                    streak = excluded.streak;
                """,
                (card_id, new_box, due_at, times_seen, again_count, int(rating), now_iso, streak),
            )

            conn.execute(
                """
                INSERT INTO cloud_study_reviews (
                    id, card_id, reviewed_at, rating, time_ms, session_id
                ) VALUES (?, ?, ?, ?, ?, ?);
                """,
                (r_id, card_id, now_iso, int(rating), int(time_ms), str(session_id)),
            )

            conn.commit()
            return {
                "card_id": card_id,
                "box": new_box,
                "due_at": due_at,
                "streak": streak,
                "times_seen": times_seen,
                "again_count": again_count,
                "duplicate": False,
            }

    def get_study_summary(self) -> dict[str, Any]:
        now_dt = datetime.now(timezone.utc)
        today_start = datetime(now_dt.year, now_dt.month, now_dt.day, tzinfo=timezone.utc).isoformat()
        seven_days_ago = (now_dt - timedelta(days=7)).isoformat()

        with self._conn() as conn:
            today_row = conn.execute(
                "SELECT COUNT(DISTINCT card_id) FROM cloud_study_reviews WHERE reviewed_at >= ?;",
                (today_start,),
            ).fetchone()
            practiced_today = today_row[0] if today_row else 0

            seven_row = conn.execute(
                "SELECT COUNT(DISTINCT card_id) FROM cloud_study_reviews WHERE reviewed_at >= ?;",
                (seven_days_ago,),
            ).fetchone()
            practiced_7d = seven_row[0] if seven_row else 0

            box_rows = conn.execute(
                "SELECT box, COUNT(*) as count FROM cloud_study_state GROUP BY box;"
            ).fetchall()
            box_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
            for r in box_rows:
                b = r["box"]
                if b in box_counts:
                    box_counts[b] = int(r["count"])

            hardest_rows = conn.execute(
                """
                SELECT cs.card_id, ac.expression, ac.reading, ac.meaning,
                       cs.again_count, cs.times_seen, cs.box
                FROM cloud_study_state cs
                JOIN anki_cards ac ON cs.card_id = ac.card_id
                WHERE cs.again_count > 0
                ORDER BY cs.again_count DESC, cs.times_seen DESC
                LIMIT 5;
                """
            ).fetchall()
            hardest_cards = [dict(r) for r in hardest_rows]

            return {
                "practiced_today": practiced_today,
                "practiced_7d": practiced_7d,
                "box_counts": box_counts,
                "box_distribution": {f"box_{k}": v for k, v in box_counts.items()},
                "hardest_cards": hardest_cards,
                "hardest_cloud_cards": hardest_cards,
            }

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
