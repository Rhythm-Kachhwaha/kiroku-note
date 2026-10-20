"""
test_server_stability.py -- Failing regression tests for Workstream A:
A1. Decimal serialization in Postgres stats overview
A2. Generator didn't stop after throw() on unknown card 404
A5. Input validation on bad max_results and global exception handler
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SUBMIT_TOKEN = "test-phone-token-xyz"
WORKER_TOKEN = "test-worker-token-123"

os.environ["SUBMIT_TOKEN"] = SUBMIT_TOKEN
os.environ["WORKER_TOKEN"] = WORKER_TOKEN
os.environ["MCP_SECRET"] = WORKER_TOKEN

import server
from queue_store import SqliteQueueStore


@pytest.fixture(params=["sqlite", "postgres"])
def client(request, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUBMIT_TOKEN", SUBMIT_TOKEN)
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    monkeypatch.setenv("MCP_SECRET", WORKER_TOKEN)
    if request.param == "sqlite":
        test_db = tmp_path / "test_stability.db"
        store = SqliteQueueStore(db_path=test_db)
        server.store = store
        with TestClient(server.app, raise_server_exceptions=False) as c:
            yield c
    elif request.param == "postgres":
        test_pg_url = os.getenv("TEST_DATABASE_URL")
        if not test_pg_url:
            pytest.skip("TEST_DATABASE_URL not set; skipping Postgres test.")
        import uuid
        from postgres_store import PostgresQueueStore
        schema_name = f"test_stab_{uuid.uuid4().hex[:8]}"
        pg_store = PostgresQueueStore(test_pg_url, schema=schema_name)
        pg_store.init_db()
        server.store = pg_store
        try:
            with TestClient(server.app, raise_server_exceptions=False) as c:
                yield c
        finally:
            pg_store.drop_schema()
            pg_store.close()


def _auth_worker():
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def _auth_recent():
    return {"Authorization": f"Bearer {SUBMIT_TOKEN}"}


def test_a1_stats_overview_json_serializable(client: TestClient):
    """
    A1: Populated collection with cards must not fail with TypeError: Object of type Decimal is not JSON serializable.
    /api/stats/overview must return 200 and be serializable with json.dumps.
    """
    card = {
        "card_id": 9001,
        "note_id": 9001,
        "deck_name": "Japanese::Mining",
        "expression": "安定",
        "reading": "あんてい",
        "meaning": "stability",
        "interval_days": 15,
        "reps": 5,
        "lapses": 0,
        "state": "mature",
        "difficulty_score": 25.0,
        "difficulty_label": "easy",
        "is_leech": False,
        "due_in_days": 5,
    }
    push_resp = client.post("/api/anki/cards", json={"cards": [card]}, headers=_auth_worker())
    assert push_resp.status_code == 200

    resp = client.get("/api/stats/overview?range=30d", headers=_auth_recent())
    assert resp.status_code == 200, f"Expected 200 but got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert "deck_breakdown" in data
    # Assert standard json.dumps succeeds on payload without custom encoders
    serialized = json.dumps(data)
    assert len(serialized) > 0


def test_a2_unknown_card_returns_404_not_500(client: TestClient):
    """
    A2: POST /api/study/review on unknown card_id must return 404 Not Found,
    never 500 RuntimeError: generator didn't stop after throw().
    """
    review_payload = {
        "card_id": 999999999,
        "rating": 3,
        "review_uuid": "test-uuid-not-found",
    }
    resp = client.post("/api/study/review", json=review_payload, headers=_auth_recent())
    assert resp.status_code == 404, f"Expected 404 on missing card, got {resp.status_code}: {resp.text}"


def test_a5_dictionary_lookup_validation_bad_max_results(client: TestClient):
    """
    A5: Bad max_results must return 400 Bad Request instead of 500.
    """
    resp = client.post("/api/dictionary/lookup", json={"text": "食べる", "max_results": "invalid_int"})
    assert resp.status_code == 400, f"Expected 400 on invalid max_results, got {resp.status_code}: {resp.text}"
