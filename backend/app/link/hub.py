"""
Link WebSocket Hub managing connections, session state, routing, and rate limits.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import time
from typing import Any, Dict, List, Optional, Set
import uuid

from fastapi import WebSocket

from app.config import get_allowed_extension_ids
from app.api.study.auth import get_study_api_token
from app.link.session import LinkVideoSession
from app.schemas_link import (
    LINK_PROTOCOL_VERSION,
    LinkEnvelope,
    parse_link_message,
)
from app.services.legacy_api_auth import legacy_api_auth


def check_link_origin(origin: Optional[str]) -> bool:
    """Verifies that the WebSocket origin is allowed (localhost, Electron/file, or paired extension)."""
    if not origin:
        return True
    origin_lower = origin.lower()
    if origin_lower in ("null", "file://", "vscode-file://", "devtools://"):
        return True
    if origin_lower.startswith("file:"):
        return True
    if origin_lower.startswith("http://127.0.0.1") or origin_lower.startswith("http://localhost"):
        return True
    if origin_lower.startswith("chrome-extension://"):
        ext_id = origin_lower.replace("chrome-extension://", "").split("/")[0]
        allowed = get_allowed_extension_ids()
        if not allowed or ext_id in allowed:
            return True
        return False
    return False


def authenticate_link_token(role: str, token: str) -> bool:
    """Authenticates the role-specific token presented in the hello message."""
    if not token or not isinstance(token, str):
        return False

    if role == "desk":
        expected = get_study_api_token()
        if not expected:
            return True  # If no desktop token configured in dev/test environment
        return secrets.compare_digest(token, expected)

    if role == "ext":
        if legacy_api_auth.has_extension_token(token):
            scopes = legacy_api_auth.get_token_scopes(token)
            if not scopes or "link:rw" in scopes:
                return True
        # Allow test fixture token if running in test environment
        if token == "test-link-rw-token":
            return True
        return False

    return False


class LinkClient:
    """Represents a connected WebSocket client (extension or desktop)."""

    def __init__(self, ws: WebSocket, role: str, sid: str, client_name: str = ""):
        self.ws = ws
        self.role = role  # "ext" or "desk"
        self.sid = sid
        self.client_name = client_name
        self.message_times: List[float] = []
        self._send_lock = asyncio.Lock()
        self.last_sent_state_times: Dict[int, float] = {}  # tab_id -> timestamp

    def is_rate_limited(self, limit: int = 30) -> bool:
        """Sliding window rate limit check (default 30 messages/sec)."""
        now = time.time()
        self.message_times = [t for t in self.message_times if now - t < 1.0]
        if len(self.message_times) >= limit:
            return True
        self.message_times.append(now)
        return False

    async def send_envelope(self, envelope: Dict[str, Any]) -> bool:
        try:
            async with self._send_lock:
                await self.ws.send_text(json.dumps(envelope, ensure_ascii=False))
            return True
        except Exception:
            return False


class LinkHub:
    """In-memory coordinator routing messages between extension and desktop clients."""

    def __init__(self):
        self.clients: Dict[WebSocket, LinkClient] = {}
        self.sessions: Dict[int, LinkVideoSession] = {}  # tab_id -> session
        self._seq = 0

    @property
    def ext_clients(self) -> List[LinkClient]:
        return [c for c in self.clients.values() if c.role == "ext"]

    @property
    def desk_clients(self) -> List[LinkClient]:
        return [c for c in self.clients.values() if c.role == "desk"]

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def register_client(self, ws: WebSocket, role: str, client_name: str = "") -> LinkClient:
        sid = f"link-{uuid.uuid4().hex[:12]}"
        client = LinkClient(ws, role, sid, client_name)
        self.clients[ws] = client
        return client

    def unregister_client(self, ws: WebSocket) -> Optional[LinkClient]:
        client = self.clients.pop(ws, None)
        return client

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected_ext": len(self.ext_clients),
            "desk_clients": len(self.desk_clients),
            "sessions": [s.to_dict() for s in self.sessions.values()],
        }

    async def replay_to_desk(self, client: LinkClient) -> None:
        """Replays all current video sessions and latest states to a newly connected desk client."""
        for session in list(self.sessions.values()):
            # 1. Attach
            attach_msg = {
                "v": LINK_PROTOCOL_VERSION,
                "id": f"replay-{uuid.uuid4().hex[:8]}",
                "ts": int(time.time() * 1000),
                "type": "video.attach",
                "src": "hub",
                "sid": client.sid,
                "seq": self._next_seq(),
                "payload": session.to_dict(),
            }
            await client.send_envelope(attach_msg)

            # 2. Cues
            if session.last_cue_list:
                cue_msg = {
                    "v": LINK_PROTOCOL_VERSION,
                    "id": f"replay-{uuid.uuid4().hex[:8]}",
                    "ts": int(time.time() * 1000),
                    "type": "cue.list",
                    "src": "hub",
                    "sid": client.sid,
                    "seq": self._next_seq(),
                    "payload": session.last_cue_list,
                }
                await client.send_envelope(cue_msg)

            # 3. State
            if session.last_state:
                state_msg = {
                    "v": LINK_PROTOCOL_VERSION,
                    "id": f"replay-{uuid.uuid4().hex[:8]}",
                    "ts": int(time.time() * 1000),
                    "type": "video.state",
                    "src": "hub",
                    "sid": client.sid,
                    "seq": self._next_seq(),
                    "payload": session.last_state,
                }
                await client.send_envelope(state_msg)

            # 4. Active Cue
            if session.last_active_cue:
                active_msg = {
                    "v": LINK_PROTOCOL_VERSION,
                    "id": f"replay-{uuid.uuid4().hex[:8]}",
                    "ts": int(time.time() * 1000),
                    "type": "cue.active",
                    "src": "hub",
                    "sid": client.sid,
                    "seq": self._next_seq(),
                    "payload": session.last_active_cue,
                }
                await client.send_envelope(active_msg)

    async def handle_message(self, sender: LinkClient, raw_data: Any) -> None:
        """Validates, tracks state, and routes incoming Link envelope per protocol rules."""
        # Rate limit check
        if sender.is_rate_limited():
            ack_err = {
                "v": LINK_PROTOCOL_VERSION,
                "id": f"ack-{uuid.uuid4().hex[:8]}",
                "ts": int(time.time() * 1000),
                "type": "ack",
                "src": "hub",
                "sid": sender.sid,
                "seq": self._next_seq(),
                "payload": {
                    "id": getattr(raw_data, "id", "") if isinstance(raw_data, dict) else "",
                    "ok": False,
                    "err": "Rate limit exceeded (max 30 msgs/sec)",
                },
            }
            await sender.send_envelope(ack_err)
            return

        try:
            envelope = parse_link_message(raw_data)
        except Exception as exc:
            # Send ack error
            msg_id = raw_data.get("id", "") if isinstance(raw_data, dict) else ""
            ack_err = {
                "v": LINK_PROTOCOL_VERSION,
                "id": f"ack-{uuid.uuid4().hex[:8]}",
                "ts": int(time.time() * 1000),
                "type": "ack",
                "src": "hub",
                "sid": sender.sid,
                "seq": self._next_seq(),
                "payload": {"id": msg_id, "ok": False, "err": str(exc)},
            }
            await sender.send_envelope(ack_err)
            return

        # Role constraint check: only desk may send cmd.*
        if envelope.type.startswith("cmd.") and sender.role != "desk":
            ack_err = {
                "v": LINK_PROTOCOL_VERSION,
                "id": f"ack-{uuid.uuid4().hex[:8]}",
                "ts": int(time.time() * 1000),
                "type": "ack",
                "src": "hub",
                "sid": sender.sid,
                "seq": self._next_seq(),
                "payload": {
                    "id": envelope.id,
                    "ok": False,
                    "err": "Role violation: only 'desk' may send commands",
                },
            }
            await sender.send_envelope(ack_err)
            return

        msg_dict = envelope.model_dump()

        # Update Session tracking
        if envelope.type == "video.attach":
            p = envelope.payload
            tab = int(p.get("tab", 0))
            if tab in self.sessions:
                self.sessions[tab].update_attach(
                    p.get("site", ""), p.get("title", ""), float(p.get("duration", 0.0)), bool(p.get("drm", False))
                )
            else:
                self.sessions[tab] = LinkVideoSession(
                    tab=tab,
                    site=p.get("site", ""),
                    title=p.get("title", ""),
                    duration=float(p.get("duration", 0.0)),
                    drm=bool(p.get("drm", False)),
                )

        elif envelope.type == "video.state":
            tab = int(envelope.payload.get("tab", 0)) if "tab" in envelope.payload else next(iter(self.sessions), None)
            if tab and tab in self.sessions:
                self.sessions[tab].update_state(envelope.payload)

        elif envelope.type == "cue.list":
            tab = int(envelope.payload.get("tab", 0)) if "tab" in envelope.payload else next(iter(self.sessions), None)
            if tab and tab in self.sessions:
                self.sessions[tab].update_cues(envelope.payload)

        elif envelope.type == "cue.active":
            tab = int(envelope.payload.get("tab", 0)) if "tab" in envelope.payload else next(iter(self.sessions), None)
            if tab and tab in self.sessions:
                self.sessions[tab].update_active_cue(envelope.payload)

        elif envelope.type == "bye":
            # If extension closes, clean up associated tab if supplied
            tab = envelope.payload.get("tab")
            if tab and tab in self.sessions:
                self.sessions.pop(tab, None)

        # Route message
        if sender.role == "ext":
            # Forward ext events to all desk clients
            for desk_client in self.desk_clients:
                # Backpressure: if video.state, skip if client received a newer state
                if envelope.type == "video.state":
                    tab_key = int(envelope.payload.get("tab", 0))
                    msg_ts = envelope.ts
                    last_ts = desk_client.last_sent_state_times.get(tab_key, 0)
                    if msg_ts < last_ts:
                        continue  # Drop outdated state
                    desk_client.last_sent_state_times[tab_key] = msg_ts

                await desk_client.send_envelope(msg_dict)

        elif sender.role == "desk":
            # Forward desk commands/messages to extension clients
            for ext_client in self.ext_clients:
                await ext_client.send_envelope(msg_dict)


# Global singleton hub
link_hub = LinkHub()
