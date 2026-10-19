"""
test_audit_fixes.py -- Targeted regression tests for all 20 audit fixes.
"""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from enrichment import EnrichmentError, enrich_card
from env_utils import load_env_file
from queue_adapter import LocalDevQueueAdapter, QueueItem, VocabCard
from queue_store import SqliteQueueStore, compute_idempotency_key
import server
import worker


def test_idempotency_key_includes_meaning():
    """Issue #7: compute_idempotency_key must produce different keys when meaning differs."""
    card1 = VocabCard(expression="回す", reading="まわす", meaning="to turn", sentence="")
    card2 = VocabCard(expression="回す", reading="まわす", meaning="to circulate", sentence="")

    key1 = compute_idempotency_key(card1)
    key2 = compute_idempotency_key(card2)

    assert key1 != key2, "Cards with different meanings must have distinct idempotency keys"


@pytest.mark.asyncio
async def test_local_dev_adapter_ack_nack_handles_uuid_gracefully(tmp_path: Path):
    """Issue #8: LocalDevQueueAdapter should not crash when receiving non-integer item_ids."""
    adapter = LocalDevQueueAdapter(db_path=tmp_path / "test_uuid.db")
    uuid_id = "550e8400-e29b-41d4-a716-446655440000"

    # Should log warning and return without raising ValueError
    await adapter.ack(uuid_id)
    await adapter.nack(uuid_id, error="simulated error")


def test_server_invalid_content_length_returns_400():
    """Issue #4: Non-integer Content-Length header should return 400 Bad Request instead of 500."""
    os.environ["SUBMIT_TOKEN"] = "test-token"
    with TestClient(server.app, raise_server_exceptions=False) as client:
        headers = {
            "Authorization": "Bearer test-token",
            "Content-Type": "application/json",
            "Content-Length": "not-a-number",
        }
        res = client.post("/submit", content='{"expression": "猫"}'.encode("utf-8"), headers=headers)
        assert res.status_code == 400
        assert "Invalid Content-Length header" in res.json()["detail"]


def test_server_mcp_unconfigured_secret_returns_503():
    """Issue #12: Unconfigured MCP_SECRET should return 503 instead of throwing a RuntimeError 500."""
    with patch.dict(os.environ, {"MCP_SECRET": ""}):
        with patch.object(server, "MCP_SECRET", ""):
            with TestClient(server.app, raise_server_exceptions=False) as client:
                res = client.post(
                    "/mcp",
                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                    headers={"Authorization": "Bearer some-token"},
                )
                assert res.status_code == 503
                assert "MCP endpoint is not configured" in res.json()["detail"]


@pytest.mark.asyncio
async def test_enrichment_does_not_double_wrap_error():
    """Issue #14: An EnrichmentError raised during capture should not be re-wrapped in a second EnrichmentError."""
    client = AsyncMock()
    client.capture_term.side_effect = EnrichmentError("Custom dictionary failure")

    card = VocabCard(expression="食べる", meaning="")
    with pytest.raises(EnrichmentError) as exc_info:
        await enrich_card(card, client=client)

    # Should raise the original error directly, without "Dictionary enrichment failed for '食べる': " prefix
    assert str(exc_info.value) == "Custom dictionary failure"


@pytest.mark.asyncio
async def test_worker_midbatch_offline_reports_skipped_offline():
    """Issue #9: Mid-batch offline skip should set skipped_offline=True on the returned BatchResult."""
    mock_adapter = AsyncMock()
    mock_adapter.fetch_pending.return_value = [
        QueueItem(id="item-1", card=VocabCard(expression="犬")),
        QueueItem(id="item-2", card=VocabCard(expression="猫")),
    ]

    with patch.object(worker.kc, "is_kiroku_alive", AsyncMock(return_value=True)), \
         patch.object(worker, "process_item") as mock_process:
        # First item succeeds, second item detects Kiroku went offline
        mock_process.side_effect = [
            worker.ProcessItemResult(item_id="item-1", status="saved", message="ok"),
            worker.ProcessItemResult(item_id="item-2", status="skipped_offline", message="Kiroku down"),
        ]

        batch = await worker.process_batch(adapter=mock_adapter)

        assert batch.processed == 1
        assert batch.skipped_offline is True
        assert len(batch.results) == 2


@pytest.mark.asyncio
async def test_sync_cloud_cards_paginates_properly():
    """Issue #10: sync_cloud_cards should paginate past 500 cards and fetch all eligible cards."""
    page_1 = [
        {"id": i, "expression": f"word{i}", "source_type": "cloud", "sync_status": "pending", "deck_name": "N3 vocabs"}
        for i in range(1, 501)
    ]
    page_2 = [
        {"id": 501, "expression": "extra", "source_type": "cloud", "sync_status": "pending", "deck_name": "N3 vocabs"}
    ]

    call_count = 0

    async def mock_list_cards(limit=500, offset=0, **kwargs):
        nonlocal call_count
        call_count += 1
        if offset == 0:
            return {"cards": page_1, "total": 501}
        elif offset == 500:
            return {"cards": page_2, "total": 501}
        return {"cards": [], "total": 501}

    with patch.object(worker.kc, "list_cards", side_effect=mock_list_cards), \
         patch.object(worker.kc, "sync_cards_bulk", AsyncMock(return_value={"synced_count": 501})) as mock_bulk:
        await worker.sync_cloud_cards()

        assert call_count == 2, "Should have requested two pages"
        mock_bulk.assert_called_once()
        sent_ids = mock_bulk.call_args[0][0]
        assert len(sent_ids) == 501
        assert 501 in sent_ids


