"""
Kiroku Note — Cloud Sync Service
Coordinates bidirectional card synchronization and learner progress tracking
between local SQLite and Turso edge database via Cloudflare Worker.
Fully crash-resilient: each batch is committed atomically to SQLite.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
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
                WHERE s.card_id IS NULL OR c.updated_at > s.synced_at
                """
            ).fetchone()[0]
            try:
                pending_deletes = conn.execute(
                    "SELECT COUNT(*) FROM deleted_cards WHERE pushed_at IS NULL"
                ).fetchone()[0]
                pending_push += pending_deletes
            except Exception:
                pass
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

    @staticmethod
    def _inline_card_image(raw_image: str) -> str:
        """Inline local capture frame files (<= 250KB) as data URIs for cloud rendering."""
        if not raw_image or raw_image.startswith(("data:", "http://", "https://")):
            return raw_image or ""
        try:
            import base64
            from app.services.media_storage import get_media_dir
            img_name = Path(raw_image.replace("/api/media/", "")).name
            img_path = get_media_dir() / img_name
            if img_path.is_file() and img_path.stat().st_size <= 250 * 1024:
                ext = img_path.suffix.lower().lstrip(".") or "jpeg"
                mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
                b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
                return f"data:{mime};base64,{b64}"
        except Exception:
            pass
        return raw_image

    @classmethod
    def _serialize_card_op(cls, r: Any) -> dict[str, Any]:
        """Serialize a local card SQLite row into a user_op_log card_save payload."""
        hash_key = hashlib.sha256(f"{r['expression']}|{r['reading']}|{r['deck_name']}".encode()).hexdigest()[:16]
        item_id = f"card_{hash_key}"
        return {
            "id": item_id,
            "local_id": r["id"],
            "op_type": "card_save",
            "expression": r["expression"],
            "reading": r["reading"],
            "meaning": r["meaning"] or "",
            "hint": r["hint"] or "",
            "example_sentence": r["example_sentence"] or "",
            "example_translation": r["example_translation"] or "",
            "image": cls._inline_card_image(r["image"] or ""),
            "audio": r["audio"] or "",
            "deck_name": r["deck_name"] or "Default",
            "tags": r["tags"] or "",
            "notes": r["notes"] or "",
            "card_kind": r["card_kind"] or "vocab",
            "jlpt_level": r["jlpt_level"] or "",
            "meanings_json": r["meanings_json"] or "",
            "examples_json": r["examples_json"] or "",
            "source_text": r["source_text"] or "",
            "deinflected_text": r["deinflected_text"] or "",
            "source_type": r["source_type"] or "",
            "source_url": r["source_url"] or "",
            "model_name": r["model_name"] or "",
            "sync_status": r["sync_status"] or "synced",
            "anki_note_id": r["anki_note_id"],
            "synced_at": r["synced_at"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"] or r["created_at"],
        }

    def get_unsynced_cards(self, limit: int = 20) -> list[dict[str, Any]]:
        """Return up to limit cards and card deletions that have not been pushed to the cloud."""
        with db_session(self.db_path) as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS deleted_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER,
                expression TEXT,
                reading TEXT,
                deck_name TEXT,
                deleted_at TEXT,
                pushed_at TEXT
            );
            """)
            conn.execute("""
            CREATE TABLE IF NOT EXISTS card_cloud_sync (
                card_id INTEGER PRIMARY KEY,
                cloud_op_id TEXT,
                synced_at TEXT
            );
            """)
            del_rows = conn.execute(
                """
                SELECT id, card_id, expression, reading, deck_name, deleted_at
                FROM deleted_cards
                WHERE pushed_at IS NULL
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            remaining_limit = max(0, limit - len(del_rows))
            rows = []
            if remaining_limit > 0:
                rows = conn.execute(
                    """
                    SELECT c.id, c.expression, c.reading, c.meaning, c.hint,
                           c.example_sentence, c.example_translation, c.image, c.audio,
                           c.deck_name, c.tags, c.notes, c.card_kind, c.jlpt_level,
                           c.meanings_json, c.examples_json, c.created_at, c.updated_at,
                           c.source_text, c.deinflected_text, c.source_type, c.source_url, c.model_name,
                           c.sync_status, c.anki_note_id, c.synced_at
                    FROM cards c
                    LEFT JOIN card_cloud_sync s ON c.id = s.card_id
                    WHERE s.card_id IS NULL OR c.updated_at > s.synced_at
                    ORDER BY c.id ASC
                    LIMIT ?
                    """,
                    (remaining_limit,),
                ).fetchall()

        import hashlib
        items = []
        for dr in del_rows:
            hash_key = hashlib.sha256(f"{dr['expression']}|{dr['reading']}|{dr['deck_name']}".encode()).hexdigest()[:16]
            items.append({
                "id": f"del_{hash_key}",
                "local_id": dr["id"],
                "tombstone_id": dr["id"],
                "op_type": "card_delete",
                "expression": dr["expression"] or "",
                "reading": dr["reading"] or "",
                "deck_name": dr["deck_name"] or "Default",
                "deleted_at": dr["deleted_at"],
            })

        for r in rows:
            items.append(self._serialize_card_op(r))
        return items

    def mark_cards_pushed(self, synced_items: list[tuple[int, str]]) -> int:
        """Record local cards and tombstones as pushed to the cloud."""
        if not synced_items:
            return 0
        now_str = datetime.now(timezone.utc).isoformat()
        with db_session(self.db_path) as conn:
            for local_id, cloud_op_id in synced_items:
                if str(cloud_op_id).startswith("del_"):
                    conn.execute(
                        "UPDATE deleted_cards SET pushed_at = ? WHERE id = ?",
                        (now_str, local_id),
                    )
                else:
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

        if not expression or len(str(expression)) > 200:
            if expression:
                logger.warning("Skipping pulled cloud op %s: expression exceeds 200 chars (%d)", cloud_id, len(str(expression)))
            return (0, False)

        # Check if this op originated from this device and is already recorded
        with db_session(self.db_path) as conn:
            if cloud_id:
                already_recorded = conn.execute(
                    "SELECT card_id FROM card_cloud_sync WHERE cloud_op_id = ?",
                    (cloud_id,)
                ).fetchone()
                if already_recorded:
                    return (already_recorded[0], False)

        now_str = datetime.now(timezone.utc).isoformat()
        is_delete_op = (item.get("op_type") == "card_delete" or payload.get("op_type") == "card_delete")

        if is_delete_op:
            with db_session(self.db_path) as conn:
                existing = self.card_repo.find_by_identity(expression, reading, deck_name)
                del_id = existing.id if existing else 0
                if existing:
                    conn.execute("DELETE FROM cards WHERE id = ?", (existing.id,))
                    conn.execute("DELETE FROM card_cloud_sync WHERE card_id = ?", (existing.id,))
                conn.execute("""
                    INSERT OR IGNORE INTO deleted_cards (card_id, expression, reading, deck_name, deleted_at, pushed_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (del_id, expression, reading, deck_name, now_str, now_str))
                conn.commit()
            return (del_id, False)

        # Check if card was deleted locally and tombstone is newer
        with db_session(self.db_path) as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS deleted_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id INTEGER,
                expression TEXT,
                reading TEXT,
                deck_name TEXT,
                deleted_at TEXT,
                pushed_at TEXT
            );
            """)
            tombstone = conn.execute(
                "SELECT deleted_at FROM deleted_cards WHERE expression = ? AND reading = ? AND deck_name = ? ORDER BY id DESC LIMIT 1",
                (expression, reading, deck_name)
            ).fetchone()
            if tombstone and tombstone[0]:
                card_updated = payload.get("updated_at") or payload.get("created_at") or ""
                if not card_updated or tombstone[0] >= card_updated:
                    return (0, False)

        card_kind = payload.get("card_kind") or "vocab"
        existing = self.card_repo.find_by_identity(expression, reading, deck_name, card_kind=card_kind)

        if existing:
            # LWW check: if local card was modified more recently than cloud payload, retain local edit
            with db_session(self.db_path) as conn:
                card_row = conn.execute("SELECT updated_at FROM cards WHERE id = ?", (existing.id,)).fetchone()
                local_updated = card_row[0] if (card_row and card_row[0]) else ""
                cloud_updated = payload.get("updated_at") or payload.get("created_at") or ""
                if local_updated and cloud_updated and local_updated > cloud_updated:
                    return (existing.id, False)

                conn.execute(
                    "DELETE FROM deleted_cards WHERE expression = ? AND reading = ? AND deck_name = ?",
                    (expression, reading, deck_name)
                )
                if payload.get("meanings_json"):
                    conn.execute(
                        "UPDATE cards SET meanings_json = ? WHERE id = ?",
                        (payload["meanings_json"], existing.id)
                    )
                if payload.get("examples_json"):
                    conn.execute(
                        "UPDATE cards SET examples_json = ? WHERE id = ?",
                        (payload["examples_json"], existing.id)
                    )
                if payload.get("meaning"):
                    conn.execute(
                        "UPDATE cards SET meaning = ? WHERE id = ?",
                        (payload["meaning"], existing.id)
                    )
                if payload.get("image"):
                    conn.execute("UPDATE cards SET image = ? WHERE id = ?", (payload["image"], existing.id))
                if payload.get("audio"):
                    conn.execute("UPDATE cards SET audio = ? WHERE id = ?", (payload["audio"], existing.id))
                if payload.get("hint"):
                    conn.execute("UPDATE cards SET hint = ? WHERE id = ?", (payload["hint"], existing.id))
                for extra_col in (
                    "source_text", "deinflected_text", "source_type", "source_url", "model_name",
                    "tags", "notes", "jlpt_level", "example_sentence", "example_translation"
                ):
                    if payload.get(extra_col):
                        try:
                            conn.execute(f"UPDATE cards SET {extra_col} = ? WHERE id = ?", (payload[extra_col], existing.id))
                        except Exception:
                            pass
                card_row = conn.execute("SELECT updated_at FROM cards WHERE id = ?", (existing.id,)).fetchone()
                sync_time = card_row[0] if (card_row and card_row[0]) else datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT OR REPLACE INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
                    VALUES (?, ?, ?)
                    """,
                    (existing.id, cloud_id, sync_time),
                )
                conn.commit()
            return (existing.id, False)

        # New card: save via CardService to handle dictionary & media cleanly
        from pydantic import ValidationError
        service = CardService(card_repository=self.card_repo)
        try:
            req = SaveCardRequest(
                expression=str(expression)[:200],
                reading=str(reading)[:200],
                meaning=str(payload.get("meaning") or "")[:2000],
                hint=str(payload.get("hint") or "")[:500],
                example_sentence=str(payload.get("example_sentence") or payload.get("sentence") or "")[:1000],
                example_translation=str(payload.get("example_translation") or payload.get("sentence_meaning") or "")[:1000],
                image=payload.get("image") or "",
                audio=payload.get("audio") or "",
                tags=str(payload.get("tags") or "")[:500],
                notes=str(payload.get("notes") or "")[:2000],
                deck_name=str(deck_name)[:100],
                card_kind=str(payload.get("card_kind") or "vocab")[:30],
                jlpt_level=payload.get("jlpt_level"),
            )
        except ValidationError as val_err:
            logger.warning("Skipping invalid pulled cloud op %s: %s", cloud_id, val_err)
            return (0, False)
        resp = service.save_card(req)
        card_id = getattr(resp, "id", None) or getattr(resp, "card_id", None)

        if card_id:
            with db_session(self.db_path) as conn:
                if payload.get("meanings_json"):
                    conn.execute(
                        "UPDATE cards SET meanings_json = ? WHERE id = ?",
                        (payload["meanings_json"], card_id)
                    )
                if payload.get("examples_json"):
                    conn.execute(
                        "UPDATE cards SET examples_json = ? WHERE id = ?",
                        (payload["examples_json"], card_id)
                    )
                for extra_col in ("source_text", "deinflected_text", "source_type", "source_url", "model_name"):
                    if payload.get(extra_col):
                        try:
                            conn.execute(f"UPDATE cards SET {extra_col} = ? WHERE id = ?", (payload[extra_col], card_id))
                        except Exception:
                            pass
                card_row = conn.execute("SELECT updated_at FROM cards WHERE id = ?", (card_id,)).fetchone()
                sync_time = card_row[0] if (card_row and card_row[0]) else datetime.now(timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT OR REPLACE INTO card_cloud_sync (card_id, cloud_op_id, synced_at)
                    VALUES (?, ?, ?)
                    """,
                    (card_id, cloud_id, sync_time),
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

            # Query recent anime watch progress from link_episode if table exists
            anime_progress = []
            try:
                table_check = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='link_episode'"
                ).fetchone()
                if table_check:
                    rows = conn.execute(
                        """SELECT series, episode_key, last_position_ms, duration_ms, mined, poster_url, synopsis, title, media_type, ts
                           FROM link_episode
                           WHERE series IS NOT NULL AND series != ''
                           ORDER BY ts DESC LIMIT 100"""
                    ).fetchall()
                    for r in rows:
                        ep_num = 1
                        ep_key_str = str(r[1] or "")
                        num_match = re.search(r"\d+", ep_key_str)
                        if num_match:
                            ep_num = int(num_match.group(0))
                        dur = int(r[3] or 0)
                        pos = int(r[2] or 0)
                        completed = 1 if (dur > 0 and pos >= dur * 0.85) else 0
                        anime_progress.append({
                            "series_id": str(r[0]),
                            "series_title": str(r[0]),
                            "episode_number": ep_num,
                            "last_position_ms": pos,
                            "duration_ms": dur,
                            "mined_card_count": int(r[4] or 0),
                            "completed": completed,
                            "poster_url": str(r[5] or ""),
                            "synopsis": str(r[6] or ""),
                            "media_type": str(r[8] or "anime"),
                            "last_watched_at": int(r[9] or 0),
                        })
            except Exception as e:
                logger.debug("Anime progress gather note: %s", e)

            grammar_reviews = []
            try:
                gp_rows = conn.execute(
                    """SELECT pattern_key, mastery_score, drill_count
                       FROM grammar_points
                       WHERE mastery_score > 0 OR drill_count > 0 OR status != 'new'
                       LIMIT 500"""
                ).fetchall()
                for gr in gp_rows:
                    pk = str(gr[0] or "").strip()
                    if not pk:
                        continue
                    ms = float(gr[1] or 0.0)
                    ml = int(round(ms * 100)) if ms <= 1.0 else int(round(ms))
                    grammar_reviews.append({
                        "point_id": pk,
                        "mastery_level": ml,
                        "consecutive_correct": int(gr[2] or 0),
                    })
            except Exception as e:
                logger.debug("Grammar progress gather note: %s", e)

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
            "grammar_reviews": grammar_reviews,
            "anime_progress": anime_progress,
        }

    async def push_batch(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        batch_size: int = 50,
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
        limit: int = 100,
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
        """Bidirectionally sync learner progress, word states, kanji mastery, and settings."""
        worker_url = worker_url.rstrip("/")
        payload = self.get_study_progress_payload()

        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        synced_known_pulled = 0
        synced_known_pushed = 0
        synced_level = None

        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Pull cloud word states, kanji progress, and preferences
            cloud_known_map: dict[str, str] = {}
            cloud_prefs: dict[str, Any] | None = None
            try:
                pull_resp = await client.get(
                    f"{worker_url}/api/user/progress/pull",
                    headers=headers,
                )
                if pull_resp.is_success:
                    pull_data = pull_resp.json()
                    from app.services.word_state_service import WordStateService
                    ws_service = WordStateService(db_path=self.db_path)

                    for kw in (pull_data.get("known_words") or []):
                        w = str(kw.get("word") or "").strip()
                        st = str(kw.get("status") or "known").strip().lower()
                        if not w:
                            continue
                        cloud_known_map[w] = st
                        try:
                            prev = ws_service.get_word_state(expression=w)
                            prev_st = str(getattr(prev, "state", "") or "").strip().lower() if prev else None
                            ws_service.set_user_word_state(state=st, expression=w)
                            if prev_st != st:
                                synced_known_pulled += 1
                        except Exception:
                            pass

                    for kp in (pull_data.get("kanji_practices") or []):
                        ch = str(kp.get("kanji_char") or "").strip()
                        flags = int(kp.get("mastery_flags") or 0)
                        acc = float(kp.get("accuracy_percent") or 0)
                        revs = int(kp.get("review_count") or 0)
                        if ch and (flags > 0 or acc >= 80 or revs >= 3):
                            try:
                                ws_service.set_user_word_state(state="known", expression=ch)
                            except Exception:
                                pass

                    cloud_prefs = pull_data.get("preferences")
                    cloud_grammar = pull_data.get("grammar_progress") or []
                    if cloud_grammar:
                        with db_session(self.db_path) as conn:
                            for gp in cloud_grammar:
                                pid = str(gp.get("point_id") or "").strip()
                                if not pid:
                                    continue
                                ml = float(gp.get("mastery_level") or 0)
                                dc = int(gp.get("consecutive_correct") or 0)
                                norm_score = ml / 100.0 if ml > 1.0 else ml
                                conn.execute(
                                    """UPDATE grammar_points
                                       SET mastery_score = MAX(mastery_score, ?),
                                           drill_count = MAX(drill_count, ?),
                                           status = CASE WHEN ? >= 80 THEN 'mastered' WHEN status = 'new' THEN 'learning' ELSE status END
                                       WHERE pattern_key = ?""",
                                    (norm_score, dc, ml, pid),
                                )
            except Exception as e:
                logger.debug("Progress pull notice: %s", e)

            # 2. Push local-only known_words to cloud so Desktop -> Cloud stays in sync
            try:
                with db_session(self.db_path) as conn:
                    local_known = [
                        str(r[0]).strip()
                        for r in conn.execute("SELECT word FROM known_words").fetchall()
                        if r[0] and str(r[0]).strip()
                    ]
                local_only = [w for w in local_known if w not in cloud_known_map]
                if local_only:
                    for i in range(0, len(local_only), 200):
                        chunk = local_only[i:i + 200]
                        push_kw_resp = await client.post(
                            f"{worker_url}/api/vocab/inventory/bulk-state",
                            headers=headers,
                            json={"expressions": chunk, "state": "known"},
                        )
                        if push_kw_resp.is_success:
                            synced_known_pushed += len(chunk)
            except Exception as e:
                logger.debug("Known words push notice: %s", e)

            # 3. Bidirectionally sync learner settings (JLPT level & Anki deck)
            try:
                from app.config import (
                    load_stored_llm_config,
                    normalize_jlpt_level,
                    save_stored_llm_config,
                )
                stored = load_stored_llm_config()
                local_level = normalize_jlpt_level(
                    stored.get("learner_jlpt_level") or stored.get("jlpt_level")
                ) or "N4"
                local_prefs = stored.get("learner_preferences") or {}
                if not isinstance(local_prefs, dict):
                    local_prefs = {}
                local_deck = str(stored.get("anki_deck") or local_prefs.get("anki_deck") or "").strip()
                local_updated = int(stored.get("learner_updated_at") or 0)
                cloud_updated = int((cloud_prefs or {}).get("updated_at") or 0)
                cloud_level = normalize_jlpt_level((cloud_prefs or {}).get("learner_level")) if cloud_prefs else None

                if cloud_prefs and cloud_updated > local_updated and cloud_level:
                    stored["learner_jlpt_level"] = cloud_level
                    stored["jlpt_level"] = cloud_level
                    stored["learner_updated_at"] = cloud_updated
                    if cloud_prefs.get("anki_deck"):
                        local_prefs["anki_deck"] = cloud_prefs["anki_deck"]
                    stored["learner_preferences"] = {**local_prefs, **{k: v for k, v in cloud_prefs.items() if k != "updated_at"}}
                    save_stored_llm_config(stored)
                    synced_level = cloud_level
                else:
                    await client.put(
                        f"{worker_url}/api/learner/settings",
                        headers=headers,
                        json={
                            "learner_level": local_level,
                            "anki_deck": local_deck,
                            "preferences": {**local_prefs, "learner_level": local_level, "anki_deck": local_deck},
                        },
                    )
                    synced_level = local_level
            except Exception as e:
                logger.warning("Learner settings sync notice: %s", e)

            # 4. Push study progress & anime progress
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
                    data = sum_resp.json()
                    data["known_words_pulled"] = synced_known_pulled
                    data["known_words_pushed"] = synced_known_pushed
                    if synced_level:
                        data["learner_level"] = synced_level
                    return data
            except Exception as e:
                logger.debug("Progress summary notice: %s", e)

        return {
            "ok": True,
            "status": "synced_locally",
            "known_words_pulled": synced_known_pulled,
            "known_words_pushed": synced_known_pushed,
            "learner_level": synced_level,
        }

    async def execute_bidirectional_sync(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        batch_size: int = 50,
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

    async def repush_anime_cards(
        self,
        worker_url: str = DEFAULT_WORKER_URL,
        token: str = "",
        series_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """Push all local anime/video cards (with inlined frames) to cloud user_op_log."""
        worker_url = (worker_url or DEFAULT_WORKER_URL).rstrip("/")
        if not token:
            return {"ok": False, "pushed": 0, "error": "Missing auth token"}

        terms = {"anime", "hianime", "zokoanime", "crunchyroll", "netflix", "youtube", "jimaku", "miruro"}
        slugs = set()
        for s in (series_names or []):
            clean = str(s or "").strip().lower()
            if clean:
                terms.add(clean)
                slug = re.sub(r"[\s\-_!?:;.,'\"()[\]{}]+", "", clean)
                if len(slug) >= 2:
                    slugs.add(slug)

        with db_session(self.db_path) as conn:
            try:
                ep_rows = conn.execute("SELECT series, title FROM link_episode").fetchall()
                for er in ep_rows:
                    for val in (er["series"], er["title"]):
                        clean = str(val or "").strip().lower()
                        if clean and len(clean) >= 2:
                            terms.add(clean)
                            slug = re.sub(r"[\s\-_!?:;.,'\"()[\]{}]+", "", clean)
                            if len(slug) >= 2:
                                slugs.add(slug)
            except Exception:
                pass

            rows = conn.execute(
                """
                SELECT c.id, c.expression, c.reading, c.meaning, c.hint,
                       c.example_sentence, c.example_translation, c.image, c.audio,
                       c.deck_name, c.tags, c.notes, c.card_kind, c.jlpt_level,
                       c.meanings_json, c.examples_json, c.created_at, c.updated_at,
                       c.source_text, c.deinflected_text, c.source_type, c.source_url, c.model_name,
                       c.sync_status, c.anki_note_id, c.synced_at
                FROM cards c
                ORDER BY c.id DESC
                """
            ).fetchall()

        matched_ops: list[dict[str, Any]] = []
        for r in rows:
            stype = (r["source_type"] or "").lower()
            hay = " ".join([
                r["source_url"] or "",
                r["tags"] or "",
                r["notes"] or "",
                r["source_text"] or "",
                r["deck_name"] or "",
            ]).lower()
            hay_slug = re.sub(r"[\s\-_!?:;.,'\"()[\]{}]+", "", hay)
            is_anime = (
                stype == "video"
                or any(t in hay for t in terms)
                or any(sl in hay_slug for sl in slugs)
            )
            if is_anime:
                matched_ops.append(self._serialize_card_op(r))

        if not matched_ops:
            return {"ok": True, "pushed": 0, "total_matched": 0}

        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
        pushed_total = 0
        synced_pairs: list[tuple[int, str]] = []

        # Chunk by <= 20 cards and <= 350KB JSON to stay safely under 512KB Worker cap
        batch: list[dict[str, Any]] = []
        batch_bytes = 0
        batches: list[list[dict[str, Any]]] = []
        for op in matched_ops:
            clean_op = dict(op)
            local_id = clean_op.pop("local_id", None)
            clean_op["_local_id"] = local_id
            sz = len(json.dumps(clean_op))
            if batch and (len(batch) >= 20 or batch_bytes + sz > 350 * 1024):
                batches.append(batch)
                batch = []
                batch_bytes = 0
            batch.append(clean_op)
            batch_bytes += sz
        if batch:
            batches.append(batch)

        async with httpx.AsyncClient(timeout=20.0) as client:
            for b in batches:
                send_ops = []
                pairs = []
                for item in b:
                    lid = item.pop("_local_id", None)
                    send_ops.append(item)
                    if lid is not None:
                        pairs.append((lid, item["id"]))
                resp = await client.post(
                    f"{worker_url}/api/sync/push",
                    headers=headers,
                    json={"ops": send_ops},
                )
                if resp.is_success:
                    pushed_total += len(send_ops)
                    synced_pairs.extend(pairs)
                else:
                    logger.warning("Repush anime batch error %d: %s", resp.status_code, resp.text)

        if synced_pairs:
            self.mark_cards_pushed(synced_pairs)

        return {"ok": True, "pushed": pushed_total, "total_matched": len(matched_ops)}
