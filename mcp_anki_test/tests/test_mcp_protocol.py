"""
test_mcp_protocol.py -- MCP protocol compliance tests for the decoupled ingestion server.
Verifies initialize, tools/list, tools/call wire format, and queue ingestion.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TOKEN = os.environ.get("MCP_SECRET", "test-secret-abc123")
AUTH = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

import queue_db as qdb
import server


@pytest.fixture()
def client(tmp_path: Path):
    qdb._DEFAULT_DB_PATH = tmp_path / "proto_test.db"
    qdb.init_queue()
    os.environ["QUEUE_BACKEND"] = "local"
    os.environ["MCP_SECRET"] = TOKEN
    server.MCP_SECRET = TOKEN
    with TestClient(server.app, raise_server_exceptions=False) as c:
        yield c



def post(client, body: dict):
    return client.post("/mcp", json=body, headers=AUTH)


# --- initialize ---

def test_initialize_returns_protocol_version(client):
    r = post(client, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert r.status_code == 200
    body = r.json()
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == 1
    result = body["result"]
    assert "protocolVersion" in result
    assert "serverInfo" in result
    assert result["serverInfo"]["name"] == "kiroku-anki-mcp"


# --- tools/list ---

def test_tools_list_returns_send_vocab_card(client):
    r = post(client, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert r.status_code == 200
    tools = r.json()["result"]["tools"]
    names = [t["name"] for t in tools]
    assert "send_vocab_card" in names


def test_tools_list_schema_has_required_fields(client):
    r = post(client, {"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
    tool = r.json()["result"]["tools"][0]
    schema = tool["inputSchema"]
    assert schema["type"] == "object"
    props = schema["properties"]
    assert "expression" in props
    assert "reading" in props
    assert "meaning" in props
    assert "sentence" in props
    assert "expression" in schema["required"]
    assert "meaning" in schema["required"]
    assert "sentence" not in schema["required"]


# --- tools/call ---

def test_tools_call_enqueues_valid_card(client):
    r = post(client, {
        "jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {
                "expression": "映画",
                "reading": "えいが",
                "meaning": "movie",
                "sentence": "映画館で見た",
            },
        },
    })
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is False
    content_text = result["content"][0]["text"]
    payload = json.loads(content_text)
    assert payload["status"] == "queued"
    assert "queue_id" in payload
    assert payload["expression"] == "映画"

    # Verify card is present in queue
    pending = qdb.list_pending()
    assert any(p["expression"] == "映画" and p["meaning"] == "movie" for p in pending)


def test_tools_call_uses_n3_vocabs_default_and_allows_override(client):
    # Call without deck_name -> defaults to "N3 vocabs"
    r1 = post(client, {
        "jsonrpc": "2.0", "id": 40, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {"expression": "勉強", "reading": "べんきょう", "meaning": "study"},
        },
    })
    assert r1.status_code == 200
    pending1 = qdb.list_pending()
    benkyo = next(p for p in pending1 if p["expression"] == "勉強")
    assert benkyo["deck_name"] == "N3 vocabs"

    # Call with explicit deck_name override -> uses provided deck
    r2 = post(client, {
        "jsonrpc": "2.0", "id": 41, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {
                "expression": "宿題",
                "reading": "しゅくだい",
                "meaning": "homework",
                "deck_name": "Custom Deck",
            },
        },
    })
    assert r2.status_code == 200
    pending2 = qdb.list_pending()
    shukudai = next(p for p in pending2 if p["expression"] == "宿題")
    assert shukudai["deck_name"] == "Custom Deck"


def test_tools_call_missing_expression_returns_error(client):
    r = post(client, {
        "jsonrpc": "2.0", "id": 5, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {"reading": "えいが", "meaning": "movie"},
        },
    })
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is True
    payload = json.loads(result["content"][0]["text"])
    assert payload["status"] == "error"
    assert "expression" in payload["message"]


def test_tools_call_missing_meaning_returns_error(client):
    r = post(client, {
        "jsonrpc": "2.0", "id": 6, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {"expression": "本", "reading": "ほん"},
        },
    })
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is True
    payload = json.loads(result["content"][0]["text"])
    assert payload["status"] == "error"
    assert "meaning" in payload["message"]


def test_tools_call_cloud_unconfigured_returns_informative_error(client, monkeypatch):
    monkeypatch.setenv("QUEUE_BACKEND", "cloud")
    monkeypatch.delenv("CLOUD_QUEUE_URL", raising=False)
    monkeypatch.delenv("CLOUD_QUEUE_API_KEY", raising=False)

    r = post(client, {
        "jsonrpc": "2.0", "id": 7, "method": "tools/call",
        "params": {
            "name": "send_vocab_card",
            "arguments": {"expression": "空", "reading": "そら", "meaning": "sky"},
        },
    })
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["isError"] is True
    payload = json.loads(result["content"][0]["text"])
    assert payload["status"] == "error"
    assert "Cloud queue is not configured" in payload["message"]


def test_unknown_tool_returns_method_not_found(client):
    r = post(client, {
        "jsonrpc": "2.0", "id": 8, "method": "tools/call",
        "params": {"name": "nonexistent_tool", "arguments": {}},
    })
    data = r.json()
    assert "error" in data
    assert data["error"]["code"] == -32601


def test_unknown_method_returns_method_not_found(client):
    r = post(client, {"jsonrpc": "2.0", "id": 9, "method": "foo/bar"})
    data = r.json()
    assert "error" in data
    assert data["error"]["code"] == -32601


def test_notifications_initialized_returns_empty(client):
    r = post(client, {"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert r.status_code == 200
    data = r.json()
    assert "error" not in data
