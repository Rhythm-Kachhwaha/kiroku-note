"""
test_anki_api.py -- Tests for Anki mirror and study API endpoints.
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


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUBMIT_TOKEN", SUBMIT_TOKEN)
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    monkeypatch.setenv("MCP_SECRET", WORKER_TOKEN)
    test_db = tmp_path / "test_anki_api.db"
    store = SqliteQueueStore(db_path=test_db)
    server.store = store
    with TestClient(server.app, raise_server_exceptions=True) as c:
        yield c


def _auth_worker():
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def _auth_recent():
    return {"Authorization": f"Bearer {SUBMIT_TOKEN}"}


def test_anki_worker_auth_required(client: TestClient):
    # No auth
    resp = client.post("/api/anki/cards", json={"cards": []})
    assert resp.status_code == 401

    # Submit token not allowed for worker endpoint
    resp = client.post("/api/anki/cards", json={"cards": []}, headers=_auth_recent())
    assert resp.status_code == 401

    # Worker token allowed
    resp = client.post("/api/anki/cards", json={"cards": []}, headers=_auth_worker())
    assert resp.status_code == 200


def test_save_anki_cards_batch_limit(client: TestClient):
    # 501 cards exceeds max 500
    oversized = [{"card_id": i, "expression": f"word{i}"} for i in range(501)]
    resp = client.post("/api/anki/cards", json={"cards": oversized}, headers=_auth_worker())
    assert resp.status_code == 413
    assert "Batch size limit exceeded" in resp.json()["detail"]

    # 500 cards allowed
    allowed = [{"card_id": i, "expression": f"word{i}"} for i in range(500)]
    resp = client.post("/api/anki/cards", json={"cards": allowed}, headers=_auth_worker())
    assert resp.status_code == 200
    assert resp.json()["count"] == 500


def test_save_anki_daily_batch_limit(client: TestClient):
    oversized = [{"day": f"2026-01-{i:02d}", "reviews": 5} for i in range(1001)]
    resp = client.post("/api/anki/daily", json={"days": oversized}, headers=_auth_worker())
    assert resp.status_code == 413
    assert "Batch size limit exceeded" in resp.json()["detail"]

    allowed = [{"day": f"2026-01-01", "reviews": 5}]
    resp = client.post("/api/anki/daily", json={"days": allowed}, headers=_auth_worker())
    assert resp.status_code == 200


def test_reconcile_anki_cards(client: TestClient):
    # Seed 3 cards
    client.post(
        "/api/anki/cards",
        json={"cards": [{"card_id": 1, "expression": "A"}, {"card_id": 2, "expression": "B"}, {"card_id": 3, "expression": "C"}]},
        headers=_auth_worker(),
    )
    # Reconcile with 1 and 2
    resp = client.post("/api/anki/reconcile", json={"card_ids": [1, 2]}, headers=_auth_worker())
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1

    # Card 3 is deleted
    resp = client.get("/api/cards/3", headers=_auth_recent())
    assert resp.status_code == 404


def test_anki_meta_endpoint(client: TestClient):
    resp = client.post(
        "/api/anki/meta",
        json={"meta": {"schema_version": "1.0", "card_count": "500"}},
        headers=_auth_worker(),
    )
    assert resp.status_code == 200

    resp = client.get("/api/anki/status", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["schema_version"] == "1.0"


def test_cards_query_empty_table(client: TestClient):
    resp = client.get("/api/cards", headers=_auth_recent())
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["limit"] == 30
    assert data["offset"] == 0


def test_cards_query_filtering_and_sorting(client: TestClient):
    cards = [
        {"card_id": 1, "expression": "勉強", "reading": "べんきょう", "meaning": "study", "difficulty_score": 75.0, "difficulty_label": "hard", "state": "young", "deck_name": "DeckA", "jlpt_level": "N3"},
        {"card_id": 2, "expression": "本", "reading": "ほん", "meaning": "book", "difficulty_score": 10.0, "difficulty_label": "easy", "state": "mature", "deck_name": "DeckB", "jlpt_level": "N5"},
    ]
    client.post("/api/anki/cards", json={"cards": cards}, headers=_auth_worker())

    # Search by text
    resp = client.get("/api/cards?q=勉強", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["card_id"] == 1

    # Filter by label
    resp = client.get("/api/cards?label=easy", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["card_id"] == 2

    # Invalid sort returns 400
    resp = client.get("/api/cards?sort=invalid_col", headers=_auth_recent())
    assert resp.status_code == 400

    # Detail view
    resp = client.get("/api/cards/1", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["card"]["expression"] == "勉強"


def test_stats_overview_empty_and_populated(client: TestClient):
    # Empty overview returns 200 with all structures
    resp = client.get("/api/stats/overview?range=30d", headers=_auth_recent())
    assert resp.status_code == 200
    data = resp.json()
    assert "card_growth" in data
    assert "true_retention" in data
    assert "due_forecast" in data
    assert "difficulty_distribution" in data
    assert "weak_words" in data
    assert "jlpt_coverage" in data


def test_study_api_flow(client: TestClient):
    card = {"card_id": 10, "expression": "記憶", "reading": "きおく", "meaning": "memory", "difficulty_score": 90.0, "difficulty_label": "leech"}
    client.post("/api/anki/cards", json={"cards": [card]}, headers=_auth_worker())

    # Session fetch
    resp = client.get("/api/study/session?mode=weakest&limit=10", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
    assert resp.json()["cards"][0]["card_id"] == 10

    # Rating validation (rating must be 1..4)
    resp = client.post("/api/study/review", json={"card_id": 10, "rating": 5}, headers=_auth_recent())
    assert resp.status_code == 422

    # Valid rating Good (3)
    resp = client.post(
        "/api/study/review",
        json={"card_id": 10, "rating": 3, "time_ms": 2500, "session_id": "test-sess", "review_uuid": "uuid-123"},
        headers=_auth_recent(),
    )
    assert resp.status_code == 200
    assert resp.json()["box"] == 2

    # Study summary
    resp = client.get("/api/study/summary", headers=_auth_recent())
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["practiced_today"] == 1
