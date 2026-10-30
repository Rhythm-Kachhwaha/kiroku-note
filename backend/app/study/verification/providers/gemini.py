"""
Google Gemini AI Provider Implementation for Question Verification.
--------------------------------------------------------------------
Implements BaseAIProvider using Google's Generative Language API.
Strictly respects rate limits (15 RPM ceiling -> 4.28s interval),
token conservation (responseMimeType=application/json, low token ceiling),
and standard library urllib for zero external runtime dependencies.
"""
from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from app.study.verification.enums import (
    ConfidenceLevel,
    QuestionValidity,
    SourceClaimAssessmentKind,
)
from app.study.verification.models import (
    AIExplanationRequest,
    AIExplanationResponse,
    AISolveRequest,
    AISolveResponse,
    AISourceClaimAssessment,
    AIVerifyClaimsRequest,
    AIVerifyClaimsResponse,
)
from app.study.verification.prompts import (
    build_explanation_system_prompt,
    build_explanation_user_prompt,
    build_solve_system_prompt,
    build_solve_user_prompt,
    build_verify_claims_system_prompt,
    build_verify_claims_user_prompt,
)
from app.study.verification.providers.base import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
    BaseAIProvider,
)


def sanitize_gemini_error_message(message: str, api_key: str = "") -> str:
    """
    Ensure API keys and credentials never appear in error messages, URLs, or exception logs.
    """
    if not message:
        return ""
    text = str(message)
    if api_key and api_key.strip():
        k = api_key.strip()
        text = text.replace(k, "[REDACTED]")
        text = text.replace(urllib.parse.quote(k, safe=""), "[REDACTED]")
    # Redact any URL query param key= or header traces
    text = re.sub(r"([?&]key=)[^&\s]+", r"\1[REDACTED]", text)
    text = re.sub(r"(x-goog-api-key['\":\s]+)[^\s,'\"}]+", r"\1[REDACTED]", text, flags=re.IGNORECASE)
    return text


