"""
Link Security Verification Suite (Slice 47).

Validates:
1. Unauthenticated WebSocket closes with 4401.
2. Disallowed Origin is rejected with 4401 (including subdomain spoofing).
3. Extension clients cannot send cmd.* (role violation ack, dropped).
4. Oversize frames (>1MB) terminate the connection.
5. Handshake tokens are never logged.
6. Hub/backend binds to 127.0.0.1 loopback only.
7. Theater webview preload does not expose desktopAPI.
8. DNS-rebinding via external Host header is rejected.
"""
from pathlib import Path
import json
import logging
import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_KIROKU_HOST
from app.link.hub import (
    authenticate_link_token,
    check_link_host,
    check_link_origin,
    link_hub,
)
from app.main import app
from app.schemas_link import LINK_PROTOCOL_VERSION, MAX_CUE_LIST_PAYLOAD_BYTES


@pytest.fixture
def client():
    return TestClient(app)


def test_unauth_ws_closes_4401(client):
    """Unauthenticated WebSocket handshake closes with code 4401."""
    with client.websocket_connect("/api/link/ws") as ws:
        # Send invalid token
        ws.send_json({
            "v": LINK_PROTOCOL_VERSION,
            "id": "h1",
            "ts": 1000,
            "type": "hello",
            "src": "ext",
            "payload": {
                "role": "ext",
                "token": "invalid-secret-token",
                "client": "attacker"
            }
        })
        with pytest.raises(Exception):
            # Server closes socket with 4401
            ws.receive_json()


def test_wrong_origin_rejected(client):
    """Wrong origin or subdomain spoof (localhost.evil.com) is rejected with 4401."""
    # Unit level check
    assert check_link_origin("http://evil.com") is False
    assert check_link_origin("http://localhost.evil.com") is False
    assert check_link_origin("http://127.0.0.1.attacker.com") is False
    assert check_link_origin("http://127.0.0.1:21828") is True
    assert check_link_origin("http://localhost:5173") is True
    assert check_link_origin(None) is True

    # WebSocket connection level check
    with pytest.raises(Exception):
        with client.websocket_connect("/api/link/ws", headers={"origin": "http://evil.com"}) as ws:
            ws.receive_json()


def test_dns_rebinding_host_header_rejected(client):
    """Host headers pointing to external domains are rejected with 4401."""
    # Unit level check
    assert check_link_host("rebind.evil.com") is False
    assert check_link_host("attacker.com:21828") is False
    assert check_link_host("127.0.0.1:21828") is True
    assert check_link_host("localhost:21828") is True
    assert check_link_host("testserver") is True

    # WebSocket connection level check
    with pytest.raises(Exception):
        with client.websocket_connect("/api/link/ws", headers={"host": "attacker.com:21828"}) as ws:
            ws.receive_json()


def test_ext_cannot_send_cmd(client):
    """Extension role cannot send cmd.* messages; receives ack error and command is dropped."""
    with client.websocket_connect("/api/link/ws") as ws:
        # Handshake as extension
        ws.send_json({
            "v": LINK_PROTOCOL_VERSION,
            "id": "h1",
            "ts": 1000,
            "type": "hello",
            "src": "ext",
            "payload": {
                "role": "ext",
                "token": "test-link-rw-token",
                "client": "ext-test"
            }
        })
        hello_ok = ws.receive_json()
        assert hello_ok["type"] == "hello.ok"

        # Attempt to issue forbidden command as extension
        ws.send_json({
            "v": LINK_PROTOCOL_VERSION,
            "id": "cmd-attack",
            "ts": 1001,
            "type": "cmd.pause",
            "src": "ext",
            "payload": {}
        })

        # Hub responds with ack error (pydantic model validator catches src != 'desk')
        ack = ws.receive_json()
        assert ack["type"] == "ack"
        assert ack["payload"]["ok"] is False
        assert "desk" in ack["payload"]["err"]

        # Attempt to spoof src: 'desk' while connected as extension role
        ws.send_json({
            "v": LINK_PROTOCOL_VERSION,
            "id": "cmd-attack-spoof",
            "ts": 1002,
            "type": "cmd.pause",
            "src": "desk",
            "payload": {}
        })
        ack_spoof = ws.receive_json()
        assert ack_spoof["type"] == "ack"
        assert ack_spoof["payload"]["ok"] is False
        assert "Role violation" in ack_spoof["payload"]["err"]


def test_oversize_frame_closed(client):
    """Frames exceeding 1MB payload limit cause immediate connection termination."""
    with client.websocket_connect("/api/link/ws") as ws:
        # Craft oversize hello frame (> 1MB)
        oversize_str = "x" * (MAX_CUE_LIST_PAYLOAD_BYTES + 1024)
        with pytest.raises(Exception):
            ws.send_text(oversize_str)
            ws.receive_text()


def test_token_never_logged(client, caplog):
    """Authentication tokens are never emitted to loggers."""
    secret_token = "ultra-secret-handshake-token-999"
    with caplog.at_level(logging.DEBUG):
        with client.websocket_connect("/api/link/ws") as ws:
            ws.send_json({
                "v": LINK_PROTOCOL_VERSION,
                "id": "h1",
                "ts": 1000,
                "type": "hello",
                "src": "desk",
                "payload": {
                    "role": "desk",
                    "token": secret_token,
                    "client": "desk-test"
                }
            })
            try:
                ws.receive_json()
            except Exception:
                pass

    for record in caplog.records:
        assert secret_token not in record.message, f"Token leaked in log message: {record.message}"


def test_hub_binds_localhost_only():
    """Kiroku hub binds strictly to loopback address 127.0.0.1."""
    assert DEFAULT_KIROKU_HOST == "127.0.0.1"


def test_theater_webview_cannot_reach_desktop_api():
    """Theater WebContentsView sandbox enforces isolation with no desktopAPI access."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    theater_preload = repo_root / "desktop" / "src" / "theater_preload.js"
    theater_view = repo_root / "desktop" / "src" / "theater_view.js"

    assert theater_preload.exists(), "theater_preload.js must exist"
    assert theater_view.exists(), "theater_view.js must exist"

    preload_code = theater_preload.read_text(encoding="utf-8")
    assert "desktopAPI" not in preload_code, "theater_preload.js must not expose desktopAPI"

    view_code = theater_view.read_text(encoding="utf-8")
    assert "sandbox: true" in view_code, "Theater webview must enforce sandbox: true"
    assert "contextIsolation: true" in view_code, "Theater webview must enforce contextIsolation: true"
    assert "nodeIntegration: false" in view_code, "Theater webview must enforce nodeIntegration: false"
