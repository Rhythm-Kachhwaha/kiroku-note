"""
Kiroku Link Protocol Schemas (v1)
Pydantic models for WebSocket envelope, payloads, and validation invariants.
"""
import json
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, field_validator, model_validator


LINK_PROTOCOL_VERSION = 1
MAX_STANDARD_PAYLOAD_BYTES = 64 * 1024       # 64 KB
MAX_CUE_LIST_PAYLOAD_BYTES = 1024 * 1024     # 1 MB


# ---------------------------------------------------------------------------
# Specific Payloads
# ---------------------------------------------------------------------------

class HelloPayload(BaseModel):
    role: Literal["ext", "desk"]
    token: str = Field(min_length=1)
    client: str = Field(min_length=1)


class HelloOkPayload(BaseModel):
    sid: str = Field(min_length=1)


class ByePayload(BaseModel):
    reason: Optional[str] = None


class AckPayload(BaseModel):
    id: str = Field(min_length=1)
    ok: bool
    err: Optional[str] = None


class VideoAttachPayload(BaseModel):
    tab: int
    frame: int = Field(default=0, ge=0)
    site: str = Field(min_length=1)
    title: str = Field(default="")
    duration: float = Field(ge=0.0)
    drm: bool = False
    hasNextEpisode: bool = False


class VideoDetachPayload(BaseModel):
    tab: int
    frame: int = Field(default=0, ge=0)


class VideoStatePayload(BaseModel):
    tab: Optional[int] = None
    frame: int = Field(default=0, ge=0)
    t: float = Field(ge=0.0)
    paused: bool
    rate: float = Field(default=1.0, gt=0.0)
    vol: float = Field(default=1.0, ge=0.0, le=1.0)
    muted: bool = False
    hasNextEpisode: bool = False


class PeerStatusPayload(BaseModel):
    ext: int = Field(ge=0)
    desk: int = Field(ge=0)


class SessionSnapshotPayload(BaseModel):
    sessions: List[Dict[str, Any]] = Field(default_factory=list)


class SubStatusPayload(BaseModel):
    tab: Optional[int] = None
    frame: int = Field(default=0, ge=0)
    source: Literal["none", "embedded", "youtube", "jimaku", "file"] = "none"
    name: str = ""
    count: int = Field(default=0, ge=0)
    offsetMs: int = 0


class CueItem(BaseModel):
    i: int = Field(ge=0)
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    text: str
    secondary_text: Optional[str] = None

    @field_validator("e")
    @classmethod
    def end_ge_start(cls, v: float, info) -> float:
        if "s" in info.data and v < info.data["s"]:
            raise ValueError("Cue end time must be greater than or equal to start time")
        return v


class CueListPayload(BaseModel):
    tab: Optional[int] = None
    frame: int = Field(default=0, ge=0)
    hash: str = Field(min_length=1)
    part: Optional[int] = Field(default=None, ge=1)
    parts: Optional[int] = Field(default=None, ge=1)
    cues: List[CueItem] = Field(default_factory=list, max_length=500)


class CueRequestPayload(BaseModel):
    hash: str = Field(min_length=1)


class CueActivePayload(BaseModel):
    tab: Optional[int] = None
    frame: int = Field(default=0, ge=0)
    i: Optional[int] = Field(default=None, ge=0)
    secondary_text: Optional[str] = None


class ClipResultPayload(BaseModel):
    reqId: str = Field(min_length=1)
    image_b64: Optional[str] = None
    audio_b64: Optional[str] = None


class CmdBasePayload(BaseModel):
    tab: Optional[int] = None
    frame: Optional[int] = None


class CmdPlayPayload(CmdBasePayload):
    pass


class CmdPausePayload(CmdBasePayload):
    pass


class CmdTogglePayload(CmdBasePayload):
    pass


class CmdSeekPayload(CmdBasePayload):
    t: Optional[float] = None
    delta: Optional[float] = None

    @model_validator(mode="after")
    def check_at_least_one(self) -> "CmdSeekPayload":
        if self.t is None and self.delta is None:
            raise ValueError("CmdSeekPayload requires either 't' or 'delta'")
        return self


class CmdCuePayload(CmdBasePayload):
    delta: Optional[int] = None
    i: Optional[int] = None

    @model_validator(mode="after")
    def check_at_least_one(self) -> "CmdCuePayload":
        if self.delta is None and self.i is None:
            raise ValueError("CmdCuePayload requires either 'delta' or 'i'")
        return self


