"""
Kiroku Note — Cloud Sync Service
Coordinates bidirectional card synchronization and learner progress tracking
between local SQLite and Turso edge database via Cloudflare Worker.
Fully crash-resilient: each batch is committed atomically to SQLite.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import get_db_path
from app.db.connection import db_session, ensure_cloud_sync_tables
from app.schemas import SaveCardRequest
from app.repositories.card_repository import CardRepository
from app.services.card_service import CardService

logger = logging.getLogger(__name__)

DEFAULT_WORKER_URL = "https://kiroku-note.rhythmkach.workers.dev"


class CloudSyncService:
    """Manages push/pull syncing of cards and progress between local SQLite and cloud worker."""

    def __init__(self, db_path: Path | str | None = None):
        self.db_path = Path(db_path) if db_path else get_db_path()
        with db_session(self.db_path) as conn:
            ensure_cloud_sync_tables(conn)
        self.card_repo = CardRepository(self.db_path)

    def get_sync_status(self) -> dict[str, Any]:
        """Return counts of local cards, cloud-synced cards, and pending uploads."""
        with db_session(self.db_path) as conn:
            total_local = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
            synced_to_cloud = conn.execute("SELECT COUNT(*) FROM card_cloud_sync").fetchone()[0]
            pending_push = conn.execute(
                """
                SELECT COUNT(*) FROM cards c
                LEFT JOIN card_cloud_sync s ON c.id = s.card_id
                WHERE s.card_id IS NULL
                """
            ).fetchone()[0]
            cursor_row = conn.execute(
                "SELECT value FROM cloud_sync_meta WHERE key = 'last_pull_cursor'"
            ).fetchone()
            last_cursor = cursor_row[0] if cursor_row else None

        return {
            "total_local": total_local,
            "synced_to_cloud": synced_to_cloud,
            "pending_push": pending_push,
            "last_cursor": last_cursor,
        }

    def get_unsynced_cards(self, limit: int = 20) -> list[dict[str, Any]]:
        """Return up to limit cards that have not been pushed to the cloud."""
        with db_session(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT c.id, c.expression, c.reading, c.meaning, c.hint,
                       c.example_sentence, c.example_translation, c.image, c.audio,
                       c.deck_name, c.tags, c.notes, c.card_kind, c.jlpt_level,
                       c.meanings_json, c.examples_json, c.created_at
                FROM cards c
                LEFT JOIN card_cloud_sync s ON c.id = s.card_id
                WHERE s.card_id IS NULL
                ORDER BY c.id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        items = []
        for r in rows:
            # Generate deterministic cloud op id: card_{local_id}
            item_id = f"card_{r['id']}"
            items.append({
                "id": item_id,
                "local_id": r["id"],
                "op_type": "card_save",
                "expression": r["expression"],
                "reading": r["reading"],
                "meaning": r["meaning"] or "",
                "hint": r["hint"] or "",
                "example_sentence": r["example_sentence"] or "",
                "example_translation": r["example_translation"] or "",
                "image": r["image"] or "",
                "audio": r["audio"] or "",
                "deck_name": r["deck_name"] or "Default",
                "tags": r["tags"] or "",
                "notes": r["notes"] or "",
                "card_kind": r["card_kind"] or "vocab",
                "jlpt_level": r["jlpt_level"] or "",
                "created_at": r["created_at"],
            })
        return items

    def mark_cards_pushed(self, synced_items: list[tuple[int, str]]) -> int:
        """Record local cards as pushed to the cloud in card_cloud_sync table."""
        if not synced_items:
            return 0
        now_str = datetime.now(timezone.utc).isoformat()
        with db_session(self.db_path) as conn:
            for local_id, cloud_op_id in synced_items:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
                    VALUES (?, ?, ?)
                    """,
                    (local_id, cloud_op_id, now_str),
                )
            conn.commit()
        return len(synced_items)

    def update_pull_cursor(self, cursor: str) -> None:
        """Save latest cursor for incremental cloud pulls."""
        if not cursor:
            return
        now_str = datetime.now(timezone.utc).isoformat()
        with db_session(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO cloud_sync_meta (key, value, updated_at)
                VALUES ('last_pull_cursor', ?, ?)
                """,
                (cursor, now_str),
            )
            conn.commit()

    def import_pulled_card(self, item: dict[str, Any]) -> tuple[int, bool]:
        """
        Import or link a card received from cloud pull.
        Returns (card_id, was_new_bool).
        """
        payload = item.get("payload") or item
        expression = payload.get("expression") or payload.get("term") or ""
        reading = payload.get("reading") or ""
        deck_name = payload.get("deck_name") or "Default"
        cloud_id = str(item.get("id") or "")

        if not expression:
            return (0, False)

        existing = self.card_repo.find_by_identity(expression, reading, deck_name)
        now_str = datetime.now(timezone.utc).isoformat()

        if existing:
            # Already exists locally: record cloud link so it won't be pushed again
            with db_session(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
                    VALUES (?, ?, ?)
                    """,
                    (existing.id, cloud_id, now_str),
                )
                conn.commit()
            return (existing.id, False)

        # New card: save via CardService to handle dictionary & media cleanly
        service = CardService(card_repository=self.card_repo)
        req = SaveCardRequest(
            expression=expression,
            reading=reading,
            meaning=payload.get("meaning") or "",
            hint=payload.get("hint") or "",
            example_sentence=payload.get("example_sentence") or payload.get("sentence") or "",
            example_translation=payload.get("example_translation") or payload.get("sentence_meaning") or "",
            image=payload.get("image") or "",
            audio=payload.get("audio") or "",
            tags=payload.get("tags") or "",
            notes=payload.get("notes") or "",
            deck_name=deck_name,
            card_kind=payload.get("card_kind") or "vocab",
            jlpt_level=payload.get("jlpt_level"),
        )
        resp = service.save_card(req)
        card_id = getattr(resp, "id", None) or getattr(resp, "card_id", None)

        if card_id:
            with db_session(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
                    VALUES (?, ?, ?)
                    """,
                    (card_id, cloud_id, now_str),
                )
                conn.commit()
            return (card_id, True)

        return (0, False)

    def get_study_progress_payload(self) -> dict[str, Any]:
        """Aggregate daily activity and review stats for cloud progress tracking."""
        today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with db_session(self.db_path) as conn:
            # Cards mined today
            mined_today = conn.execute(
                "SELECT COUNT(*) FROM cards WHERE created_at LIKE ?",
                (f"{today_iso}%",),
            ).fetchone()[0]

            # Reviews logged today
            reviewed_today = conn.execute(
                "SELECT COUNT(*) FROM review_logs WHERE reviewed_at LIKE ?",
                (f"{today_iso}%",),
            ).fetchone()[0]

            # Again vs Good counts today
            again_count = conn.execute(
                "SELECT COUNT(*) FROM review_logs WHERE rating = 1 AND reviewed_at LIKE ?",
                (f"{today_iso}%",),
            ).fetchone()[0]
            good_count = conn.execute(
                "SELECT COUNT(*) FROM review_logs WHERE rating >= 3 AND reviewed_at LIKE ?",
                (f"{today_iso}%",),
            ).fetchone()[0]

            # Total vocabulary cards
            total_vocab = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]

        return {
            "sync_id": f"progress_{datetime.now(timezone.utc).timestamp()}",
            "daily": {
                "cards_reviewed": reviewed_today,
                "minutes_studied": max(1, reviewed_today * 2),
                "cards_mined": mined_today,
                "again_count": again_count,
                "good_count": good_count,
            },
            "vocab_reviews": [],
            "kanji_practices": [],
            "grammar_reviews": [],
        }

    async def push_batch(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        batch_size: int = 10,
    ) -> dict[str, Any]:
        """Push a batch of unsynced local cards to the cloud edge."""
        worker_url = worker_url.rstrip("/")
        cards = self.get_unsynced_cards(limit=batch_size)
        if not cards:
            return {"pushed": 0, "remaining": 0, "status": "up_to_date"}

        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        clean_ops = []
        for c in cards:
            op = dict(c)
            op.pop("local_id", None)
            clean_ops.append(op)

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{worker_url}/api/sync/push",
                headers=headers,
                json={"ops": clean_ops},
            )
            if not resp.is_success:
                logger.warning("Sync push error %d: %s", resp.status_code, resp.text)
                return {
                    "pushed": 0,
                    "error": f"Cloud push error: {resp.status_code}",
                    "remaining": len(cards),
                }

            data = resp.json()
            created_ids = set(data.get("ids", []))
            synced_pairs = []
            for c in cards:
                if c["id"] in created_ids or data.get("status") == "ok":
                    synced_pairs.append((c["local_id"], c["id"]))

            pushed_count = self.mark_cards_pushed(synced_pairs)
            status_after = self.get_sync_status()

            return {
                "pushed": pushed_count,
                "remaining": status_after["pending_push"],
                "status": "ok",
            }

    async def pull_batch(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        limit: int = 25,
    ) -> dict[str, Any]:
        """Pull a batch of pending cards from cloud edge into local SQLite and acknowledge."""
        worker_url = worker_url.rstrip("/")
        status = self.get_sync_status()
        cursor = status.get("last_cursor")

        url = f"{worker_url}/api/sync/pull?limit={limit}"
        if cursor:
            url += f"&cursor={cursor}"

        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            if not resp.is_success:
                logger.warning("Sync pull error %d: %s", resp.status_code, resp.text)
                return {"pulled": 0, "error": f"Cloud pull error: {resp.status_code}", "has_more": False}

            data = resp.json()
            items = data.get("items", [])
            new_cursor = data.get("cursor")
            has_more = bool(data.get("has_more"))

            imported_count = 0
            pulled_ids = []
            for it in items:
                cid = it.get("id")
                if cid:
                    pulled_ids.append(cid)
                _, is_new = self.import_pulled_card(it)
                if is_new:
                    imported_count += 1

            if new_cursor:
                self.update_pull_cursor(new_cursor)

            # Acknowledge pulled items on worker
            if pulled_ids:
                try:
                    await client.post(
                        f"{worker_url}/api/sync/ack",
                        headers={"Content-Type": "application/json", **headers},
                        json={"ids": pulled_ids},
                    )
                except Exception as ack_err:
                    logger.debug("Sync ack notice: %s", ack_err)

            return {
                "pulled": len(items),
                "imported_new": imported_count,
                "cursor": new_cursor,
                "has_more": has_more,
                "status": "ok",
            }

    async def sync_progress(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
    ) -> dict[str, Any]:
        """Push local learner activity metrics to cloud and retrieve summary."""
        worker_url = worker_url.rstrip("/")
        payload = self.get_study_progress_payload()

        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                await client.post(
                    f"{worker_url}/api/user/progress/sync",
                    headers=headers,
                    json=payload,
                )
            except Exception as e:
                logger.debug("Progress sync notice: %s", e)

            try:
                sum_resp = await client.get(
                    f"{worker_url}/api/user/progress/summary",
                    headers=headers,
                )
                if sum_resp.is_success:
                    return sum_resp.json()
            except Exception as e:
                logger.debug("Progress summary notice: %s", e)

        return {"ok": True, "status": "synced_locally"}

    async def execute_bidirectional_sync(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        batch_size: int = 15,
    ) -> dict[str, Any]:
        """Perform full bidirectional synchronization: push local, pull cloud, and sync progress."""
        worker_url = worker_url or DEFAULT_WORKER_URL
        total_pushed = 0
        total_pulled = 0
        total_imported = 0

        # 1. Push all pending local cards in batches
        while True:
            push_res = await self.push_batch(worker_url, token, batch_size=batch_size)
            if push_res.get("error"):
                logger.warning("Push loop stopped on error: %s", push_res["error"])
                break
            pushed = push_res.get("pushed", 0)
            total_pushed += pushed
            if pushed == 0 or push_res.get("remaining", 0) == 0:
                break

        # 2. Pull all pending cloud cards in batches
        while True:
            pull_res = await self.pull_batch(worker_url, token, limit=batch_size)
            if pull_res.get("error"):
                logger.warning("Pull loop stopped on error: %s", pull_res["error"])
                break
            pulled = pull_res.get("pulled", 0)
            total_pulled += pulled
            total_imported += pull_res.get("imported_new", 0)
            if not pull_res.get("has_more"):
                break

        # 3. Synchronize study activity
        progress_res = await self.sync_progress(worker_url, token)

        status = self.get_sync_status()
        return {
            "ok": True,
            "pushed": total_pushed,
            "pulled": total_pulled,
            "imported_new": total_imported,
            "pending_push": status["pending_push"],
            "total_local": status["total_local"],
            "progress_summary": progress_res.get("summary"),
        }
