"""
test_auth.py -- Authentication middleware tests for the MCP server.
Uses FastAPI TestClient (no real HTTP).
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

# Set a known secret before importing the server module
os.environ["MCP_SECRET"] = "test-secret-abc123"
os.environ["KIROKU_URL"] = "http://127.0.0.1:19999"  # deliberate wrong port

import server  # noqa: E402 -- must import after env vars are set


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Point queue to temp db so tests don't interfere
    import queue_db as qdb
    qdb._DEFAULT_DB_PATH = tmp_path / "test_mcp.db"
    qdb.init_queue()
    monkeypatch.setenv("MCP_SECRET", "test-secret-abc123")
    server.MCP_SECRET = "test-secret-abc123"
    with TestClient(server.app, raise_server_exceptions=False) as c:
        yield c


def _post(client, body: dict, token: str | None = "test-secret-abc123"):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.post("/mcp", json=body, headers=headers)


def test_missing_token_returns_401(client):
    r = _post(client, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, token=None)
    assert r.status_code == 401


def test_wrong_token_returns_401(client):
    r = _post(client, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, token="wrong-token")
    assert r.status_code == 401


def test_correct_token_returns_200(client):
    r = _post(client, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 200


def test_health_endpoint_requires_no_auth(client):
    # /health must not require auth (used by ngrok health checks)
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert "status" in data
    assert data["status"] == "ok"


def test_malformed_json_returns_error(client):
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-secret-abc123",
    }
    r = client.post("/mcp", content=b"not-json", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert "error" in data
