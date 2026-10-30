"""
Targeted tests for AI Provider Abstraction and Adapters.
--------------------------------------------------------
Covers:
- MockAIProvider behavior, canned responses, and simulated failures
- ProviderRegistry resolution and registration
- OpenAICompatibleProvider & XAIProvider endpoint resolution
- Markdown sanitization and JSON parsing
- HTTP error mapping (401 Auth, 429 RateLimit, Timeout, 5xx Retry)
"""
from __future__ import annotations

import io
import json
import socket
from unittest.mock import MagicMock, patch
import urllib.error

import pytest

from app.study.verification.enums import (
    ConfidenceLevel,
    QuestionValidity,
    SourceClaimAssessmentKind,
)
from app.study.verification.models import (
    AIChoiceInput,
    AIExplanationRequest,
    AISolveRequest,
    AISourceClaimInput,
    AIVerifyClaimsRequest,
)
from app.study.verification.providers import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
    MockAIProvider,
    OpenAICompatibleProvider,
    ProviderRegistry,
    XAIProvider,
)


@pytest.fixture
def sample_solve_req() -> AISolveRequest:
    return AISolveRequest(
        question_id="test_q1",
        format_code="kanji_reading",
        structural_family="F1",
        level="N5",
        category="vocabulary",
        instruction_text="言葉の読み方を選びなさい。",
        stem_markup="あの{u|山}は高いです。",
        stem_plain="あの山は高いです。",
        choices=[
            AIChoiceInput(choice_key="1", label="1", text="かわ"),
            AIChoiceInput(choice_key="2", label="2", text="やま"),
            AIChoiceInput(choice_key="3", label="3", text="うみ"),
            AIChoiceInput(choice_key="4", label="4", text="き"),
        ],
    )


def test_mock_provider_solve_and_canned_answers(sample_solve_req: AISolveRequest):
    """Verify MockAIProvider produces deterministic responses and respects canned overrides."""
    mock = MockAIProvider(default_selected_choice="2")
    resp = mock.solve_question(sample_solve_req)
    assert resp.selected_choice_key == "2"
    assert resp.confidence == ConfidenceLevel.HIGH
    assert resp.question_validity == QuestionValidity.VALID
    assert resp.ambiguity_detected is False
    assert "2" in resp.choice_analysis
    assert len(mock.solve_calls) == 1

    # Set canned answer
    mock.set_canned_answer("test_q1", "3")
    resp2 = mock.solve_question(sample_solve_req)
    assert resp2.selected_choice_key == "3"


def test_mock_provider_simulated_failures(sample_solve_req: AISolveRequest):
    """Verify MockAIProvider cleanly simulates network and API failure modes."""
    # 1. Timeout
    m_timeout = MockAIProvider(raise_timeout=True)
    with pytest.raises(AIProviderTimeoutError):
        m_timeout.solve_question(sample_solve_req)

    # 2. Auth error
    m_auth = MockAIProvider(raise_auth_error=True)
    with pytest.raises(AIProviderAuthError):
        m_auth.solve_question(sample_solve_req)

    # 3. Rate limit
    m_rate = MockAIProvider(raise_rate_limit=True)
    with pytest.raises(AIProviderRateLimitError):
        m_rate.solve_question(sample_solve_req)

    # 4. Invalid JSON
    m_json = MockAIProvider(return_invalid_json=True)
    with pytest.raises(AIProviderResponseError):
        m_json.solve_question(sample_solve_req)


def test_mock_provider_rejects_nonexistent_choice(sample_solve_req: AISolveRequest):
    """Verify provider validates choices and rejects invalid choice keys."""
    mock = MockAIProvider(return_invalid_choice_key=True)
    with pytest.raises(AIProviderResponseError) as exc_info:
        mock.solve_question(sample_solve_req)
    assert "does not exist in valid choices" in str(exc_info.value)


def test_mock_provider_source_verify():
    """Verify stage 2 source answer claim evaluation."""
    mock = MockAIProvider()
    verify_req = AIVerifyClaimsRequest(
        question_id="test_q1",
        format_code="kanji_reading",
        level="N5",
        stem_plain="あの山は高いです。",
        choices=[
            AIChoiceInput(choice_key="1", label="1", text="かわ"),
            AIChoiceInput(choice_key="2", label="2", text="やま"),
        ],
        independent_selected_choice_key="2",
        independent_reasoning="山 is read やま.",
        source_claims=[
            AISourceClaimInput(claim_id=10, source_name="Source A", claimed_choice_key="2"),
            AISourceClaimInput(claim_id=11, source_name="Source B", claimed_choice_key="1"),
        ],
    )
    resp = mock.verify_source_claims(verify_req)
    assert len(resp.assessments) == 2
    assert resp.assessments[0].assessment == SourceClaimAssessmentKind.SUPPORTED
    assert resp.assessments[1].assessment == SourceClaimAssessmentKind.CONTRADICTED


