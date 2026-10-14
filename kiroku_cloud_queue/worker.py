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
import logging
import os
import sys
from dataclasses import dataclass
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
    """
    queue = adapter or get_queue_adapter()
    log.info("Worker started. Polling every %ds with adapter %s (auto_sync=%s)...",
             poll_interval, type(queue).__name__, auto_sync)

    while True:
        if stop_event and stop_event.is_set():
            break

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
    parser.add_argument("--deck", type=str, default=None, help="Filter deck for --sync-cloud-all")
    args = parser.parse_args()

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
