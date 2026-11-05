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
    check_link_host,
    check_link_origin,
    link_hub,
)
from app.schemas_link import (
    LINK_PROTOCOL_VERSION,
    MAX_CUE_LIST_PAYLOAD_BYTES,
)

router = APIRouter(prefix="/api/link", tags=["link"])


@router.get("/status")
def get_link_status() -> Dict[str, Any]:
    """Returns connected extension count, desktop clients, and active video sessions."""
    return link_hub.get_status()


@router.websocket("/ws")
async def link_websocket_endpoint(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for Extension <-> Desktop link companion protocol.
    Enforces loopback host check (anti-DNS rebinding), origin policy,
    oversize frame guards, and 3-second authenticated hello handshake.
    """
    # 1. DNS rebinding check on Host header
    host = websocket.headers.get("host")
    if not check_link_host(host):
        await websocket.close(code=4401, reason="DNS rebinding rejected: invalid host")
        return

    # 2. Origin check
    origin = websocket.headers.get("origin")
    if not check_link_origin(origin):
        await websocket.close(code=4401, reason="Forbidden origin")
        return

    await websocket.accept()

    # 3. Enforce 3.0 second first-message handshake & frame limit
    try:
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=3.0)
        if len(first_raw.encode("utf-8")) > MAX_CUE_LIST_PAYLOAD_BYTES:
            await websocket.close(code=1009, reason="Oversize handshake frame")
            return
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

    # 4. Register client and send hello.ok
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

    # 5. If desk connected, replay active sessions
    if role == "desk":
        await link_hub.replay_to_desk(client)

    # 6. Message reception loop with oversize frame protection
    try:
        while True:
            text = await websocket.receive_text()
            if len(text.encode("utf-8")) > MAX_CUE_LIST_PAYLOAD_BYTES:
                await websocket.close(code=1009, reason="Oversize message frame")
                return
            try:
                data = json.loads(text)
            except Exception:
                continue
            await link_hub.handle_message(client, data)
    except WebSocketDisconnect:
        pass
    finally:
        link_hub.unregister_client(websocket)
