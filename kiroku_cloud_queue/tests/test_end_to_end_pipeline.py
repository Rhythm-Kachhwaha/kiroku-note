"""
test_end_to_end_pipeline.py -- End-to-end simulation of the complete pipeline:
iPhone Shortcut (text/plain) -> Cloud API (/submit) -> Durable Queue -> Windows Worker -> Kiroku -> Anki
"""
import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SUBMIT_TOKEN = "iphone-secret-test-token"
WORKER_TOKEN = "worker-secret-test-token"

os.environ["SUBMIT_TOKEN"] = SUBMIT_TOKEN
os.environ["WORKER_TOKEN"] = WORKER_TOKEN
os.environ["MCP_SECRET"] = WORKER_TOKEN

import server
from queue_store import SqliteQueueStore
from queue_adapter import CloudQueueAdapter
import worker
import kiroku_client as kc


@pytest.fixture()
def pipeline_env(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUBMIT_TOKEN", SUBMIT_TOKEN)
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    monkeypatch.setenv("MCP_SECRET", WORKER_TOKEN)
    db_file = tmp_path / "e2e_queue.db"
    store = SqliteQueueStore(db_path=db_file)
    server.store = store
    with TestClient(server.app, raise_server_exceptions=False) as client:
        yield client, store


@pytest.mark.asyncio
async def test_full_pipeline_shortcut_to_anki(pipeline_env):
    client, store = pipeline_env

    # -----------------------------------------------------------------------
    # Step 1: iPhone Shortcut sends clipboard as text/plain POST
    # -----------------------------------------------------------------------
    shortcut_payload = json.dumps({
        "expression": "映画",
        "reading": "えいが",
        "meaning": "movie; film",
        "sentence": "昨日、映画を見た。",
        "sentence_meaning": "I watched a movie yesterday.",
    }, ensure_ascii=False)

    post_headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain; charset=utf-8",
    }

    resp1 = client.post("/submit", content=shortcut_payload.encode("utf-8"), headers=post_headers)
    assert resp1.status_code == 200
    res_data1 = resp1.json()
    assert res_data1["status"] == "queued"
    assert res_data1["is_duplicate"] is False
    item_id = res_data1["id"]

    # -----------------------------------------------------------------------
    # Step 2: User accidental double-tap produces duplicate submission
    # -----------------------------------------------------------------------
    resp2 = client.post("/submit", content=shortcut_payload.encode("utf-8"), headers=post_headers)
    assert resp2.status_code == 200
    res_data2 = resp2.json()
    assert res_data2["id"] == item_id
    assert res_data2["is_duplicate"] is True

    # Queue should contain only 1 pending card
    assert store.stats().get("pending") == 1

    # -----------------------------------------------------------------------
    # Step 3: PC comes online and Worker polls cloud queue via CloudQueueAdapter
    # -----------------------------------------------------------------------
    cloud_adapter = CloudQueueAdapter(queue_url="https://cloud.kiroku.local", api_key=WORKER_TOKEN)

    # Mock outbound HTTPS calls from CloudQueueAdapter to our FastAPI client
    async def mock_http_get(url, params=None, headers=None):
        endpoint = url.replace("https://cloud.kiroku.local", "")
        r = client.get(endpoint, params=params, headers=headers)
        return httpx.Response(r.status_code, json=r.json(), request=httpx.Request("GET", url))

    async def mock_http_post(url, json=None, headers=None):
        endpoint = url.replace("https://cloud.kiroku.local", "")
        r = client.post(endpoint, json=json, headers=headers)
        return httpx.Response(r.status_code, json=r.json(), request=httpx.Request("POST", url))

    save_mock_resp = {
        "id": 555,
        "expression": "映画",
        "reading": "えいが",
        "meaning": "movie; film",
        "is_duplicate": False,
        "sync_status": "pending",
    }
    sync_mock_resp = {"id": 555, "sync_status": "synced", "anki_note_id": 99991}

    with patch("httpx.AsyncClient.get", side_effect=mock_http_get), \
         patch("httpx.AsyncClient.post", side_effect=mock_http_post), \
         patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_mock_resp)) as mock_save, \
         patch("kiroku_client.sync_card", new=AsyncMock(return_value=sync_mock_resp)) as mock_sync:

        batch_result = await worker.process_batch(adapter=cloud_adapter, auto_sync=True)

    # -----------------------------------------------------------------------
    # Step 4: Verify downstream execution and queue status
    # -----------------------------------------------------------------------
    assert batch_result.total_fetched == 1
    assert batch_result.processed == 1
    assert batch_result.duplicates == 0
    assert batch_result.failed == 0

    # Verify Kiroku API was called with exact fields
    assert mock_save.call_count == 1
    call_kwargs = mock_save.call_args.kwargs
    assert call_kwargs["expression"] == "映画"
    assert call_kwargs["reading"] == "えいが"
    assert call_kwargs["meaning"] == "movie; film"
    assert call_kwargs["sentence"] == "昨日、映画を見た。"
    assert call_kwargs["sentence_meaning"] == "I watched a movie yesterday."
    assert call_kwargs["deck_name"] == "N3 vocabs"
    assert call_kwargs["source_type"] == "cloud"
    mock_sync.assert_called_once_with(555)

    # Verify queue state transitioned to completed
    final_stats = store.stats()
    assert final_stats.get("completed") == 1
    assert final_stats.get("pending", 0) == 0
    assert final_stats.get("claimed", 0) == 0
