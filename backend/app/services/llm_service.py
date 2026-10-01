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
    DEFAULT_LLM_JLPT_LEVEL,
    DEFAULT_LLM_TIMEOUT,
    DEFAULT_OLLAMA_URL,
    VALID_JLPT_LEVELS,
    get_llm_api_key,
    get_llm_jlpt_level,
    get_llm_model,
    get_llm_ollama_url,
    get_llm_provider,
    is_llm_configured,
    resolve_default_llm_model,
    resolve_llm_timeout,
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
# Task-Specific Prompt Synthesis
# ============================================================================

SUPPORTED_LLM_TASKS = {
    "translate",
    "explain_sense",
    "explain_grammar",
    "mnemonic",
    "answer_question",
    "chat",
}


def build_system_instruction(
    task: str,
    jlpt_level: Optional[str] = None,
    mode: str = "short",
) -> str:
    """
    Construct a compact, task-specific system instruction encoding Kiroku core behavior,
    the learner's JLPT level, and response brevity mode.
    """
    level = (
        jlpt_level.strip().upper()
        if jlpt_level and str(jlpt_level).strip().upper() in VALID_JLPT_LEVELS
        else get_llm_jlpt_level()
    )
    is_detailed = str(mode).strip().lower() == "detailed"
    mode_desc = (
        "Detailed mode (provide thorough nuance, formation, and distractor breakdowns without filler)"
        if is_detailed
        else "Short mode (concise, direct answer first, minimal essential explanation)"
    )

    base = (
        f"You are Kiroku's Japanese language assistant. "
        f"Learner level: JLPT {level}. "
        f"Response mode: {mode_desc}. "
        f"Be accurate, answer directly, and do not repeat the prompt. "
        f"Do not use markdown tables unless they materially improve clarity. "
        f"Do not use emojis in your response."
    )

    if task == "translate":
        if is_detailed:
            specific = "Translate the Japanese text to natural English, preserving meaning and tone. Briefly note any important nuance or ambiguity if helpful."
        else:
            specific = "Translate the Japanese text to natural English. Output only the translation without commentary."
    elif task == "explain_sense":
        if is_detailed:
            specific = "Identify which provided dictionary sense best matches the sentence. Explain the contextual meaning in depth with nuance."
        else:
            specific = "Identify which provided dictionary sense best matches the sentence. Explain the contextual meaning in 1-2 concise sentences."
    elif task == "explain_grammar":
        if is_detailed:
            specific = "Explain the grammar pattern in context. Include meaning, formation, nuance, key distinctions, and common mistakes where useful. Do not use markdown tables for ordinary explanations."
        else:
            specific = "Explain the grammar pattern concisely. Use a compact structure: Meaning, Usage, and Example. Do not use tables or textbook filler."
    elif task == "answer_question":
        if is_detailed:
            specific = "State the correct choice immediately, then explain why it is correct. Explain distractors individually and break down relevant nuances."
        else:
            specific = "State the correct choice immediately, then explain why with a concise reason. Address distractors only when useful. Do not create lengthy tables or section spam."
    elif task == "mnemonic":
        specific = "Provide a brief, memorable English mnemonic linking pronunciation and meaning. Avoid complicated stories, false etymologies, or long explanations."
    elif task == "chat":
        specific = "Assist the learner with Japanese vocabulary, grammar, reading, or nuance. Answer directly and concisely for their JLPT level."
    else:
        specific = "Assist the learner accurately and concisely."

    return f"{base}\n{specific}"


def build_user_prompt(
    task: str,
    text: str,
    context: Optional[str] = None,
    word: Optional[str] = None,
) -> str:
    """
    Format the user prompt with context and target word without redundant instruction duplication.
    """
    clean_text = text.strip()
    clean_ctx = context.strip() if context and context.strip() else None
    clean_word = word.strip() if word and word.strip() else None

    if task == "translate":
        return clean_text
    elif task == "explain_sense":
        target = clean_word or clean_text
        ctx_str = clean_ctx or "No dictionary definitions provided."
        return f"Target word: {target}\nSentence: {clean_text}\nDictionary senses:\n{ctx_str}"
    elif task == "explain_grammar":
        parts = [f"Sentence: {clean_text}"]
        if clean_word:
            parts.append(f"Grammar pattern: {clean_word}")
        if clean_ctx:
            parts.append(f"Context / Notes:\n{clean_ctx}")
        return "\n\n".join(parts)
    elif task == "mnemonic":
        target = clean_word or clean_text
        ctx_str = clean_ctx or "None"
        return f"Target word: {target}\nMeaning / Context: {ctx_str}"
    elif task == "answer_question":
        if clean_ctx:
            return f"Question / Problem:\n{clean_text}\n\nContext / Options / Notes:\n{clean_ctx}"
        return clean_text
    elif task == "chat":
        if clean_ctx:
            return f"{clean_text}\n\nContext:\n{clean_ctx}"
        return clean_text
    return clean_text