class GeminiProvider(BaseAIProvider):
    """Provider specifically configured for Google Gemini APIs."""

    name: str = "gemini"

    def __init__(
        self,
        model: str = "gemini-3.5-flash-lite",
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 1,
        compact: bool = True,
        min_delay: float = 4.3,
    ) -> None:
        actual_model = model if model and model.strip() else "gemini-3.5-flash-lite"
        # Support fallback if gemini-3.5-flash is passed
        if actual_model == "gemini-3.5-flash":
            actual_model = "gemini-3.6-flash"

        super().__init__(
            model=actual_model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            compact=compact,
        )
        self.min_delay = min_delay
        self._last_request_time = 0.0

    def _resolve_url(self) -> str:
        base = (self.base_url or "https://generativelanguage.googleapis.com").rstrip("/")
        return f"{base}/v1beta/models/{self.model_name}:generateContent"

    def _send_generate_content(
        self,
        system_instruction: str,
        user_prompt: str,
        max_tokens: int = 100,
    ) -> tuple[str, dict[str, int], int]:
        """
        Send generateContent request to Gemini with retry handling and rate limiting.
        Returns: (content_string, token_usage_dict, execution_time_ms)
        """
        payload: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": max_tokens,
                "responseMimeType": "application/json",
            },
        }
        if system_instruction.strip():
            payload["system_instruction"] = {
                "parts": [{"text": system_instruction.strip()}]
            }

        url = self._resolve_url()
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-StudyBank/1.0",
        }
        if self.api_key and self.api_key.strip():
            headers["x-goog-api-key"] = self.api_key.strip()

        body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")

        retries_left = self.max_retries
        backoff_sec = 2.0

        while True:
            if self.min_delay > 0:
                elapsed = time.time() - self._last_request_time
                if elapsed < self.min_delay:
                    time.sleep(self.min_delay - elapsed)
                self._last_request_time = time.time()

            start_time = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw_data = resp.read().decode("utf-8")
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    parsed_body = json.loads(raw_data)

                    candidates = parsed_body.get("candidates")
                    if not candidates or not isinstance(candidates, list):
                        safe_preview = sanitize_gemini_error_message(raw_data[:200], self.api_key)
                        raise AIProviderResponseError(f"Missing candidates in Gemini response: {safe_preview}")

                    parts = candidates[0].get("content", {}).get("parts", [])
                    if not parts or not isinstance(parts, list):
                        safe_preview = sanitize_gemini_error_message(raw_data[:200], self.api_key)
                        raise AIProviderResponseError(f"Missing parts in Gemini candidate content: {safe_preview}")

                    content = parts[0].get("text", "")
                    usage = parsed_body.get("usageMetadata", {})
                    token_usage = {
                        "prompt_tokens": usage.get("promptTokenCount", 0),
                        "completion_tokens": usage.get("candidatesTokenCount", 0),
                        "total_tokens": usage.get("totalTokenCount", 0),
                    }
                    return content, token_usage, duration_ms

            except urllib.error.HTTPError as exc:
                err_text = ""
                try:
                    err_text = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass

                err_text = sanitize_gemini_error_message(err_text, self.api_key)
                reason = sanitize_gemini_error_message(str(exc.reason), self.api_key)

                if exc.code in (401, 403):
                    raise AIProviderAuthError(f"Gemini authentication failure ({exc.code}): {err_text or reason}") from exc
                if exc.code == 429:
                    if retries_left > 0:
                        retries_left -= 1
                        time.sleep(backoff_sec)
                        backoff_sec *= 2
                        continue
                    raise AIProviderRateLimitError(f"Gemini rate limit exceeded (429): {err_text or reason}") from exc

                if 500 <= exc.code <= 599 and retries_left > 0:
                    retries_left -= 1
                    time.sleep(backoff_sec)
                    backoff_sec *= 2
                    continue

                raise AIProviderError(f"Gemini HTTP error ({exc.code}): {err_text or reason}") from exc

            except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
                raw_reason = getattr(exc, "reason", exc)
                reason = sanitize_gemini_error_message(str(raw_reason), self.api_key)
                if isinstance(raw_reason, (socket.timeout, TimeoutError)) or "timed out" in reason.lower():
                    if retries_left > 0:
                        retries_left -= 1
                        time.sleep(backoff_sec)
                        backoff_sec *= 2
                        continue
                    raise AIProviderTimeoutError(f"Gemini request timed out after {self.timeout}s: {reason}") from exc

                if retries_left > 0:
                    retries_left -= 1
                    time.sleep(backoff_sec)
                    backoff_sec *= 2
                    continue
                raise AIProviderError(f"Gemini connection failure: {reason}") from exc

            except json.JSONDecodeError as exc:
                safe_exc = sanitize_gemini_error_message(str(exc), self.api_key)
                raise AIProviderResponseError(f"Malformed JSON from Gemini API: {safe_exc}") from exc

    def solve_question(self, req: AISolveRequest) -> AISolveResponse:
        system_prompt = build_solve_system_prompt(compact=self.compact)
        user_prompt = build_solve_user_prompt(req, compact=self.compact)

        token_ceiling = 120 if self.compact else 1000
        raw_content, token_usage, duration_ms = self._send_generate_content(
            system_instruction=system_prompt,
            user_prompt=user_prompt,
            max_tokens=token_ceiling,
        )
        parsed = self.parse_json_payload(raw_content)

        raw_selected = parsed.get("selected_answer")
        if raw_selected is None:
            safe_preview = sanitize_gemini_error_message(raw_content[:200], self.api_key)
            raise AIProviderResponseError(f"Missing 'selected_answer' in Gemini solve output: {safe_preview}")

        validated_choice_key = self.validate_choice_key(str(raw_selected), req.choices)

        raw_conf = str(parsed.get("confidence", "high")).strip().lower()
        confidence = ConfidenceLevel.HIGH
        if raw_conf in ("medium", "med"):
            confidence = ConfidenceLevel.MEDIUM
        elif raw_conf == "low":
            confidence = ConfidenceLevel.LOW

        raw_validity = str(parsed.get("question_validity", "valid")).strip().lower()
        validity = QuestionValidity.VALID
        if raw_validity == "ambiguous":
            validity = QuestionValidity.AMBIGUOUS
        elif raw_validity == "defective":
            validity = QuestionValidity.DEFECTIVE

        ambiguity_detected = bool(parsed.get("ambiguity_detected", False)) or (validity == QuestionValidity.AMBIGUOUS)

        return AISolveResponse(
            selected_choice_key=validated_choice_key,
            confidence=confidence,
            reasoning=str(parsed.get("reasoning", "")).strip(),
            choice_analysis={str(k): str(v) for k, v in parsed.get("choice_analysis", {}).items()},
            question_validity=validity,
            ambiguity_detected=ambiguity_detected,
            notes=[str(n) for n in parsed.get("notes", [])],
            execution_time_ms=duration_ms,
            token_usage=token_usage,
            raw_response=raw_content,
        )

    def verify_source_claims(self, req: AIVerifyClaimsRequest) -> AIVerifyClaimsResponse:
        system_prompt = build_verify_claims_system_prompt()
        user_prompt = build_verify_claims_user_prompt(req)

        raw_content, token_usage, duration_ms = self._send_generate_content(
            system_instruction=system_prompt,
            user_prompt=user_prompt,
            max_tokens=500,
        )
        parsed = self.parse_json_payload(raw_content)

        raw_assessments = parsed.get("assessments", [])
        assessments: list[AISourceClaimAssessment] = []

        for item in raw_assessments:
            claim_id = item.get("claim_id", 0)
            claimed_key = str(item.get("claimed_choice_key", "")).strip()

            raw_kind = str(item.get("assessment", "supported")).strip().lower()
            kind = SourceClaimAssessmentKind.SUPPORTED
            if "contradict" in raw_kind or "disagree" in raw_kind or "incorrect" in raw_kind:
                kind = SourceClaimAssessmentKind.CONTRADICTED
            elif "plausible" in raw_kind or "alternative" in raw_kind:
                kind = SourceClaimAssessmentKind.PLAUSIBLE_ALTERNATIVE

            raw_conf = str(item.get("confidence", "high")).strip().lower()
            confidence = ConfidenceLevel.HIGH
            if raw_conf in ("medium", "med"):
                confidence = ConfidenceLevel.MEDIUM
            elif raw_conf == "low":
                confidence = ConfidenceLevel.LOW

            assessments.append(
                AISourceClaimAssessment(
                    claim_id=claim_id,
                    claimed_choice_key=claimed_key,
                    assessment=kind,
                    confidence=confidence,
                    rationale=str(item.get("rationale", "")).strip(),
                )
            )

        return AIVerifyClaimsResponse(
            opinion_changed=bool(parsed.get("opinion_changed", False)),
            revised_choice_key=str(parsed.get("revised_choice_key")).strip() if parsed.get("revised_choice_key") else None,
            revised_reasoning=str(parsed.get("revised_reasoning")).strip() if parsed.get("revised_reasoning") else None,
            assessments=assessments,
            execution_time_ms=duration_ms,
            token_usage=token_usage,
            raw_response=raw_content,
        )

    def generate_explanation(self, req: AIExplanationRequest) -> AIExplanationResponse:
        system_prompt = build_explanation_system_prompt()
        user_prompt = build_explanation_user_prompt(req)

        raw_content, token_usage, duration_ms = self._send_generate_content(
            system_instruction=system_prompt,
            user_prompt=user_prompt,
            max_tokens=1000,
        )
        parsed = self.parse_json_payload(raw_content)

        return AIExplanationResponse(
            target_choice_key=str(parsed.get("target_choice_key", req.target_choice_key)).strip(),
            summary=str(parsed.get("summary", "")).strip(),
            correct_choice_analysis=str(parsed.get("correct_choice_analysis", "")).strip(),
            distractor_analysis={str(k): str(v) for k, v in parsed.get("distractor_analysis", {}).items()},
            grammar_notes=str(parsed.get("grammar_notes", "")).strip() or None,
            kanji_vocabulary_notes=str(parsed.get("kanji_vocabulary_notes", "")).strip() or None,
            reading_context_notes=str(parsed.get("reading_context_notes", "")).strip() or None,
            execution_time_ms=duration_ms,
            token_usage=token_usage,
            raw_response=raw_content,
        )

