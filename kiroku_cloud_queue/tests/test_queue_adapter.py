"""
test_queue_adapter.py -- Tests for LocalDevQueueAdapter and CloudQueueAdapter.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from queue_adapter import (
    CloudQueueAdapter,
    CloudQueueNotConfiguredError,
    LocalDevQueueAdapter,
    QueueError,
    VocabCard,
    get_queue_adapter,
)


# ---------------------------------------------------------------------------
# LocalDevQueueAdapter Tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def local_adapter(tmp_path: Path) -> LocalDevQueueAdapter:
    db_file = tmp_path / "test_queue.db"
    return LocalDevQueueAdapter(db_path=db_file)


@pytest.mark.asyncio
async def test_local_enqueue_and_fetch(local_adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="映画", reading="えいが", meaning="movie", sentence="映画を見る")
    item_id = await local_adapter.enqueue(card)
    assert item_id.isdigit()
    assert int(item_id) > 0

    pending = await local_adapter.fetch_pending()
    assert len(pending) == 1
    item = pending[0]
    assert item.id == item_id
    assert item.card.expression == "映画"
    assert item.card.reading == "えいが"
    assert item.card.meaning == "movie"
    assert item.card.sentence == "映画を見る"
    assert item.status == "pending"
    assert item.attempts == 0


@pytest.mark.asyncio
async def test_local_ack_removes_from_pending(local_adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="本", reading="ほん", meaning="book")
    item_id = await local_adapter.enqueue(card)

    await local_adapter.ack(item_id)
    pending = await local_adapter.fetch_pending()
    assert len(pending) == 0

    stats = await local_adapter.stats()
    assert stats.get("sent") == 1
    assert stats.get("pending", 0) == 0


@pytest.mark.asyncio
async def test_local_nack_and_retry_limit(local_adapter: LocalDevQueueAdapter):
    card = VocabCard(expression="猫", reading="ねこ", meaning="cat")
    item_id = await local_adapter.enqueue(card)

    await local_adapter.nack(item_id, error="Temporary failure 1")
    pending = await local_adapter.fetch_pending()
    assert len(pending) == 1
    assert pending[0].attempts == 1
    assert "Temporary failure 1" in pending[0].error

    # Exhaust retries up to 10
    for i in range(2, 11):
        await local_adapter.nack(item_id, error=f"Failure {i}")

    # Now attempts == 10, should be excluded from pending
    pending_after = await local_adapter.fetch_pending()
    assert len(pending_after) == 0


@pytest.mark.asyncio
async def test_local_fifo_order(local_adapter: LocalDevQueueAdapter):
    for i in range(5):
        await local_adapter.enqueue(VocabCard(expression=f"word_{i}", meaning=f"m_{i}"))

    pending = await local_adapter.fetch_pending()
    assert [p.card.expression for p in pending] == [f"word_{i}" for i in range(5)]


# ---------------------------------------------------------------------------
# CloudQueueAdapter Tests (Unconfigured & Mocked Remote)
# ---------------------------------------------------------------------------

def test_cloud_adapter_unconfigured_detection():
    adapter = CloudQueueAdapter(queue_url="", api_key="")
    assert not adapter.is_configured


@pytest.mark.asyncio
async def test_cloud_adapter_unconfigured_raises_on_all_methods():
    adapter = CloudQueueAdapter(queue_url="", api_key="")
    card = VocabCard(expression="犬", meaning="dog")

    with pytest.raises(CloudQueueNotConfiguredError) as exc_info:
        await adapter.enqueue(card)
    assert "CLOUD_QUEUE_URL" in str(exc_info.value)

    with pytest.raises(CloudQueueNotConfiguredError):
        await adapter.fetch_pending()

    with pytest.raises(CloudQueueNotConfiguredError):
        await adapter.ack("123")

    with pytest.raises(CloudQueueNotConfiguredError):
        await adapter.nack("123", "err")

    with pytest.raises(CloudQueueNotConfiguredError):
        await adapter.stats()


@pytest.mark.asyncio
async def test_cloud_adapter_configured_http_calls():
    adapter = CloudQueueAdapter(queue_url="https://cloud-queue.example.com", api_key="secret-token-123")
    assert adapter.is_configured

    # Mock enqueue response
    mock_post_resp = httpx.Response(200, json={"id": "cloud-item-999"}, request=httpx.Request("POST", "https://cloud-queue.example.com/enqueue"))
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_post_resp)) as mock_post:
        res_id = await adapter.enqueue(VocabCard(expression="鳥", meaning="bird"))
        assert res_id == "cloud-item-999"
        mock_post.assert_called_once()
        assert "Authorization" in mock_post.call_args[1]["headers"]
        assert mock_post.call_args[1]["headers"]["Authorization"] == "Bearer secret-token-123"

    # Mock fetch_pending response
    mock_get_resp = httpx.Response(
        200,
        json={"items": [{"id": "cloud-item-999", "card": {"expression": "鳥", "meaning": "bird"}, "status": "pending"}]},
        request=httpx.Request("GET", "https://cloud-queue.example.com/pending")
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=mock_get_resp)):
        items = await adapter.fetch_pending()
        assert len(items) == 1
        assert items[0].id == "cloud-item-999"
        assert items[0].card.expression == "鳥"


@pytest.mark.asyncio
async def test_cloud_adapter_wraps_network_errors_in_queue_error():
    adapter = CloudQueueAdapter(queue_url="https://cloud-queue.example.com", api_key="secret-token-123")
    card = VocabCard(expression="鳥", meaning="bird")

    # ConnectError on enqueue
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=httpx.ConnectError("Connection refused"))):
        with pytest.raises(QueueError) as exc_info:
            await adapter.enqueue(card)
        assert "network error" in str(exc_info.value).lower() or "connection" in str(exc_info.value).lower()

    # TimeoutException on fetch_pending
    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=httpx.ReadTimeout("Timeout reading response"))):
        with pytest.raises(QueueError) as exc_info:
            await adapter.fetch_pending()
        assert "timeout" in str(exc_info.value).lower() or "network" in str(exc_info.value).lower()

    # ConnectError on ack
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=httpx.ConnectError("Connection reset"))):
        with pytest.raises(QueueError):
            await adapter.ack("123")


# ---------------------------------------------------------------------------
# Factory Tests
# ---------------------------------------------------------------------------

def test_factory_local(tmp_path: Path):
    adapter = get_queue_adapter(backend="local", db_path=tmp_path / "f.db")
    assert isinstance(adapter, LocalDevQueueAdapter)


def test_factory_cloud():
    adapter = get_queue_adapter(backend="cloud")
    assert isinstance(adapter, CloudQueueAdapter)

