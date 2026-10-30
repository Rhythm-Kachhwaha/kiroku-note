"""
Targeted tests for AI Verification Configuration.
-------------------------------------------------
Covers:
- Loading configuration from environment variables
- Safe representation excluding secrets
- Auto-enabled vs explicit enabled flags
- Boundary clamping for timeouts and retries
- Missing configuration tolerance (graceful offline fallback)
"""
from __future__ import annotations

import pytest

from app.study.verification.config import (
    AIVerificationConfig,
    ModelSlotConfig,
    load_verification_config_from_env,
)


def test_default_config_empty_env():
    """Verify default settings when no AI environment variables are set."""
    cfg = load_verification_config_from_env({})
    assert cfg.enabled is False
    assert cfg.is_ready() is False
    assert cfg.timeout == 60.0
    assert cfg.max_retries == 2
    assert cfg.max_concurrency == 2
    assert cfg.model_a.provider == "xai"
    assert cfg.model_a.api_key == ""
    assert cfg.model_b.provider == "openai_compatible"
    assert cfg.model_b.api_key == ""


def test_explicit_env_configuration():
    """Verify full environment loading for both model slots."""
    env = {
        "KIROKU_AI_ENABLED": "true",
        "KIROKU_AI_MODEL_A_PROVIDER": "xai",
        "KIROKU_AI_MODEL_A_MODEL": "grok-2-custom",
        "KIROKU_AI_MODEL_A_API_KEY": "xai-test-key-123",
        "KIROKU_AI_MODEL_B_PROVIDER": "openai_compatible",
        "KIROKU_AI_MODEL_B_MODEL": "gpt-4o-mini",
        "KIROKU_AI_MODEL_B_API_KEY": "openai-test-key-456",
        "KIROKU_AI_MODEL_B_BASE_URL": "https://custom.openai.endpoint/v1",
        "KIROKU_AI_TIMEOUT": "45.5",
        "KIROKU_AI_MAX_RETRIES": "3",
        "KIROKU_AI_MAX_CONCURRENCY": "4",
    }
    cfg = load_verification_config_from_env(env)
    assert cfg.enabled is True
    assert cfg.is_ready() is True
    assert cfg.model_a.model == "grok-2-custom"
    assert cfg.model_a.api_key == "xai-test-key-123"
    assert cfg.model_b.base_url == "https://custom.openai.endpoint/v1"
    assert cfg.timeout == 45.5
    assert cfg.max_retries == 3
    assert cfg.max_concurrency == 4


def test_api_keys_never_exposed_in_repr_or_safe_dict():
    """Verify secrets are redacted from representation and diagnostics."""
    slot = ModelSlotConfig(
        provider="xai",
        model="grok-2",
        api_key="SUPER_SECRET_TOKEN_DO_NOT_LEAK",
    )
    # repr must not contain the secret
    assert "SUPER_SECRET_TOKEN_DO_NOT_LEAK" not in repr(slot)

    # safe dict must redact secret
    safe = slot.to_safe_dict()
    assert "api_key" not in safe
    assert safe["has_api_key"] is True

    cfg = AIVerificationConfig(
        enabled=True,
        model_a=slot,
        model_b=ModelSlotConfig(provider="mock"),
    )
    cfg_safe = cfg.to_safe_dict()
    assert "SUPER_SECRET_TOKEN_DO_NOT_LEAK" not in str(cfg_safe)


def test_timeout_and_retry_clamping():
    """Verify boundary clamping on timeout and retries."""
    env_low = {"KIROKU_AI_TIMEOUT": "1.0", "KIROKU_AI_MAX_RETRIES": "-5"}
    cfg_low = load_verification_config_from_env(env_low)
    assert cfg_low.timeout == 5.0  # Clamped to min 5.0
    assert cfg_low.max_retries == 0  # Clamped to min 0

    env_high = {"KIROKU_AI_TIMEOUT": "999.0", "KIROKU_AI_MAX_RETRIES": "50"}
    cfg_high = load_verification_config_from_env(env_high)
    assert cfg_high.timeout == 180.0  # Clamped to max 180.0
    assert cfg_high.max_retries == 5  # Clamped to max 5


def test_mock_provider_is_configured_without_api_key():
    """Verify mock provider is considered configured for offline test suites."""
    slot = ModelSlotConfig(provider="mock", model="mock-model")
    assert slot.is_configured() is True


def test_load_dotenv_file(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Verify standard-library load_dotenv loads key-value pairs without overriding existing env."""
    from app.config import load_dotenv

    env_file = tmp_path / ".env"
    env_file.write_text(
        "# Test comment\n"
        "KIROKU_TEST_DOTENV_KEY=custom_value_123\n"
        "export KIROKU_TEST_EXPORT_KEY=\"quoted_value_456\"\n"
        "KIROKU_TEST_EXISTING_KEY=new_file_value\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("KIROKU_TEST_EXISTING_KEY", "already_set")
    monkeypatch.delenv("KIROKU_TEST_DOTENV_KEY", raising=False)
    monkeypatch.delenv("KIROKU_TEST_EXPORT_KEY", raising=False)

    load_dotenv(env_path=env_file, override=False)

    import os
    assert os.environ.get("KIROKU_TEST_DOTENV_KEY") == "custom_value_123"
    assert os.environ.get("KIROKU_TEST_EXPORT_KEY") == "quoted_value_456"
    assert os.environ.get("KIROKU_TEST_EXISTING_KEY") == "already_set"


def test_missing_dotenv_file_is_safe(tmp_path):
    """Verify missing .env does not raise or fail."""
    from app.config import load_dotenv
    non_existent = tmp_path / "does_not_exist.env"
    load_dotenv(env_path=non_existent)


