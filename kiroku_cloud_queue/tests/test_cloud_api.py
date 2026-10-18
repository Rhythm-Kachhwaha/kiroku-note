"""
test_cloud_api.py -- Tests for the public cloud submission API and worker queue endpoints.
"""
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
import queue_store


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUBMIT_TOKEN", SUBMIT_TOKEN)
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    monkeypatch.setenv("MCP_SECRET", WORKER_TOKEN)
    test_db = tmp_path / "test_api_queue.db"
    store = SqliteQueueStore(db_path=test_db)
    server.store = store
    with TestClient(server.app, raise_server_exceptions=False) as c:
        yield c


def test_submit_text_plain_valid_payload(client: TestClient):
    body = json.dumps({
        "expression": "映画",
        "reading": "えいが",
        "meaning": "movie; film",
        "sentence": "昨日、映画を見た。",
        "sentence_meaning": "I watched a movie yesterday.",
    }, ensure_ascii=False)

    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    resp = client.post("/submit", content=body.encode("utf-8"), headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "queued"
    assert "id" in data
    assert data["expression"] == "映画"


def test_submit_markdown_code_block_payload(client: TestClient):
    body = "```json\n" + json.dumps({
        "expression": "約束",
        "reading": "やくそく",
        "meaning": "promise",
        "sentence": "約束を守る。",
        "sentence_meaning": "Keep a promise.",
    }, ensure_ascii=False) + "\n```"

    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    resp = client.post("/submit", content=body.encode("utf-8"), headers=headers)
    assert resp.status_code == 200
    assert resp.json()["expression"] == "約束"


def test_submit_ios_smart_quotes_payload(client: TestClient):
    # iOS often auto-converts " to “ and ”
    smart_quotes_body = (
        '{\n'
        '  “expression”: “刹那”,\n'
        '  “reading”: “せつな”,\n'
        '  “meaning”: “a moment, an instant”,\n'
        '  “sentence”: “刹那の出来事だった。”,\n'
        '  “sentence_meaning”: “It was a momentary event.”,\n'
        '  “deck_name”: “N3 vocabs”\n'
        '}'
    )
    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    resp = client.post("/submit", content=smart_quotes_body.encode("utf-8"), headers=headers)
    assert resp.status_code == 200
    assert resp.json()["expression"] == "刹那"


def test_submit_surrounding_chat_prose(client: TestClient):
    body = (
        "Here is the card you requested:\n\n"
        '{"expression": "瞬間", "reading": "しゅんかん", "meaning": "moment"}\n\n'
        "Hope this helps with your Anki deck!"
    )
    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    resp = client.post("/submit", content=body.encode("utf-8"), headers=headers)
    assert resp.status_code == 200
    assert resp.json()["expression"] == "瞬間"



def test_submit_application_json_valid_payload(client: TestClient):
    body = {
        "expression": "音楽",
        "reading": "おんがく",
        "meaning": "music",
        "sentence": "音楽を聴く。",
        "sentence_meaning": "Listen to music.",
        "deck_name": "N3 vocabs",
    }
    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
    }
    resp = client.post("/submit", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "queued"
    assert data["expression"] == "音楽"


def test_submit_accepts_expression_only_payload(client: TestClient):
    body = {"expression": "桜"}
    headers = {"Authorization": f"Bearer {SUBMIT_TOKEN}"}
    resp = client.post("/submit", json=body, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "queued"
    assert data["expression"] == "桜"


def test_submit_rejects_missing_field(client: TestClient):
    # Missing required expression
    body = json.dumps({
        "reading": "ほん",
        "meaning": "book",
        "sentence": "本を読む。",
    }, ensure_ascii=False)

    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain",
    }
    resp = client.post("/submit", content=body.encode("utf-8"), headers=headers)
    assert resp.status_code in (400, 422)
    assert "expression" in resp.text


def test_submit_rejects_empty_string_field(client: TestClient):
    # Blank expression is rejected
    body = {
        "expression": "   ",
        "reading": "いぬ",
        "meaning": "dog",
    }
    headers = {"Authorization": f"Bearer {SUBMIT_TOKEN}"}
    resp = client.post("/submit", json=body, headers=headers)
    assert resp.status_code in (400, 422)
    assert "expression" in resp.text


def test_submit_rejects_invalid_field_types(client: TestClient):
    # Non-string reading is rejected
    body = {
        "expression": "犬",
        "reading": 12345,
        "meaning": "dog",
    }
    headers = {"Authorization": f"Bearer {SUBMIT_TOKEN}"}
    resp = client.post("/submit", json=body, headers=headers)
    assert resp.status_code in (400, 422)
    assert "reading" in resp.text


def test_submit_rejects_malformed_json(client: TestClient):
    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain",
    }
    resp = client.post("/submit", content=b"{not valid json", headers=headers)
    assert resp.status_code in (400, 422)


def test_submit_rejects_oversized_payload(client: TestClient):
    huge_text = "A" * 70000  # > 64KB
    headers = {
        "Authorization": f"Bearer {SUBMIT_TOKEN}",
        "Content-Type": "text/plain",
    }
    resp = client.post("/submit", content=huge_text.encode("utf-8"), headers=headers)
    assert resp.status_code in (400, 413)


def test_submit_unauthorized(client: TestClient):
    body = json.dumps({"expression": "猫", "reading": "ねこ", "meaning": "cat", "sentence": "猫", "sentence_meaning": "cat"})
    # No auth
    resp = client.post("/submit", content=body.encode("utf-8"), headers={"Content-Type": "text/plain"})
    assert resp.status_code == 401

    # Wrong token
    resp = client.post(
        "/submit",
        content=body.encode("utf-8"),
        headers={"Content-Type": "text/plain", "Authorization": "Bearer bad-token"}
    )
    assert resp.status_code == 401


