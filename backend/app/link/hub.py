"""
Link WebSocket Hub managing connections, session state, routing, and rate limits.
"""
from __future__ import annotations

import asyncio
import json
import re
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


def check_link_host(host: Optional[str]) -> bool:
    """
    Prevents DNS-rebinding attacks by validating the HTTP/WS Host header.
    Only strictly allows loopback interfaces (127.0.0.1, localhost, [::1])
    and test runners (testserver).
    """
    if not host:
        return True
    host_clean = host.strip().lower()
    # Strip optional port number
    if host_clean.startswith("[") and "]" in host_clean:
        hostname = host_clean.split("]")[0] + "]"
    else:
        hostname = host_clean.split(":")[0]

    return hostname in ("127.0.0.1", "localhost", "::1", "[::1]", "testserver")


def check_link_origin(origin: Optional[str]) -> bool:
    """
    Verifies that the WebSocket origin is strictly allowed (localhost, Electron/file, or paired extension).
    Uses strict regex matching to prevent subdomains like http://localhost.evil.com.
    """
    if not origin:
        return True
    origin_lower = origin.lower().strip()
    if origin_lower in ("null", "file://", "vscode-file://", "devtools://"):
        return True
    if origin_lower.startswith("file:"):
        return True

    # Strict loopback origin match (with optional port)
    if re.match(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", origin_lower):
        return True

    # Extension origin check
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
            # D2: Ext token accepted if scopes contain 'link:rw' OR 'legacy:write' (or default empty)
            if not scopes or "link:rw" in scopes or "legacy:write" in scopes:
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


class SessionDict(dict):
    """
    Session storage mapping (ext_sid, tab, frame) -> LinkVideoSession,
    while supporting integer tab lookup/containment for backwards compatibility with tests.
    """
    def __contains__(self, key: Any) -> bool:
        if super().__contains__(key):
            return True
        if isinstance(key, int):
            return any(isinstance(k, tuple) and len(k) == 3 and k[1] == key for k in self.keys())
        return False

    def __getitem__(self, key: Any) -> Any:
        if super().__contains__(key):
            return super().__getitem__(key)
        if isinstance(key, int):
            for k, v in self.items():
                if isinstance(k, tuple) and len(k) == 3 and k[1] == key:
                    return v
        raise KeyError(key)

    def pop(self, key: Any, default: Any = None) -> Any:
        if super().__contains__(key):
            return super().pop(key, default)
        if isinstance(key, int):
            found_key = None
            for k in list(self.keys()):
                if isinstance(k, tuple) and len(k) == 3 and k[1] == key:
                    found_key = k
                    break
            if found_key is not None:
                return super().pop(found_key, default)
        return default


class LinkHub:
    """In-memory coordinator routing messages between extension and desktop clients."""

    def __init__(self):
        self.clients: Dict[WebSocket, LinkClient] = {}
        # Keyed by (ext_sid, tab, frame), supports integer tab compatibility via SessionDict
        self.sessions: SessionDict = SessionDict()
        self._seq = 0
        self.last_reject: Optional[Dict[str, Any]] = None

    def record_reject(self, role: str, reason: str, origin: Optional[str] = None) -> None:
        """Records the latest handshake rejection reason without storing the token."""
        self.last_reject = {
            "role": role,
            "reason": reason,
            "origin": origin or "",
            "ts": int(time.time() * 1000),
        }

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

    async def disconnect_ext_clients(self, reason: str = "Pairings revoked") -> int:
        """Terminates active WebSocket connections for all paired extension clients."""
        count = 0
        for client in list(self.ext_clients):
            try:
                await client.ws.close(code=4401, reason=reason)
                count += 1
            except Exception:
                pass
        return count

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected_ext": len(self.ext_clients),
            "desk_clients": len(self.desk_clients),
            "sessions": [s.to_dict() for s in self.sessions.values()],
            "last_reject": self.last_reject,
        }

    async def broadcast_peer_status(self) -> None:
        """Broadcasts current peer counts to all connected desk clients."""
        peer_msg = {
            "v": LINK_PROTOCOL_VERSION,
            "id": f"peer-{uuid.uuid4().hex[:8]}",
            "ts": int(time.time() * 1000),
            "type": "peer.status",
            "src": "hub",
            "seq": self._next_seq(),
            "payload": {
                "ext": len(self.ext_clients),
                "desk": len(self.desk_clients),
            },
        }
        for c in list(self.desk_clients):
            await c.send_envelope(peer_msg)

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
            for cue_payload in session.get_all_cue_payloads():
                cue_msg = {
                    "v": LINK_PROTOCOL_VERSION,
                    "id": f"replay-{uuid.uuid4().hex[:8]}",
                    "ts": int(time.time() * 1000),
                    "type": "cue.list",
                    "src": "hub",
                    "sid": client.sid,
                    "seq": self._next_seq(),
                    "payload": cue_payload,
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

            # 5. Sub Status
            if session.last_sub_status:
                sub_msg = {
                    "v": LINK_PROTOCOL_VERSION,
                    "id": f"replay-{uuid.uuid4().hex[:8]}",
                    "ts": int(time.time() * 1000),
                    "type": "sub.status",
                    "src": "hub",
                    "sid": client.sid,
                    "seq": self._next_seq(),
                    "payload": session.last_sub_status,
                }
                await client.send_envelope(sub_msg)

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
            frame = int(p.get("frame", 0))
            raw_title = p.get("title", "")
            fallback_title = p.get("site", "") or "Video"
            title = raw_title.strip() if isinstance(raw_title, str) and raw_title.strip() else fallback_title
            if not p.get("title"):
                msg_dict["payload"]["title"] = title
            
            sess_key = (sender.sid, tab, frame)
            if sess_key in self.sessions:
                self.sessions[sess_key].update_attach(
                    p.get("site", ""),
                    title,
                    float(p.get("duration", 0.0)),
                    bool(p.get("drm", False)),
                    ext_sid=sender.sid,
                )
            else:
                self.sessions[sess_key] = LinkVideoSession(
                    tab=tab,
                    frame=frame,
                    site=p.get("site", ""),
                    title=title,
                    duration=float(p.get("duration", 0.0)),
                    drm=bool(p.get("drm", False)),
                    ext_sid=sender.sid,
                )

        elif envelope.type == "video.detach":
            tab = int(envelope.payload.get("tab", 0))
            frame = int(envelope.payload.get("frame", 0))
            sess_key = (sender.sid, tab, frame)
            self.sessions.pop(sess_key, None)

        elif envelope.type == "video.state":
            tab = int(envelope.payload.get("tab", 0))
            frame = int(envelope.payload.get("frame", 0))
            sess_key = (sender.sid, tab, frame)
            if sess_key in self.sessions:
                self.sessions[sess_key].update_state(envelope.payload)

        elif envelope.type == "sub.status":
            tab = int(envelope.payload.get("tab", 0))
            frame = int(envelope.payload.get("frame", 0))
            sess_key = (sender.sid, tab, frame)
            if sess_key in self.sessions:
                self.sessions[sess_key].update_sub_status(envelope.payload)

        elif envelope.type == "cue.list":
            tab = int(envelope.payload.get("tab", 0))
            frame = int(envelope.payload.get("frame", 0))
            sess_key = (sender.sid, tab, frame)
            if sess_key in self.sessions:
                self.sessions[sess_key].update_cues(envelope.payload)

        elif envelope.type == "cue.active":
            tab = int(envelope.payload.get("tab", 0))
            frame = int(envelope.payload.get("frame", 0))
            sess_key = (sender.sid, tab, frame)
            if sess_key in self.sessions:
                self.sessions[sess_key].update_active_cue(envelope.payload)

        elif envelope.type == "cue.request":
            # Desk requests cues for hash
            req_hash = envelope.payload.get("hash", "")
            for sess in self.sessions.values():
                cues_to_send = [c for c in sess.get_all_cue_payloads() if c.get("hash") == req_hash]
                if cues_to_send:
                    for cue_payload in cues_to_send:
                        await sender.send_envelope({
                            "v": LINK_PROTOCOL_VERSION,
                            "id": f"cue-res-{uuid.uuid4().hex[:8]}",
                            "ts": int(time.time() * 1000),
                            "type": "cue.list",
                            "src": "hub",
                            "sid": sender.sid,
                            "seq": self._next_seq(),
                            "payload": cue_payload,
                        })
                    break

        elif envelope.type == "bye":
            # If extension closes, clean up associated sessions and notify desk
            if sender.role == "ext":
                stale_keys = [k for k in list(self.sessions.keys()) if k[0] == sender.sid]
                for k in stale_keys:
                    sess = self.sessions.pop(k, None)
                    if sess:
                        detach_msg = {
                            "v": LINK_PROTOCOL_VERSION,
                            "id": f"detach-{uuid.uuid4().hex[:8]}",
                            "ts": int(time.time() * 1000),
                            "type": "video.detach",
                            "src": "hub",
                            "seq": self._next_seq(),
                            "payload": {"tab": sess.tab, "frame": sess.frame},
                        }
                        for desk in self.desk_clients:
                            await desk.send_envelope(detach_msg)

        # Route message
        if sender.role == "ext":
            # Forward ext events and acks to all desk clients
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
            # Forward desk commands/messages to target extension client
            target_tab = envelope.payload.get("tab")
            target_ext = None
            if target_tab is not None:
                for (ext_sid, tab, frame), sess in self.sessions.items():
                    if tab == target_tab:
                        target_ext = next((c for c in self.ext_clients if c.sid == ext_sid), None)
                        if target_ext:
                            break
            if target_ext:
                await target_ext.send_envelope(msg_dict)
            else:
                for ext_client in self.ext_clients:
                    await ext_client.send_envelope(msg_dict)


# Global singleton hub
link_hub = LinkHub()
