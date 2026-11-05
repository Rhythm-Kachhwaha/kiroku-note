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
    site: str = Field(min_length=1)
    title: str = Field(min_length=1)
    duration: float = Field(ge=0.0)
    drm: bool = False
    hasNextEpisode: bool = False


class VideoStatePayload(BaseModel):
    t: float = Field(ge=0.0)
    paused: bool
    rate: float = Field(default=1.0, gt=0.0)
    vol: float = Field(default=1.0, ge=0.0, le=1.0)
    muted: bool = False
    hasNextEpisode: bool = False


class CueItem(BaseModel):
    i: int = Field(ge=0)
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    text: str

    @field_validator("e")
    @classmethod
    def end_ge_start(cls, v: float, info) -> float:
        if "s" in info.data and v < info.data["s"]:
            raise ValueError("Cue end time must be greater than or equal to start time")
        return v


class CueListPayload(BaseModel):
    hash: str = Field(min_length=1)
    cues: List[CueItem] = Field(default_factory=list, max_length=500)


class CueActivePayload(BaseModel):
    i: Optional[int] = Field(default=None, ge=0)


class ClipResultPayload(BaseModel):
    reqId: str = Field(min_length=1)
    image_b64: Optional[str] = None
    audio_b64: Optional[str] = None


class CmdPlayPayload(BaseModel):
    pass


class CmdPausePayload(BaseModel):
    pass


class CmdTogglePayload(BaseModel):
    pass


class CmdSeekPayload(BaseModel):
    t: Optional[float] = None
    delta: Optional[float] = None

    @model_validator(mode="after")
    def check_at_least_one(self) -> "CmdSeekPayload":
        if self.t is None and self.delta is None:
            raise ValueError("CmdSeekPayload requires either 't' or 'delta'")
        return self


class CmdCuePayload(BaseModel):
    delta: Optional[int] = None
    i: Optional[int] = None

    @model_validator(mode="after")
    def check_at_least_one(self) -> "CmdCuePayload":
        if self.delta is None and self.i is None:
            raise ValueError("CmdCuePayload requires either 'delta' or 'i'")
        return self


class CmdLoopPayload(BaseModel):
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    count: int = Field(default=1, ge=1)

    @field_validator("e")
    @classmethod
    def end_gt_start(cls, v: float, info) -> float:
        if "s" in info.data and v <= info.data["s"]:
            raise ValueError("Loop end must be greater than start")
        return v


class CmdRatePayload(BaseModel):
    v: float = Field(gt=0.0, le=16.0)


class CmdOffsetPayload(BaseModel):
    ms: int


class CmdClipPayload(BaseModel):
    reqId: str = Field(min_length=1)
    s: float = Field(ge=0.0)
    e: float = Field(ge=0.0)
    want: List[Literal["image", "audio"]] = Field(min_length=1)


class CmdNextEpisodePayload(BaseModel):
    pass


TYPE_PAYLOAD_MAP: Dict[str, type] = {
    "hello": HelloPayload,
    "hello.ok": HelloOkPayload,
    "bye": ByePayload,
    "ack": AckPayload,
    "video.attach": VideoAttachPayload,
    "video.state": VideoStatePayload,
    "cue.list": CueListPayload,
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
}


# ---------------------------------------------------------------------------
# Envelope Model
# ---------------------------------------------------------------------------

class LinkEnvelope(BaseModel):
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
