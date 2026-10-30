"""
Targeted tests for Deterministic Comparator across all Scenarios A through H.
----------------------------------------------------------------------------
Covers:
- Scenario A: Full agreement with source answer key (AGREEMENT)
- Scenario B: Both models agree, unconfirmed by source (AI_AGREEMENT_UNCONFIRMED)
- Scenario C: One model disagrees with source (MODEL_DISAGREEMENT)
- Scenario D: Both models disagree with source (SOURCE_ANSWER_CONFLICT)
- Scenario E: Models disagree with each other without source (MODEL_DISAGREEMENT)
- Scenario F: Multiple conflicting external source answer keys (SOURCE_CLAIM_CONFLICT)
- Scenario G: Question flagged ambiguous by one or both models (QUESTION_AMBIGUOUS)
- Scenario H: Model execution failure or invalid choice key (VERIFICATION_FAILED)
"""
from __future__ import annotations

import pytest

from app.study.verification.comparator import DeterministicComparator
from app.study.verification.enums import (
    ComparisonScenario,
    ConfidenceLevel,
    QuestionValidity,
    VerificationStatus,
)
from app.study.verification.models import (
    AIChoiceInput,
    AISolveResponse,
    AISourceClaimInput,
)


@pytest.fixture
def choices() -> list[AIChoiceInput]:
    return [
        AIChoiceInput(choice_key="1", label="1", text="かわ"),
        AIChoiceInput(choice_key="2", label="2", text="やま"),
        AIChoiceInput(choice_key="3", label="3", text="うみ"),
        AIChoiceInput(choice_key="4", label="4", text="き"),
    ]


@pytest.fixture
def comparator() -> DeterministicComparator:
    return DeterministicComparator()


def _make_resp(
    choice: str,
    ambiguous: bool = False,
    validity: QuestionValidity = QuestionValidity.VALID,
) -> AISolveResponse:
    return AISolveResponse(
        selected_choice_key=choice,
        confidence=ConfidenceLevel.HIGH,
        reasoning=f"Reasoning for {choice}",
        choice_analysis={choice: "Correct"},
        question_validity=validity,
        ambiguity_detected=ambiguous,
    )


