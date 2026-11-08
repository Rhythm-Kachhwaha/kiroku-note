"""
Tests for Link Protocol Schemas and Invariants (Slice 35).
Validates all JSON fixtures and Pydantic LinkEnvelope constraints.
"""
import json
from pathlib import Path
import pytest
from pydantic import ValidationError

from app.schemas_link import (
    LinkEnvelope,
    parse_link_message,
    LINK_PROTOCOL_VERSION,
    MAX_STANDARD_PAYLOAD_BYTES,
    MAX_CUE_LIST_PAYLOAD_BYTES,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "link"


def get_fixtures(prefix: str):
    return sorted(list(FIXTURES_DIR.glob(f"{prefix}*.json")))


def test_fixtures_directory_exists():
    assert FIXTURES_DIR.exists()
    assert len(list(FIXTURES_DIR.glob("*.json"))) >= 25


@pytest.mark.parametrize("fixture_path", [p for p in FIXTURES_DIR.glob("*.json") if not p.name.startswith("invalid_")])
def test_valid_fixtures_pass_validation(fixture_path: Path):
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    envelope = parse_link_message(data)
    assert isinstance(envelope, LinkEnvelope)
    assert envelope.v == LINK_PROTOCOL_VERSION
    assert envelope.id
    assert envelope.ts > 0
    assert envelope.src in ("ext", "desk", "hub")
    assert envelope.type


@pytest.mark.parametrize("fixture_path", [p for p in FIXTURES_DIR.glob("invalid_*.json")])
def test_invalid_fixtures_fail_validation(fixture_path: Path):
    data = json.loads(fixture_path.read_text(encoding="utf-8"))
    with pytest.raises((ValidationError, ValueError)):
        parse_link_message(data)


def test_command_role_enforcement():
    # desk can send cmd.play
    valid_cmd = {
        "v": 1,
        "id": "c1",
        "ts": 1000,
        "type": "cmd.play",
        "src": "desk",
        "payload": {}
    }
    assert parse_link_message(valid_cmd).src == "desk"

    # ext sending cmd.play must raise ValueError
    invalid_ext = {**valid_cmd, "src": "ext"}
    with pytest.raises(ValidationError) as exc:
        parse_link_message(invalid_ext)
    assert "Commands (cmd.*) can only be sent by 'desk'" in str(exc.value)

    # hub sending cmd.play must raise ValueError
    invalid_hub = {**valid_cmd, "src": "hub"}
    with pytest.raises(ValidationError) as exc:
        parse_link_message(invalid_hub)
    assert "Commands (cmd.*) can only be sent by 'desk'" in str(exc.value)


def test_payload_size_boundaries():
    # 64KB boundary for standard message
    exact_payload = {"pad": "X" * (MAX_STANDARD_PAYLOAD_BYTES - 20)}
    envelope_ok = {
        "v": 1,
        "id": "p1",
        "ts": 1000,
        "type": "bye",
        "src": "ext",
        "payload": exact_payload
    }
    # Within 64KB should parse
    assert parse_link_message(envelope_ok)

    # Exceeding 64KB for non-cue.list message must raise
    oversize_payload = {"pad": "X" * (MAX_STANDARD_PAYLOAD_BYTES + 500)}
    envelope_bad = {
        "v": 1,
        "id": "p2",
        "ts": 1000,
        "type": "bye",
        "src": "ext",
        "payload": oversize_payload
    }
    with pytest.raises(ValidationError) as exc:
        parse_link_message(envelope_bad)
    assert "exceeds limit" in str(exc.value)


def test_fixture_parity_across_subsystems():
    """Fixtures across backend, desktop, and extension must be identical."""
    root = Path(__file__).resolve().parents[2]
    backend_fix = root / "backend" / "tests" / "fixtures" / "link"
    desktop_fix = root / "desktop" / "tests" / "fixtures" / "link"
    extension_fix = root / "extension" / "tests" / "fixtures" / "link"

    backend_files = {p.name: p.read_bytes() for p in backend_fix.glob("*.json")}
    desktop_files = {p.name: p.read_bytes() for p in desktop_fix.glob("*.json")}
    extension_files = {p.name: p.read_bytes() for p in extension_fix.glob("*.json")}

    assert set(backend_files.keys()) == set(desktop_files.keys()), "Backend and Desktop fixtures differ in file list"
    assert set(backend_files.keys()) == set(extension_files.keys()), "Backend and Extension fixtures differ in file list"

    for name, content in backend_files.items():
        assert desktop_files[name] == content, f"Desktop fixture {name} differs from backend"
        assert extension_files[name] == content, f"Extension fixture {name} differs from backend"


def test_a2_new_protocol_schemas():
    """Verify newly introduced A2 schemas round-trip correctly."""
    # video.detach
    v_detach = {
        "v": 1, "id": "vd-1", "ts": 1000, "type": "video.detach", "src": "ext",
        "payload": {"tab": 12, "frame": 1}
    }
    assert parse_link_message(v_detach).type == "video.detach"

    # peer.status
    peer_st = {
        "v": 1, "id": "ps-1", "ts": 1000, "type": "peer.status", "src": "hub",
        "payload": {"ext": 1, "desk": 2}
    }
    assert parse_link_message(peer_st).type == "peer.status"

    # sub.status
    sub_st = {
        "v": 1, "id": "ss-1", "ts": 1000, "type": "sub.status", "src": "ext",
        "payload": {"tab": 12, "frame": 0, "source": "jimaku", "name": "ep1.srt", "count": 250, "offsetMs": -500}
    }
    assert parse_link_message(sub_st).type == "sub.status"

    # cmd.subs
    cmd_subs = {
        "v": 1, "id": "cs-1", "ts": 1000, "type": "cmd.subs", "src": "desk",
        "payload": {"action": "open_menu", "tab": 12, "frame": 0}
    }
    assert parse_link_message(cmd_subs).type == "cmd.subs"

    # cue.request
    cue_req = {
        "v": 1, "id": "cr-1", "ts": 1000, "type": "cue.request", "src": "desk",
        "payload": {"hash": "abc-hash-123"}
    }
    assert parse_link_message(cue_req).type == "cue.request"

    # cue.list chunked
    cue_chunk = {
        "v": 1, "id": "cl-1", "ts": 1000, "type": "cue.list", "src": "ext",
        "payload": {
            "tab": 12, "frame": 0, "hash": "abc-hash-123", "part": 1, "parts": 2,
            "cues": [{"i": 0, "s": 0.0, "e": 2.5, "text": "テスト"}]
        }
    }
    assert parse_link_message(cue_chunk).type == "cue.list"

    # unknown fields tolerated
    extra_field_envelope = {
        "v": 1, "id": "ef-1", "ts": 1000, "type": "bye", "src": "ext",
        "payload": {}, "some_future_envelope_field": 42
    }
    assert parse_link_message(extra_field_envelope).id == "ef-1"