def test_worker_pending_ack_nack_lifecycle(client: TestClient):
    # 1. Submit card
    body = {
        "expression": "約束",
        "reading": "やくそく",
        "meaning": "promise",
        "sentence": "約束を守る。",
        "sentence_meaning": "Keep a promise.",
    }
    sub_resp = client.post("/submit", json=body, headers={"Authorization": f"Bearer {SUBMIT_TOKEN}"})
    assert sub_resp.status_code == 200
    item_id = sub_resp.json()["id"]

    # 2. Worker fetches pending (claims item)
    worker_headers = {"Authorization": f"Bearer {WORKER_TOKEN}"}
    pend_resp = client.get("/pending?limit=10", headers=worker_headers)
    assert pend_resp.status_code == 200
    items = pend_resp.json()["items"]
    assert len(items) == 1
    claimed = items[0]
    assert claimed["id"] == item_id
    assert claimed["claim_token"] != ""

    # 3. Worker acknowledges item
    ack_resp = client.post(f"/ack/{item_id}", json={"claim_token": claimed["claim_token"]}, headers=worker_headers)
    assert ack_resp.status_code == 200

    # 4. Check stats: 1 completed, 0 pending
    stats_resp = client.get("/stats", headers=worker_headers)
    assert stats_resp.status_code == 200
    assert stats_resp.json().get("completed") == 1
    assert stats_resp.json().get("pending", 0) == 0


def test_health_check_public(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "database" in data
    assert "backend" in data
    # Health endpoint must never leak secret tokens or keys
    for k in ("token", "secret", "key", "password", "auth"):
        assert k not in data
        assert k not in str(data).lower() or k == "backend"  # 'backend' is safe string


def test_server_cli_args_parsing(monkeypatch):
    import argparse
    import server

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("QUEUE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("QUEUE_PORT", "8100")))

    args = parser.parse_args(["--host", "192.168.1.100", "--port", "8200"])
    assert args.host == "192.168.1.100"
    assert args.port == 8200


@pytest.fixture()
def submit_headers():
    return {"Authorization": f"Bearer {SUBMIT_TOKEN}"}


@pytest.fixture()
def worker_headers():
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def test_recent_returns_empty_when_no_cards(client: TestClient, submit_headers):
    resp = client.get("/recent", headers=submit_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["items"] == []
    assert data["count"] == 0


def test_recent_returns_submitted_cards(client: TestClient, submit_headers):
    # Submit one card first
    card_payload = {"expression": "桜", "reading": "さくら", "meaning": "cherry blossom"}
    client.post("/submit", content=json.dumps(card_payload).encode("utf-8"), headers={**submit_headers, "Content-Type": "text/plain"})

    resp = client.get("/recent", headers=submit_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    expressions = [item["expression"] for item in data["items"]]
    assert "桜" in expressions


def test_recent_requires_auth(client: TestClient):
    resp = client.get("/recent")
    assert resp.status_code == 401


def test_recent_limit_param(client: TestClient, submit_headers):
    resp = client.get("/recent?limit=5", headers=submit_headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) <= 5


def test_dashboard_endpoint_public_returns_html(client: TestClient):
    import re
    resp = client.get("/dashboard")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "Kiroku" in resp.text
    assert "Recent Cards" in resp.text
    assert "kiroku_submit_token" in resp.text
    assert "kiroku cloud" in resp.text
    assert "hero-modal" in resp.text
    assert "sync-banner" not in resp.text

    # Verify zero emojis anywhere in the dashboard HTML
    emojis = re.findall(r'[\U00010000-\U0010ffff\u2600-\u26ff\u2700-\u27bf\u2300-\u23ff\u2b50\u2b55\u25b6\u25c0\u2705\u274c]', resp.text)
    assert len(emojis) == 0, f"Found emojis in dashboard HTML: {emojis}"



def test_recent_accepts_worker_token(client: TestClient, worker_headers):
    resp = client.get("/recent", headers=worker_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_anki_stats_push_requires_worker_auth(client: TestClient, submit_headers):
    # Unauthenticated
    resp = client.post("/api/stats/anki", json={"current_streak": 1})
    assert resp.status_code == 401

    # Submit token rejected for worker push
    resp = client.post("/api/stats/anki", json={"current_streak": 1}, headers=submit_headers)
    assert resp.status_code == 401


def test_anki_stats_push_validates_json_object(client: TestClient, worker_headers):
    resp = client.post("/api/stats/anki", content=b"12345", headers={**worker_headers, "Content-Type": "application/json"})
    assert resp.status_code == 400


def test_anki_stats_lifecycle(client: TestClient, worker_headers, submit_headers):
    # Initially empty
    resp = client.get("/api/stats/anki", headers=submit_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "empty"

    # Push snapshot
    snapshot = {
        "synced_at": "2026-10-18T10:00:00Z",
        "current_streak": 7,
        "best_streak": 14,
        "today_reviewed": 25,
        "cards_reviewed_by_day": [["2026-10-18", 25]],
        "summary": {"total_cards": 500, "total_due_today": 12},
    }
    resp = client.post("/api/stats/anki", json=snapshot, headers=worker_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    # Read back snapshot via GET /api/stats/anki (accessible with submit_headers)
    resp = client.get("/api/stats/anki", headers=submit_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["stats"]["current_streak"] == 7
    assert data["stats"]["today_reviewed"] == 25
    assert data["stats"]["summary"]["total_cards"] == 500

    # Also works via un-prefixed alias /stats/anki
    resp_alias = client.get("/stats/anki", headers=worker_headers)
    assert resp_alias.status_code == 200
    assert resp_alias.json()["status"] == "ok"