# ============================================================================
# Native HTTP Request Helper
# ============================================================================

def _send_http_json(url: str, data: dict, headers: dict[str, str], timeout: float = DEFAULT_LLM_TIMEOUT) -> dict:
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
        sanitized_reason = str(exc.reason)
        raise LLMAPIError(f"LLM API error ({exc.code} {sanitized_reason}): {err_body or sanitized_reason}") from exc
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
    timeout: float = DEFAULT_LLM_TIMEOUT

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

    def __init__(self, api_key: str, model: Optional[str] = None, timeout: float = DEFAULT_LLM_TIMEOUT):
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

    def __init__(self, api_key: str, model: Optional[str] = None, timeout: float = DEFAULT_LLM_TIMEOUT):
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

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-LLM/1.0",
            "x-goog-api-key": self.api_key,
        }
        data = _send_http_json(url, payload, headers, timeout=self.timeout)

        try:
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"Unexpected response structure from Gemini API: {data}") from exc


class OllamaProvider(BaseLLMProvider):
    name = "ollama"

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None, timeout: float = DEFAULT_LLM_TIMEOUT):
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
        timeout: Optional[float] = None,
    ):
        resolved_provider = provider if provider is not None else get_llm_provider()
        resolved_api_key = api_key if api_key is not None else get_llm_api_key()
        resolved_ollama_url = ollama_url if ollama_url is not None else get_llm_ollama_url()
        resolved_model = model if model is not None else get_llm_model()
        resolved_timeout = timeout if timeout is not None else resolve_llm_timeout()

        self._provider_type = resolved_provider.lower()
        self.timeout = resolved_timeout
        self.provider: BaseLLMProvider

        if self._provider_type == "groq":
            if not resolved_api_key:
                self.provider = NoneProvider()
            else:
                self.provider = GroqProvider(api_key=resolved_api_key, model=resolved_model, timeout=self.timeout)
        elif self._provider_type == "gemini":
            if not resolved_api_key:
                self.provider = NoneProvider()
            else:
                self.provider = GeminiProvider(api_key=resolved_api_key, model=resolved_model, timeout=self.timeout)
        elif self._provider_type == "ollama":
            self.provider = OllamaProvider(base_url=resolved_ollama_url, model=resolved_model, timeout=self.timeout)
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

    def build_prompts(
        self,
        task: str,
        text: str,
        context: Optional[str] = None,
        word: Optional[str] = None,
        mode: str = "short",
        jlpt_level: Optional[str] = None,
    ) -> tuple[str, str]:
        """Synthesize system instruction and user prompt for the given task."""
        system_instruction = build_system_instruction(
            task=task,
            jlpt_level=jlpt_level,
            mode=mode,
        )
        user_prompt = build_user_prompt(
            task=task,
            text=text,
            context=context,
            word=word,
        )
        return system_instruction, user_prompt

    def ask(
        self,
        task: str,
        text: str,
        context: Optional[str] = None,
        word: Optional[str] = None,
        messages: Optional[list[LLMChatMessage]] = None,
        mode: str = "short",
        jlpt_level: Optional[str] = None,
    ) -> tuple[str, str, str]:
        """
        Execute an assistant task prompt.
        Returns: (result_text, provider_name, model_name)
        """
        if task not in SUPPORTED_LLM_TASKS:
            raise ValueError(
                f"Unsupported LLM task: '{task}'. Supported tasks: {', '.join(sorted(SUPPORTED_LLM_TASKS))}."
            )

        if isinstance(self.provider, NoneProvider):
            raise LLMNotConfiguredError(
                "LLM assistant is not configured. Please set KIROKU_LLM_PROVIDER."
            )

        system, prompt = self.build_prompts(
            task=task,
            text=text,
            context=context,
            word=word,
            mode=mode,
            jlpt_level=jlpt_level,
        )

        # Retain only the last 10 messages for prompt construction
        recent_messages = messages[-10:] if messages else None

        result = self.provider.ask(prompt=prompt, system=system, messages=recent_messages)
        model = self.model_name or "unknown"
        return result, self.provider_name, model


def get_llm_service(
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    ollama_url: Optional[str] = None,
    model: Optional[str] = None,
    timeout: Optional[float] = None,
) -> LLMService:
    """Factory creating an LLMService instance from current environment variables or arguments."""
    return LLMService(
        provider=provider,
        api_key=api_key,
        ollama_url=ollama_url,
        model=model,
        timeout=timeout,
    )
