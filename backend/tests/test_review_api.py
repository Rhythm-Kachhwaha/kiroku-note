from fastapi.testclient import TestClient
import pytest
from app.main import app
from app.db.connection import init_db

def test_settings_and_sync_endpoints(tmp_path, monkeypatch):
    test_db = tmp_path / "review_api.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)
    
    # Check settings endpoint
    res = client.get("/api/review/settings")
    assert res.status_code == 200
    data = res.json()
    assert "values" in data
    assert "explanations" in data
    assert "easy_initial_cap_days" in data["values"]
    assert data["values"]["easy_initial_cap_days"] == 6

    # Update settings
    put_res = client.put("/api/review/settings", json={
        "easy_initial_cap_days": 7,
        "new_cards_per_day": 30
    })
    assert put_res.status_code == 200
    updated_data = put_res.json()
    assert updated_data["values"]["easy_initial_cap_days"] == 7
    assert updated_data["values"]["new_cards_per_day"] == 30

    # Boost limits
    boost_res = client.post("/api/review/boost-limits", json={"add_new": 10, "add_reviews": 20})
    assert boost_res.status_code == 200
    assert boost_res.json()["extra_new_today"] == 10
    assert boost_res.json()["extra_reviews_today"] == 20

    # Get stats
    stats_res = client.get("/api/review/stats")
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert "cards_due_today" in stats
    assert "streak_days" in stats

def test_queue_and_answer_workflow(tmp_path, monkeypatch):
    test_db = tmp_path / "review_queue.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    # Save a card first
    card_res = client.post("/api/cards/save", json={
        "expression": "夕焼け",
        "reading": "ゆうやけ",
        "meaning": "sunset, afterglow"
    })
    assert card_res.status_code == 200
    card_id = card_res.json().get("id") or card_res.json().get("card", {}).get("id")

    # Queue should have this new card
    queue_res = client.get("/api/review/queue")
    assert queue_res.status_code == 200
    cards = queue_res.json()["cards"]
    assert len(cards) >= 1
    target = next((c for c in cards if c["id"] == card_id), None)
    assert target is not None
    assert "intervals" in target
    assert target["intervals"]["easy"] == "6d"

    # Answer card with Easy (4)
    ans_res = client.post("/api/review/answer", json={
        "card_id": card_id,
        "rating": 4,
        "duration_ms": 1500
    })
    assert ans_res.status_code == 200
    ans_data = ans_res.json()
    assert ans_data["status"] == "ok"
    assert ans_data["record"]["scheduled_days"] == 6
