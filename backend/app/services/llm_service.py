"""
Kiroku Note LLM Core Service & Provider Implementations
------------------------------------------------------
Provider-neutral LLM client supporting Groq, Gemini, Ollama, and None.
Uses only standard library urllib for zero extra runtime dependencies.
"""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from app.config import (
    DEFAULT_OLLAMA_URL,
    get_llm_api_key,
    get_llm_model,
    get_llm_ollama_url,
    get_llm_provider,
    is_llm_configured,
    resolve_default_llm_model,
)
from app.schemas import LLMChatMessage


# ============================================================================
# Exceptions
# ============================================================================

class LLMError(Exception):
    """Base exception for LLM operations."""
    pass


class LLMNotConfiguredError(LLMError):
    """Raised when the LLM provider is 'none' or missing credentials."""
    pass


class LLMTimeoutError(LLMError):
    """Raised when an LLM upstream request times out."""
    pass


class LLMConnectionError(LLMError):
    """Raised when connection to LLM provider fails or is refused."""
    pass


class LLMAPIError(LLMError):
    """Raised when LLM provider returns non-200 HTTP error."""
    pass


class LLMResponseError(LLMError):
    """Raised when LLM response is malformed or missing expected fields."""
    pass


# ============================================================================
# Built-in System Prompts
# ============================================================================

PROMPT_TRANSLATE = (
    "Translate the following Japanese text to English naturally. "
    "Reply with only the translation. Do not use emojis in your response."
)

PROMPT_EXPLAIN_SENSE = (
    "The word '{word}' appears in this Japanese sentence: '{text}'. "
    "The dictionary gives these meanings: '{context}'. "
    "Which meaning best fits the sentence? Reply in one sentence. Do not use emojis in your response."
)

PROMPT_EXPLAIN_GRAMMAR = (
    "Explain the grammar pattern used in this Japanese sentence in simple English "
    "for a language learner: '{text}'. Do not use emojis in your response."
)

PROMPT_MNEMONIC = (
    "Create a simple, memorable English mnemonic for remembering the Japanese word '{word}' "
    "which means '{context}'. Be creative and brief. Do not use emojis in your response."
)

PROMPT_ANSWER_QUESTION = (
    "Answer the following Japanese question or multiple-choice question clearly. "
    "State the correct answer directly, and explain why that answer is correct with a concise, "
    "step-by-step explanation, breaking down any grammar points, vocabulary nuances, "
    "or distractors for a Japanese language learner. Do not use emojis in your response."
)

PROMPT_CHAT = (
    "You are a friendly, expert Japanese language tutor assisting a language learner "
    "with vocabulary, grammar, and sentence mining. "
    "Answer concisely and accurately in English unless requested otherwise. Do not use emojis in your response."
)



# ============================================================================
# Native HTTP Request Helper
# ============================================================================

def _send_http_json(url: str, data: dict, headers: dict[str, str], timeout: float = 5.0) -> dict:
    """Send JSON payload via standard library urllib and return parsed JSON response."""
    body_bytes = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except (socket.timeout, TimeoutError) as exc:
        raise LLMTimeoutError(f"LLM request timeout after {timeout}s: {exc}") from exc
    except urllib.error.HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise LLMAPIError(f"LLM API error ({exc.code} {exc.reason}): {err_body or exc.reason}") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (socket.timeout, TimeoutError)):
            raise LLMTimeoutError(f"LLM request timed out: {exc.reason}") from exc
        raise LLMConnectionError(f"LLM connection failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise LLMResponseError(f"Malformed JSON response from LLM provider: {exc}") from exc
    except Exception as exc:
        raise LLMError(f"Unexpected error communicating with LLM provider: {exc}") from exc


# ============================================================================
# Provider Implementations
# ============================================================================

class BaseLLMProvider:
    name: str = "base"
    model: Optional[str] = None
    timeout: float = 5.0

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> str:
        raise NotImplementedError


class NoneProvider(BaseLLMProvider):
    name = "none"
    model = None

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> str:
        raise LLMNotConfiguredError(
            "LLM assistant is not configured. Please set KIROKU_LLM_PROVIDER (e.g. groq, gemini, ollama)."
        )


class GroqProvider(BaseLLMProvider):
    name = "groq"

    def __init__(self, api_key: str, model: Optional[str] = None, timeout: float = 5.0):
        self.api_key = api_key
        self.model = model or resolve_default_llm_model("groq") or "llama-3.1-8b-instant"
        self.timeout = timeout

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> str:
        if not self.api_key:
            raise LLMNotConfiguredError("Groq provider requires KIROKU_LLM_API_KEY.")

        groq_messages = []
        if system:
            groq_messages.append({"role": "system", "content": system})
        if messages:
            for m in messages:
                groq_messages.append({"role": m.role, "content": m.content})
        groq_messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": groq_messages,
            "temperature": 0.3,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-LLM/1.0",
        }
        url = "https://api.groq.com/openai/v1/chat/completions"
        data = _send_http_json(url, payload, headers, timeout=self.timeout)

        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"Unexpected response structure from Groq API: {data}") from exc


