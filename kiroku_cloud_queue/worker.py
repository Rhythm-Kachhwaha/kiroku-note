"""
worker.py -- Local worker that drains pending cards from the queue to Kiroku and Anki.

Architecture role:
  - Runs on the user's PC as an independent local process over loopback.
  - Polls or pulls pending vocabulary cards from the configured queue.
  - Submits cards to the local Kiroku backend via kiroku_client.py.
  - Acknowledges (ack) cards ONLY after successful persistence / duplicate resolution in Kiroku.
  - Conditionally runs dictionary enrichment ONLY if meaning is missing/empty.
  - Local persistence is separated from Anki sync: cards are persisted in Kiroku SQLite (pending)
    without forcing immediate Anki sync, allowing user inspection.
  - Manual sync actions allow syncing individual cards or all cloud cards in bulk without
    touching unrelated local cards.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from enrichment import EnrichmentError, enrich_card
import kiroku_client as kc
from queue_adapter import (
    CloudQueueNotConfiguredError,
    QueueAdapter,
    QueueError,
    QueueItem,
    VocabCard,
    get_queue_adapter,
)
from anki_mirror import sync_anki_mirror

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kiroku_cloud_worker")


from env_utils import load_env_file

_load_env_file = load_env_file
load_env_file()



# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class ProcessItemResult:
    item_id: str
    status: str  # "synced", "saved", "duplicate", "skipped_offline", "failed"
    message: str
    card_id: Optional[int] = None
    anki_note_id: Optional[int] = None


@dataclass
class BatchResult:
    total_fetched: int
    processed: int
    duplicates: int
    failed: int
    skipped_offline: bool
    results: list[ProcessItemResult]


# ---------------------------------------------------------------------------
# Core Item Processor
# ---------------------------------------------------------------------------

async def process_item(
    item: QueueItem,
    adapter: QueueAdapter,
    auto_sync: bool = False,
) -> ProcessItemResult:
    """
    Process a single queue item through Kiroku:
      1. Conditionally enrich card if meaning is missing/empty (zero dictionary calls if meaning supplied).
      2. POST /api/cards/save to persist locally in SQLite with status='pending'.
      3. Acknowledge (ack) card in cloud queue once safely committed locally.
      4. Only sync to Anki if auto_sync is explicitly enabled; otherwise leave pending for user inspection.
      5. On KirokuAPIError or EnrichmentError, record failure (nack).
    """
    orig_card = item.card
    claim_token = getattr(item, "claim_token", "") or None
    log.info("Processing card item_id=%s: '%s' (%s)", item.id, orig_card.expression, orig_card.reading)

    # Step 1: Conditional Enrichment
    try:
        card, did_enrich = await enrich_card(orig_card, client=kc)
    except EnrichmentError as exc:
        log.error("Enrichment failed for card item_id=%s ('%s'): %s", item.id, orig_card.expression, exc)
        await adapter.nack(item.id, error=str(exc), claim_token=claim_token)
        return ProcessItemResult(
            item_id=item.id,
            status="failed",
            message=f"Enrichment error: {exc}",
        )

    # Step 2: Persist locally in Kiroku SQLite
    try:
        save_kwargs: dict[str, Any] = {
            "expression": card.expression,
            "reading": card.reading,
            "meaning": card.meaning,
            "sentence": card.sentence,
            "sentence_meaning": card.sentence_meaning,
            "notes": card.notes,
            "hint": card.hint,
            "context": card.context,
            "jlpt_level": card.jlpt_level,
            "tags": card.tags,
            "deck_name": card.deck_name,
            "model_name": card.model_name,
            "source_type": "cloud",
            "extra_data": card.extra_data,
        }
        save_resp = await kc.save_card(**save_kwargs)
    except kc.KirokuUnavailableError as exc:
        log.warning("Kiroku backend is unreachable: %s", exc)
        return ProcessItemResult(
            item_id=item.id,
            status="skipped_offline",
            message=f"Kiroku offline: {exc}",
        )
    except kc.KirokuAPIError as exc:
        log.error("Kiroku rejected card item_id=%s: %s", item.id, exc.detail)
        await adapter.nack(item.id, error=exc.detail, claim_token=claim_token)
        return ProcessItemResult(
            item_id=item.id,
            status="failed",
            message=f"Kiroku rejected: {exc.detail}",
        )
    except Exception as exc:
        log.exception("Unexpected error saving card item_id=%s: %s", item.id, exc)
        await adapter.nack(item.id, error=str(exc), claim_token=claim_token)
        return ProcessItemResult(
            item_id=item.id,
            status="failed",
            message=f"Save error: {exc}",
        )

    card_id = save_resp.get("id")
    is_dup = save_resp.get("is_duplicate", False)
    sync_status = save_resp.get("sync_status", "pending")
    anki_note_id: Optional[int] = None

    if is_dup:
        # Duplicate already exists in Kiroku / Anki; considered fully resolved.
        log.info("Card '%s' is duplicate in deck '%s'. Acknowledging item_id=%s.", card.expression, card.deck_name, item.id)
        try:
            await adapter.ack(item.id, claim_token=claim_token)
        except QueueError as exc:
            log.warning("Failed to ack duplicate item_id=%s in queue: %s", item.id, exc)
        return ProcessItemResult(
            item_id=item.id,
            status="duplicate",
            message=f"Card '{card.expression}' already exists in deck '{card.deck_name}'.",
            card_id=card_id,
        )

    # Step 3: Optional Anki sync (if auto_sync=True)
    if auto_sync and card_id is not None:
        try:
            sync_resp = await kc.sync_card(card_id)
            sync_status = sync_resp.get("sync_status", sync_status)
            anki_note_id = sync_resp.get("anki_note_id")
        except (kc.KirokuUnavailableError, kc.KirokuAPIError) as exc:
            log.warning("Anki sync failed for card_id=%s: %s (card safely stored in Kiroku)", card_id, exc)

    # Step 4: Card is safely stored in Kiroku's database -> Acknowledge in queue
    final_status = "synced" if sync_status == "synced" else "saved"
    try:
        await adapter.ack(item.id, claim_token=claim_token)
        log.info(
            "Successfully persisted card '%s' (item_id=%s, card_id=%s, status=%s). Acknowledged in queue.",
            card.expression, item.id, card_id, final_status
        )
        msg = f"Card '{card.expression}' safely stored in Kiroku (id={card_id}, sync={final_status})."
    except QueueError as exc:
        log.warning(
            "Card '%s' safely saved in Kiroku (id=%s), but queue ack failed for item_id=%s: %s.",
            card.expression, card_id, item.id, exc
        )
        final_status = "saved_ack_failed"
        msg = f"Card '{card.expression}' saved in Kiroku (id={card_id}), but queue ack failed: {exc}"

    return ProcessItemResult(
        item_id=item.id,
        status=final_status,
        message=msg,
        card_id=card_id,
        anki_note_id=anki_note_id,
    )


# ---------------------------------------------------------------------------
# Manual Sync Helpers (Single Card & Cloud Batch)
# ---------------------------------------------------------------------------

async def sync_single_card(card_id: int) -> dict[str, Any]:
    """
    Manually synchronize a single card to Anki by card ID.
    """
    log.info("Triggering manual Anki sync for card_id=%s", card_id)
    return await kc.sync_card(card_id)


async def sync_cloud_cards(deck_name: Optional[str] = None) -> dict[str, Any]:
    """
    Manually synchronize all eligible unsynced cloud cards to Anki.
    Finds cards with source_type='cloud' (or 'iphone_cloud_queue') and sync_status in ('pending', 'failed').
    Uses bulk sync to ensure only cloud cards are synced, without touching unrelated local cards.
    """
    log.info("Fetching unsynced cloud cards for batch sync...")
    eligible_ids: list[int] = []
    page_size = 500
    offset = 0

    while True:
        if offset == 0:
            list_resp = await kc.list_cards(limit=page_size)
        else:
            list_resp = await kc.list_cards(limit=page_size, offset=offset)
        cards = list_resp.get("cards", [])
        if not cards:
            break

        for c in cards:
            src = str(c.get("source_type") or "").lower()
            sync_st = str(c.get("sync_status") or "").lower()
            c_deck = str(c.get("deck_name") or "")
            if src in ("cloud", "iphone_cloud_queue") and sync_st in ("pending", "failed"):
                if deck_name is None or c_deck == deck_name:
                    eligible_ids.append(int(c["id"]))

        if len(cards) < page_size:
            break
        offset += page_size

    if not eligible_ids:
        log.info("No unsynced cloud cards found.")
        return {"total_eligible": 0, "synced_count": 0, "failed_count": 0, "results": []}

    log.info("Syncing %d cloud cards to Anki: %s", len(eligible_ids), eligible_ids)
    return await kc.sync_cards_bulk(eligible_ids)


# ---------------------------------------------------------------------------
# AnkiConnect Real Stats Collector & Cloud Sync
# ---------------------------------------------------------------------------

def fetch_anki_connect_stats(
    anki_url: Optional[str] = None,
    timeout_seconds: float = 3.0,
) -> Optional[dict[str, Any]]:
    """
    Connect to local AnkiConnect (http://127.0.0.1:8765) and retrieve study statistics.
    Returns None if Anki is not running or unreachable.
    """
    endpoint = anki_url or os.getenv("ANKICONNECT_URL", "http://127.0.0.1:8765")

    def _invoke(action: str, **params: Any) -> Any:
        req_payload = {"action": action, "version": 6, "params": params}
        data = json.dumps(req_payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Origin": "http://localhost",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("error"):
                raise ValueError(f"AnkiConnect error on '{action}': {body['error']}")
            return body.get("result")

    try:
        ver = _invoke("version")
        if not ver:
            return None
    except Exception as exc:
        log.debug("AnkiConnect unreachable at %s: %s", endpoint, exc)
        return None

    raw_reviews_by_day = []
    today_reviewed = 0
    deck_names = []
    deck_stats_raw = {}

    try:
        raw_reviews_by_day = _invoke("getNumCardsReviewedByDay") or []
    except Exception as exc:
        log.warning("Failed querying Anki getNumCardsReviewedByDay: %s", exc)

    try:
        today_reviewed = _invoke("getNumCardsReviewedToday") or 0
    except Exception as exc:
        log.warning("Failed querying Anki getNumCardsReviewedToday: %s", exc)

    try:
        deck_names = _invoke("deckNames") or []
    except Exception as exc:
        log.warning("Failed querying Anki deckNames: %s", exc)

    if deck_names:
        try:
            res = _invoke("getDeckStats", decks=deck_names)
            if isinstance(res, dict):
                deck_stats_raw = res
        except Exception as bulk_exc:
            log.debug("Bulk getDeckStats failed (%s); falling back to per-deck queries", bulk_exc)
            for d in deck_names:
                try:
                    res = _invoke("getDeckStats", decks=[d])
                    if isinstance(res, dict):
                        deck_stats_raw.update(res)
                except Exception:
                    pass

    daily_map: dict[str, int] = {}
    for entry in raw_reviews_by_day:
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            d_str = str(entry[0]).strip()
            try:
                cnt = int(entry[1])
            except (ValueError, TypeError):
                cnt = 0
            if d_str:
                daily_map[d_str] = cnt

    today_local = datetime.now().strftime("%Y-%m-%d")
    if today_reviewed > 0 or today_local not in daily_map:
        daily_map[today_local] = max(daily_map.get(today_local, 0), int(today_reviewed))

    sorted_days = sorted(daily_map.keys())
    current_streak = 0
    best_streak = 0
    temp_streak = 0
    prev_date = None

    for d_str in sorted_days:
        try:
            cur_date = datetime.strptime(d_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        cnt = daily_map[d_str]
        if cnt > 0:
            if prev_date is not None and (cur_date - prev_date).days == 1:
                temp_streak += 1
            else:
                temp_streak = 1
            if temp_streak > best_streak:
                best_streak = temp_streak
            prev_date = cur_date
        else:
            temp_streak = 0
            prev_date = None

    today_date = datetime.now().date()
    yesterday_date = today_date - timedelta(days=1)

    check_date = today_date if daily_map.get(today_date.strftime("%Y-%m-%d"), 0) > 0 else yesterday_date
    while True:
        d_str = check_date.strftime("%Y-%m-%d")
        if daily_map.get(d_str, 0) > 0:
            current_streak += 1
            check_date -= timedelta(days=1)
        else:
            break

    total_reviews = sum(daily_map.values())
    one_year_ago = (today_date - timedelta(days=365)).strftime("%Y-%m-%d")
    recent_reviews_by_day = [
        [d, daily_map[d]] for d in sorted_days if d >= one_year_ago
    ]
    days_studied_past_year = sum(1 for d, c in recent_reviews_by_day if c > 0)

    decks_list = []
    total_cards = 0
    total_new = 0
    total_learn = 0
    total_review = 0

    if isinstance(deck_stats_raw, dict):
        for d_id, d_data in deck_stats_raw.items():
            if not isinstance(d_data, dict):
                continue
            d_name = d_data.get("name", f"Deck {d_id}")
            t_cards = int(d_data.get("total_in_deck", 0))
            n_cards = int(d_data.get("new_count", 0))
            l_cards = int(d_data.get("learn_count", 0))
            r_cards = int(d_data.get("review_count", 0))
            decks_list.append({
                "name": d_name,
                "total": t_cards,
                "new": n_cards,
                "learn": l_cards,
                "review": r_cards,
            })
            total_cards += t_cards
            total_new += n_cards
            total_learn += l_cards
            total_review += r_cards

    decks_list.sort(key=lambda d: d["total"], reverse=True)

    return {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "today_reviewed": int(today_reviewed),
        "current_streak": current_streak,
        "best_streak": max(best_streak, current_streak),
        "total_reviews": total_reviews,
        "days_studied_past_year": days_studied_past_year,
        "cards_reviewed_by_day": recent_reviews_by_day,
        "decks": decks_list,
        "summary": {
            "total_cards": total_cards,
            "total_due_today": total_new + total_review + total_learn,
            "total_new_due": total_new,
            "total_review_due": total_review,
            "total_learn_due": total_learn,
        },
    }


async def sync_anki_stats_to_cloud(
    adapter: Optional[QueueAdapter] = None,
    anki_url: Optional[str] = None,
) -> bool:
    """
    Collect real study metrics from local AnkiConnect and push to the cloud queue service.
    Returns True if stats were collected and pushed; False if Anki was closed or push failed.
    """
    stats = await asyncio.to_thread(fetch_anki_connect_stats, anki_url=anki_url)
    if not stats:
        log.info("Anki is not currently running; skipping study stats sync.")
        return False

    queue = adapter or get_queue_adapter()
    success = await queue.push_anki_stats(stats)
    if success:
        log.info(
            "Successfully synced Anki stats to cloud: streak=%d days, today=%d reviews, total_cards=%d",
            stats["current_streak"], stats["today_reviewed"], stats["summary"]["total_cards"]
        )
    else:
        log.warning("Failed to push Anki stats to queue adapter.")

    # Trigger mirror sync without failing stats sync on mirror errors
    try:
        await sync_anki_mirror(queue)
    except Exception as exc:
        log.warning("Anki mirror sync failed (continuing normally): %s", exc)

    return success


# ---------------------------------------------------------------------------
# Batch Processing
# ---------------------------------------------------------------------------

async def process_batch(
    adapter: Optional[QueueAdapter] = None,
    limit: int = 20,
    auto_sync: bool = False,
) -> BatchResult:
    """
    Process up to `limit` pending items from the queue.
    By default (auto_sync=False), cards are persisted locally in Kiroku and acknowledged in the queue,
    but NOT automatically pushed to Anki.
    If Kiroku is offline, halts processing immediately to avoid pointless polling.
    """
    queue = adapter or get_queue_adapter()

    # Pre-flight check
    if not await kc.is_kiroku_alive():
        log.warning("Kiroku backend is not running at %s. Postponing batch.", kc._kiroku_url())
        return BatchResult(
            total_fetched=0,
            processed=0,
            duplicates=0,
            failed=0,
            skipped_offline=True,
            results=[],
        )

    try:
        pending_items = await queue.fetch_pending(limit=limit)
    except CloudQueueNotConfiguredError as exc:
        log.error("Queue is not configured: %s", exc)
        return BatchResult(
            total_fetched=0,
            processed=0,
            duplicates=0,
            failed=0,
            skipped_offline=False,
            results=[],
        )
    except QueueError as exc:
        log.error("Failed to fetch pending items from queue: %s", exc)
        return BatchResult(
            total_fetched=0,
            processed=0,
            duplicates=0,
            failed=0,
            skipped_offline=False,
            results=[],
        )

    if not pending_items:
        return BatchResult(
            total_fetched=0,
            processed=0,
            duplicates=0,
            failed=0,
            skipped_offline=False,
            results=[],
        )

    log.info("Fetched %d pending card(s) from queue.", len(pending_items))
    results: list[ProcessItemResult] = []
    processed_count = 0
    duplicate_count = 0
    failed_count = 0
    skipped_offline = False

    for item in pending_items:
        res = await process_item(item, queue, auto_sync=auto_sync)
        results.append(res)
        if res.status in ("synced", "saved", "saved_ack_failed"):
            processed_count += 1
        elif res.status == "duplicate":
            duplicate_count += 1
        elif res.status == "failed":
            failed_count += 1
        elif res.status == "skipped_offline":
            # Kiroku went offline mid-batch; stop processing the rest
            skipped_offline = True
            break

    return BatchResult(
        total_fetched=len(pending_items),
        processed=processed_count,
        duplicates=duplicate_count,
        failed=failed_count,
        skipped_offline=skipped_offline,
        results=results,
    )


# ---------------------------------------------------------------------------
# Continuous Loop
# ---------------------------------------------------------------------------

async def run_worker_loop(
    poll_interval: int = 10,
    adapter: Optional[QueueAdapter] = None,
    stop_event: Optional[asyncio.Event] = None,
    auto_sync: bool = False,
) -> None:
    """
    Continuously drain the queue at specified interval until cancelled.
    Also syncs real Anki study metrics periodically (every 5 minutes) when Anki is running.
    """
    queue = adapter or get_queue_adapter()
    log.info("Worker started. Polling every %ds with adapter %s (auto_sync=%s)...",
             poll_interval, type(queue).__name__, auto_sync)

    last_stats_sync = 0.0
    STATS_SYNC_INTERVAL = 300.0  # Sync stats every 5 minutes

    while True:
        if stop_event and stop_event.is_set():
            break

        now = time.time()
        if now - last_stats_sync >= STATS_SYNC_INTERVAL:
            try:
                synced = await sync_anki_stats_to_cloud(adapter=queue)
                if synced:
                    last_stats_sync = now
            except Exception as exc:
                log.debug("Periodic stats sync skipped or failed: %s", exc)

        try:
            batch = await process_batch(adapter=queue, auto_sync=auto_sync)
            if batch.total_fetched > 0:
                log.info(
                    "Batch summary: %d fetched, %d processed, %d duplicates, %d failed.",
                    batch.total_fetched, batch.processed, batch.duplicates, batch.failed
                )
        except asyncio.CancelledError:
            log.info("Worker loop cancelled.")
            break
        except Exception as exc:
            log.exception("Error during worker batch cycle: %s", exc)

        try:
            await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            break


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Kiroku Local Queue Worker")
    parser.add_argument("--once", action="store_true", help="Process one batch from queue and exit")
    parser.add_argument("--interval", type=int, default=10, help="Polling interval in seconds (default: 10)")
    parser.add_argument("--backend", choices=["local", "cloud"], default=None, help="Queue backend override")
    parser.add_argument("--auto-sync", action="store_true", help="Automatically push saved cards to Anki during fetch")
    parser.add_argument("--sync-card", type=int, default=None, help="Manually sync a single card ID to Anki")
    parser.add_argument("--sync-cloud-all", action="store_true", help="Manually sync all eligible cloud cards to Anki")
    parser.add_argument("--sync-stats", action="store_true", help="Sync local AnkiConnect study stats to cloud and exit")
    parser.add_argument("--sync-cards", action="store_true", help="Run incremental Anki cards mirror sync to cloud and exit")
    parser.add_argument("--full-resync", action="store_true", help="Force a full reconcile of all Anki cards to cloud and exit")
    parser.add_argument("--allow-shrink", action="store_true", help="Allow reconcile to delete cards even if collection shrinks by >50%")
    parser.add_argument("--flush-mature-media", action="store_true", help="Evict media images for mature cards (interval >= 21) from cloud storage and exit")
    parser.add_argument("--deck", type=str, default=None, help="Filter deck for --sync-cloud-all")
    args = parser.parse_args()

    if args.flush_mature_media:
        adapter = get_queue_adapter(backend=args.backend)
        if hasattr(adapter, "_store") and adapter._store:
            flushed = adapter._store.flush_mature_card_media(min_interval_days=21)
            print(f"Flushed {flushed} mature card images locally.")
        else:
            res = asyncio.run(adapter._post_json_with_retry("/api/anki/media/flush?min_interval_days=21", {}))
            print(f"Cloud mature media flush result: {res}")
        return

    if args.sync_cards or args.full_resync:
        adapter = get_queue_adapter(backend=args.backend)
        from anki_mirror import sync_anki_mirror
        res = asyncio.run(sync_anki_mirror(adapter, full=args.full_resync, allow_shrink=args.allow_shrink))
        print(f"Anki card mirror ({res.mode}): status={res.status}, seen={res.cards_seen}, "
              f"changed={res.cards_changed}, pushed={res.cards_pushed}, "
              f"daily={res.daily_rows_pushed}, deleted={res.deleted_on_reconcile} ({res.duration_s:.2f}s)")
        return

    if args.sync_stats:
        adapter = get_queue_adapter(backend=args.backend)
        result = asyncio.run(sync_anki_stats_to_cloud(adapter=adapter))
        print(f"Anki stats sync: {'success' if result else 'skipped (Anki not running or push failed)'}")
        return

    if args.sync_card is not None:
        result = asyncio.run(sync_single_card(args.sync_card))
        print(f"Sync result for card {args.sync_card}: {result}")
        return

    if args.sync_cloud_all:
        result = asyncio.run(sync_cloud_cards(deck_name=args.deck))
        print(f"Cloud cards sync result: {result}")
        return

    adapter = get_queue_adapter(backend=args.backend)

    if args.once:
        result = asyncio.run(process_batch(adapter=adapter, auto_sync=args.auto_sync))
        print(f"Batch result: fetched={result.total_fetched}, processed={result.processed}, "
              f"duplicates={result.duplicates}, failed={result.failed}, skipped_offline={result.skipped_offline}")
    else:
        try:
            asyncio.run(run_worker_loop(poll_interval=args.interval, adapter=adapter, auto_sync=args.auto_sync))
        except KeyboardInterrupt:
            print("\nWorker stopped by user.")


if __name__ == "__main__":
    main()
