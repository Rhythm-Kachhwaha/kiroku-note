"""
worker.py -- Local worker that drains pending cards from the queue to Kiroku and Anki.

Architecture role:
  - Runs on the user's PC as an independent local process.
  - Polls or pulls pending vocabulary cards from the configured queue
    (in local testing: LocalDevQueueAdapter; in target cloud: CloudQueueAdapter).
  - Submits cards to the local Kiroku backend via kiroku_client.py.
  - Acknowledges (ack) cards ONLY after successful persistence / duplicate resolution in Kiroku.
  - If Kiroku is unreachable, leaves cards pending without counting against attempt limits.
  - If Kiroku rejects a card with a validation/API error, records failure (nack).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from typing import Optional

import kiroku_client as kc
from queue_adapter import (
    CloudQueueNotConfiguredError,
    QueueAdapter,
    QueueError,
    QueueItem,
    get_queue_adapter,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mcp_anki_worker")


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
) -> ProcessItemResult:
    """
    Process a single queue item through Kiroku:
      1. POST /api/cards/save to persist locally.
      2. If duplicate, acknowledge immediately and log info.
      3. If newly created, attempt POST /api/cards/{id}/sync to push to Anki.
      4. Acknowledge the card in the queue once safely saved.
      5. On KirokuAPIError, record failure (nack).
    """
    card = item.card
    log.info("Processing card item_id=%s: '%s' (%s)", item.id, card.expression, card.reading)

    try:
        save_resp = await kc.save_card(
            expression=card.expression,
            reading=card.reading,
            meaning=card.meaning,
            sentence=card.sentence,
            deck_name=card.deck_name,
        )
    except kc.KirokuUnavailableError as exc:
        log.warning("Kiroku backend is unreachable: %s", exc)
        return ProcessItemResult(
            item_id=item.id,
            status="skipped_offline",
            message=f"Kiroku offline: {exc}",
        )
    except kc.KirokuAPIError as exc:
        log.error("Kiroku rejected card item_id=%s: %s", item.id, exc.detail)
        await adapter.nack(item.id, error=exc.detail)
        return ProcessItemResult(
            item_id=item.id,
            status="failed",
            message=f"Kiroku rejected: {exc.detail}",
        )
    except Exception as exc:
        log.exception("Unexpected error saving card item_id=%s: %s", item.id, exc)
        await adapter.nack(item.id, error=str(exc))
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
            await adapter.ack(item.id)
        except QueueError as exc:
            log.warning("Failed to ack duplicate item_id=%s in queue: %s", item.id, exc)
        return ProcessItemResult(
            item_id=item.id,
            status="duplicate",
            message=f"Card '{card.expression}' already exists in deck '{card.deck_name}'.",
            card_id=card_id,
        )

    # Attempt Anki sync if card_id is valid
    if card_id is not None:
        try:
            sync_resp = await kc.sync_card(card_id)
            sync_status = sync_resp.get("sync_status", sync_status)
            anki_note_id = sync_resp.get("anki_note_id")
        except (kc.KirokuUnavailableError, kc.KirokuAPIError) as exc:
            log.warning("Anki sync failed for card_id=%s: %s (card safely stored in Kiroku)", card_id, exc)

    # Card is safely stored in Kiroku's database (source of truth) -> Acknowledge in queue
    final_status = "synced" if sync_status == "synced" else "saved"
    try:
        await adapter.ack(item.id)
        log.info(
            "Successfully imported card '%s' (item_id=%s, card_id=%s, status=%s). Acknowledged in queue.",
            card.expression, item.id, card_id, final_status
        )
        msg = f"Card '{card.expression}' saved in Kiroku (id={card_id}, sync={final_status})."
    except QueueError as exc:
        log.warning(
            "Card '%s' safely saved in Kiroku (id=%s), but queue ack failed for item_id=%s: %s. Will re-ack on next sync.",
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
# Batch Processing
# ---------------------------------------------------------------------------

async def process_batch(
    adapter: Optional[QueueAdapter] = None,
    limit: int = 20,
) -> BatchResult:
    """
    Process up to `limit` pending items from the queue.
    If Kiroku is offline, halts processing immediately to avoid pointless polling.
    """
    queue = adapter or get_queue_adapter()

    # Pre-check Kiroku liveness before fetching
    if not await kc.is_kiroku_alive():
        log.debug("Kiroku backend is not running at %s. Skipping queue drain.", kc._kiroku_url())
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
        log.error("Cannot fetch from queue: %s", exc)
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

    for item in pending_items:
        res = await process_item(item, queue)
        results.append(res)
        if res.status in ("synced", "saved", "saved_ack_failed"):
            processed_count += 1
        elif res.status == "duplicate":
            duplicate_count += 1
        elif res.status == "failed":
            failed_count += 1
        elif res.status == "skipped_offline":
            # Kiroku went offline mid-batch; stop processing the rest
            break

    return BatchResult(
        total_fetched=len(pending_items),
        processed=processed_count,
        duplicates=duplicate_count,
        failed=failed_count,
        skipped_offline=False,
        results=results,
    )


# ---------------------------------------------------------------------------
# Continuous Loop
# ---------------------------------------------------------------------------

async def run_worker_loop(
    poll_interval: int = 10,
    adapter: Optional[QueueAdapter] = None,
    stop_event: Optional[asyncio.Event] = None,
) -> None:
    """
    Continuously drain the queue at specified interval until cancelled.
    """
    queue = adapter or get_queue_adapter()
    log.info("Worker started. Polling every %ds with adapter %s...", poll_interval, type(queue).__name__)

    while True:
        if stop_event and stop_event.is_set():
            break

        try:
            batch = await process_batch(adapter=queue)
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
    parser.add_argument("--once", action="store_true", help="Process one batch and exit")
    parser.add_argument("--interval", type=int, default=10, help="Polling interval in seconds (default: 10)")
    parser.add_argument("--backend", choices=["local", "cloud"], default=None, help="Queue backend override")
    args = parser.parse_args()

    adapter = get_queue_adapter(backend=args.backend)

    if args.once:
        result = asyncio.run(process_batch(adapter=adapter))
        print(f"Batch result: fetched={result.total_fetched}, processed={result.processed}, "
              f"duplicates={result.duplicates}, failed={result.failed}, skipped_offline={result.skipped_offline}")
    else:
        try:
            asyncio.run(run_worker_loop(poll_interval=args.interval, adapter=adapter))
        except KeyboardInterrupt:
            print("\nWorker stopped by user.")


if __name__ == "__main__":
    main()
