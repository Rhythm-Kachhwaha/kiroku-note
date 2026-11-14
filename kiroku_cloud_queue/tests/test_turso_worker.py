"""
test_turso_worker.py -- Tests for direct libSQL/Turso queue adapter and worker integration.
Uses local file-backed libSQL database for deterministic offline testing.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import libsql_client

from queue_adapter import (
    CloudQueueAdapter,
    LocalDevQueueAdapter,
    QueueItem,
    VocabCard,
    get_queue_adapter,
)
from turso_adapter import TursoQueueAdapter
from worker import process_item


@pytest.fixture
def temp_turso_db():
    temp_dir = tempfile.mkdtemp()
    db_path = Path(temp_dir) / "test_turso_queue.db"
    db_url = f"file:{db_path.as_posix()}"
    yield db_url
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_turso_enqueue_and_lease(temp_turso_db):
    adapter = TursoQueueAdapter(db_url=temp_turso_db)
    await adapter.init_schema()

    card = VocabCard(
        expression="猫",
        reading="ねこ",
        meaning="cat",
        sentence="黒い猫が歩いている。",
        sentence_meaning="A black cat is walking.",
        deck_name="N3 vocabs"
    )

    # 1. Enqueue card
    item_id = await adapter.enqueue(card)
    assert item_id is not None

    stats = await adapter.stats()
    assert stats["pending"] == 1
    assert stats["leased"] == 0
    assert stats["acked"] == 0

    # 2. Fetch pending (lease claim)
    items = await adapter.fetch_pending(limit=10)
    assert len(items) == 1
    leased_item = items[0]
    assert leased_item.id == item_id
    assert leased_item.card.expression == "猫"
    assert leased_item.card.reading == "ねこ"
    assert leased_item.claim_token != ""

    stats_after_lease = await adapter.stats()
    assert stats_after_lease["pending"] == 0
    assert stats_after_lease["leased"] == 1

    # 3. Ack item
    await adapter.ack(leased_item.id, claim_token=leased_item.claim_token)
    stats_after_ack = await adapter.stats()
    assert stats_after_ack["leased"] == 0
    assert stats_after_ack["acked"] == 1

    # Fetch again should return empty
    empty_items = await adapter.fetch_pending(limit=10)
    assert len(empty_items) == 0


@pytest.mark.asyncio
async def test_turso_nack_retry(temp_turso_db):
    adapter = TursoQueueAdapter(db_url=temp_turso_db)
    await adapter.init_schema()

    card = VocabCard(expression="犬", reading="いぬ", meaning="dog")
    item_id = await adapter.enqueue(card)

    items = await adapter.fetch_pending(limit=1)
    assert len(items) == 1
    item = items[0]

    # Nack item
    await adapter.nack(item.id, error="Transient network error", claim_token=item.claim_token)

    # Item should be released back to pending
    stats = await adapter.stats()
    assert stats["pending"] == 1
    assert stats["leased"] == 0

    # Can be leased again
    re_leased = await adapter.fetch_pending(limit=1)
    assert len(re_leased) == 1
    assert re_leased[0].id == item_id
    assert re_leased[0].attempts == 2


@pytest.mark.asyncio
async def test_turso_worker_process_item(temp_turso_db):
    adapter = TursoQueueAdapter(db_url=temp_turso_db)
    await adapter.init_schema()

    card = VocabCard(
        expression="約束",
        reading="やくそく",
        meaning="promise",
        sentence="約束を守る。",
        sentence_meaning="Keep a promise."
    )
    item_id = await adapter.enqueue(card)
    items = await adapter.fetch_pending(limit=1)
    assert len(items) == 1
    item = items[0]

    # Mock kc.save_card to simulate successful local Kiroku persistence
    with patch("worker.kc.save_card", new_callable=AsyncMock) as mock_save:
        mock_save.return_value = {
            "id": 123,
            "expression": "約束",
            "is_duplicate": False,
            "sync_status": "saved"
        }

        result = await process_item(item, adapter=adapter, auto_sync=False)
        assert result.status == "saved"
        assert result.card_id == 123
        mock_save.assert_called_once()

    # Op log should now be acked
    stats = await adapter.stats()
    assert stats["acked"] == 1
    assert stats["leased"] == 0


def test_turso_fallback_flag(temp_turso_db):
    # Without fallback: turso url returns TursoQueueAdapter
    with patch.dict(os.environ, {
        "QUEUE_BACKEND": "cloud",
        "TURSO_DATABASE_URL": temp_turso_db,
        "KIROKU_USE_HTTP_QUEUE": "false"
    }):
        ad = get_queue_adapter()
        assert isinstance(ad, TursoQueueAdapter)

    # With fallback enabled: returns CloudQueueAdapter
    with patch.dict(os.environ, {
        "QUEUE_BACKEND": "cloud",
        "TURSO_DATABASE_URL": temp_turso_db,
        "KIROKU_USE_HTTP_QUEUE": "true",
        "CLOUD_QUEUE_URL": "http://localhost:8000",
        "CLOUD_QUEUE_API_KEY": "test"
    }):
        ad = get_queue_adapter()
        assert isinstance(ad, CloudQueueAdapter)
