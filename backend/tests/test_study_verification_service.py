"""
Targeted tests for VerificationService workflow.
------------------------------------------------
Covers:
- Stage 1 independent solving: strict isolation from source answers and cross-model leakage
- Stage 2 second-stage source claim verification
- Stage 3 deterministic comparator integration
- Stage 4 pedagogical explanation generation
- Partial failure handling and audit response preservation
- Graceful behavior when AI verification is disabled or unconfigured
- Batch verification across multiple candidate questions
"""
from __future__ import annotations

import pytest

from app.study.contracts.enums import JlptLevel, QuestionCategory, StructuralFamily
from app.study.ingestion.models import (
    CandidateClassification,
    CandidateQuestion,
    ChoiceDraft,
    QuestionDraft,
)
from app.study.verification.enums import (
    ComparisonScenario,
    ConfidenceLevel,
    ModelSlot,
    VerificationStage,
    VerificationStatus,
)
from app.study.verification.models import (
    AIChoiceInput,
    AISolveRequest,
    AISourceClaimInput,
)
from app.study.verification.providers import MockAIProvider
from app.study.verification.service import VerificationService


@pytest.fixture
def sample_candidate() -> CandidateQuestion:
    draft = QuestionDraft(
        draft_id="cand_1",
        section_header="問題1",
        instruction_text="言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。",
        raw_stem="あの{u|山}は高いです。",
        raw_choices=[
            ChoiceDraft(ordinal=1, label="1", text="かわ"),
            ChoiceDraft(ordinal=2, label="2", text="やま"),
            ChoiceDraft(ordinal=3, label="3", text="うみ"),
            ChoiceDraft(ordinal=4, label="4", text="き"),
        ],
        source_answer_key="2",
        source_answer_rationale="山 reading is やま",
    )
    classification = CandidateClassification(
        format_code="kanji_reading",
        structural_family=StructuralFamily.F1,
        category=QuestionCategory.VOCABULARY,
        level=JlptLevel.N5,
        confidence=1.0,
    )
    return CandidateQuestion(draft=draft, classification=classification)


def test_independent_solving_isolation(sample_candidate: CandidateQuestion):
    """
    CRITICAL: Verify that neither Model A nor Model B receives source answer keys
    or cross-model output during initial Stage 1 solving.
    """
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    req, source_claims = service.build_solve_request_from_candidate(sample_candidate)

    # Verify AISolveRequest schema has no source answer attributes
    assert not hasattr(req, "source_answer_key")
    assert not hasattr(req, "source_claims")

    record = service.verify_solve_request(req, source_claims=source_claims)

    # 1. Verify Model A call received only question text and choices
    assert len(prov_a.solve_calls) == 1
    call_a = prov_a.solve_calls[0]
    assert call_a.stem_plain == "あの山は高いです。"
    assert len(call_a.choices) == 4

    # 2. Verify Model B call was independent
    assert len(prov_b.solve_calls) == 1
    call_b = prov_b.solve_calls[0]
    assert call_b.stem_plain == "あの山は高いです。"

    # 3. Verify comparison status is AGREEMENT
    assert record.status == VerificationStatus.AGREEMENT
    assert record.comparison.agreed_choice == "2"

    # 4. Verify stage 2 calls occurred after stage 1
    assert len(prov_a.verify_calls) == 1
    assert len(prov_b.verify_calls) == 1
    assert prov_a.verify_calls[0].independent_selected_choice_key == "2"

    # 5. Verify explanation was synthesized
    assert record.explanation is not None
    assert record.explanation.target_choice_key == "2"


def test_partial_failure_preserves_successful_model():
    """Verify that if Model B fails, Model A's successful solve is preserved."""
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", raise_timeout=True)

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    req = AISolveRequest(
        format_code="kanji_reading",
        structural_family="F1",
        level="N5",
        category="vocabulary",
        stem_markup="テスト",
        stem_plain="テスト",
        choices=[AIChoiceInput(choice_key="1", label="1"), AIChoiceInput(choice_key="2", label="2")],
    )

    record = service.verify_solve_request(req)
    assert record.status == VerificationStatus.VERIFICATION_FAILED
    assert record.comparison.scenario == ComparisonScenario.SCENARIO_H_MODEL_FAILURE
    assert record.comparison.model_a_choice == "2"
    assert record.comparison.model_b_choice is None

    # Check preserved responses
    resp_slots = [r.model_slot for r in record.model_responses]
    assert ModelSlot.MODEL_A in resp_slots
    assert ModelSlot.MODEL_B in resp_slots


