"""
Integration tests for Link Hub WebSocket and status endpoints (Slice 36).
Uses Starlette TestClient to test authentication, routing, replay, role rules, and rate limits.
"""
import json
import time
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.link.hub import link_hub
from app.schemas_link import LINK_PROTOCOL_VERSION


@pytest.fixture(autouse=True)
def clean_hub():
    """Resets in-memory hub sessions and clients between tests."""
    link_hub.sessions.clear()
    link_hub.clients.clear()
    yield
    link_hub.sessions.clear()
    link_hub.clients.clear()


def test_link_status_endpoint():
    client = TestClient(app)
    res = client.get("/api/link/status")
    assert res.status_code == 200
    data = res.json()
    assert "connected_ext" in data
    assert "desk_clients" in data
    assert "sessions" in data
    assert isinstance(data["sessions"], list)


def test_ws_origin_check_forbidden():
    client = TestClient(app)
    # Origin from untrusted foreign web origin
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/link/ws", headers={"origin": "http://malicious.evil.com"}) as ws:
            pass
    assert exc.value.code == 4401


def test_ws_handshake_unauthorized_token():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/link/ws", headers={"origin": "http://127.0.0.1"}) as ws:
            ws.send_text(json.dumps({
                "v": 1,
                "id": "m1",
                "ts": int(time.time() * 1000),
                "type": "hello",
                "src": "ext",
                "payload": {
                    "role": "ext",
                    "token": "bad-invalid-token",
                    "client": "test-ext"
                }
            }))
            ws.receive_text()
    assert exc.value.code == 4401


def test_ws_handshake_first_message_not_hello():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/link/ws", headers={"origin": "http://127.0.0.1"}) as ws:
            ws.send_text(json.dumps({
                "v": 1,
                "id": "m1",
                "ts": int(time.time() * 1000),
                "type": "video.state",
                "src": "ext",
                "payload": {"t": 1.0, "paused": True}
            }))
            ws.receive_text()
    assert exc.value.code == 4401


def test_ws_handshake_success_hello_ok():
    client = TestClient(app)
    with client.websocket_connect("/api/link/ws", headers={"origin": "http://127.0.0.1"}) as ws:
        ws.send_text(json.dumps({
            "v": 1,
            "id": "m1",
            "ts": int(time.time() * 1000),
            "type": "hello",
            "src": "desk",
            "payload": {
                "role": "desk",
                "token": "test-desktop-control-token",
                "client": "test-desk"
            }
        }))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "hello.ok"
        assert resp["src"] == "hub"
        assert resp["payload"]["sid"]
        assert resp["v"] == LINK_PROTOCOL_VERSION


def test_ws_routing_and_role_enforcement():
    client = TestClient(app)
    # Connect extension
    with client.websocket_connect("/api/link/ws", headers={"origin": "chrome-extension://allowed"}) as ws_ext:
        ws_ext.send_text(json.dumps({
            "v": 1,
            "id": "ext-hello",
            "ts": int(time.time() * 1000),
            "type": "hello",
            "src": "ext",
            "payload": {
                "role": "ext",
                "token": "test-link-rw-token",
                "client": "ext-1"
            }
        }))
        hello_ext = json.loads(ws_ext.receive_text())
        assert hello_ext["type"] == "hello.ok"

        # Connect desktop
        with client.websocket_connect("/api/link/ws", headers={"origin": "file://"}) as ws_desk:
            ws_desk.send_text(json.dumps({
                "v": 1,
                "id": "desk-hello",
                "ts": int(time.time() * 1000),
                "type": "hello",
                "src": "desk",
                "payload": {
                    "role": "desk",
                    "token": "test-desktop-control-token",
                    "client": "desk-1"
                }
            }))
            hello_desk = json.loads(ws_desk.receive_text())
            assert hello_desk["type"] == "hello.ok"

            # 1. Ext sends video.attach
            ws_ext.send_text(json.dumps({
                "v": 1,
                "id": "att-1",
                "ts": int(time.time() * 1000),
                "type": "video.attach",
                "src": "ext",
                "payload": {
                    "tab": 101,
                    "site": "youtube.com",
                    "title": "Anime Episode 1",
                    "duration": 1200.0,
                    "drm": False
                }
            }))
            desk_rec = json.loads(ws_desk.receive_text())
            assert desk_rec["type"] == "video.attach"
            assert desk_rec["payload"]["title"] == "Anime Episode 1"

            # Verify session was registered in status
            status_res = client.get("/api/link/status").json()
            assert status_res["connected_ext"] == 1
            assert status_res["desk_clients"] == 1
            assert len(status_res["sessions"]) == 1
            assert status_res["sessions"][0]["tab"] == 101

            # 2. Desk sends command cmd.play -> routed to ext
            ws_desk.send_text(json.dumps({
                "v": 1,
                "id": "cmd-1",
                "ts": int(time.time() * 1000),
                "type": "cmd.play",
                "src": "desk",
                "payload": {}
            }))
            ext_rec = json.loads(ws_ext.receive_text())
            assert ext_rec["type"] == "cmd.play"

            # 3. Role enforcement: ext sends cmd.pause -> must receive ack error
            ws_ext.send_text(json.dumps({
                "v": 1,
                "id": "illegal-cmd",
                "ts": int(time.time() * 1000),
                "type": "cmd.pause",
                "src": "ext",
                "payload": {}
            }))
            ext_err = json.loads(ws_ext.receive_text())
            assert ext_err["type"] == "ack"
            assert ext_err["payload"]["ok"] is False
            assert "Commands (cmd.*) can only be sent by 'desk'" in ext_err["payload"]["err"]


