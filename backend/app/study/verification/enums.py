"""
Enumerations and Status Types for Kiroku Study Bank AI Verification.
--------------------------------------------------------------------
Defines verification statuses, comparison scenarios, model execution stages,
slots, and human decision types.
"""
from __future__ import annotations

from enum import Enum


class VerificationStatus(str, Enum):
    """
    Quality control and verification statuses for question candidates and revisions.
    Distinct from ingestion status, structural validation, and question eligibility.
    """
    NOT_VERIFIED = "not_verified"
    PENDING = "pending"
    AGREEMENT = "agreement"
    AI_AGREEMENT_UNCONFIRMED = "ai_agreement_unconfirmed"
    MODEL_DISAGREEMENT = "model_disagreement"
    SOURCE_ANSWER_CONFLICT = "source_answer_conflict"
    SOURCE_CLAIM_CONFLICT = "source_claim_conflict"
    QUESTION_AMBIGUOUS = "question_ambiguous"
    VERIFICATION_FAILED = "verification_failed"
    NEEDS_HUMAN_REVIEW = "needs_human_review"
    HUMAN_APPROVED = "human_approved"
    HUMAN_CORRECTED = "human_corrected"
    HUMAN_REJECTED = "human_rejected"


class ComparisonScenario(str, Enum):
    """Deterministic comparison outcomes evaluating Model A, Model B, and Source claims."""
    SCENARIO_A_AGREEMENT = "scenario_a_agreement"
    SCENARIO_B_AI_AGREEMENT_UNCONFIRMED = "scenario_b_ai_agreement_unconfirmed"
    SCENARIO_C_MODEL_DISAGREEMENT = "scenario_c_model_disagreement"
    SCENARIO_D_SOURCE_ANSWER_CONFLICT = "scenario_d_source_answer_conflict"
    SCENARIO_E_MODEL_DISAGREEMENT = "scenario_e_model_disagreement"
    SCENARIO_F_SOURCE_CLAIM_CONFLICT = "scenario_f_source_claim_conflict"
    SCENARIO_G_QUESTION_AMBIGUOUS = "scenario_g_question_ambiguous"
    SCENARIO_H_MODEL_FAILURE = "scenario_h_model_failure"


class ModelSlot(str, Enum):
    """Identifier for the two independent verification model slots."""
    MODEL_A = "model_a"
    MODEL_B = "model_b"


class VerificationStage(str, Enum):
    """Stages of AI verification."""
    INDEPENDENT_SOLVE = "independent_solve"
    SOURCE_VERIFY = "source_verify"
    EXPLANATION = "explanation"


class HumanDecisionType(str, Enum):
    """Explicit decision made by human reviewer on a verified question."""
    ACCEPT = "accept"
    CORRECT = "correct"
    AMBIGUOUS = "ambiguous"
    DEFECTIVE = "defective"
    REJECT = "reject"
    REVERIFY = "reverify"


class ConfidenceLevel(str, Enum):
    """Self-reported model confidence."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class QuestionValidity(str, Enum):
    """Model-reported assessment of question structural and semantic soundness."""
    VALID = "valid"
    AMBIGUOUS = "ambiguous"
    DEFECTIVE = "defective"


class SourceClaimAssessmentKind(str, Enum):
    """Model evaluation of a specific source answer claim."""
    SUPPORTED = "supported"
    CONTRADICTED = "contradicted"
    PLAUSIBLE_ALTERNATIVE = "plausible_alternative"

