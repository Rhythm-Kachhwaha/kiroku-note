"""
Integration and security tests for secure persistent LLM settings and API key management.
"""
import json
import logging
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.secret_store import reset_secret_store


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_stores(tmp_path):
    reset_secret_store()
    yield
    reset_secret_store()


def _make_http_response(payload: dict, status: int = 200):
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
    mock_resp.status = status
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.__exit__.return_value = None
    return mock_resp


def test_save_and_retrieve_secret_lifecycle(client, tmp_path):
    secrets_file = tmp_path / "data" / ".secrets.enc"
    with patch.dict(
        "os.environ",
        {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_SECRETS_PATH": str(secrets_file),
            "KIROKU_LLM_PROVIDER": "groq",
        },
        clear=True,
    ):
        # 1. Initially status reports not configured
        status_resp = client.get("/api/llm/status")
        assert status_resp.status_code == 200
        assert status_resp.json()["configured"] is False

        # 2. Save API key via POST /api/llm/secret
        test_secret = "gsk_prod_secure_token_9876543210abcdef"
        save_resp = client.post(
            "/api/llm/secret",
            json={"api_key": test_secret, "key_name": "My Personal Groq Key"},
        )
        assert save_resp.status_code == 200
        save_data = save_resp.json()
        assert save_data["ok"] is True
        assert save_data["configured"] is True
        assert save_data["key_name"] == "My Personal Groq Key"
        # Must not leak secret in save response
        assert test_secret not in str(save_data)

        # 3. GET /api/llm/status and GET /api/llm/config report configured
        status_resp2 = client.get("/api/llm/status")
        assert status_resp2.status_code == 200
        assert status_resp2.json()["configured"] is True
        assert status_resp2.json()["key_name"] == "My Personal Groq Key"
        assert test_secret not in str(status_resp2.json())

        config_resp = client.get("/api/llm/config")
        assert config_resp.status_code == 200
        config_data = config_resp.json()
        assert config_data["configured"] is True
        assert config_data["has_key"] is True
        assert config_data["key_name"] == "My Personal Groq Key"
        assert config_data["key_preview"] is None
        assert test_secret not in str(config_data)

        # 4. Restart backend simulation: reset singleton store and re-check
        reset_secret_store()
        status_resp3 = client.get("/api/llm/status")
        assert status_resp3.status_code == 200
        assert status_resp3.json()["configured"] is True

        # 5. Replace existing key
        new_secret = "gsk_replacement_token_11223344556677"
        replace_resp = client.post(
            "/api/llm/secret",
            json={"api_key": new_secret, "key_name": "Replaced Groq Key"},
        )
        assert replace_resp.status_code == 200
        assert replace_resp.json()["configured"] is True
        assert replace_resp.json()["key_name"] == "Replaced Groq Key"
        assert new_secret not in str(replace_resp.json())

        # 6. Delete key
        del_resp = client.delete("/api/llm/secret")
        assert del_resp.status_code == 200
        assert del_resp.json()["ok"] is True
        assert del_resp.json()["configured"] is False

        status_after_del = client.get("/api/llm/status")
        assert status_after_del.json()["configured"] is False


def test_env_var_fallback_and_precedence(client, tmp_path):
    secrets_file = tmp_path / "data" / ".secrets.enc"
    with patch.dict(
        "os.environ",
        {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_SECRETS_PATH": str(secrets_file),
            "KIROKU_LLM_PROVIDER": "groq",
            "KIROKU_LLM_API_KEY": "gsk_env_fallback_key_12345",
        },
        clear=True,
    ):
        # 1. With env var present and no stored secret: configured = True (via fallback)
        status_resp = client.get("/api/llm/status")
        assert status_resp.json()["configured"] is True

        # 2. Store an explicit secure key: it must take precedence over env var
        stored_secret = "gsk_explicitly_stored_secret_99999"
        client.post(
            "/api/llm/secret",
            json={"api_key": stored_secret, "key_name": "Stored Secret Key"},
        )

        from app.config import get_llm_api_key
        assert get_llm_api_key() == stored_secret

        # 3. Delete stored secret: falls back to environment variable
        del_resp = client.delete("/api/llm/secret")
        assert del_resp.status_code == 200
        # Configured is still True because env fallback exists
        assert del_resp.json()["configured"] is True
        assert get_llm_api_key() == "gsk_env_fallback_key_12345"


def test_llm_request_uses_securely_stored_key(client, tmp_path):
    secrets_file = tmp_path / "data" / ".secrets.enc"
    with patch.dict(
        "os.environ",
        {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_SECRETS_PATH": str(secrets_file),
            "KIROKU_LLM_PROVIDER": "groq",
        },
        clear=True,
    ):
        stored_secret = "gsk_secure_operational_key_88888"
        client.post(
            "/api/llm/secret",
            json={"api_key": stored_secret, "key_name": "Operational Key"},
        )

        # Mock urllib request to Groq and verify the Authorization header received the stored key
        captured_headers = {}

        def mock_urlopen(req, timeout=None):
            for k, v in req.headers.items():
                captured_headers[k] = v
            # Return valid Groq chat completion payload
            body = {
                "choices": [
                    {"message": {"role": "assistant", "content": "Correct grammar explanation."}}
                ]
            }
            return _make_http_response(body)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            ask_resp = client.post(
                "/api/llm/ask",
                json={
                    "text": "食べる",
                    "task": "explain_grammar",
                },
            )
            assert ask_resp.status_code == 200
            assert ask_resp.json()["result"] == "Correct grammar explanation."
            assert captured_headers.get("Authorization") == f"Bearer {stored_secret}"


def test_security_assertions_raw_secret_never_exposed(client, tmp_path, caplog):
    """
    Search all relevant responses, persisted files, and logs for the test secret,
    confirming it is never exposed in plain text.
    """
    secrets_file = tmp_path / "data" / ".secrets.enc"
    test_secret = "gsk_canary_secret_do_not_leak_xyz789"

    with patch.dict(
        "os.environ",
        {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_SECRETS_PATH": str(secrets_file),
            "KIROKU_LLM_PROVIDER": "groq",
        },
        clear=True,
    ):
        with caplog.at_level(logging.DEBUG):
            # Save secret
            res_post = client.post(
                "/api/llm/secret",
                json={"api_key": test_secret, "key_name": "Canary Key"},
            )
            res_get_cfg = client.get("/api/llm/config")
            res_get_status = client.get("/api/llm/status")

        # 1. API responses must not contain secret
        leak_found = False
        if test_secret in res_post.text:
            leak_found = True
        if test_secret in res_get_cfg.text:
            leak_found = True
        if test_secret in res_get_status.text:
            leak_found = True
        assert not leak_found, "Secret leaked in API response payload!"

        # 2. llm_config.json must not contain secret
        cfg_file = tmp_path / "llm_config.json"
        if cfg_file.is_file():
            assert test_secret not in cfg_file.read_text(encoding="utf-8"), (
                "Secret leaked in llm_config.json!"
            )

        # 3. Log records must not contain secret
        for record in caplog.records:
            assert test_secret not in record.getMessage(), "Secret leaked in application logs!"

        # 4. Encrypted storage file on disk must not contain raw secret
        if secrets_file.is_file():
            raw_bytes = secrets_file.read_bytes()
            assert test_secret.encode("utf-8") not in raw_bytes, (
                "Secret stored unencrypted in storage file!"
            )


def test_empty_or_invalid_secret_validation(client):
    resp = client.post("/api/llm/secret", json={"api_key": "   "})
    assert resp.status_code == 422
