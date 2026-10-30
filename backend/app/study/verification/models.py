"""
Data Models and Request/Response Contracts for AI Question Verification.
------------------------------------------------------------------------
Defines input payloads, model requests, structured responses, comparator
results, audit run records, and human review decision schemas.
"""
from __future__ import annotations

from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.study.verification.enums import (
    ComparisonScenario,
    ConfidenceLevel,
    HumanDecisionType,
    ModelSlot,
    QuestionValidity,
    SourceClaimAssessmentKind,
    VerificationStage,
    VerificationStatus,
)


class AIChoiceInput(BaseModel):
    """Normalized question choice provided to an AI model."""
    choice_key: str
    label: str
    text: str = ""


class AISourceClaimInput(BaseModel):
    """External source answer claim evaluated during stage 2 verification."""
    claim_id: int | str
    source_name: str
    claimed_choice_key: str
    claimed_rationale: str = ""


class AISolveRequest(BaseModel):
    """
    Input payload for independent question solving (Stage 1).
    CRITICAL: Contains NO source answer keys or cross-model output.
    """
    question_id: str | None = None
    format_code: str
    structural_family: str
    level: str
    category: str
    instruction_text: str = ""
    stem_markup: str
    stem_plain: str
    choices: list[AIChoiceInput]
    context_text: str | None = None
    audio_transcript: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AISolveResponse(BaseModel):
    """Structured response returned by an AI model solving a question independently."""
    selected_choice_key: str
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH
    reasoning: str
    choice_analysis: dict[str, str] = Field(default_factory=dict)
    question_validity: QuestionValidity = QuestionValidity.VALID
    ambiguity_detected: bool = False
    notes: list[str] = Field(default_factory=list)
    execution_time_ms: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
    raw_response: str = ""


class AIVerifyClaimsRequest(BaseModel):
    """Input payload for evaluating source answer claims (Stage 2)."""
    question_id: str | None = None
    format_code: str
    level: str
    stem_plain: str
    choices: list[AIChoiceInput]
    context_text: str | None = None
    independent_selected_choice_key: str
    independent_reasoning: str
    source_claims: list[AISourceClaimInput]


class AISourceClaimAssessment(BaseModel):
    """Assessment of a single source answer claim by a model."""
    claim_id: int | str
    claimed_choice_key: str
    assessment: SourceClaimAssessmentKind
    rationale: str
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH


class AIVerifyClaimsResponse(BaseModel):
    """Structured response from source claim assessment (Stage 2)."""
    assessments: list[AISourceClaimAssessment] = Field(default_factory=list)
    opinion_changed: bool = False
    revised_choice_key: str | None = None
    revised_reasoning: str | None = None
    execution_time_ms: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
    raw_response: str = ""


class AIExplanationRequest(BaseModel):
    """Input payload for generating pedagogical explanations."""
    format_code: str
    level: str
    stem_plain: str
    choices: list[AIChoiceInput]
    target_choice_key: str
    context_text: str | None = None
    independent_reasonings: list[str] = Field(default_factory=list)


class AIExplanationResponse(BaseModel):
    """Comprehensive pedagogical explanation produced for a learner."""
    target_choice_key: str
    summary: str
    correct_choice_analysis: str
    distractor_analysis: dict[str, str] = Field(default_factory=dict)
    grammar_notes: str = ""
    kanji_vocabulary_notes: str = ""
    reading_context_notes: str = ""
    execution_time_ms: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
    raw_response: str = ""


class ComparisonResult(BaseModel):
    """Structured, deterministic output comparing model answers, source claims, and ambiguity."""
    scenario: ComparisonScenario
    status: VerificationStatus
    model_a_choice: str | None = None
    model_b_choice: str | None = None
    source_choices: list[str] = Field(default_factory=list)
    agreed_choice: str | None = None
    is_ambiguous: bool = False
    conflict_details: str = ""
    reasoning: str = ""


class ModelExecutionRecord(BaseModel):
    """Preserves model execution audit details for a stage."""
    model_slot: ModelSlot
    stage: VerificationStage
    provider: str
    model_name: str
    selected_choice_key: str | None = None
    confidence: ConfidenceLevel | None = None
    question_validity: QuestionValidity | None = None
    ambiguity_detected: bool = False
    reasoning_markup: str = ""
    choice_analysis: dict[str, str] = Field(default_factory=dict)
    source_assessment: dict[str, Any] = Field(default_factory=dict)
    raw_response_text: str = ""
    execution_time_ms: int = 0
    token_usage: dict[str, int] = Field(default_factory=dict)
    error_message: str | None = None


class ExplanationRecord(BaseModel):
    """Preserved learner explanation."""
    external_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    generated_by_slot: str
    provider: str
    model_name: str
    target_choice_key: str
    summary_text: str
    correct_choice_analysis: str = ""
    distractor_analysis: dict[str, str] = Field(default_factory=dict)
    grammar_notes: str = ""
    kanji_vocabulary_notes: str = ""
    reading_context_notes: str = ""
    is_human_approved: bool = False


class HumanReviewInput(BaseModel):
    """Input payload submitted when human reviewer evaluates a verification run."""
    decision: HumanDecisionType
    selected_choice_key: str | None = None
    human_explanation: str = ""
    notes: str = ""
    reviewer_id: str = "local_user"


class VerificationRunRecord(BaseModel):
    """Complete aggregate of a verification attempt on a question revision."""
    external_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    question_id: int | None = None
    question_revision_id: int | None = None
    attempt_number: int = 1
    status: VerificationStatus
    comparison: ComparisonResult
    model_responses: list[ModelExecutionRecord] = Field(default_factory=list)
    explanation: ExplanationRecord | None = None
    human_decisions: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None


class BatchVerificationResult(BaseModel):
    """Summary of batch verification processing."""
    total_questions: int = 0
    verified_count: int = 0
    agreement_count: int = 0
    disagreement_count: int = 0
    conflict_count: int = 0
    ambiguous_count: int = 0
    failed_count: int = 0
    records: list[VerificationRunRecord] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

