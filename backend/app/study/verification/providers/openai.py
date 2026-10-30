"""
OpenAI-Compatible AI Provider Implementation.
----------------------------------------------
Implements BaseAIProvider using the standard OpenAI chat completions API format.
Works with OpenAI, local proxies (vLLM, Ollama OpenAI compatibility), Groq, etc.
Uses strictly standard library urllib for zero extra runtime dependencies.
"""
from __future__ import annotations

import json
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


class OpenAICompatibleProvider(BaseAIProvider):
    """Provider for any OpenAI-compatible chat completions endpoint."""

    name: str = "openai_compatible"
    default_endpoint: str = "https://api.openai.com/v1/chat/completions"

    def __init__(
        self,
        model: str,
        api_key: str = "",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
    ) -> None:
        super().__init__(
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )
        self._endpoint = self._resolve_endpoint()

    def _resolve_endpoint(self) -> str:
        """Resolve full completions URL from base_url or default."""
        if not self.base_url or not self.base_url.strip():
            return self.default_endpoint

        url = self.base_url.strip().rstrip("/")
        if url.endswith("/chat/completions"):
            return url
        if url.endswith("/v1"):
            return f"{url}/chat/completions"
        return f"{url}/v1/chat/completions"

    def _send_chat_completion(self, system_prompt: str, user_prompt: str) -> tuple[str, dict[str, int], int]:
        """
        Send chat completion request with retry handling.
        Returns: (assistant_content_string, token_usage_dict, execution_time_ms)
        """
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
        }
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "KirokuNote-StudyBank/1.0",
        }
        if self.api_key.strip():
            headers["Authorization"] = f"Bearer {self.api_key.strip()}"

        body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self._endpoint, data=body_bytes, headers=headers, method="POST")

        retries_left = self.max_retries
        backoff_sec = 1.0

        while True:
            start_time = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw_data = resp.read().decode("utf-8")
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    parsed_body = json.loads(raw_data)

                    choices = parsed_body.get("choices")
                    if not choices or not isinstance(choices, list):
                        raise AIProviderResponseError(f"Missing choices in completion response: {raw_data[:200]}")

                    content = choices[0].get("message", {}).get("content", "")
                    usage = parsed_body.get("usage", {})
                    token_usage = {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                    }
                    return content, token_usage, duration_ms

            except urllib.error.HTTPError as exc:
                err_text = ""
                try:
                    err_text = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    pass

                if exc.code in (401, 403):
                    raise AIProviderAuthError(f"Authentication failure ({exc.code}): {err_text or exc.reason}") from exc
                if exc.code == 429:
                    if retries_left > 0:
                        retries_left -= 1
                        time.sleep(backoff_sec)
                        backoff_sec *= 2
                        continue
                    raise AIProviderRateLimitError(f"Rate limit exceeded (429): {err_text or exc.reason}") from exc

                # 5xx Server errors are retryable
                if 500 <= exc.code <= 599 and retries_left > 0:
                    retries_left -= 1
                    time.sleep(backoff_sec)
                    backoff_sec *= 2
                    continue

                raise AIProviderError(f"HTTP error ({exc.code}): {err_text or exc.reason}") from exc

            except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
                # Check for timeout
                reason = getattr(exc, "reason", exc)
                if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
                    if retries_left > 0:
                        retries_left -= 1
                        time.sleep(backoff_sec)
                        backoff_sec *= 2
                        continue
                    raise AIProviderTimeoutError(f"Request timed out after {self.timeout}s: {reason}") from exc

                if retries_left > 0:
                    retries_left -= 1
                    time.sleep(backoff_sec)
                    backoff_sec *= 2
                    continue
                raise AIProviderError(f"Connection failure to {self._endpoint}: {reason}") from exc

            except json.JSONDecodeError as exc:
                raise AIProviderResponseError(f"Malformed JSON from API endpoint: {exc}") from exc

    # -------------------------------------------------------------------------
    # Stage 1: Independent Solve
    # -------------------------------------------------------------------------
    def solve_question(self, req: AISolveRequest) -> AISolveResponse:
        system_prompt = build_solve_system_prompt()
        user_prompt = build_solve_user_prompt(req)

        raw_content, token_usage, duration_ms = self._send_chat_completion(system_prompt, user_prompt)
        parsed = self.parse_json_payload(raw_content)

        raw_selected = parsed.get("selected_answer")
        if raw_selected is None:
            raise AIProviderResponseError(f"Missing 'selected_answer' in model solve output: {raw_content[:200]}")

        validated_choice_key = self.validate_choice_key(str(raw_selected), req.choices)

        # Parse confidence
        raw_conf = str(parsed.get("confidence", "high")).strip().lower()
        confidence = ConfidenceLevel.HIGH
        if raw_conf in ("medium", "med"):
            confidence = ConfidenceLevel.MEDIUM
        elif raw_conf == "low":
            confidence = ConfidenceLevel.LOW

        # Parse validity & ambiguity
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

    # -------------------------------------------------------------------------
    # Stage 2: Source Claim Verification
    # -------------------------------------------------------------------------
    def verify_source_claims(self, req: AIVerifyClaimsRequest) -> AIVerifyClaimsResponse:
        system_prompt = build_verify_claims_system_prompt()
        user_prompt = build_verify_claims_user_prompt(req)

        raw_content, token_usage, duration_ms = self._send_chat_completion(system_prompt, user_prompt)
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
            conf = ConfidenceLevel.HIGH
            if raw_conf == "medium":
                conf = ConfidenceLevel.MEDIUM
            elif raw_conf == "low":
                conf = ConfidenceLevel.LOW

            assessments.append(
                AISourceClaimAssessment(
                    claim_id=claim_id,
                    claimed_choice_key=claimed_key,
                    assessment=kind,
                    rationale=str(item.get("rationale", "")).strip(),
                    confidence=conf,
                )
            )

        opinion_changed = bool(parsed.get("opinion_changed", False))
        revised_key = parsed.get("revised_choice_key")
        if revised_key:
            try:
                revised_key = self.validate_choice_key(str(revised_key), req.choices)
            except Exception:
                revised_key = None

        return AIVerifyClaimsResponse(
            assessments=assessments,
            opinion_changed=opinion_changed,
            revised_choice_key=revised_key,
            revised_reasoning=parsed.get("revised_reasoning"),
            execution_time_ms=duration_ms,
            token_usage=token_usage,
            raw_response=raw_content,
        )

    # -------------------------------------------------------------------------
    # Stage 3: Pedagogical Explanation Generation
    # -------------------------------------------------------------------------
    def generate_explanation(self, req: AIExplanationRequest) -> AIExplanationResponse:
        system_prompt = build_explanation_system_prompt()
        user_prompt = build_explanation_user_prompt(req)

        raw_content, token_usage, duration_ms = self._send_chat_completion(system_prompt, user_prompt)
        parsed = self.parse_json_payload(raw_content)

        summary = str(parsed.get("summary", "")).strip()
        correct_analysis = str(parsed.get("correct_choice_analysis", "")).strip()
        distractors = {str(k): str(v) for k, v in parsed.get("distractor_analysis", {}).items()}

        return AIExplanationResponse(
            target_choice_key=req.target_choice_key,
            summary=summary,
            correct_choice_analysis=correct_analysis,
            distractor_analysis=distractors,
            grammar_notes=str(parsed.get("grammar_notes", "")).strip(),
            kanji_vocabulary_notes=str(parsed.get("kanji_vocabulary_notes", "")).strip(),
            reading_context_notes=str(parsed.get("reading_context_notes", "")).strip(),
            execution_time_ms=duration_ms,
            token_usage=token_usage,
            raw_response=raw_content,
        )