class CmdLoopPayload(CmdBasePayload):
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    count: int = Field(default=1, ge=1)

    @field_validator("e")
    @classmethod
    def end_gt_start(cls, v: float, info) -> float:
        if "s" in info.data and v <= info.data["s"]:
            raise ValueError("Loop end must be greater than start")
        return v


class CmdRatePayload(CmdBasePayload):
    v: float = Field(gt=0.0, le=16.0)


class CmdOffsetPayload(CmdBasePayload):
    ms: int


class CmdClipPayload(CmdBasePayload):
    reqId: str = Field(min_length=1)
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    want: List[Literal["image", "audio"]] = Field(min_length=1)


class CmdNextEpisodePayload(CmdBasePayload):
    pass


class CmdSubsPayload(CmdBasePayload):
    action: Literal["open_menu", "clear"]


class CmdReplayPayload(CmdBasePayload):
    pass


class CmdSubTogglePayload(CmdBasePayload):
    enabled: Optional[bool] = None


TYPE_PAYLOAD_MAP: Dict[str, type] = {
    "hello": HelloPayload,
    "hello.ok": HelloOkPayload,
    "bye": ByePayload,
    "ack": AckPayload,
    "video.attach": VideoAttachPayload,
    "video.detach": VideoDetachPayload,
    "video.state": VideoStatePayload,
    "peer.status": PeerStatusPayload,
    "session.snapshot": SessionSnapshotPayload,
    "sub.status": SubStatusPayload,
    "cue.list": CueListPayload,
    "cue.request": CueRequestPayload,
    "cue.active": CueActivePayload,
    "clip.result": ClipResultPayload,
    "cmd.play": CmdPlayPayload,
    "cmd.pause": CmdPausePayload,
    "cmd.toggle": CmdTogglePayload,
    "cmd.seek": CmdSeekPayload,
    "cmd.cue": CmdCuePayload,
    "cmd.loop": CmdLoopPayload,
    "cmd.rate": CmdRatePayload,
    "cmd.offset": CmdOffsetPayload,
    "cmd.clip": CmdClipPayload,
    "cmd.next_episode": CmdNextEpisodePayload,
    "cmd.subs": CmdSubsPayload,
    "cmd.replay": CmdReplayPayload,
    "cmd.sub_toggle": CmdSubTogglePayload,
}


# ---------------------------------------------------------------------------
# Envelope Model
# ---------------------------------------------------------------------------

class LinkEnvelope(BaseModel):
    model_config = {"extra": "ignore"}
    v: int = Field(default=1)
    id: str = Field(min_length=1)
    ts: int = Field(gt=0)
    type: str = Field(min_length=1)
    src: Literal["ext", "desk", "hub"]
    sid: Optional[str] = None
    seq: int = Field(default=0, ge=0)
    payload: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("v")
    @classmethod
    def check_version(cls, v: int) -> int:
        if v != LINK_PROTOCOL_VERSION:
            raise ValueError(f"Unsupported protocol version {v}, expected {LINK_PROTOCOL_VERSION}")
        return v

    @model_validator(mode="after")
    def validate_rules(self) -> "LinkEnvelope":
        if self.type not in TYPE_PAYLOAD_MAP:
            raise ValueError(f"Unknown message type '{self.type}'")

        if self.type.startswith("cmd.") and self.src != "desk":
            raise ValueError(f"Commands (cmd.*) can only be sent by 'desk', got '{self.src}'")

        payload_bytes = len(json.dumps(self.payload).encode("utf-8"))
        max_bytes = MAX_CUE_LIST_PAYLOAD_BYTES if self.type == "cue.list" else MAX_STANDARD_PAYLOAD_BYTES
        if payload_bytes > max_bytes:
            raise ValueError(
                f"Payload size {payload_bytes} exceeds limit of {max_bytes} bytes for type '{self.type}'"
            )

        payload_cls = TYPE_PAYLOAD_MAP[self.type]
        payload_cls.model_validate(self.payload)

        return self


def parse_link_message(raw: Union[str, bytes, dict]) -> LinkEnvelope:
    """Parses and validates a raw Link message dictionary or JSON string."""
    if isinstance(raw, (str, bytes)):
        data = json.loads(raw)
    elif isinstance(raw, dict):
        data = raw
    else:
        raise ValueError(f"Invalid raw message type: {type(raw)}")
    return LinkEnvelope.model_validate(data)
