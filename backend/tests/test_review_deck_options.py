from fastapi.testclient import TestClient
import pytest
from app.main import app
from app.db.connection import init_db

def test_bury_and_unbury_workflow(tmp_path, monkeypatch):
    test_db = tmp_path / "review_bury.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    # 1. Create a card
    res = client.post("/api/cards/save", json={
        "expression": "雨宿り",
        "reading": "あまやどり",
        "meaning": "taking shelter from rain"
    })
    assert res.status_code == 200
    card_id = res.json().get("id")

    # 2. Check card is in queue
    q_res = client.get("/api/review/queue")
    assert q_res.status_code == 200
    assert any(c["id"] == card_id for c in q_res.json()["cards"])

    # 3. Bury the card
    b_res = client.post("/api/review/bury", json={"card_id": card_id})
    assert b_res.status_code == 200
    assert b_res.json()["status"] == "ok"

    # 4. Card should now be omitted from queue
    q_res2 = client.get("/api/review/queue")
    assert not any(c["id"] == card_id for c in q_res2.json()["cards"])

    stats_res = client.get("/api/review/stats")
    assert stats_res.json().get("buried_count", 0) >= 1

    # 5. Unbury cards
    u_res = client.post("/api/review/unbury", json={})
    assert u_res.status_code == 200
    assert u_res.json()["status"] == "ok"

    # 6. Card should be back in queue
    q_res3 = client.get("/api/review/queue")
    assert any(c["id"] == card_id for c in q_res3.json()["cards"])

def test_suspend_and_unsuspend_workflow(tmp_path, monkeypatch):
    test_db = tmp_path / "review_suspend.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    res = client.post("/api/cards/save", json={
        "expression": "風情",
        "reading": "ふぜい",
        "meaning": "elegance, taste"
    })
    card_id = res.json().get("id")

    # Suspend
    s_res = client.post("/api/review/suspend", json={"card_id": card_id})
    assert s_res.status_code == 200
    assert s_res.json()["status"] == "ok"

    q_res = client.get("/api/review/queue")
    assert not any(c["id"] == card_id for c in q_res.json()["cards"])

    stats_res = client.get("/api/review/stats")
    assert stats_res.json().get("suspended_count", 0) >= 1

    # Unsuspend
    uns_res = client.post("/api/review/unsuspend", json={"card_id": card_id})
    assert uns_res.status_code == 200

    q_res2 = client.get("/api/review/queue")
    assert any(c["id"] == card_id for c in q_res2.json()["cards"])

def test_create_deck_and_list(tmp_path, monkeypatch):
    test_db = tmp_path / "review_deck.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    create_res = client.post("/api/review/decks/create", json={"deck_name": "Test Mock Deck"})
    assert create_res.status_code == 200
    assert create_res.json()["deck_name"] == "Test Mock Deck"

    list_res = client.get("/api/review/decks")
    assert list_res.status_code == 200
    assert "Test Mock Deck" in list_res.json()["decks"]

def test_undo_last_review(tmp_path, monkeypatch):
    test_db = tmp_path / "review_undo.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    res = client.post("/api/cards/save", json={
        "expression": "木漏れ日",
        "reading": "こもれび",
        "meaning": "sunlight through trees"
    })
    card_id = res.json().get("id")

    # Answer card with Good (3)
    client.post("/api/review/answer", json={"card_id": card_id, "rating": 3})

    stats_before = client.get("/api/review/stats").json()
    assert stats_before["new_done_today"] == 1 or stats_before["reviews_done_today"] == 1

    # Undo review
    undo_res = client.post("/api/review/undo", json={})
    assert undo_res.status_code == 200
    assert undo_res.json()["status"] == "ok"
    assert undo_res.json()["card_id"] == card_id

    stats_after = client.get("/api/review/stats").json()
    assert stats_after["new_done_today"] == 0 and stats_after["reviews_done_today"] == 0

def test_default_deck_omitted_when_empty_and_other_decks_exist(tmp_path, monkeypatch):
    test_db = tmp_path / "deck_filter.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)
    client = TestClient(app)

    # Add card specifically to N3 vocabs
    res = client.post("/api/cards/save", json={
        "expression": "名前",
        "reading": "なまえ",
        "meaning": "name",
        "deck_name": "N3 vocabs"
    })
    assert res.status_code == 200

    list_res = client.get("/api/review/decks")
    assert list_res.status_code == 200
    decks = list_res.json()["decks"]
    assert "N3 vocabs" in decks
    assert "Default" not in decks

def test_media_file_endpoint_serves_from_media_dir(tmp_path, monkeypatch):
    test_media = tmp_path / "media"
    test_media.mkdir(parents=True, exist_ok=True)
    sample_file = test_media / "ankiminer_img_test_123.jpg"
    sample_file.write_bytes(b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xDB")

    monkeypatch.setenv("KIROKU_MEDIA_DIR", str(test_media))
    client = TestClient(app)

    res = client.get("/api/media/ankiminer_img_test_123.jpg")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/jpeg")
    assert len(res.content) > 0

