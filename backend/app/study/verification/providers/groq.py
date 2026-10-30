"""
Groq AI Provider Adapter for Question Verification.
---------------------------------------------------
Configures OpenAI-compatible communication with Groq APIs, enforcing strict
token conservation and rate limits (30 RPM ceiling -> 2.14s interval).
"""
from __future__ import annotations

from app.study.verification.providers.openai import OpenAICompatibleProvider


class GroqProvider(OpenAICompatibleProvider):
    """Provider specifically configured for Groq APIs."""

    name: str = "groq"
    default_endpoint: str = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(
        self,
        model: str = "openai/gpt-oss-120b",
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 1,
        compact: bool = True,
        min_delay: float = 2.15,
    ) -> None:
        actual_model = model if model and model.strip() else "openai/gpt-oss-120b"
        actual_base = base_url if base_url and base_url.strip() else "https://api.groq.com/openai/v1"
        super().__init__(
            model=actual_model,
            api_key=api_key,
            base_url=actual_base,
            timeout=timeout,
            max_retries=max_retries,
            compact=compact,
            min_delay=min_delay,
        )

