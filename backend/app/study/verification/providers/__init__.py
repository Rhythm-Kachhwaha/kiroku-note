"""
AI Providers Package for Kiroku Study Bank Verification.
--------------------------------------------------------
Exports BaseAIProvider, ProviderRegistry, and concrete provider adapters.
"""
from __future__ import annotations

from app.study.verification.providers.base import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
    BaseAIProvider,
    ProviderRegistry,
)
from app.study.verification.providers.mock import MockAIProvider
from app.study.verification.providers.openai import OpenAICompatibleProvider
from app.study.verification.providers.xai import XAIProvider

# Register standard adapters
ProviderRegistry.register("xai", XAIProvider)
ProviderRegistry.register("openai_compatible", OpenAICompatibleProvider)
ProviderRegistry.register("mock", MockAIProvider)

__all__ = [
    "AIProviderAuthError",
    "AIProviderError",
    "AIProviderRateLimitError",
    "AIProviderResponseError",
    "AIProviderTimeoutError",
    "BaseAIProvider",
    "MockAIProvider",
    "OpenAICompatibleProvider",
    "ProviderRegistry",
    "XAIProvider",
]

