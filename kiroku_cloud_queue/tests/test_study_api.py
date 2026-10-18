"""
test_study_api.py -- Dedicated unit & integration tests for Cloud Study Mode (Extra Practice).
Verifies Leitner 5-box scheduling, mode selection, duplicate idempotency,
and summary endpoints.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

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
    test_db = tmp_path / "test_study_api.db"
    store = SqliteQueueStore(db_path=test_db)
    server.store = store
    with TestClient(server.app, raise_server_exceptions=True) as c:
        yield c


def _auth():
    return {"Authorization": f"Bearer {SUBMIT_TOKEN}"}


def _seed_cards(client: TestClient):
    cards = [
        {
            "card_id": 1001,
            "note_id": 2001,
            "deck_name": "Japanese",
            "model_name": "Kiroku Note",
            "expression": "執着",
            "reading": "しゅうちゃく",
            "meaning": "obsession; attachment",
            "sentence": "過去への執着を捨てる。",
            "sentence_meaning": "Abandon attachment to the past.",
            "jlpt_level": "N1",
            "state": "learning",
            "interval_days": 2,
            "reps": 12,
            "lapses": 9,
            "difficulty_score": 85.0,
            "difficulty_label": "leech",
            "is_leech": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mod_at": datetime.now(timezone.utc).isoformat(),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "card_id": 1002,
            "note_id": 2002,
            "deck_name": "Japanese",
            "model_name": "Kiroku Note",
            "expression": "慎重",
            "reading": "しんちょう",
            "meaning": "discreet; prudent; cautious",
            "sentence": "慎重に行動する。",
            "sentence_meaning": "Act cautiously.",
            "jlpt_level": "N2",
            "state": "young",
            "interval_days": 8,
            "reps": 6,
            "lapses": 2,
            "difficulty_score": 55.0,
            "difficulty_label": "normal",
            "is_leech": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mod_at": datetime.now(timezone.utc).isoformat(),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
        {
            "card_id": 1003,
            "note_id": 2003,
            "deck_name": "Japanese",
            "model_name": "Kiroku Note",
            "expression": "休止",
            "reading": "きゅうし",
            "meaning": "pause; suspension",
            "sentence": "",
            "sentence_meaning": "",
            "jlpt_level": "N2",
            "state": "suspended",
            "interval_days": 10,
            "reps": 4,
            "lapses": 0,
            "difficulty_score": 30.0,
            "difficulty_label": "easy",
            "is_leech": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mod_at": datetime.now(timezone.utc).isoformat(),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
    ]
    resp = client.post("/api/anki/cards", json={"cards": cards}, headers={"Authorization": f"Bearer {WORKER_TOKEN}"})
    assert resp.status_code == 200


def test_study_session_modes(client: TestClient):
    _seed_cards(client)

    # 1. Mode: weakest (should return active cards sorted by difficulty DESC)
    resp = client.get("/api/study/session?mode=weakest&limit=10", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    cards = data.get("cards") or data.get("items") or []
    assert len(cards) >= 1
    assert cards[0]["card_id"] == 1001  # Leech / highest difficulty
    # Suspended card (1003) excluded from non-leech modes
    card_ids = [c["card_id"] for c in cards]
    assert 1003 not in card_ids

    # 2. Mode: leeches
    resp = client.get("/api/study/session?mode=leeches", headers=_auth())
    assert resp.status_code == 200
    leeches = (resp.json().get("cards") or resp.json().get("items") or [])
    assert len(leeches) == 1
    assert leeches[0]["card_id"] == 1001

    # 3. Mode: jlpt
    resp = client.get("/api/study/session?mode=jlpt&level=N2", headers=_auth())
    assert resp.status_code == 200
    n2_cards = (resp.json().get("cards") or resp.json().get("items") or [])
    assert len(n2_cards) == 1
    assert n2_cards[0]["card_id"] == 1002

    # 4. Mode: custom
    resp = client.get("/api/study/session?mode=custom&custom_ids=1001,1002", headers=_auth())
    assert resp.status_code == 200
    custom_cards = (resp.json().get("cards") or resp.json().get("items") or [])
    assert len(custom_cards) == 2


def test_leitner_box_transitions(client: TestClient):
    _seed_cards(client)

    # Card starts unseen (not in cloud_study_state)
    # Review 1: Rating 3 (Good) -> moves to Box 2
    resp = client.post("/api/study/review", json={
        "card_id": 1002,
        "rating": 3,
        "time_ms": 2000,
        "session_id": "session-1",
        "review_uuid": "uuid-001",
    }, headers=_auth())
    assert resp.status_code == 200
    res1 = resp.json()
    assert res1["box"] == 2
    assert res1["streak"] == 1

    # Review 2: Rating 4 (Easy) -> moves up 2 boxes -> Box 4
    resp = client.post("/api/study/review", json={
        "card_id": 1002,
        "rating": 4,
        "time_ms": 1500,
        "session_id": "session-2",
        "review_uuid": "uuid-002",
    }, headers=_auth())
    assert resp.status_code == 200
    res2 = resp.json()
    assert res2["box"] == 4
    assert res2["streak"] == 2

    # Review 3: Rating 2 (Hard) -> stays in current box (Box 4)
    resp = client.post("/api/study/review", json={
        "card_id": 1002,
        "rating": 2,
        "time_ms": 3000,
        "session_id": "session-3",
        "review_uuid": "uuid-003",
    }, headers=_auth())
    assert resp.status_code == 200
    res3 = resp.json()
    assert res3["box"] == 4
    assert res3["streak"] == 2

    # Review 4: Rating 1 (Again) -> drops back to Box 1, streak resets
    resp = client.post("/api/study/review", json={
        "card_id": 1002,
        "rating": 1,
        "time_ms": 4000,
        "session_id": "session-4",
        "review_uuid": "uuid-004",
    }, headers=_auth())
    assert resp.status_code == 200
    res4 = resp.json()
    assert res4["box"] == 1
    assert res4["streak"] == 0
    assert res4["again_count"] == 1


def test_study_review_idempotency(client: TestClient):
    _seed_cards(client)

    payload = {
        "card_id": 1001,
        "rating": 3,
        "time_ms": 1800,
        "session_id": "session-repeat",
        "review_uuid": "stable-uuid-abc",
    }

    # First attempt
    resp1 = client.post("/api/study/review", json=payload, headers=_auth())
    assert resp1.status_code == 200
    assert resp1.json()["box"] == 2
    assert resp1.json().get("duplicate") is False

    # Second duplicate attempt with identical review_uuid
    resp2 = client.post("/api/study/review", json=payload, headers=_auth())
    assert resp2.status_code == 200
    assert resp2.json()["box"] == 2
    assert resp2.json().get("duplicate") is True


def test_study_review_validation(client: TestClient):
    _seed_cards(client)

    # Invalid rating (must be 1..4)
    resp = client.post("/api/study/review", json={
        "card_id": 1001,
        "rating": 5,
        "time_ms": 1000,
        "session_id": "session-val",
    }, headers=_auth())
    assert resp.status_code == 422

    # Non-existent card
    resp = client.post("/api/study/review", json={
        "card_id": 999999,
        "rating": 3,
        "time_ms": 1000,
        "session_id": "session-val",
    }, headers=_auth())
    assert resp.status_code == 404


def test_study_summary(client: TestClient):
    _seed_cards(client)

    # Record two reviews
    client.post("/api/study/review", json={
        "card_id": 1001,
        "rating": 3,
        "time_ms": 2000,
        "session_id": "s1",
        "review_uuid": "u1",
    }, headers=_auth())
    client.post("/api/study/review", json={
        "card_id": 1002,
        "rating": 4,
        "time_ms": 2000,
        "session_id": "s1",
        "review_uuid": "u2",
    }, headers=_auth())

    resp = client.get("/api/study/summary", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert data["reviewed_today"] >= 2
    assert data["reviewed_7d"] >= 2
    assert "boxes" in data
