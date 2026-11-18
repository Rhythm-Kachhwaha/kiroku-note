"""Bidirectional synchronization service between Kiroku FSRS and AnkiConnect."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import logging
import threading
from typing import Any, Dict, List, Optional

from app.db.connection import db_session
from app.services.anki_connect import AnkiConnectService
from app.repositories.review_repository import ReviewRepository

logger = logging.getLogger(__name__)

# Serialize all review-to-Anki sync operations across request handlers and background flushers
# so a pending review log can never be answered twice in Anki.
_ANKI_FSRS_SYNC_LOCK = threading.RLock()

class AnkiFSRSSyncService:
    def __init__(
        self,
        anki_service: Optional[AnkiConnectService] = None,
        review_repo: Optional[ReviewRepository] = None
    ) -> None:
        self.anki_service = anki_service or AnkiConnectService()
        self.review_repo = review_repo or ReviewRepository()

    def first_load_import(self, deck_name: Optional[str] = None) -> Dict[str, Any]:
        """Discovers pre-existing Anki cards corresponding to Kiroku words and imports them."""
        connected, err = self.anki_service.is_connected()
        if not connected:
            return {"status": "disconnected", "error": err, "imported_count": 0}

        cards_to_sync = self.review_repo.get_cards_without_fsrs()
        if not cards_to_sync:
            return {"status": "ok", "imported_count": 0, "message": "All cards have FSRS records"}

        # Collect note IDs to query
        note_id_to_cards: Dict[int, List[Dict[str, Any]]] = {}
        expr_to_cards: Dict[str, List[Dict[str, Any]]] = {}

        for c in cards_to_sync:
            nid = c.get("anki_note_id")
            if nid:
                note_id_to_cards.setdefault(int(nid), []).append(c)
            expr = c.get("expression")
            if expr:
                expr_to_cards.setdefault(expr.strip(), []).append(c)

        anki_card_ids: List[int] = []
        if note_id_to_cards:
            queries = [f"nid:{nid}" for nid in note_id_to_cards.keys()]
            # Batch queries in chunks of 50
            for idx in range(0, len(queries), 50):
                sub_query = " OR ".join(queries[idx : idx + 50])
                try:
                    found = self.anki_service.find_cards(sub_query)
                    anki_card_ids.extend(found)
                except Exception as e:
                    logger.warning("Failed finding Anki cards for batch: %s", e)
        else:
            q = f'deck:"{deck_name}"' if deck_name else "nid:>0"
            try:
                anki_card_ids = self.anki_service.find_cards(q)
            except Exception as e:
                logger.warning("Failed finding Anki cards with query '%s': %s", q, e)

        if not anki_card_ids:
            return {"status": "ok", "imported_count": 0}

        try:
            cards_info = self.anki_service.get_cards_info(anki_card_ids)
        except Exception as e:
            return {"status": "error", "error": str(e), "imported_count": 0}

        imported_count = 0
        for info in cards_info:
            cid = info.get("cardId") if info.get("cardId") is not None else info.get("card_id")
            nid = info.get("note") if info.get("note") is not None else info.get("note_id")
            reps = int(info.get("reps") or 0)
            lapses = int(info.get("lapses") or 0)
            interval = int(info.get("interval") or 0)
            due = info.get("due")
            expr = info.get("expression")

            target_cards: List[Dict[str, Any]] = []
            if nid and int(nid) in note_id_to_cards:
                target_cards = note_id_to_cards[int(nid)]
            elif expr and expr.strip() in expr_to_cards:
                target_cards = expr_to_cards[expr.strip()]

            for tc in target_cards:
                self.review_repo.init_fsrs_from_anki(
                    card_id=tc["id"],
                    anki_card_id=int(cid),
                    reps=reps,
                    lapses=lapses,
                    interval=interval,
                    due_timestamp=int(due) if due else None
                )
                imported_count += 1

        return {"status": "ok", "imported_count": imported_count}

    def _resolve_anki_card_id(
        self,
        card_id: int,
        anki_note_id: Optional[int] = None,
        expression: Optional[str] = None,
        reading: Optional[str] = None,
        deck_name: Optional[str] = None,
    ) -> Optional[int]:
        """Resolve and persist card_fsrs.anki_card_id from cards.anki_note_id or expression."""
        if anki_note_id is None and expression is None and hasattr(self.review_repo, "get_card_anki_identity"):
            identity = self.review_repo.get_card_anki_identity(card_id)
            if isinstance(identity, dict):
                anki_note_id = identity.get("anki_note_id")
                expression = identity.get("expression")
                reading = identity.get("reading")
                deck_name = identity.get("deck_name")

        resolved_cid: Optional[int] = None
        if anki_note_id:
            try:
                found_cids = self.anki_service.find_cards(f"nid:{int(anki_note_id)}")
                if isinstance(found_cids, list) and found_cids:
                    resolved_cid = int(found_cids[0])
            except Exception as exc:
                logger.warning("Failed resolving Anki card ID from note %s: %s", anki_note_id, exc)

        if resolved_cid is None and expression:
            try:
                found_nid = self.anki_service.find_existing_note(
                    deck_name or "",
                    str(expression),
                    str(reading or ""),
                )
                if found_nid:
                    found_cids = self.anki_service.find_cards(f"nid:{int(found_nid)}")
                    if isinstance(found_cids, list) and found_cids:
                        resolved_cid = int(found_cids[0])
            except Exception as exc:
                logger.warning("Failed resolving Anki card ID from expression '%s': %s", expression, exc)

        if resolved_cid is not None:
            self.review_repo.update_card_fsrs(card_id, {"anki_card_id": resolved_cid})
        return resolved_cid

    def sync_card_review(self, card_id: int, rating: int, log_id: Optional[int] = None) -> Dict[str, Any]:
        """Pushes a card review forward into Anki, or safely queues if offline."""
        with _ANKI_FSRS_SYNC_LOCK:
            if (
                log_id is not None
                and hasattr(self.review_repo, "is_review_log_synced")
                and self.review_repo.is_review_log_synced(log_id) is True
            ):
                return {"status": "synced", "reason": "already_synced"}

            connected, _ = self.anki_service.is_connected()
            if not connected:
                self.review_repo.update_card_fsrs(card_id, {"sync_state": "pending_anki"})
                return {"status": "queued", "reason": "anki_offline"}

            fsrs = self.review_repo.get_or_create_fsrs(card_id)
            anki_card_id = fsrs.get("anki_card_id")
            if not anki_card_id:
                anki_card_id = self._resolve_anki_card_id(card_id)
            if not anki_card_id:
                self.review_repo.update_card_fsrs(card_id, {"sync_state": "pending_anki"})
                return {"status": "queued", "reason": "no_anki_card_id"}

            success = self.anki_service.answer_card(int(anki_card_id), int(rating))
            if success:
                if log_id is not None:
                    self.review_repo.mark_review_synced(log_id=log_id, card_id=card_id)
                else:
                    self.review_repo.mark_review_synced(card_id=card_id)
                return {"status": "synced", "anki_card_id": int(anki_card_id)}
            else:
                self.review_repo.update_card_fsrs(card_id, {"sync_state": "pending_anki"})
                return {"status": "queued", "reason": "answer_card_failed"}

    def flush_pending_reviews(self) -> Dict[str, Any]:
        """Pushes pending reviews when Anki reconnects."""
        with _ANKI_FSRS_SYNC_LOCK:
            connected, _ = self.anki_service.is_connected()
            if not connected:
                return {"status": "offline", "flushed_count": 0}

            pending = self.review_repo.get_pending_anki_reviews()
            flushed_count = 0
            failed_count = 0
            resolved_cids: Dict[int, int] = {}

            for item in pending:
                log_id = item.get("log_id")
                card_id = item.get("card_id")
                rating = item.get("rating")
                cid = item.get("anki_card_id") or (resolved_cids.get(int(card_id)) if card_id is not None else None)

                if not cid and card_id is not None:
                    cid = self._resolve_anki_card_id(
                        int(card_id),
                        anki_note_id=item.get("anki_note_id"),
                        expression=item.get("expression"),
                        reading=item.get("reading"),
                        deck_name=item.get("deck_name"),
                    )
                    if cid is not None:
                        resolved_cids[int(card_id)] = cid

                if cid and rating:
                    if self.anki_service.answer_card(int(cid), int(rating)):
                        self.review_repo.mark_review_synced(log_id=log_id, card_id=card_id)
                        flushed_count += 1
                    else:
                        failed_count += 1
                        logger.warning(
                            "Failed flushing pending Anki review log_id=%s card_id=%s anki_card_id=%s",
                            log_id,
                            card_id,
                            cid,
                        )
                else:
                    failed_count += 1

            return {
                "status": "ok",
                "flushed_count": flushed_count,
                "failed_count": failed_count,
                "remaining_count": max(0, len(pending) - flushed_count),
            }

    def pull_anki_reviews(self, deck_name: Optional[str] = None) -> Dict[str, Any]:
        """Reconciles reviews done inside Anki back into Kiroku without overwriting pending local reviews."""
        with _ANKI_FSRS_SYNC_LOCK:
            connected, _ = self.anki_service.is_connected()
            if not connected:
                return {"status": "offline", "pulled_count": 0}

            linked_cards = self.review_repo.get_all_linked_anki_cards(deck_name)
            if not linked_cards:
                return {"status": "ok", "pulled_count": 0}

            pending_card_ids: set[int] = set()
            if hasattr(self.review_repo, "get_pending_anki_card_ids"):
                raw_pending = self.review_repo.get_pending_anki_card_ids()
                if isinstance(raw_pending, set):
                    pending_card_ids = raw_pending

            cid_to_card = {c["anki_card_id"]: c for c in linked_cards}
            all_cids = list(cid_to_card.keys())

            try:
                due_cids = set(self.anki_service.find_cards('is:due'))
                suspended_cids = set(self.anki_service.find_cards('is:suspended'))
                buried_cids = set(self.anki_service.find_cards('is:buried'))
            except Exception as e:
                logger.warning("Failed querying Anki card states: %s", e)
                due_cids, suspended_cids, buried_cids = set(), set(), set()

            pulled_count = 0
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            for idx in range(0, len(all_cids), 500):
                chunk = all_cids[idx : idx + 500]
                try:
                    infos = self.anki_service.get_cards_info(chunk)
                except Exception as e:
                    logger.warning("Failed getting cards_info: %s", e)
                    continue

                for info in infos:
                    cid = info.get("cardId") if info.get("cardId") is not None else info.get("card_id")
                    if not cid or int(cid) not in cid_to_card:
                        continue
                    kc = cid_to_card[int(cid)]

                    # Never overwrite cards that still have unsynced Kiroku reviews waiting to push to Anki.
                    if kc["id"] in pending_card_ids:
                        continue

                    anki_reps = int(info.get("reps") or 0)
                    anki_lapses = int(info.get("lapses") or 0)
                    anki_interval = int(info.get("interval") or 0)
                    anki_queue = int(info.get("queue") or 0)

                    is_due = int(cid) in due_cids
                    is_suspended = 1 if (int(cid) in suspended_cids or anki_queue == -1) else 0
                    buried_until = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d") if (int(cid) in buried_cids or anki_queue in (-2, -3)) else None

                    if is_due:
                        due_date = today
                    elif anki_reps > 0:
                        due_date = (datetime.now(timezone.utc) + timedelta(days=max(1, anki_interval))).strftime("%Y-%m-%d")
                    else:
                        due_date = None

                    k_reps = kc.get("reps") or 0
                    k_due = kc.get("due_date")
                    k_sched = kc.get("scheduled_days") or 0
                    k_susp = kc.get("is_suspended") or 0
                    actual_deck = info.get("deck_name") or info.get("deckName")
                    k_deck = kc.get("deck_name")
                    deck_mismatch = bool(actual_deck and actual_deck != k_deck)

                    needs_update = (
                        anki_reps != k_reps or
                        anki_interval != k_sched or
                        due_date != k_due or
                        is_suspended != k_susp or
                        deck_mismatch
                    )

                    if needs_update:
                        if deck_mismatch:
                            with db_session(self.review_repo.db_path) as conn:
                                conn.execute("UPDATE cards SET deck_name = ? WHERE id = ?", (actual_deck, kc["id"]))
                                conn.commit()
                        state = 2 if anki_reps > 0 else 0
                        stability = max(1.0, float(anki_interval)) if anki_interval > 0 else 0.0
                        self.review_repo.update_card_fsrs(kc["id"], {
                            "state": state,
                            "stability": stability,
                            "scheduled_days": anki_interval,
                            "elapsed_days": anki_interval,
                            "reps": anki_reps,
                            "lapses": anki_lapses,
                            "due_date": due_date,
                            "is_suspended": is_suspended,
                            "buried_until": buried_until,
                            "sync_state": "synced"
                        })
                        pulled_count += 1

            return {"status": "ok", "pulled_count": pulled_count}

    def full_sync(self, deck_name: Optional[str] = None) -> Dict[str, Any]:
        """Runs full two-way synchronization: AnkiWeb sync, import, flush, pull, then push."""
        with _ANKI_FSRS_SYNC_LOCK:
            try:
                self.anki_service.sync_with_ankiweb()
            except Exception:
                pass

            import_res = self.first_load_import(deck_name)
            flush_res = self.flush_pending_reviews()
            pull_res = self.pull_anki_reviews(deck_name)

            if flush_res.get("flushed_count", 0) > 0:
                try:
                    self.anki_service.sync_with_ankiweb()
                except Exception:
                    pass

            return {
                "status": "ok",
                "imported_count": import_res.get("imported_count", 0),
                "flushed_count": flush_res.get("flushed_count", 0),
                "failed_count": flush_res.get("failed_count", 0),
                "pulled_count": pull_res.get("pulled_count", 0)
            }
