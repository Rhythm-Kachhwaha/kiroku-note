"""
Link WebSocket and Status API endpoints.
Provides loopback communication between browser extension and desktop companion.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse

from app.link.hub import (
    authenticate_link_token,
    check_link_origin,
    link_hub,
)
from app.schemas_link import LINK_PROTOCOL_VERSION

router = APIRouter(prefix="/api/link", tags=["link"])


@router.get("/status")
def get_link_status() -> Dict[str, Any]:
    """Returns connected extension count, desktop clients, and active video sessions."""
    return link_hub.get_status()


@router.websocket("/ws")
async def link_websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for Extension <-> Desktop link companion protocol.
    Enforces origin policy and 3-second authenticated hello handshake.
    """
    origin = websocket.headers.get("origin")
    if not check_link_origin(origin):
        await websocket.close(code=4401, reason="Forbidden origin")
        return

    await websocket.accept()

    # 1. Enforce 3.0 second first-message handshake
    try:
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=3.0)
        first_msg = json.loads(first_raw)
    except Exception:
        await websocket.close(code=4401, reason="Handshake timeout or invalid payload")
        return

    if not isinstance(first_msg, dict) or first_msg.get("type") != "hello":
        await websocket.close(code=4401, reason="First message must be hello")
        return

    payload = first_msg.get("payload")
    if not isinstance(payload, dict):
        await websocket.close(code=4401, reason="Missing hello payload")
        return

    role = payload.get("role")
    token = payload.get("token")
    client_name = payload.get("client", "")

    if role not in ("ext", "desk") or not authenticate_link_token(role, token):
        await websocket.close(code=4401, reason="Unauthorized token or role")
        return

    # 2. Register client and send hello.ok
    client = link_hub.register_client(websocket, role, client_name)
    hello_ok = {
        "v": LINK_PROTOCOL_VERSION,
        "id": f"msg-{uuid.uuid4().hex[:8]}",
        "ts": int(time.time() * 1000),
        "type": "hello.ok",
        "src": "hub",
        "sid": client.sid,
        "seq": 0,
        "payload": {"sid": client.sid},
    }
    await client.send_envelope(hello_ok)

    # 3. If desk connected, replay active sessions
    if role == "desk":
        await link_hub.replay_to_desk(client)

    # 4. Message reception loop
    try:
        while True:
            text = await websocket.receive_text()
            try:
                data = json.loads(text)
            except Exception:
                continue
            await link_hub.handle_message(client, data)
    except WebSocketDisconnect:
        pass
    finally:
        link_hub.unregister_client(websocket)
