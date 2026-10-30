"""
xAI (Grok) Provider Adapter for Question Verification.
------------------------------------------------------
Configures the OpenAI-compatible communication layer for xAI's native endpoint
(https://api.x.ai/v1/chat/completions) with default Grok models.
"""
from __future__ import annotations

from app.study.verification.providers.openai import OpenAICompatibleProvider


class XAIProvider(OpenAICompatibleProvider):
    """Provider specifically configured for xAI (Grok) APIs."""

    name: str = "xai"
    default_endpoint: str = "https://api.x.ai/v1/chat/completions"

    def __init__(
        self,
        model: str = "grok-2",
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
    ) -> None:
        actual_model = model if model and model.strip() else "grok-2"
        actual_base = base_url if base_url and base_url.strip() else "https://api.x.ai/v1"
        super().__init__(
            model=actual_model,
            api_key=api_key,
            base_url=actual_base,
            timeout=timeout,
            max_retries=max_retries,
        )

