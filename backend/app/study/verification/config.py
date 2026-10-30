"""
Configuration Management for AI Question Verification.
-------------------------------------------------------
Resolves independent provider settings, model names, endpoints, timeouts,
and credentials for Model A and Model B.
Strictly excludes secrets from string representations, logs, and serialization.
"""
from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel, Field


def _clean_str(val: Any) -> str:
    """Trim whitespace and return sanitized string."""
    if val is None:
        return ""
    return str(val).strip()


def _parse_bool(val: Any, default: bool = False) -> bool:
    """Parse boolean from string or truthy value."""
    if val is None:
        return default
    s = str(val).strip().lower()
    if s in ("1", "true", "yes", "on", "enable", "enabled"):
        return True
    if s in ("0", "false", "no", "off", "disable", "disabled"):
        return False
    return default


class ModelSlotConfig(BaseModel):
    """Configuration for an independent model slot (Model A or Model B)."""
    provider: str = "none"
    model: str = ""
    api_key: str = Field(default="", repr=False)  # Excluded from repr to prevent leak in logs
    base_url: str | None = None

    def is_configured(self) -> bool:
        """Check whether this slot has valid provider and credentials."""
        p = self.provider.strip().lower()
        if p in ("none", ""):
            return False
        if p == "mock":
            return True
        if self.api_key.strip():
            return True
        # Local endpoints (e.g. ollama or local proxy) do not require API keys
        if p == "openai_compatible" and self.base_url and "localhost" in self.base_url:
            return True
        return False

    def to_safe_dict(self) -> dict[str, Any]:
        """Return safe dictionary without exposing the API key."""
        return {
            "provider": self.provider,
            "model": self.model,
            "base_url": self.base_url,
            "has_api_key": bool(self.api_key.strip()),
        }


class AIVerificationConfig(BaseModel):
    """Global configuration for the two-model AI verification subsystem."""
    enabled: bool = False
    model_a: ModelSlotConfig = Field(default_factory=ModelSlotConfig)
    model_b: ModelSlotConfig = Field(default_factory=ModelSlotConfig)
    timeout: float = 60.0
    max_retries: int = 2
    max_concurrency: int = 2

    def is_ready(self) -> bool:
        """Check whether AI verification is enabled and both models are properly configured."""
        return (
            self.enabled
            and self.model_a.is_configured()
            and self.model_b.is_configured()
        )

    def to_safe_dict(self) -> dict[str, Any]:
        """Return safe dictionary for logging or diagnostics without secrets."""
        return {
            "enabled": self.enabled,
            "is_ready": self.is_ready(),
            "model_a": self.model_a.to_safe_dict(),
            "model_b": self.model_b.to_safe_dict(),
            "timeout": self.timeout,
            "max_retries": self.max_retries,
            "max_concurrency": self.max_concurrency,
        }


def load_verification_config_from_env(env: dict[str, str] | None = None) -> AIVerificationConfig:
    """
    Load AI verification configuration from environment variables.
    Automatically ensures root .env is loaded if present.
    Safe against missing variables; never raises an exception.
    """
    if env is None:
        try:
            from app.config import load_dotenv
            load_dotenv()
        except Exception:
            pass

    env_dict = os.environ if env is None else env

    # Model A configuration
    model_a_provider = _clean_str(env_dict.get("KIROKU_AI_MODEL_A_PROVIDER", "xai")).lower()
    model_a_model = _clean_str(env_dict.get("KIROKU_AI_MODEL_A_MODEL", "grok-2"))
    model_a_key = _clean_str(env_dict.get("KIROKU_AI_MODEL_A_API_KEY") or env_dict.get("XAI_API_KEY"))
    model_a_url = _clean_str(env_dict.get("KIROKU_AI_MODEL_A_BASE_URL")) or None

    # Model B configuration
    model_b_provider = _clean_str(env_dict.get("KIROKU_AI_MODEL_B_PROVIDER", "openai_compatible")).lower()
    model_b_model = _clean_str(env_dict.get("KIROKU_AI_MODEL_B_MODEL", "gpt-4o-mini"))
    model_b_key = _clean_str(env_dict.get("KIROKU_AI_MODEL_B_API_KEY") or env_dict.get("OPENAI_API_KEY"))
    model_b_url = _clean_str(env_dict.get("KIROKU_AI_MODEL_B_BASE_URL")) or None

    # Timeouts and retries
    try:
        raw_timeout = float(env_dict.get("KIROKU_AI_TIMEOUT", "60.0"))
        timeout = max(5.0, min(180.0, raw_timeout))
    except (ValueError, TypeError):
        timeout = 60.0

    try:
        raw_retries = int(env_dict.get("KIROKU_AI_MAX_RETRIES", "2"))
        max_retries = max(0, min(5, raw_retries))
    except (ValueError, TypeError):
        max_retries = 2

    try:
        raw_concurrency = int(env_dict.get("KIROKU_AI_MAX_CONCURRENCY", "2"))
        max_concurrency = max(1, min(10, raw_concurrency))
    except (ValueError, TypeError):
        max_concurrency = 2

    slot_a = ModelSlotConfig(
        provider=model_a_provider,
        model=model_a_model,
        api_key=model_a_key,
        base_url=model_a_url,
    )
    slot_b = ModelSlotConfig(
        provider=model_b_provider,
        model=model_b_model,
        api_key=model_b_key,
        base_url=model_b_url,
    )

    # Enabled flag: explicit variable, or defaults to True if both models are configured
    raw_enabled = env_dict.get("KIROKU_AI_ENABLED")
    if raw_enabled is not None:
        enabled = _parse_bool(raw_enabled, default=False)
    else:
        enabled = slot_a.is_configured() and slot_b.is_configured()

    return AIVerificationConfig(
        enabled=enabled,
        model_a=slot_a,
        model_b=slot_b,
        timeout=timeout,
        max_retries=max_retries,
        max_concurrency=max_concurrency,
    )

