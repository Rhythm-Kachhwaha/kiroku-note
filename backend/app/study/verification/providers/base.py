"""
Base AI Provider Abstraction and Registry for Question Verification.
--------------------------------------------------------------------
Defines the standard provider interface, common response parsing, JSON markdown
sanitization, structured output validation, and provider registry.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
import json
import re
import time
from typing import Any, Callable, Type

from app.study.verification.enums import (
    ConfidenceLevel,
    QuestionValidity,
    SourceClaimAssessmentKind,
)
from app.study.verification.models import (
    AIChoiceInput,
    AIExplanationRequest,
    AIExplanationResponse,
    AISolveRequest,
    AISolveResponse,
    AISourceClaimAssessment,
    AIVerifyClaimsRequest,
    AIVerifyClaimsResponse,
)


class AIProviderError(Exception):
    """Base exception for all AI provider communication or execution failures."""
    pass


class AIProviderTimeoutError(AIProviderError):
    """Raised when an upstream AI request exceeds the configured timeout."""
    pass


class AIProviderAuthError(AIProviderError):
    """Raised when an AI provider returns 401/403 authentication failures."""
    pass


class AIProviderRateLimitError(AIProviderError):
    """Raised when an AI provider returns 429 rate limit or quota exceeded."""
    pass


class AIProviderResponseError(AIProviderError):
    """Raised when an AI provider returns malformed, unparseable, or invalid structured data."""
    pass


class BaseAIProvider(ABC):
    """Abstract base class for all interchangeable LLM verification providers."""

    name: str = "base"

    def __init__(
        self,
        model: str,
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
    ) -> None:
        self.model_name = model
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = timeout
        self.max_retries = max_retries

    @abstractmethod
    def solve_question(self, req: AISolveRequest) -> AISolveResponse:
        """Independently solve a question candidate without knowledge of source answers."""
        raise NotImplementedError

    @abstractmethod
    def verify_source_claims(self, req: AIVerifyClaimsRequest) -> AIVerifyClaimsResponse:
        """Evaluate external source answer claims against question and independent solution."""
        raise NotImplementedError

    @abstractmethod
    def generate_explanation(self, req: AIExplanationRequest) -> AIExplanationResponse:
        """Generate a pedagogical breakdown for a learner."""
        raise NotImplementedError

    def test_connection(self) -> bool:
        """Lightweight health check confirming provider responsiveness and authentication."""
        return True

    # -------------------------------------------------------------------------
    # Shared Parsing & Validation Utilities
    # -------------------------------------------------------------------------
    @staticmethod
    def clean_json_markdown(raw_text: str) -> str:
        """
        Strip markdown formatting (e.g. ```json ... ```) and extract outermost JSON object.
        """
        text = raw_text.strip()
        # Remove markdown code fences if present
        if "```" in text:
            # Match ```json ... ``` or ``` ... ```
            fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
            if fence_match:
                text = fence_match.group(1).strip()

        # Extract outermost JSON object if there is leading/trailing prose
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            text = text[first_brace : last_brace + 1]

        return text

    def parse_json_payload(self, raw_text: str) -> dict[str, Any]:
        """Safely parse JSON from raw model output."""
        cleaned = self.clean_json_markdown(raw_text)
        try:
            data = json.loads(cleaned)
            if not isinstance(data, dict):
                raise AIProviderResponseError(f"Expected JSON object, got {type(data).__name__}: {raw_text[:200]}")
            return data
        except json.JSONDecodeError as exc:
            raise AIProviderResponseError(f"Failed parsing model JSON response: {exc}. Raw: {raw_text[:200]}") from exc

    def validate_choice_key(self, selected_key: str, valid_choices: list[AIChoiceInput]) -> str:
        """
        Validate that the model's selected answer exists among valid choices.
        Tolerates minor casing/trimming mismatches if unambiguous.
        """
        norm_key = str(selected_key).strip()
        valid_keys = [c.choice_key for c in valid_choices]

        if norm_key in valid_keys:
            return norm_key

        # Try case-insensitive or ordinal matching if choice_key was an integer or single char
        for c in valid_choices:
            if norm_key.lower() == c.choice_key.lower() or norm_key == str(c.label).strip():
                return c.choice_key

        raise AIProviderResponseError(
            f"Model selected choice key '{selected_key}' which does not exist in valid choices: {valid_keys}"
        )


class ProviderRegistry:
    """Registry of available LLM providers."""

    _registry: dict[str, Type[BaseAIProvider]] = {}

    @classmethod
    def register(cls, name: str, provider_cls: Type[BaseAIProvider]) -> None:
        """Register a provider implementation under a canonical name."""
        cls._registry[name.strip().lower()] = provider_cls

    @classmethod
    def create(
        cls,
        name: str,
        model: str,
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
    ) -> BaseAIProvider:
        """Instantiate a registered provider."""
        canon_name = name.strip().lower()
        if canon_name not in cls._registry:
            raise ValueError(f"Unknown AI provider '{name}'. Available: {sorted(cls._registry.keys())}")
        return cls._registry[canon_name](
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )

    @classmethod
    def available_providers(cls) -> list[str]:
        """List registered provider names."""
        return sorted(cls._registry.keys())