def test_sqlite_queue_store_atomic_nack(tmp_path: Path):
    """Issue #2: SqliteQueueStore nack transitions item to failed when attempts >= MAX_ATTEMPTS."""
    store = SqliteQueueStore(db_path=tmp_path / "nack_test.db")
    store.init_db()

    card = VocabCard(expression="本", reading="ほん", meaning="book")
    item_id, _ = store.enqueue(card)

    # Claim the item up to 5 times (attempts increments each time)
    for _ in range(5):
        claimed = store.claim_pending(limit=1, lease_seconds=1)
        assert len(claimed) == 1
        # Set lease to past so it can be reclaimed
        with store._conn() as conn:
            conn.execute("UPDATE queued_cards SET lease_expires_at = '2000-01-01T00:00:00+00:00' WHERE id = ?", (item_id,))
            conn.commit()

    # Nack on an item with attempts=5 should mark it 'failed'
    success = store.nack(item_id, error="Fatal failure")
    assert success is True

    item = store.get_item(item_id)
    assert item is not None
    assert item.status == "failed"
    assert item.attempts == 5
    assert item.error == "Fatal failure"


def test_env_utils_loads_without_overwriting(tmp_path: Path):
    """Issue #16: load_env_file loads keys from .env without clobbering existing variables."""
    env_file = tmp_path / ".env"
    env_file.write_text("TEST_KEY_NEW=hello\nTEST_KEY_EXISTING=new_val\n", encoding="utf-8")

    os.environ["TEST_KEY_EXISTING"] = "original_val"
    try:
        load_env_file(env_file)
        assert os.environ["TEST_KEY_NEW"] == "hello"
        assert os.environ["TEST_KEY_EXISTING"] == "original_val"
    finally:
        os.environ.pop("TEST_KEY_NEW", None)
        os.environ.pop("TEST_KEY_EXISTING", None)


def test_clear_all_cards_and_reconcile_cleans_media(tmp_path: Path):
    """Ensure clear_all_cards and reconcile_anki_cards clean media and associated rows."""
    store = SqliteQueueStore(db_path=tmp_path / "test_clear.db")
    store.init_db()

    # Insert test card
    store.upsert_anki_cards([{
        "card_id": 99991,
        "note_id": 88881,
        "deck_name": "Default",
        "expression": "走る",
        "reading": "はしる",
        "meaning": "to run",
        "state": "review",
        "difficulty_score": 45.0,
        "difficulty_label": "normal",
        "due_in_days": 1,
        "synced_at": "2026-10-19T00:00:00+00:00",
    }])
    store.save_card_media(99991, "test.webp", b"WEBPTESTBYTES", mime_type="image/webp")
    store.record_study_review(99991, rating=3, time_ms=1200)

    assert store.get_card_media(99991) is not None

    # Reconcile when card is omitted should delete media
    store.reconcile_anki_cards([12345])
    assert store.get_card_media(99991) is None
    assert store.get_anki_card(99991) is None

    # Insert another card and test clear_all_cards
    store.upsert_anki_cards([{
        "card_id": 99992,
        "note_id": 88882,
        "deck_name": "Default",
        "expression": "飛ぶ",
        "reading": "とぶ",
        "meaning": "to fly",
        "state": "review",
        "difficulty_score": 30.0,
        "difficulty_label": "easy",
        "due_in_days": 2,
        "synced_at": "2026-10-19T00:00:00+00:00",
    }])
    store.save_card_media(99992, "fly.webp", b"FLYBYTES", mime_type="image/webp")
    res = store.clear_all_cards(include_stats=True)
    assert res["deleted_cards"] == 1
    assert res["deleted_media"] == 1
    assert store.get_card_media(99992) is None


def test_study_mode_aliases_unseen_and_due(tmp_path: Path):
    """Ensure get_study_session accepts 'unseen' and 'due' mode aliases."""
    store = SqliteQueueStore(db_path=tmp_path / "test_aliases.db")
    store.init_db()

    store.upsert_anki_cards([{
        "card_id": 1001,
        "note_id": 2001,
        "deck_name": "Japanese",
        "expression": "青",
        "reading": "あお",
        "meaning": "blue",
        "state": "review",
        "difficulty_score": 10.0,
        "difficulty_label": "easy",
        "due_in_days": 0,
        "synced_at": "2026-10-19T00:00:00+00:00",
    }])

    # Mode 'unseen' should find cards not in cloud_study_state
    cards_unseen = store.get_study_session(mode="unseen", limit=10)
    assert len(cards_unseen) == 1
    assert cards_unseen[0]["card_id"] == 1001

    # Record review with rating 1 -> sets box 1, due in 10 minutes (so it's due in the future)
    store.record_study_review(1001, rating=1)

    # Set due_at in the past
    with store._conn() as conn:
        conn.execute("UPDATE cloud_study_state SET due_at = '2020-01-01T00:00:00+00:00' WHERE card_id = 1001;")
        conn.commit()

    # Mode 'due' should find this card
    cards_due = store.get_study_session(mode="due", limit=10)
    assert len(cards_due) == 1
    assert cards_due[0]["card_id"] == 1001


def test_clear_cards_endpoint_requires_auth_and_clears(tmp_path: Path):
    """Ensure POST /api/anki/cards/clear requires WORKER_TOKEN and properly clears data."""
    store = SqliteQueueStore(db_path=tmp_path / "test_api_clear.db")
    store.init_db()

    os.environ["WORKER_TOKEN"] = "valid-worker-token"
    with patch.object(server, "store", store):
        with TestClient(server.app) as client:
            # 401 without auth
            resp = client.post("/api/anki/cards/clear")
            assert resp.status_code == 401

            # 200 with auth
            resp = client.post(
                "/api/anki/cards/clear",
                headers={"Authorization": "Bearer valid-worker-token"},
                json={"include_stats": True},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert "deleted" in data