def test_mock_provider_generate_explanation():
    """Verify pedagogical explanation generation."""
    mock = MockAIProvider()
    expl_req = AIExplanationRequest(
        format_code="kanji_reading",
        level="N5",
        stem_plain="あの山は高いです。",
        choices=[
            AIChoiceInput(choice_key="1", label="1", text="かわ"),
            AIChoiceInput(choice_key="2", label="2", text="やま"),
        ],
        target_choice_key="2",
    )
    resp = mock.generate_explanation(expl_req)
    assert resp.target_choice_key == "2"
    assert "2" in resp.summary
    assert "1" in resp.distractor_analysis


def test_provider_registry():
    """Verify registry lookups and instantiation."""
    providers = ProviderRegistry.available_providers()
    assert "mock" in providers
    assert "xai" in providers
    assert "openai_compatible" in providers

    instance = ProviderRegistry.create("xai", model="grok-2", api_key="secret")
    assert isinstance(instance, XAIProvider)
    assert instance.model_name == "grok-2"

    with pytest.raises(ValueError) as exc:
        ProviderRegistry.create("nonexistent_provider", model="test")
    assert "Unknown AI provider" in str(exc.value)


def test_json_markdown_cleaning():
    """Verify clean_json_markdown strips code blocks and extracts JSON object."""
    raw1 = "```json\n{\"selected_answer\": \"2\", \"confidence\": \"high\"}\n```"
    cleaned1 = OpenAICompatibleProvider.clean_json_markdown(raw1)
    assert json.loads(cleaned1)["selected_answer"] == "2"

    raw2 = "Here is my evaluation:\n```\n{\"selected_answer\": \"4\"}\n```\nHope this helps!"
    cleaned2 = OpenAICompatibleProvider.clean_json_markdown(raw2)
    assert json.loads(cleaned2)["selected_answer"] == "4"


def test_openai_compatible_endpoint_resolution():
    """Verify URL resolution for OpenAI and custom base endpoints."""
    p_default = OpenAICompatibleProvider(model="gpt-4o", api_key="test")
    assert p_default._endpoint == "https://api.openai.com/v1/chat/completions"

    p_base = OpenAICompatibleProvider(model="local", api_key="", base_url="http://localhost:11434")
    assert p_base._endpoint == "http://localhost:11434/v1/chat/completions"

    p_direct = OpenAICompatibleProvider(model="local", api_key="", base_url="http://localhost:8000/v1/chat/completions")
    assert p_direct._endpoint == "http://localhost:8000/v1/chat/completions"


@patch("urllib.request.urlopen")
def test_openai_compatible_http_success(mock_urlopen, sample_solve_req: AISolveRequest):
    """Verify successful chat completion request and response parsing."""
    resp_payload = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": json.dumps({
                        "selected_answer": "2",
                        "confidence": "high",
                        "reasoning": "山 is read やま in this context.",
                        "choice_analysis": {"2": "Correct reading"},
                        "question_validity": "valid",
                        "ambiguity_detected": False,
                    }),
                }
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
    }

    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(resp_payload).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_urlopen.return_value = mock_resp

    provider = OpenAICompatibleProvider(model="gpt-4o-mini", api_key="test-key")
    resp = provider.solve_question(sample_solve_req)

    assert resp.selected_choice_key == "2"
    assert resp.confidence == ConfidenceLevel.HIGH
    assert resp.token_usage["total_tokens"] == 140


@patch("urllib.request.urlopen")
def test_openai_compatible_http_401_auth_error(mock_urlopen, sample_solve_req: AISolveRequest):
    """Verify 401 raises AIProviderAuthError."""
    http_err = urllib.error.HTTPError(
        url="http://api",
        code=401,
        msg="Unauthorized",
        hdrs={},  # type: ignore[arg-type]
        fp=io.BytesIO(b'{"error": "Invalid API Key"}'),
    )
    mock_urlopen.side_effect = http_err

    provider = OpenAICompatibleProvider(model="gpt-4o-mini", api_key="bad-key", max_retries=0)
    with pytest.raises(AIProviderAuthError):
        provider.solve_question(sample_solve_req)

