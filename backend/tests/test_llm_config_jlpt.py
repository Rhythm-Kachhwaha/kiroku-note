"""Tests for LLM JLPT Level configuration, schemas, and API persistence."""
import pytest
from fastapi.testclient import TestClient

from app.config import (
    DEFAULT_LLM_JLPT_LEVEL,
    VALID_JLPT_LEVELS,
    get_llm_jlpt_level,
    load_stored_llm_config,
    save_stored_llm_config,
)
from app.main import app
from app.schemas import LLMConfigResponse, LLMConfigUpdateRequest, LLMRequest


@pytest.fixture
def client():
    return TestClient(app)


def test_default_jlpt_level():
    assert DEFAULT_LLM_JLPT_LEVEL == "N3"
    assert get_llm_jlpt_level({}) == "N3"


def test_env_jlpt_level_override():
    assert get_llm_jlpt_level({"KIROKU_LLM_JLPT_LEVEL": "N1"}) == "N1"
    assert get_llm_jlpt_level({"KIROKU_LLM_JLPT_LEVEL": "n5"}) == "N5"
    assert get_llm_jlpt_level({"KIROKU_LLM_JLPT_LEVEL": "invalid"}) == "N3"


def test_stored_jlpt_level(tmp_path):
    env = {"KIROKU_DATA_DIR": str(tmp_path)}
    assert get_llm_jlpt_level(env) == "N3"
    save_stored_llm_config({"jlpt_level": "N2"}, env=env)
    assert get_llm_jlpt_level(env) == "N2"


def test_config_api_jlpt_level(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KIROKU_DATA_DIR", str(tmp_path))
    # GET config includes jlpt_level
    resp = client.get("/api/llm/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "jlpt_level" in data
    assert data["jlpt_level"] in VALID_JLPT_LEVELS

    # PUT config updates jlpt_level
    resp = client.put("/api/llm/config", json={"jlpt_level": "N4"})
    assert resp.status_code == 200
    assert resp.json()["jlpt_level"] == "N4"

    # Verify persistence
    resp = client.get("/api/llm/config")
    assert resp.status_code == 200
    assert resp.json()["jlpt_level"] == "N4"


def test_llm_request_mode_and_jlpt_schema():
    req = LLMRequest(task="translate", text="テスト")
    assert req.mode == "short"
    assert req.jlpt_level is None

    req_detailed = LLMRequest(task="explain_grammar", text="テスト", mode="detailed", jlpt_level="N2")
    assert req_detailed.mode == "detailed"
    assert req_detailed.jlpt_level == "N2"