# -----------------------------------------------------------------------------
# Scenario A
# -----------------------------------------------------------------------------
def test_scenario_a_agreement_with_source(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Both models independently derive choice 2, matching source choice 2."""
    resp_a = _make_resp("2")
    resp_b = _make_resp("2")
    claims = [AISourceClaimInput(claim_id=1, source_name="Mock Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_A_AGREEMENT
    assert result.status == VerificationStatus.AGREEMENT
    assert result.agreed_choice == "2"
    assert result.is_ambiguous is False


def test_scenario_a_with_multiple_concordant_sources(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Multiple sources all agree on choice 2; both models derive choice 2."""
    resp_a = _make_resp("2")
    resp_b = _make_resp("2")
    claims = [
        AISourceClaimInput(claim_id=1, source_name="Source A", claimed_choice_key="2"),
        AISourceClaimInput(claim_id=2, source_name="Source B", claimed_choice_key="2"),
    ]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_A_AGREEMENT
    assert result.status == VerificationStatus.AGREEMENT
    assert result.agreed_choice == "2"


# -----------------------------------------------------------------------------
# Scenario B
# -----------------------------------------------------------------------------
def test_scenario_b_ai_agreement_unconfirmed(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Both models agree on choice 3, but no external source answer key exists."""
    resp_a = _make_resp("3")
    resp_b = _make_resp("3")
    claims = []

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_B_AI_AGREEMENT_UNCONFIRMED
    assert result.status == VerificationStatus.AI_AGREEMENT_UNCONFIRMED
    assert result.agreed_choice == "3"
    assert result.is_ambiguous is False


# -----------------------------------------------------------------------------
# Scenario C
# -----------------------------------------------------------------------------
def test_scenario_c_one_model_disagrees_with_source(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Source is 2; Model A chose 2, but Model B chose 1."""
    resp_a = _make_resp("2")
    resp_b = _make_resp("1")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_C_MODEL_DISAGREEMENT
    assert result.status == VerificationStatus.MODEL_DISAGREEMENT
    assert result.agreed_choice is None
    assert "Model B chose [1]" in result.conflict_details


# -----------------------------------------------------------------------------
# Scenario D
# -----------------------------------------------------------------------------
def test_scenario_d_both_models_disagree_with_source(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Source is 2; Model A chose 3, Model B chose 4."""
    resp_a = _make_resp("3")
    resp_b = _make_resp("4")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_D_SOURCE_ANSWER_CONFLICT
    assert result.status == VerificationStatus.SOURCE_ANSWER_CONFLICT
    assert result.agreed_choice is None
    assert "Source claims [2]" in result.conflict_details


def test_scenario_d_both_models_agree_with_each_other_but_disagree_with_source(
    comparator: DeterministicComparator, choices: list[AIChoiceInput]
):
    """Source is 2; Model A chose 3, Model B also chose 3."""
    resp_a = _make_resp("3")
    resp_b = _make_resp("3")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_D_SOURCE_ANSWER_CONFLICT
    assert result.status == VerificationStatus.SOURCE_ANSWER_CONFLICT
    assert result.agreed_choice == "3"


# -----------------------------------------------------------------------------
# Scenario E
# -----------------------------------------------------------------------------
def test_scenario_e_models_disagree_no_source(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Model A chose 1, Model B chose 4; no source answer exists."""
    resp_a = _make_resp("1")
    resp_b = _make_resp("4")
    claims = []

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_E_MODEL_DISAGREEMENT
    assert result.status == VerificationStatus.MODEL_DISAGREEMENT
    assert result.agreed_choice is None


# -----------------------------------------------------------------------------
# Scenario F
# -----------------------------------------------------------------------------
def test_scenario_f_conflicting_source_claims(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Source A claims choice 2; Source B claims choice 3. Conflict preserved."""
    resp_a = _make_resp("2")
    resp_b = _make_resp("2")
    claims = [
        AISourceClaimInput(claim_id=1, source_name="Source A", claimed_choice_key="2"),
        AISourceClaimInput(claim_id=2, source_name="Source B", claimed_choice_key="3"),
    ]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_F_SOURCE_CLAIM_CONFLICT
    assert result.status == VerificationStatus.SOURCE_CLAIM_CONFLICT
    assert "Contradictory external source answer claims" in result.conflict_details


# -----------------------------------------------------------------------------
# Scenario G
# -----------------------------------------------------------------------------
def test_scenario_g_question_flagged_ambiguous(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Model A flags question as ambiguous."""
    resp_a = _make_resp("2", ambiguous=True, validity=QuestionValidity.AMBIGUOUS)
    resp_b = _make_resp("2")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_G_QUESTION_AMBIGUOUS
    assert result.status == VerificationStatus.QUESTION_AMBIGUOUS
    assert result.is_ambiguous is True


# -----------------------------------------------------------------------------
# Scenario H
# -----------------------------------------------------------------------------
def test_scenario_h_model_failure(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Model B timed out with an error."""
    resp_a = _make_resp("2")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(
        model_a_resp=resp_a,
        model_b_resp=None,
        source_claims=claims,
        valid_choices=choices,
        model_b_error="Request timed out after 60s",
    )
    assert result.scenario == ComparisonScenario.SCENARIO_H_MODEL_FAILURE
    assert result.status == VerificationStatus.VERIFICATION_FAILED
    assert result.model_a_choice == "2"
    assert result.model_b_choice is None
    assert "Model B failed" in result.conflict_details


def test_scenario_h_invalid_choice_key(comparator: DeterministicComparator, choices: list[AIChoiceInput]):
    """Model A selected a nonexistent choice key '99'."""
    resp_a = _make_resp("99")
    resp_b = _make_resp("2")
    claims = [AISourceClaimInput(claim_id=1, source_name="Source", claimed_choice_key="2")]

    result = comparator.compare(resp_a, resp_b, claims, choices)
    assert result.scenario == ComparisonScenario.SCENARIO_H_MODEL_FAILURE
    assert result.status == VerificationStatus.VERIFICATION_FAILED
    assert "invalid choice '99'" in result.conflict_details

