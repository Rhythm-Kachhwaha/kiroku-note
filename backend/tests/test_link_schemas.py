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