def test_ws_session_state_replay():
    client = TestClient(app)
    # Ext connects and sets up a session
    with client.websocket_connect("/api/link/ws", headers={"origin": "chrome-extension://allowed"}) as ws_ext:
        ws_ext.send_text(json.dumps({
            "v": 1,
            "id": "ext-1",
            "ts": int(time.time() * 1000),
            "type": "hello",
            "src": "ext",
            "payload": {
                "role": "ext",
                "token": "test-link-rw-token",
                "client": "ext-1"
            }
        }))
        assert json.loads(ws_ext.receive_text())["type"] == "hello.ok"

        # Attach video
        ws_ext.send_text(json.dumps({
            "v": 1,
            "id": "att-1",
            "ts": int(time.time() * 1000),
            "type": "video.attach",
            "src": "ext",
            "payload": {
                "tab": 202,
                "site": "crunchyroll.com",
                "title": "Demon Slayer",
                "duration": 1400.0,
                "drm": True
            }
        }))

        # Send state
        ws_ext.send_text(json.dumps({
            "v": 1,
            "id": "st-1",
            "ts": int(time.time() * 1000),
            "type": "video.state",
            "src": "ext",
            "payload": {
                "tab": 202,
                "t": 45.0,
                "paused": False,
                "rate": 1.0,
                "vol": 1.0,
                "muted": False
            }
        }))

        # Now a desktop client connects AFTER session exists
        with client.websocket_connect("/api/link/ws", headers={"origin": "file://"}) as ws_desk:
            ws_desk.send_text(json.dumps({
                "v": 1,
                "id": "desk-1",
                "ts": int(time.time() * 1000),
                "type": "hello",
                "src": "desk",
                "payload": {
                    "role": "desk",
                    "token": "test-desktop-control-token",
                    "client": "desk-1"
                }
            }))
            # First message is hello.ok
            assert json.loads(ws_desk.receive_text())["type"] == "hello.ok"
            # Replayed attach
            replayed_attach = json.loads(ws_desk.receive_text())
            assert replayed_attach["type"] == "video.attach"
            assert replayed_attach["payload"]["tab"] == 202
            # Replayed state
            replayed_state = json.loads(ws_desk.receive_text())
            assert replayed_state["type"] == "video.state"
            assert replayed_state["payload"]["t"] == 45.0


def test_ws_rate_limiting():
    client = TestClient(app)
    with client.websocket_connect("/api/link/ws", headers={"origin": "file://"}) as ws:
        ws.send_text(json.dumps({
            "v": 1,
            "id": "d1",
            "ts": int(time.time() * 1000),
            "type": "hello",
            "src": "desk",
            "payload": {
                "role": "desk",
                "token": "test-desktop-control-token",
                "client": "desk-1"
            }
        }))
        assert json.loads(ws.receive_text())["type"] == "hello.ok"

        # Flood 35 messages rapidly
        for i in range(35):
            ws.send_text(json.dumps({
                "v": 1,
                "id": f"flood-{i}",
                "ts": int(time.time() * 1000),
                "type": "cmd.toggle",
                "src": "desk",
                "payload": {}
            }))

        responses = []
        for _ in range(5):
            try:
                responses.append(json.loads(ws.receive_text()))
            except Exception:
                break

        # At least one rate limit ack should be returned
        assert any(
            r.get("type") == "ack" and r.get("payload", {}).get("ok") is False and "Rate limit" in r.get("payload", {}).get("err", "")
            for r in responses
        )
