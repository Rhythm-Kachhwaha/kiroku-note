"""
Kiroku Study Bank — Milestone 3, Gate 2: AI Question Verification Subsystem.
-----------------------------------------------------------------------------
Provides independent dual-model AI verification, multi-claim source answer evaluation,
deterministic comparison, explanation synthesis, and human review workflows.
"""
from __future__ import annotations

from app.study.verification.comparator import DeterministicComparator
from app.study.verification.config import (
    AIVerificationConfig,
    ModelSlotConfig,
    load_verification_config_from_env,
)
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
from app.study.verification.models import (
    AIChoiceInput,
    AIExplanationRequest,
    AIExplanationResponse,
    AISolveRequest,
    AISolveResponse,
    AISourceClaimAssessment,
    AISourceClaimInput,
    AIVerifyClaimsRequest,
    AIVerifyClaimsResponse,
    BatchVerificationResult,
    ComparisonResult,
    ExplanationRecord,
    HumanReviewInput,
    ModelExecutionRecord,
    VerificationRunRecord,
)
from app.study.verification.persistence import VerificationPersistenceService
from app.study.verification.providers import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
    BaseAIProvider,
    MockAIProvider,
    OpenAICompatibleProvider,
    ProviderRegistry,
    XAIProvider,
)
from app.study.verification.review import VerificationReviewService
from app.study.verification.service import VerificationService

__all__ = [
    "AIChoiceInput",
    "AIExplanationRequest",
    "AIExplanationResponse",
    "AIProviderAuthError",
    "AIProviderError",
    "AIProviderRateLimitError",
    "AIProviderResponseError",
    "AIProviderTimeoutError",
    "AISolveRequest",
    "AISolveResponse",
    "AISourceClaimAssessment",
    "AISourceClaimInput",
    "AIVerificationConfig",
    "AIVerifyClaimsRequest",
    "AIVerifyClaimsResponse",
    "BaseAIProvider",
    "BatchVerificationResult",
    "ComparisonResult",
    "ComparisonScenario",
    "ConfidenceLevel",
    "DeterministicComparator",
    "ExplanationRecord",
    "HumanDecisionType",
    "HumanReviewInput",
    "MockAIProvider",
    "ModelExecutionRecord",
    "ModelSlot",
    "ModelSlotConfig",
    "OpenAICompatibleProvider",
    "ProviderRegistry",
    "QuestionValidity",
    "SourceClaimAssessmentKind",
    "VerificationPersistenceService",
    "VerificationReviewService",
    "VerificationRunRecord",
    "VerificationService",
    "VerificationStage",
    "VerificationStatus",
    "XAIProvider",
    "load_verification_config_from_env",
]

