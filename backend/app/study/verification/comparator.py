"""
Deterministic Comparison Engine for AI Question Verification.
--------------------------------------------------------------
Evaluates Model A, Model B, and external source answer claims using
100% deterministic rules (zero LLM dependency).
Implements Scenarios A through H defined in Milestone 3 Gate 2 specification.
"""
from __future__ import annotations

from typing import Sequence

from app.study.verification.enums import (
    ComparisonScenario,
    QuestionValidity,
    VerificationStatus,
)
from app.study.verification.models import (
    AIChoiceInput,
    AISolveResponse,
    AISourceClaimInput,
    ComparisonResult,
)


class DeterministicComparator:
    """Evaluates multi-model solutions and source answer claims."""

    def compare(
        self,
        model_a_resp: AISolveResponse | None,
        model_b_resp: AISolveResponse | None,
        source_claims: Sequence[AISourceClaimInput],
        valid_choices: Sequence[AIChoiceInput],
        model_a_error: str | None = None,
        model_b_error: str | None = None,
    ) -> ComparisonResult:
        """
        Execute deterministic comparison across Model A, Model B, and Source claims.
        """
        valid_choice_keys = {c.choice_key for c in valid_choices}
        source_choice_set = {
            c.claimed_choice_key.strip()
            for c in source_claims
            if c.claimed_choice_key and c.claimed_choice_key.strip()
        }
        sorted_source_choices = sorted(source_choice_set)

        # ---------------------------------------------------------------------
        # Scenario H: Model Failure (upstream error, timeout, unparseable output)
        # ---------------------------------------------------------------------
        if model_a_error or model_b_error or model_a_resp is None or model_b_resp is None:
            err_parts = []
            if model_a_error or model_a_resp is None:
                err_parts.append(f"Model A failed: {model_a_error or 'no response'}")
            if model_b_error or model_b_resp is None:
                err_parts.append(f"Model B failed: {model_b_error or 'no response'}")

            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_H_MODEL_FAILURE,
                status=VerificationStatus.VERIFICATION_FAILED,
                model_a_choice=model_a_resp.selected_choice_key if model_a_resp else None,
                model_b_choice=model_b_resp.selected_choice_key if model_b_resp else None,
                source_choices=sorted_source_choices,
                agreed_choice=None,
                is_ambiguous=False,
                conflict_details="; ".join(err_parts),
                reasoning="One or both AI models failed during verification execution.",
            )

        a_choice = model_a_resp.selected_choice_key.strip()
        b_choice = model_b_resp.selected_choice_key.strip()

        # Validate that model choices exist in question choices
        if a_choice not in valid_choice_keys or b_choice not in valid_choice_keys:
            invalid_desc = []
            if a_choice not in valid_choice_keys:
                invalid_desc.append(f"Model A selected invalid choice '{a_choice}'")
            if b_choice not in valid_choice_keys:
                invalid_desc.append(f"Model B selected invalid choice '{b_choice}'")

            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_H_MODEL_FAILURE,
                status=VerificationStatus.VERIFICATION_FAILED,
                model_a_choice=a_choice,
                model_b_choice=b_choice,
                source_choices=sorted_source_choices,
                agreed_choice=None,
                is_ambiguous=False,
                conflict_details="; ".join(invalid_desc),
                reasoning="One or both models returned an answer key that does not exist in the question choices.",
            )

        # ---------------------------------------------------------------------
        # Scenario F: Multiple Source Answer Keys Conflict
        # ---------------------------------------------------------------------
        if len(sorted_source_choices) > 1:
            conflict_msg = f"Contradictory external source answer claims: {sorted_source_choices}"
            agreed = a_choice if (a_choice == b_choice and a_choice in sorted_source_choices) else None
            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_F_SOURCE_CLAIM_CONFLICT,
                status=VerificationStatus.SOURCE_CLAIM_CONFLICT,
                model_a_choice=a_choice,
                model_b_choice=b_choice,
                source_choices=sorted_source_choices,
                agreed_choice=agreed,
                is_ambiguous=False,
                conflict_details=conflict_msg,
                reasoning=f"External sources provided conflicting answer keys ({sorted_source_choices}). Question flagged for human review.",
            )

        # ---------------------------------------------------------------------
        # Scenario G: Question Ambiguous or Defective
        # ---------------------------------------------------------------------
        is_ambiguous = (
            model_a_resp.ambiguity_detected
            or model_b_resp.ambiguity_detected
            or model_a_resp.question_validity in (QuestionValidity.AMBIGUOUS, QuestionValidity.DEFECTIVE)
            or model_b_resp.question_validity in (QuestionValidity.AMBIGUOUS, QuestionValidity.DEFECTIVE)
        )
        if is_ambiguous:
            ambiguity_reasons = []
            if model_a_resp.ambiguity_detected or model_a_resp.question_validity != QuestionValidity.VALID:
                ambiguity_reasons.append(f"Model A flagged {model_a_resp.question_validity.value}")
            if model_b_resp.ambiguity_detected or model_b_resp.question_validity != QuestionValidity.VALID:
                ambiguity_reasons.append(f"Model B flagged {model_b_resp.question_validity.value}")

            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_G_QUESTION_AMBIGUOUS,
                status=VerificationStatus.QUESTION_AMBIGUOUS,
                model_a_choice=a_choice,
                model_b_choice=b_choice,
                source_choices=sorted_source_choices,
                agreed_choice=a_choice if a_choice == b_choice else None,
                is_ambiguous=True,
                conflict_details="; ".join(ambiguity_reasons),
                reasoning="One or both AI models flagged the question as ambiguous or having multiple plausible answers.",
            )

        # ---------------------------------------------------------------------
        # Scenarios B & E: No Source Answer Key Available
        # ---------------------------------------------------------------------
        if len(sorted_source_choices) == 0:
            if a_choice == b_choice:
                # Scenario B: Both models agree, unconfirmed by source
                return ComparisonResult(
                    scenario=ComparisonScenario.SCENARIO_B_AI_AGREEMENT_UNCONFIRMED,
                    status=VerificationStatus.AI_AGREEMENT_UNCONFIRMED,
                    model_a_choice=a_choice,
                    model_b_choice=b_choice,
                    source_choices=[],
                    agreed_choice=a_choice,
                    is_ambiguous=False,
                    conflict_details="",
                    reasoning=f"Both models independently derived choice [{a_choice}], but no external source answer key exists.",
                )
            else:
                # Scenario E: Models disagree with each other (no source)
                return ComparisonResult(
                    scenario=ComparisonScenario.SCENARIO_E_MODEL_DISAGREEMENT,
                    status=VerificationStatus.MODEL_DISAGREEMENT,
                    model_a_choice=a_choice,
                    model_b_choice=b_choice,
                    source_choices=[],
                    agreed_choice=None,
                    is_ambiguous=False,
                    conflict_details=f"Model A chose [{a_choice}], Model B chose [{b_choice}]",
                    reasoning="Models independently derived different answers, and no external source answer exists to corroborate.",
                )

        # ---------------------------------------------------------------------
        # Single Source Answer Key Scenarios (A, C, D)
        # ---------------------------------------------------------------------
        source_key = sorted_source_choices[0]

        if a_choice == source_key and b_choice == source_key:
            # Scenario A: Full agreement with source
            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_A_AGREEMENT,
                status=VerificationStatus.AGREEMENT,
                model_a_choice=a_choice,
                model_b_choice=b_choice,
                source_choices=sorted_source_choices,
                agreed_choice=source_key,
                is_ambiguous=False,
                conflict_details="",
                reasoning=f"Both models independently agreed with external source answer key [{source_key}].",
            )

        if (a_choice == source_key and b_choice != source_key) or (a_choice != source_key and b_choice == source_key):
            # Scenario C: One model disagrees with source
            disagreeing_model = "Model B" if a_choice == source_key else "Model A"
            disagreeing_choice = b_choice if a_choice == source_key else a_choice
            return ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_C_MODEL_DISAGREEMENT,
                status=VerificationStatus.MODEL_DISAGREEMENT,
                model_a_choice=a_choice,
                model_b_choice=b_choice,
                source_choices=sorted_source_choices,
                agreed_choice=None,
                is_ambiguous=False,
                conflict_details=f"{disagreeing_model} chose [{disagreeing_choice}], conflicting with source [{source_key}]",
                reasoning=f"One model corroborates source [{source_key}], but {disagreeing_model} derived [{disagreeing_choice}]. Requires human review.",
            )

        # Both models disagree with source
        # Scenario D: Source Answer Conflict
        return ComparisonResult(
            scenario=ComparisonScenario.SCENARIO_D_SOURCE_ANSWER_CONFLICT,
            status=VerificationStatus.SOURCE_ANSWER_CONFLICT,
            model_a_choice=a_choice,
            model_b_choice=b_choice,
            source_choices=sorted_source_choices,
            agreed_choice=a_choice if a_choice == b_choice else None,
            is_ambiguous=False,
            conflict_details=f"Source claims [{source_key}], but Model A derived [{a_choice}] and Model B derived [{b_choice}]",
            reasoning=f"Both models independently rejected external source answer [{source_key}]. High priority human review required.",
        )