def test_disabled_service_returns_not_verified():
    """Verify that if AI verification is disabled, service returns NOT_VERIFIED gracefully."""
    service = VerificationService(provider_a=None, provider_b=None)
    assert service.is_enabled is False

    req = AISolveRequest(
        format_code="kanji_reading",
        structural_family="F1",
        level="N5",
        category="vocabulary",
        stem_markup="テスト",
        stem_plain="テスト",
        choices=[AIChoiceInput(choice_key="1", label="1")],
    )
    record = service.verify_solve_request(req)
    assert record.status == VerificationStatus.NOT_VERIFIED


def test_batch_verification(sample_candidate: CandidateQuestion):
    """Verify batch processing across candidates with mixed scenarios."""
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")

    # Candidate 2: no source answer
    cand2 = sample_candidate.model_copy(deep=True)
    cand2.candidate_id = "cand_2"
    cand2.draft.source_answer_key = None

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    batch_result = service.batch_verify_candidates([sample_candidate, cand2], persist=False)

    assert batch_result.total_questions == 2
    assert batch_result.verified_count == 2
    assert batch_result.agreement_count == 2
    assert len(batch_result.records) == 2
    assert batch_result.records[0].status == VerificationStatus.AGREEMENT
    assert batch_result.records[1].status == VerificationStatus.AI_AGREEMENT_UNCONFIRMED


def test_model_disagreement_does_not_generate_canonical_explanation(sample_candidate: CandidateQuestion):
    """
    CRITICAL (Audit B): When models disagree, the service must NOT fabricate a canonical
    explanation asserting one answer is correct. Both models' answers and reasoning must
    be preserved in model_responses, and the question flagged for human review.
    """
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="3")

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    req, source_claims = service.build_solve_request_from_candidate(sample_candidate)

    record = service.verify_solve_request(req, source_claims=source_claims)

    assert record.status == VerificationStatus.MODEL_DISAGREEMENT
    assert record.explanation is None, "Must not generate canonical explanation on model disagreement"

    # Verify both models' outputs are preserved in audit log
    slots = [r.model_slot for r in record.model_responses if r.stage == VerificationStage.INDEPENDENT_SOLVE]
    assert ModelSlot.MODEL_A in slots
    assert ModelSlot.MODEL_B in slots


def test_conflicting_sources_do_not_generate_canonical_explanation(sample_candidate: CandidateQuestion):
    """
    CRITICAL (Audit B): When multiple external source claims conflict, the service
    must NOT silently pick one source to generate an explanation.
    """
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    req, _ = service.build_solve_request_from_candidate(sample_candidate)

    conflicting_claims = [
        AISourceClaimInput(claim_id=1, source_name="Book A", claimed_choice_key="2"),
        AISourceClaimInput(claim_id=2, source_name="Book B", claimed_choice_key="3"),
    ]
    record = service.verify_solve_request(req, source_claims=conflicting_claims)

    assert record.status == VerificationStatus.SOURCE_CLAIM_CONFLICT
    assert record.explanation is None, "Must not generate canonical explanation on conflicting sources"


def test_ambiguous_question_does_not_generate_canonical_explanation(sample_candidate: CandidateQuestion):
    """
    CRITICAL (Audit B): When a question is flagged ambiguous by a model, the service
    must NOT generate a canonical explanation asserting a single correct answer.
    """
    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2", ambiguity_detected=True)
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")

    service = VerificationService(provider_a=prov_a, provider_b=prov_b)
    req, source_claims = service.build_solve_request_from_candidate(sample_candidate)

    record = service.verify_solve_request(req, source_claims=source_claims)

    assert record.status == VerificationStatus.QUESTION_AMBIGUOUS
    assert record.explanation is None