class GeminiProvider(BaseLLMProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: Optional[str] = None, timeout: float = 5.0):
        self.api_key = api_key
        self.model = model or resolve_default_llm_model("gemini") or "gemini-2.0-flash"
        self.timeout = timeout

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> str:
        if not self.api_key:
            raise LLMNotConfiguredError("Gemini provider requires KIROKU_LLM_API_KEY.")

        payload: dict = {
            "generationConfig": {"temperature": 0.3},
        }
        if system:
            payload["system_instruction"] = {
                "parts": [{"text": system}]
            }

        contents = []
        if messages:
            for m in messages:
                role = "user" if m.role == "user" else "model"
                contents.append({"role": role, "parts": [{"text": m.content}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})
        payload["contents"] = contents

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={urllib.parse.quote(self.api_key)}"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-LLM/1.0",
        }
        data = _send_http_json(url, payload, headers, timeout=self.timeout)

        try:
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"Unexpected response structure from Gemini API: {data}") from exc


class OllamaProvider(BaseLLMProvider):
    name = "ollama"

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None, timeout: float = 5.0):
        self.base_url = (base_url or DEFAULT_OLLAMA_URL).rstrip("/")
        self.model = model or resolve_default_llm_model("ollama") or "qwen2.5:1.5b"
        self.timeout = timeout

    def ask(
        self,
        prompt: str,
        system: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> str:
        ollama_messages = []
        if system:
            ollama_messages.append({"role": "system", "content": system})
        if messages:
            for m in messages:
                ollama_messages.append({"role": m.role, "content": m.content})
        ollama_messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": ollama_messages,
            "stream": False,
        }
        url = f"{self.base_url}/api/chat"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-LLM/1.0",
        }
        data = _send_http_json(url, payload, headers, timeout=self.timeout)

        try:
            return data["message"]["content"].strip()
        except (KeyError, TypeError) as exc:
            raise LLMResponseError(f"Unexpected response structure from Ollama API: {data}") from exc


# ============================================================================
# Service Facade
# ============================================================================

class LLMService:
    """Service facade coordinating LLM provider resolution and task execution."""

    def __init__(
        self,
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
        ollama_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = 5.0,
    ):
        resolved_provider = provider if provider is not None else get_llm_provider()
        resolved_api_key = api_key if api_key is not None else get_llm_api_key()
        resolved_ollama_url = ollama_url if ollama_url is not None else get_llm_ollama_url()
        resolved_model = model if model is not None else get_llm_model()

        self._provider_type = resolved_provider.lower()
        self.provider: BaseLLMProvider

        if self._provider_type == "groq":
            if not resolved_api_key:
                self.provider = NoneProvider()
            else:
                self.provider = GroqProvider(api_key=resolved_api_key, model=resolved_model, timeout=timeout)
        elif self._provider_type == "gemini":
            if not resolved_api_key:
                self.provider = NoneProvider()
            else:
                self.provider = GeminiProvider(api_key=resolved_api_key, model=resolved_model, timeout=timeout)
        elif self._provider_type == "ollama":
            self.provider = OllamaProvider(base_url=resolved_ollama_url, model=resolved_model, timeout=timeout)
        else:
            self.provider = NoneProvider()

    def is_configured(self) -> bool:
        return not isinstance(self.provider, NoneProvider)

    @property
    def provider_name(self) -> str:
        return self.provider.name

    @property
    def model_name(self) -> Optional[str]:
        return self.provider.model

    def ask(
        self,
        task: str,
        text: str,
        context: Optional[str] = None,
        word: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
    ) -> tuple[str, str, str]:
        """
        Execute an assistant task prompt.
        Returns: (result_text, provider_name, model_name)
        """
        if isinstance(self.provider, NoneProvider):
            raise LLMNotConfiguredError(
                "LLM assistant is not configured. Please set KIROKU_LLM_PROVIDER."
            )

        system: Optional[str] = None
        prompt: str = text

        if task == "translate":
            system = PROMPT_TRANSLATE
            prompt = text
        elif task == "explain_sense":
            system = "You are an expert Japanese lexicographer and language teacher. Answer concisely. Do not use emojis in your response."
            target_word = word or text
            ctx = context or "None provided"
            prompt = PROMPT_EXPLAIN_SENSE.format(word=target_word, text=text, context=ctx)
        elif task == "explain_grammar":
            system = "You are an expert Japanese grammar instructor. Answer concisely in simple English. Do not use emojis in your response."
            prompt = PROMPT_EXPLAIN_GRAMMAR.format(text=text)
        elif task == "mnemonic":
            system = "You are an expert Japanese memory coach. Create vivid, brief mnemonics. Do not use emojis in your response."
            target_word = word or text
            ctx = context or "None provided"
            prompt = PROMPT_MNEMONIC.format(word=target_word, context=ctx)
        elif task == "answer_question":
            system = PROMPT_ANSWER_QUESTION
            if context and context.strip():
                prompt = f"Question / Problem:\n{text}\n\nContext / Options / Notes:\n{context.strip()}"
            else:
                prompt = text
        elif task == "chat":
            system = PROMPT_CHAT
            prompt = text
        else:
            # Fallback
            prompt = text

        result = self.provider.ask(prompt=prompt, system=system, messages=messages)
        model = self.model_name or "unknown"
        return result, self.provider_name, model


def get_llm_service() -> LLMService:
    """Factory creating an LLMService instance from current environment variables."""
    return LLMService()
