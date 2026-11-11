"""Repository boundary for canonical word_states and word_encounters persistence."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import re
import sqlite3
from typing import Any, Sequence
import unicodedata

from app.db.connection import (
    db_session,
    ensure_vocab_state_tables,
    init_db,
)
from app.services.card_normalizer import normalize_expression
from kiroku_dictionary.schema import katakana_to_hiragana

VALID_WORD_STATES: tuple[str, ...] = (
    "unseen",
    "seen",
    "tracking",
    "learning",
    "known",
    "ignored",
    "blacklisted",
)
VALID_WORD_STATES_SET: frozenset[str] = frozenset(VALID_WORD_STATES)
MANUAL_OVERRIDE_STATES: frozenset[str] = frozenset({"ignored", "blacklisted"})
EXCLUDED_FROM_STATS_STATES: frozenset[str] = frozenset({"blacklisted"})


def normalize_word_expression(expression: str | None) -> str:
    """Normalize a Japanese word expression for canonical lookup."""
    return normalize_expression(str(expression or ""))


def normalize_word_reading(reading: str | None) -> str:
    """Normalize a Japanese reading to trimmed NFC/NFKC hiragana."""
    raw = str(reading or "")
    if not raw:
        return ""
    collapsed = re.sub(r"[\s\u3000]+", " ", unicodedata.normalize("NFKC", raw)).strip()
    return katakana_to_hiragana(collapsed)


def _validate_state(state: str) -> str:
    clean = str(state or "").strip().lower()
    if clean not in VALID_WORD_STATES_SET:
        raise ValueError(
            f"Invalid word state '{state}'. Expected one of: {', '.join(VALID_WORD_STATES)}."
        )
    return clean


@dataclass
class WordStateRecord:
    """Persistent learner state row for a vocabulary word."""

    id: int
    sequence_id: int | None
    reading: str
    expression: str
    state: str
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    anki_interval: int | None = None
    anki_lapses: int | None = None
    anki_status: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class WordEncounterRecord:
    """Persistent encounter log row for a vocabulary word occurrence."""

    id: int
    sequence_id: int | None
    reading: str
    expression: str
    sentence: str
    source_media: str
    timestamp: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class WordStatesIndex:
    """In-memory index for sub-millisecond word state resolution without homograph collisions."""

    by_canonical: dict[tuple[int, str], WordStateRecord] = field(default_factory=dict)
    by_fallback_expr_reading: dict[tuple[str, str], WordStateRecord] = field(default_factory=dict)
    by_fallback_expr: dict[str, WordStateRecord] = field(default_factory=dict)
    by_expr_reading_any: dict[tuple[str, str], list[WordStateRecord]] = field(default_factory=dict)

    def resolve(
        self,
        *,
        sequence_id: int | None = None,
        canonical_reading: str | None = None,
        reading: str = "",
        expression: str = "",
        surface: str = "",
    ) -> WordStateRecord | None:
        """
        Resolve a token's WordStateRecord.

        When sequence_id is present, checks (sequence_id, reading) FIRST and only falls
        back to sequence_id IS NULL entries (never across different sequence_ids).
        When sequence_id is absent/unresolved, matches (expression, reading) first and
        falls back to readingless expression entries only if reading is absent or stored
        without a reading.
        """
        norm_canon = normalize_word_reading(canonical_reading)
        norm_read = normalize_word_reading(reading)
        expr_candidates: list[str] = []
        for cand in (expression, surface):
            norm_c = normalize_word_expression(cand)
            if norm_c and norm_c not in expr_candidates:
                expr_candidates.append(norm_c)

        if sequence_id is not None:
            reading_candidates = [r for r in (norm_canon, norm_read) if r]
            if not reading_candidates:
                reading_candidates = [""]
            for r in reading_candidates:
                hit = self.by_canonical.get((sequence_id, r))
                if hit is not None:
                    return hit

            # Fallback only to explicit non-JMdict (sequence_id IS NULL) rows
            for expr in expr_candidates:
                for r in reading_candidates:
                    if r:
                        hit = self.by_fallback_expr_reading.get((expr, r))
                        if hit is not None:
                            return hit
                hit = self.by_fallback_expr.get(expr)
                if hit is not None:
                    return hit
            return None

        # Unresolved / no sequence_id path
        effective_read = norm_canon or norm_read
        for expr in expr_candidates:
            if effective_read:
                hit = self.by_fallback_expr_reading.get((expr, effective_read))
                if hit is not None:
                    return hit
                any_hits = self.by_expr_reading_any.get((expr, effective_read))
                if any_hits:
                    return any_hits[0]
            hit = self.by_fallback_expr.get(expr)
            if hit is not None:
                return hit
        return None


def _row_to_word_state(row: sqlite3.Row) -> WordStateRecord:
    return WordStateRecord(
        id=int(row["id"]),
        sequence_id=int(row["sequence_id"]) if row["sequence_id"] is not None else None,
        reading=str(row["reading"] or ""),
        expression=str(row["expression"] or ""),
        state=str(row["state"] or "unseen"),
        first_seen_at=row["first_seen_at"],
        last_seen_at=row["last_seen_at"],
        anki_interval=int(row["anki_interval"]) if row["anki_interval"] is not None else None,
        anki_lapses=int(row["anki_lapses"]) if row["anki_lapses"] is not None else None,
        anki_status=str(row["anki_status"] or ""),
        updated_at=str(row["updated_at"] or ""),
    )


def _pick_later_timestamp(first: str | None, second: str | None) -> str | None:
    if not first:
        return second
    if not second:
        return first
    return max(first, second)


def _pick_earlier_timestamp(first: str | None, second: str | None) -> str | None:
    if not first:
        return second
    if not second:
        return first
    return min(first, second)


class WordStateRepository:
    """SQLite repository for word_states and word_encounters."""

    def __init__(self, db_path: Path | str | None = None, *, initialize: bool = True):
        self._db_path = db_path
        if initialize:
            init_db(self._db_path)

    def _find_row(
        self,
        conn: sqlite3.Connection,
        *,
        sequence_id: int | None,
        norm_reading: str,
        norm_expr: str,
    ) -> sqlite3.Row | None:
        if sequence_id is not None:
            row = conn.execute(
                "SELECT * FROM word_states WHERE sequence_id = ? AND reading = ?",
                (sequence_id, norm_reading),
            ).fetchone()
            if row is not None or norm_reading != "":
                return row
            return conn.execute(
                "SELECT * FROM word_states WHERE sequence_id = ? ORDER BY id ASC LIMIT 1",
                (sequence_id,),
            ).fetchone()

        if not norm_expr:
            return None
        row = conn.execute(
            "SELECT * FROM word_states WHERE sequence_id IS NULL AND expression = ? AND reading = ?",
            (norm_expr, norm_reading),
        ).fetchone()
        if row is not None or norm_reading != "":
            return row
        return conn.execute(
            "SELECT * FROM word_states WHERE sequence_id IS NULL AND expression = ? ORDER BY id ASC LIMIT 1",
            (norm_expr,),
        ).fetchone()

    def get_word_state(
        self,
        *,
        sequence_id: int | None = None,
        reading: str = "",
        expression: str = "",
    ) -> WordStateRecord | None:
        """Retrieve a word_states record by (sequence_id, reading) or fallback (expression, reading)."""
        norm_expr = normalize_word_expression(expression)
        norm_reading = normalize_word_reading(reading)
        if sequence_id is None and not norm_expr:
            return None

        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            row = self._find_row(
                conn,
                sequence_id=sequence_id,
                norm_reading=norm_reading,
                norm_expr=norm_expr,
            )
            if row is None and sequence_id is None and norm_expr and norm_reading:
                row = conn.execute(
                    "SELECT * FROM word_states WHERE expression = ? AND reading = ? ORDER BY id ASC LIMIT 1",
                    (norm_expr, norm_reading),
                ).fetchone()
            return _row_to_word_state(row) if row is not None else None

    def upsert_word_state(
        self,
        *,
        expression: str = "",
        reading: str = "",
        sequence_id: int | None = None,
        state: str = "unseen",
        first_seen_at: str | None = None,
        last_seen_at: str | None = None,
        anki_interval: int | None = None,
        anki_lapses: int | None = None,
        anki_status: str | None = None,
        clear_anki_interval: bool = False,
        respect_manual_override: bool = True,
        now_iso: str | None = None,
    ) -> WordStateRecord:
        """Insert or update a word_states record, enforcing partial unique identity and manual overrides."""
        validated_state = _validate_state(state)
        norm_expr = normalize_word_expression(expression)
        norm_reading = normalize_word_reading(reading)
        if sequence_id is None and not norm_expr:
            raise ValueError("Either sequence_id or a non-empty expression is required.")

        ts = now_iso or datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            existing = self._find_row(
                conn,
                sequence_id=sequence_id,
                norm_reading=norm_reading,
                norm_expr=norm_expr,
            )
            if existing is not None:
                existing_state = str(existing["state"])
                next_state = (
                    existing_state
                    if (respect_manual_override and existing_state in MANUAL_OVERRIDE_STATES)
                    else validated_state
                )
                next_expr = norm_expr or str(existing["expression"] or "")
                next_first = _pick_earlier_timestamp(existing["first_seen_at"], first_seen_at)
                next_last = _pick_later_timestamp(existing["last_seen_at"], last_seen_at)
                if clear_anki_interval:
                    next_interval = None
                elif anki_interval is not None:
                    next_interval = int(anki_interval)
                else:
                    next_interval = existing["anki_interval"]

                next_lapses = int(anki_lapses) if anki_lapses is not None else existing["anki_lapses"]
                next_anki_status = (
                    str(anki_status) if anki_status is not None else str(existing["anki_status"] or "")
                )

                conn.execute(
                    """
                    UPDATE word_states SET
                        expression = ?,
                        state = ?,
                        first_seen_at = ?,
                        last_seen_at = ?,
                        anki_interval = ?,
                        anki_lapses = ?,
                        anki_status = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        next_expr,
                        next_state,
                        next_first,
                        next_last,
                        next_interval,
                        next_lapses,
                        next_anki_status,
                        ts,
                        existing["id"],
                    ),
                )
                conn.commit()
                updated = conn.execute(
                    "SELECT * FROM word_states WHERE id = ?", (existing["id"],)
                ).fetchone()
                return _row_to_word_state(updated)

            try:
                cur = conn.execute(
                    """
                    INSERT INTO word_states (
                        sequence_id, reading, expression, state,
                        first_seen_at, last_seen_at,
                        anki_interval, anki_lapses, anki_status, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sequence_id,
                        norm_reading,
                        norm_expr,
                        validated_state,
                        first_seen_at,
                        last_seen_at,
                        None if clear_anki_interval else anki_interval,
                        anki_lapses,
                        str(anki_status or ""),
                        ts,
                    ),
                )
                conn.commit()
                inserted = conn.execute(
                    "SELECT * FROM word_states WHERE id = ?", (cur.lastrowid,)
                ).fetchone()
                return _row_to_word_state(inserted)
            except sqlite3.IntegrityError:
                # Race fallback: re-fetch and update
                raced = self._find_row(
                    conn,
                    sequence_id=sequence_id,
                    norm_reading=norm_reading,
                    norm_expr=norm_expr,
                )
                if raced is None:
                    raise
                return _row_to_word_state(raced)

    def set_user_word_state(
        self,
        *,
        state: str,
        expression: str = "",
        reading: str = "",
        sequence_id: int | None = None,
        now_iso: str | None = None,
    ) -> WordStateRecord:
        """Manually set a word's state (e.g. ignored, blacklisted, tracking, known), overriding prior state."""
        validated_state = _validate_state(state)
        ts = now_iso or datetime.now(timezone.utc).isoformat()
        first_seen = ts if validated_state in {"seen", "tracking", "learning", "known"} else None
        last_seen = ts if validated_state in {"seen", "tracking", "learning", "known"} else None
        return self.upsert_word_state(
            expression=expression,
            reading=reading,
            sequence_id=sequence_id,
            state=validated_state,
            first_seen_at=first_seen,
            last_seen_at=last_seen,
            respect_manual_override=False,
            now_iso=ts,
        )

    def list_word_states(
        self,
        *,
        state: str | None = None,
        include_blacklisted: bool = True,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[WordStateRecord]:
        """List word_states rows with optional state/search filters and pagination."""
        clauses: list[str] = []
        params: list[Any] = []

        if state is not None and str(state).strip():
            clean_state = _validate_state(state)
            clauses.append("state = ?")
            params.append(clean_state)
        elif not include_blacklisted:
            clauses.append("state != 'blacklisted'")

        if search and search.strip():
            needle = f"%{search.strip()}%"
            clauses.append("(expression LIKE ? OR reading LIKE ?)")
            params.extend([needle, needle])

        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        safe_limit = max(1, min(int(limit), 1000))
        safe_offset = max(0, int(offset))

        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            rows = conn.execute(
                f"SELECT * FROM word_states{where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
                (*params, safe_limit, safe_offset),
            ).fetchall()
            return [_row_to_word_state(r) for r in rows]

    def get_word_states_index(self) -> WordStatesIndex:
        """Load all word_states into an indexed structure for fast O(1) resolution."""
        index = WordStatesIndex()
        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            rows = conn.execute("SELECT * FROM word_states ORDER BY id ASC").fetchall()
            for row in rows:
                rec = _row_to_word_state(row)
                if rec.sequence_id is not None:
                    index.by_canonical[(rec.sequence_id, rec.reading)] = rec
                else:
                    if rec.reading:
                        index.by_fallback_expr_reading[(rec.expression, rec.reading)] = rec
                    else:
                        index.by_fallback_expr[rec.expression] = rec
                if rec.expression and rec.reading:
                    index.by_expr_reading_any.setdefault((rec.expression, rec.reading), []).append(rec)
        return index

    def list_anki_backed_states(self) -> list[WordStateRecord]:
        """Return word_states rows previously hydrated from Anki (for deleted-card detection)."""
        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            rows = conn.execute(
                """
                SELECT * FROM word_states
                WHERE anki_status != '' AND anki_status != 'deleted'
                ORDER BY id ASC
                """
            ).fetchall()
            return [_row_to_word_state(r) for r in rows]

    def get_stats(self) -> dict[str, Any]:
        """Return aggregate counts per word state, excluding blacklisted words from active totals."""
        counts: dict[str, int] = {state: 0 for state in VALID_WORD_STATES}
        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            rows = conn.execute(
                "SELECT state, COUNT(*) AS cnt FROM word_states GROUP BY state"
            ).fetchall()
            for row in rows:
                st = str(row["state"])
                if st in counts:
                    counts[st] = int(row["cnt"])

        active_total = sum(
            cnt for st, cnt in counts.items() if st not in EXCLUDED_FROM_STATS_STATES
        )
        return {
            "counts": counts,
            "active_total": active_total,
            "blacklisted_excluded": counts["blacklisted"],
        }

    def log_encounter(
        self,
        *,
        expression: str,
        reading: str = "",
        sequence_id: int | None = None,
        sentence: str = "",
        source_media: str = "",
        timestamp: str | None = None,
    ) -> int:
        """Record a single word encounter and advance unseen -> seen in word_states."""
        norm_expr = normalize_word_expression(expression)
        norm_reading = normalize_word_reading(reading)
        if sequence_id is None and not norm_expr:
            raise ValueError("Either sequence_id or a non-empty expression is required.")
        ts = timestamp or datetime.now(timezone.utc).isoformat()

        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            cur = conn.execute(
                """
                INSERT INTO word_encounters (
                    sequence_id, reading, expression, sentence, source_media, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    sequence_id,
                    norm_reading,
                    norm_expr,
                    str(sentence or ""),
                    str(source_media or ""),
                    ts,
                ),
            )
            self._advance_seen_on_conn(
                conn,
                sequence_id=sequence_id,
                norm_reading=norm_reading,
                norm_expr=norm_expr,
                ts=ts,
            )
            conn.commit()
            return int(cur.lastrowid)

    def log_encounters(
        self,
        encounters: Sequence[dict[str, Any]],
        *,
        default_sentence: str = "",
        default_source_media: str = "",
        timestamp: str | None = None,
    ) -> int:
        """Batch-record word encounters and advance unseen -> seen in a single transaction."""
        if not encounters:
            return 0

        default_ts = timestamp or datetime.now(timezone.utc).isoformat()
        prepared: list[tuple[int | None, str, str, str, str, str]] = []
        for item in encounters:
            seq_raw = item.get("sequence_id")
            seq_id = int(seq_raw) if seq_raw is not None else None
            norm_expr = normalize_word_expression(
                item.get("expression") or item.get("lemma") or item.get("surface") or ""
            )
            norm_reading = normalize_word_reading(
                item.get("canonical_reading") or item.get("reading") or ""
            )
            if seq_id is None and not norm_expr:
                continue
            sentence = str(item.get("sentence") if item.get("sentence") is not None else default_sentence or "")
            source_media = str(
                item.get("source_media") if item.get("source_media") is not None else default_source_media or ""
            )
            ts = str(item.get("timestamp") or default_ts)
            prepared.append((seq_id, norm_reading, norm_expr, sentence, source_media, ts))

        if not prepared:
            return 0

        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            conn.executemany(
                """
                INSERT INTO word_encounters (
                    sequence_id, reading, expression, sentence, source_media, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                prepared,
            )
            # Deduplicate state updates within the batch by identity
            latest_by_identity: dict[tuple[int | None, str, str], str] = {}
            for seq_id, norm_reading, norm_expr, _sent, _src, ts in prepared:
                ident = (seq_id, norm_reading, norm_expr if seq_id is None else "")
                prev_ts = latest_by_identity.get(ident)
                if prev_ts is None or ts > prev_ts:
                    latest_by_identity[ident] = ts
                # Keep non-empty expression for new inserts when seq_id is set
            expr_by_seq: dict[tuple[int, str], str] = {}
            for seq_id, norm_reading, norm_expr, _sent, _src, _ts in prepared:
                if seq_id is not None and norm_expr and (seq_id, norm_reading) not in expr_by_seq:
                    expr_by_seq[(seq_id, norm_reading)] = norm_expr

            for (seq_id, norm_reading, ident_expr), ts in latest_by_identity.items():
                expr_for_row = expr_by_seq.get((seq_id, norm_reading), ident_expr) if seq_id is not None else ident_expr
                self._advance_seen_on_conn(
                    conn,
                    sequence_id=seq_id,
                    norm_reading=norm_reading,
                    norm_expr=expr_for_row,
                    ts=ts,
                )
            conn.commit()
            return len(prepared)

    def _advance_seen_on_conn(
        self,
        conn: sqlite3.Connection,
        *,
        sequence_id: int | None,
        norm_reading: str,
        norm_expr: str,
        ts: str,
    ) -> None:
        existing = self._find_row(
            conn,
            sequence_id=sequence_id,
            norm_reading=norm_reading,
            norm_expr=norm_expr,
        )
        if existing is None:
            conn.execute(
                """
                INSERT INTO word_states (
                    sequence_id, reading, expression, state,
                    first_seen_at, last_seen_at, updated_at
                ) VALUES (?, ?, ?, 'seen', ?, ?, ?)
                """,
                (sequence_id, norm_reading, norm_expr, ts, ts, ts),
            )
            return

        current_state = str(existing["state"])
        next_state = "seen" if current_state == "unseen" else current_state
        next_first = _pick_earlier_timestamp(existing["first_seen_at"], ts)
        next_last = _pick_later_timestamp(existing["last_seen_at"], ts)
        next_expr = norm_expr or str(existing["expression"] or "")
        conn.execute(
            """
            UPDATE word_states SET
                expression = ?,
                state = ?,
                first_seen_at = ?,
                last_seen_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (next_expr, next_state, next_first, next_last, ts, existing["id"]),
        )

    def get_encounter_summary(
        self,
        *,
        sequence_id: int | None = None,
        reading: str = "",
        expression: str = "",
        recent_limit: int = 10,
    ) -> dict[str, Any]:
        """Return total encounters, distinct source_media count, and recent evidence sentences."""
        norm_expr = normalize_word_expression(expression)
        norm_reading = normalize_word_reading(reading)
        if sequence_id is None and not norm_expr:
            raise ValueError("Either sequence_id or a non-empty expression is required.")

        clauses: list[str] = []
        params: list[Any] = []
        if sequence_id is not None:
            clauses.append("sequence_id = ?")
            params.append(sequence_id)
            if norm_reading:
                clauses.append("reading = ?")
                params.append(norm_reading)
        else:
            clauses.append("expression = ?")
            params.append(norm_expr)
            if norm_reading:
                clauses.append("reading = ?")
                params.append(norm_reading)

        where = " WHERE " + " AND ".join(clauses)
        safe_limit = max(1, min(int(recent_limit), 100))

        with db_session(self._db_path) as conn:
            ensure_vocab_state_tables(conn)
            agg = conn.execute(
                f"""
                SELECT
                    COUNT(*) AS total_encounters,
                    COUNT(DISTINCT CASE WHEN source_media != '' THEN source_media END) AS episode_count,
                    MIN(timestamp) AS first_seen_at,
                    MAX(timestamp) AS last_seen_at
                FROM word_encounters{where}
                """,
                params,
            ).fetchone()
            recent_rows = conn.execute(
                f"""
                SELECT id, sequence_id, reading, expression, sentence, source_media, timestamp
                FROM word_encounters{where}
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
                """,
                (*params, safe_limit),
            ).fetchall()

        total_encounters = int(agg["total_encounters"]) if agg else 0
        episode_count = int(agg["episode_count"]) if agg else 0
        return {
            "sequence_id": sequence_id,
            "reading": norm_reading,
            "expression": norm_expr,
            "total_encounters": total_encounters,
            "episode_count": episode_count,
            "distinct_sources": episode_count,
            "first_seen_at": agg["first_seen_at"] if agg else None,
            "last_seen_at": agg["last_seen_at"] if agg else None,
            "recent_sentences": [
                {
                    "id": int(r["id"]),
                    "sentence": str(r["sentence"] or ""),
                    "source_media": str(r["source_media"] or ""),
                    "timestamp": str(r["timestamp"] or ""),
                }
                for r in recent_rows
            ],
        }
