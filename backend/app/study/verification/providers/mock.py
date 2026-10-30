"""
Mock AI Provider for Offline Testing and Verification Simulations.
------------------------------------------------------------------
Provides reproducible, deterministic, and configurable AI responses without
requiring real network connections or paid API tokens.
"""
from __future__ import annotations

import time
from typing import Any

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
from app.study.verification.providers.base import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
    BaseAIProvider,
)


class MockAIProvider(BaseAIProvider):
    """Configurable mock provider for tests."""

    name: str = "mock"

    def __init__(
        self,
        model: str = "mock-model-v1",
        api_key: str = "mock-secret-key",
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        default_selected_choice: str = "1",
        confidence: ConfidenceLevel = ConfidenceLevel.HIGH,
        question_validity: QuestionValidity = QuestionValidity.VALID,
        ambiguity_detected: bool = False,
        raise_timeout: bool = False,
        raise_auth_error: bool = False,
        raise_rate_limit: bool = False,
        return_invalid_json: bool = False,
        return_invalid_choice_key: bool = False,
        simulated_delay_ms: int = 5,
    ) -> None:
        super().__init__(
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
        )
        self.default_selected_choice = default_selected_choice
        self.confidence = confidence
        self.question_validity = question_validity
        self.ambiguity_detected = ambiguity_detected
        self.raise_timeout = raise_timeout
        self.raise_auth_error = raise_auth_error
        self.raise_rate_limit = raise_rate_limit
        self.return_invalid_json = return_invalid_json
        self.return_invalid_choice_key = return_invalid_choice_key
        self.simulated_delay_ms = simulated_delay_ms

        # Audit calls made to this mock
        self.solve_calls: list[AISolveRequest] = []
        self.verify_calls: list[AIVerifyClaimsRequest] = []
        self.explanation_calls: list[AIExplanationRequest] = []

        # Optional canned mapping from question stem or id to specific choice_key
        self.canned_answers: dict[str, str] = {}

    def set_canned_answer(self, key: str, choice_key: str) -> None:
        """Set a specific answer for a question identifier or stem fragment."""
        self.canned_answers[key] = choice_key

    def _simulate_failure_if_configured(self) -> None:
        """Trigger simulated errors if flags are set."""
        if self.raise_auth_error:
            raise AIProviderAuthError("Simulated 401 Unauthorized API error.")
        if self.raise_rate_limit:
            raise AIProviderRateLimitError("Simulated 429 Rate Limit Exceeded.")
        if self.raise_timeout:
            raise AIProviderTimeoutError(f"Simulated timeout after {self.timeout}s.")
        if self.return_invalid_json:
            raise AIProviderResponseError("Simulated unparseable model response: {invalid_json:")

    def solve_question(self, req: AISolveRequest) -> AISolveResponse:
        self.solve_calls.append(req)
        self._simulate_failure_if_configured()

        if self.simulated_delay_ms > 0:
            time.sleep(self.simulated_delay_ms / 1000.0)

        # Determine choice
        chosen = self.default_selected_choice
        if req.question_id and req.question_id in self.canned_answers:
            chosen = self.canned_answers[req.question_id]
        elif req.stem_plain in self.canned_answers:
            chosen = self.canned_answers[req.stem_plain]

        if self.return_invalid_choice_key:
            chosen = "INVALID_CHOICE_KEY_999"

        validated_key = self.validate_choice_key(chosen, req.choices)

        choice_analysis: dict[str, str] = {}
        for c in req.choices:
            if c.choice_key == validated_key:
                choice_analysis[c.choice_key] = f"Choice [{c.choice_key}] is the grammatically and semantically correct answer."
            else:
                choice_analysis[c.choice_key] = f"Choice [{c.choice_key}] is incorrect in this grammatical context."

        return AISolveResponse(
            selected_choice_key=validated_key,
            confidence=self.confidence,
            reasoning=f"Mock analysis concluding choice [{validated_key}] is correct.",
            choice_analysis=choice_analysis,
            question_validity=self.question_validity,
            ambiguity_detected=self.ambiguity_detected or (self.question_validity == QuestionValidity.AMBIGUOUS),
            notes=["Mock test solver note."],
            execution_time_ms=self.simulated_delay_ms,
            token_usage={"prompt_tokens": 150, "completion_tokens": 50, "total_tokens": 200},
            raw_response=f'{{"selected_answer": "{validated_key}"}}',
        )

    def verify_source_claims(self, req: AIVerifyClaimsRequest) -> AIVerifyClaimsResponse:
        self.verify_calls.append(req)
        self._simulate_failure_if_configured()

        assessments: list[AISourceClaimAssessment] = []
        for claim in req.source_claims:
            is_match = claim.claimed_choice_key == req.independent_selected_choice_key
            kind = SourceClaimAssessmentKind.SUPPORTED if is_match else SourceClaimAssessmentKind.CONTRADICTED
            assessments.append(
                AISourceClaimAssessment(
                    claim_id=claim.claim_id,
                    claimed_choice_key=claim.claimed_choice_key,
                    assessment=kind,
                    rationale=f"Claim choice [{claim.claimed_choice_key}] "
                              f"{'matches' if is_match else 'contradicts'} independent solution [{req.independent_selected_choice_key}].",
                    confidence=ConfidenceLevel.HIGH,
                )
            )

        return AIVerifyClaimsResponse(
            assessments=assessments,
            opinion_changed=False,
            revised_choice_key=None,
            revised_reasoning=None,
            execution_time_ms=self.simulated_delay_ms,
            token_usage={"prompt_tokens": 120, "completion_tokens": 40, "total_tokens": 160},
            raw_response='{"assessments": []}',
        )

    def generate_explanation(self, req: AIExplanationRequest) -> AIExplanationResponse:
        self.explanation_calls.append(req)
        self._simulate_failure_if_configured()

        distractors: dict[str, str] = {}
        for c in req.choices:
            if c.choice_key != req.target_choice_key:
                distractors[c.choice_key] = f"Choice [{c.choice_key}] is a distractor because it conveys a different nuance."

        return AIExplanationResponse(
            target_choice_key=req.target_choice_key,
            summary=f"The correct answer is choice [{req.target_choice_key}], which matches official JLPT standards.",
            correct_choice_analysis=f"Detailed pedagogical rationale for [{req.target_choice_key}].",
            distractor_analysis=distractors,
            grammar_notes="Demonstrates standard N-level grammatical structure.",
            kanji_vocabulary_notes="Key vocabulary terms and kanji readings analyzed.",
            reading_context_notes="Contextual inference based on passage cues.",
            execution_time_ms=self.simulated_delay_ms,
            token_usage={"prompt_tokens": 200, "completion_tokens": 100, "total_tokens": 300},
            raw_response='{"summary": "Mock explanation"}',
        )

