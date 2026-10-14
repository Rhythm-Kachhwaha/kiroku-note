"""
test_worker.py -- Unit and integration tests for worker.py.
Verifies queue draining, Kiroku API interactions, duplicate handling, and failure safety.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import kiroku_client as kc
import worker
from queue_adapter import (
    CloudQueueAdapter,
    LocalDevQueueAdapter,
    VocabCard,
)


@pytest.fixture()
def adapter(tmp_path: Path) -> LocalDevQueueAdapter:
    db_file = tmp_path / "test_worker.db"
    return LocalDevQueueAdapter(db_path=db_file)


@pytest.mark.asyncio
async def test_worker_successful_card_processing(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="約束", reading="やくそく", meaning="promise", sentence="約束を守る")
    item_id = await adapter.enqueue(card)

    save_resp = {
        "id": 101, "expression": "約束", "reading": "やくそく", "meaning": "promise",
        "is_duplicate": False, "sync_status": "pending",
    }
    sync_resp = {"id": 101, "sync_status": "synced", "anki_note_id": 5001}

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_resp)) as mock_save, \
         patch("kiroku_client.sync_card", new=AsyncMock(return_value=sync_resp)) as mock_sync:
        batch_res = await worker.process_batch(adapter=adapter, auto_sync=True)

    assert batch_res.total_fetched == 1
    assert batch_res.processed == 1
    assert batch_res.duplicates == 0
    assert batch_res.failed == 0
    assert batch_res.skipped_offline is False

    assert mock_save.call_count == 1
    call_kwargs = mock_save.call_args.kwargs
    assert call_kwargs["expression"] == "約束"
    assert call_kwargs["reading"] == "やくそく"
    assert call_kwargs["meaning"] == "promise"
    assert call_kwargs["sentence"] == "約束を守る"
    assert call_kwargs["deck_name"] == "N3 vocabs"
    assert call_kwargs["source_type"] == "cloud"
    mock_sync.assert_called_once_with(101)

    # Card must be acknowledged and removed from pending
    pending = await adapter.fetch_pending()
    assert len(pending) == 0


@pytest.mark.asyncio
async def test_worker_duplicate_card_acknowledged(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="映画", reading="えいが", meaning="movie")
    await adapter.enqueue(card)

    dup_resp = {
        "id": 10, "expression": "映画", "reading": "えいが", "meaning": "movie",
        "is_duplicate": True, "sync_status": "synced",
    }

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=dup_resp)), \
         patch("kiroku_client.sync_card", new=AsyncMock()) as mock_sync:
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.total_fetched == 1
    assert batch_res.processed == 0
    assert batch_res.duplicates == 1
    assert batch_res.failed == 0
    # Duplicate does not trigger Anki sync
    mock_sync.assert_not_called()

    # Must be acknowledged so it doesn't get retried
    pending = await adapter.fetch_pending()
    assert len(pending) == 0


@pytest.mark.asyncio
async def test_worker_kiroku_unavailable_preserves_pending(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="学校", reading="がっこう", meaning="school")
    await adapter.enqueue(card)

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=False)):
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.skipped_offline is True
    assert batch_res.processed == 0

    # Card is preserved in queue with 0 attempts (outage is not a card failure)
    pending = await adapter.fetch_pending()
    assert len(pending) == 1
    assert pending[0].attempts == 0


@pytest.mark.asyncio
async def test_worker_api_error_nacks_card(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="BadCard", meaning="test")
    await adapter.enqueue(card)

    api_err = kc.KirokuAPIError(400, "Invalid expression format")

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(side_effect=api_err)):
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.failed == 1
    pending = await adapter.fetch_pending()
    assert len(pending) == 1
    assert pending[0].attempts == 1
    assert "Invalid expression format" in pending[0].error


@pytest.mark.asyncio
async def test_worker_sync_failure_still_acks_if_saved(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="雨", reading="あめ", meaning="rain")
    await adapter.enqueue(card)

    save_resp = {
        "id": 77, "expression": "雨", "reading": "あめ", "meaning": "rain",
        "is_duplicate": False, "sync_status": "pending",
    }
    sync_err = kc.KirokuUnavailableError("AnkiConnect unreachable")

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_resp)), \
         patch("kiroku_client.sync_card", new=AsyncMock(side_effect=sync_err)):
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.processed == 1
    assert batch_res.failed == 0
    # Kiroku has safely persisted the card locally; queue must acknowledge it
    pending = await adapter.fetch_pending()
    assert len(pending) == 0


@pytest.mark.asyncio
async def test_worker_unconfigured_cloud_handled_cleanly():
    unconfigured_adapter = CloudQueueAdapter(queue_url="", api_key="")
    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)):
        batch_res = await worker.process_batch(adapter=unconfigured_adapter)

    assert batch_res.total_fetched == 0
    assert batch_res.processed == 0
    assert batch_res.skipped_offline is False


@pytest.mark.asyncio
async def test_worker_ack_failure_handled_resiliently(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="川", reading="かわ", meaning="river")
    await adapter.enqueue(card)

    save_resp = {
        "id": 88, "expression": "川", "reading": "かわ", "meaning": "river",
        "is_duplicate": False, "sync_status": "synced",
    }

    from queue_adapter import QueueError
    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_resp)), \
         patch("kiroku_client.sync_card", new=AsyncMock(return_value={"id": 88, "sync_status": "synced"})), \
         patch.object(adapter, "ack", new=AsyncMock(side_effect=QueueError("Connection dropped during ack"))):
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.total_fetched == 1
    assert batch_res.processed == 1
    assert batch_res.failed == 0
    assert batch_res.results[0].status == "saved_ack_failed"


@pytest.mark.asyncio
async def test_worker_passes_custom_deck_name_to_kiroku(adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="星", reading="ほし", meaning="star", deck_name="Custom Mining Deck")
    await adapter.enqueue(card)

    save_resp = {
        "id": 99, "expression": "星", "reading": "ほし", "meaning": "star",
        "deck_name": "Custom Mining Deck", "is_duplicate": False, "sync_status": "synced",
    }

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_resp)) as mock_save, \
         patch("kiroku_client.sync_card", new=AsyncMock(return_value={"id": 99, "sync_status": "synced"})):
        batch_res = await worker.process_batch(adapter=adapter)

    assert batch_res.processed == 1
    assert mock_save.call_count == 1
    call_kwargs = mock_save.call_args.kwargs
    assert call_kwargs["expression"] == "星"
    assert call_kwargs["reading"] == "ほし"
    assert call_kwargs["meaning"] == "star"
    assert call_kwargs["deck_name"] == "Custom Mining Deck"


