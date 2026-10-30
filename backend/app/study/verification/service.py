"""
AI Question Verification Service.
---------------------------------
Orchestrates independent two-model question solving, source claim cross-verification,
deterministic comparison, explanation synthesis, and transactional audit persistence.

Guarantees:
- Strict isolation of initial solving stage from source answer keys and cross-model leakage
- Provider-agnostic execution through interchangeable adapters
- Deterministic comparison (zero third-model dependencies)
- Offline & disabled tolerance: pipeline operates unimpeded without AI
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Sequence

from app.study.contracts.enums import StructuralFamily
from app.study.contracts.families import AnyQuestionPayload
from app.study.ingestion.models import CandidateQuestion
from app.study.markup.parser import parse_markup
from app.study.markup.serializer import to_plain_text
from app.study.verification.comparator import DeterministicComparator
from app.study.verification.config import (
    AIVerificationConfig,
    load_verification_config_from_env,
)
from app.study.verification.enums import (
    ComparisonScenario,
    ConfidenceLevel,
    ModelSlot,
    QuestionValidity,
    VerificationStage,
    VerificationStatus,
)
from app.study.verification.models import (
    AIChoiceInput,
    AIExplanationRequest,
    AIExplanationResponse,
    AISolveRequest,
    AISolveResponse,
    AISourceClaimInput,
    AIVerifyClaimsRequest,
    AIVerifyClaimsResponse,
    BatchVerificationResult,
    ComparisonResult,
    ExplanationRecord,
    ModelExecutionRecord,
    VerificationRunRecord,
)
from app.study.verification.persistence import VerificationPersistenceService
from app.study.verification.providers.base import (
    BaseAIProvider,
    ProviderRegistry,
)


def _plain_from_markup(markup: str) -> str:
    """Safely convert Kiroku markup to plain text."""
    if not markup or not markup.strip():
        return ""
    try:
        ast = parse_markup(markup)
        return to_plain_text(ast)
    except Exception:
        return markup


class VerificationService:
    """Core domain service for orchestrating AI verification workflows."""

    def __init__(
        self,
        config: AIVerificationConfig | None = None,
        provider_a: BaseAIProvider | None = None,
        provider_b: BaseAIProvider | None = None,
        comparator: DeterministicComparator | None = None,
        persistence: VerificationPersistenceService | None = None,
    ) -> None:
        self.config = config or load_verification_config_from_env()
        self.comparator = comparator or DeterministicComparator()
        self.persistence = persistence or VerificationPersistenceService()

        # Initialize providers from explicit arguments or configuration
        if provider_a is not None:
            self._provider_a = provider_a
        elif self.config.model_a.is_configured():
            self._provider_a = ProviderRegistry.create(
                name=self.config.model_a.provider,
                model=self.config.model_a.model,
                api_key=self.config.model_a.api_key,
                base_url=self.config.model_a.base_url,
                timeout=self.config.timeout,
                max_retries=self.config.max_retries,
            )
        else:
            self._provider_a = None

        if provider_b is not None:
            self._provider_b = provider_b
        elif self.config.model_b.is_configured():
            self._provider_b = ProviderRegistry.create(
                name=self.config.model_b.provider,
                model=self.config.model_b.model,
                api_key=self.config.model_b.api_key,
                base_url=self.config.model_b.base_url,
                timeout=self.config.timeout,
                max_retries=self.config.max_retries,
            )
        else:
            self._provider_b = None

    @property
    def is_enabled(self) -> bool:
        """Return True if both models are available and ready to verify."""
        return self._provider_a is not None and self._provider_b is not None

    # -------------------------------------------------------------------------
    # Request Construction Helpers
    # -------------------------------------------------------------------------
    def build_solve_request_from_candidate(
        self,
        candidate: CandidateQuestion,
        context_text: str | None = None,
    ) -> tuple[AISolveRequest, list[AISourceClaimInput]]:
        """Construct AISolveRequest and source claims from an ingestion CandidateQuestion."""
        stem_markup = candidate.draft.raw_stem
        stem_plain = _plain_from_markup(stem_markup)

        choices = [
            AIChoiceInput(
                choice_key=str(c.label).strip() if not c.text else str(c.ordinal),
                label=str(c.label),
                text=c.text or "",
            )
            for c in candidate.draft.raw_choices
        ]
        # If payload exists, use normalized payload choices for higher precision
        if candidate.payload:
            choices = [
                AIChoiceInput(
                    choice_key=c.choice_key,
                    label=c.label,
                    text=_plain_from_markup(c.text_markup or ""),
                )
                for c in candidate.payload.choices
            ]

        fmt_code = candidate.classification.format_code if candidate.classification else "unknown"
        family = candidate.classification.structural_family.value if candidate.classification else "F1"
        level = candidate.classification.level.value if candidate.classification else "N3"
        category = candidate.classification.category.value if candidate.classification else "vocabulary"

        req = AISolveRequest(
            question_id=candidate.candidate_id,
            format_code=fmt_code,
            structural_family=family,
            level=level,
            category=category,
            instruction_text=candidate.draft.instruction_text,
            stem_markup=stem_markup,
            stem_plain=stem_plain,
            choices=choices,
            context_text=context_text,
        )

        source_claims: list[AISourceClaimInput] = []
        if candidate.draft.source_answer_key is not None:
            # Map source answer key to choice_key
            claimed_str = str(candidate.draft.source_answer_key).strip()
            # Match choice key or label
            matching_key = claimed_str
            for c in choices:
                if claimed_str in (c.choice_key, c.label, str(c.choice_key)):
                    matching_key = c.choice_key
                    break

            source_claims.append(
                AISourceClaimInput(
                    claim_id=1,
                    source_name="Ingested Source",
                    claimed_choice_key=matching_key,
                    claimed_rationale=candidate.draft.source_answer_rationale,
                )
            )

        return req, source_claims

    # -------------------------------------------------------------------------
    # Core Verification Workflow
    # -------------------------------------------------------------------------
    def verify_solve_request(
        self,
        req: AISolveRequest,
        source_claims: Sequence[AISourceClaimInput] = (),
        question_id: int | None = None,
        question_revision_id: int | None = None,
        attempt_number: int = 1,
    ) -> VerificationRunRecord:
        """
        Execute independent two-model verification on an AISolveRequest.
        """
        if not self.is_enabled:
            # AI not configured or disabled -> return NOT_VERIFIED record
            comp = ComparisonResult(
                scenario=ComparisonScenario.SCENARIO_H_MODEL_FAILURE,
                status=VerificationStatus.NOT_VERIFIED,
                reasoning="AI verification is not configured or disabled.",
            )
            return VerificationRunRecord(
                question_id=question_id,
                question_revision_id=question_revision_id,
                attempt_number=attempt_number,
                status=VerificationStatus.NOT_VERIFIED,
                comparison=comp,
            )

        assert self._provider_a is not None
        assert self._provider_b is not None

        model_responses: list[ModelExecutionRecord] = []

        # ---------------------------------------------------------------------
        # Stage 1: Independent Solving (Models solve separately with NO source answer)
        # ---------------------------------------------------------------------
        model_a_resp: AISolveResponse | None = None
        model_a_error: str | None = None
        try:
            model_a_resp = self._provider_a.solve_question(req)
            model_responses.append(
                ModelExecutionRecord(
                    model_slot=ModelSlot.MODEL_A,
                    stage=VerificationStage.INDEPENDENT_SOLVE,
                    provider=self._provider_a.name,
                    model_name=self._provider_a.model_name,
                    selected_choice_key=model_a_resp.selected_choice_key,
                    confidence=model_a_resp.confidence,
                    question_validity=model_a_resp.question_validity,
                    ambiguity_detected=model_a_resp.ambiguity_detected,
                    reasoning_markup=model_a_resp.reasoning,
                    choice_analysis=model_a_resp.choice_analysis,
                    raw_response_text=model_a_resp.raw_response,
                    execution_time_ms=model_a_resp.execution_time_ms,
                    token_usage=model_a_resp.token_usage,
                )
            )
        except Exception as exc:
            model_a_error = str(exc)
            model_responses.append(
                ModelExecutionRecord(
                    model_slot=ModelSlot.MODEL_A,
                    stage=VerificationStage.INDEPENDENT_SOLVE,
                    provider=self._provider_a.name,
                    model_name=self._provider_a.model_name,
                    error_message=model_a_error,
                )
            )

        model_b_resp: AISolveResponse | None = None
        model_b_error: str | None = None
        try:
            model_b_resp = self._provider_b.solve_question(req)
            model_responses.append(
                ModelExecutionRecord(
                    model_slot=ModelSlot.MODEL_B,
                    stage=VerificationStage.INDEPENDENT_SOLVE,
                    provider=self._provider_b.name,
                    model_name=self._provider_b.model_name,
                    selected_choice_key=model_b_resp.selected_choice_key,
                    confidence=model_b_resp.confidence,
                    question_validity=model_b_resp.question_validity,
                    ambiguity_detected=model_b_resp.ambiguity_detected,
                    reasoning_markup=model_b_resp.reasoning,
                    choice_analysis=model_b_resp.choice_analysis,
                    raw_response_text=model_b_resp.raw_response,
                    execution_time_ms=model_b_resp.execution_time_ms,
                    token_usage=model_b_resp.token_usage,
                )
            )
        except Exception as exc:
            model_b_error = str(exc)
            model_responses.append(
                ModelExecutionRecord(
                    model_slot=ModelSlot.MODEL_B,
                    stage=VerificationStage.INDEPENDENT_SOLVE,
                    provider=self._provider_b.name,
                    model_name=self._provider_b.model_name,
                    error_message=model_b_error,
                )
            )

        # ---------------------------------------------------------------------
        # Stage 2: Second-Stage Source Claim Verification
        # ---------------------------------------------------------------------
        # Only performed if source claims exist and models succeeded
        if source_claims:
            if model_a_resp is not None:
                try:
                    verify_req_a = AIVerifyClaimsRequest(
                        question_id=req.question_id,
                        format_code=req.format_code,
                        level=req.level,
                        stem_plain=req.stem_plain,
                        choices=req.choices,
                        context_text=req.context_text,
                        independent_selected_choice_key=model_a_resp.selected_choice_key,
                        independent_reasoning=model_a_resp.reasoning,
                        source_claims=list(source_claims),
                    )
                    verify_resp_a = self._provider_a.verify_source_claims(verify_req_a)
                    model_responses.append(
                        ModelExecutionRecord(
                            model_slot=ModelSlot.MODEL_A,
                            stage=VerificationStage.SOURCE_VERIFY,
                            provider=self._provider_a.name,
                            model_name=self._provider_a.model_name,
                            source_assessment={
                                "opinion_changed": verify_resp_a.opinion_changed,
                                "revised_choice_key": verify_resp_a.revised_choice_key,
                                "revised_reasoning": verify_resp_a.revised_reasoning,
                                "assessments": [a.model_dump() for a in verify_resp_a.assessments],
                            },
                            raw_response_text=verify_resp_a.raw_response,
                            execution_time_ms=verify_resp_a.execution_time_ms,
                            token_usage=verify_resp_a.token_usage,
                        )
                    )
                except Exception as exc:
                    model_responses.append(
                        ModelExecutionRecord(
                            model_slot=ModelSlot.MODEL_A,
                            stage=VerificationStage.SOURCE_VERIFY,
                            provider=self._provider_a.name,
                            model_name=self._provider_a.model_name,
                            error_message=str(exc),
                        )
                    )

            if model_b_resp is not None:
                try:
                    verify_req_b = AIVerifyClaimsRequest(
                        question_id=req.question_id,
                        format_code=req.format_code,
                        level=req.level,
                        stem_plain=req.stem_plain,
                        choices=req.choices,
                        context_text=req.context_text,
                        independent_selected_choice_key=model_b_resp.selected_choice_key,
                        independent_reasoning=model_b_resp.reasoning,
                        source_claims=list(source_claims),
                    )
                    verify_resp_b = self._provider_b.verify_source_claims(verify_req_b)
                    model_responses.append(
                        ModelExecutionRecord(
                            model_slot=ModelSlot.MODEL_B,
                            stage=VerificationStage.SOURCE_VERIFY,
                            provider=self._provider_b.name,
                            model_name=self._provider_b.model_name,
                            source_assessment={
                                "opinion_changed": verify_resp_b.opinion_changed,
                                "revised_choice_key": verify_resp_b.revised_choice_key,
                                "revised_reasoning": verify_resp_b.revised_reasoning,
                                "assessments": [a.model_dump() for a in verify_resp_b.assessments],
                            },
                            raw_response_text=verify_resp_b.raw_response,
                            execution_time_ms=verify_resp_b.execution_time_ms,
                            token_usage=verify_resp_b.token_usage,
                        )
                    )
                except Exception as exc:
                    model_responses.append(
                        ModelExecutionRecord(
                            model_slot=ModelSlot.MODEL_B,
                            stage=VerificationStage.SOURCE_VERIFY,
                            provider=self._provider_b.name,
                            model_name=self._provider_b.model_name,
                            error_message=str(exc),
                        )
                    )

        # ---------------------------------------------------------------------
        # Stage 3: Deterministic Comparison Engine
        # ---------------------------------------------------------------------
        comparison = self.comparator.compare(
            model_a_resp=model_a_resp,
            model_b_resp=model_b_resp,
            source_claims=source_claims,
            valid_choices=req.choices,
            model_a_error=model_a_error,
            model_b_error=model_b_error,
        )

        # ---------------------------------------------------------------------
        # Stage 4: Explanation Generation
        # ---------------------------------------------------------------------
        # Pedagogical explanations are synthesized ONLY when both models agree
        # on the same target choice (Scenario A, B, or D where models agree with each other).
        # When models disagree (Scenario C, E, D-disagree), or when source claims conflict
        # (Scenario F), or when question is flagged ambiguous/defective (Scenario G),
        # or when a model fails (Scenario H):
        # We do NOT generate a canonical explanation asserting one answer is correct,
        # do NOT silently pick one model's answer, and do NOT fabricate a consensus.
        # Both models' answers and reasoning remain preserved in verification_model_response.
        explanation_record: ExplanationRecord | None = None
        target_choice: str | None = None

        if (
            comparison.status in (
                VerificationStatus.AGREEMENT,
                VerificationStatus.AI_AGREEMENT_UNCONFIRMED,
            )
            and comparison.agreed_choice
        ):
            target_choice = comparison.agreed_choice
        elif (
            comparison.status == VerificationStatus.SOURCE_ANSWER_CONFLICT
            and comparison.agreed_choice
            and model_a_resp is not None
            and model_b_resp is not None
            and model_a_resp.selected_choice_key == model_b_resp.selected_choice_key
        ):
            target_choice = comparison.agreed_choice

        if target_choice and model_a_resp is not None and model_b_resp is not None:
            expl_provider = self._provider_a
            expl_slot = "model_a"

            ref_notes = []
            if model_a_resp:
                ref_notes.append(f"Model A: {model_a_resp.reasoning}")
            if model_b_resp:
                ref_notes.append(f"Model B: {model_b_resp.reasoning}")

            try:
                assert expl_provider is not None
                expl_req = AIExplanationRequest(
                    format_code=req.format_code,
                    level=req.level,
                    stem_plain=req.stem_plain,
                    choices=req.choices,
                    target_choice_key=target_choice,
                    context_text=req.context_text,
                    independent_reasonings=ref_notes,
                )
                expl_resp = expl_provider.generate_explanation(expl_req)

                explanation_record = ExplanationRecord(
                    generated_by_slot=expl_slot,
                    provider=expl_provider.name,
                    model_name=expl_provider.model_name,
                    target_choice_key=expl_resp.target_choice_key,
                    summary_text=expl_resp.summary,
                    correct_choice_analysis=expl_resp.correct_choice_analysis,
                    distractor_analysis=expl_resp.distractor_analysis,
                    grammar_notes=expl_resp.grammar_notes,
                    kanji_vocabulary_notes=expl_resp.kanji_vocabulary_notes,
                    reading_context_notes=expl_resp.reading_context_notes,
                    is_human_approved=False,
                )
            except Exception:
                # Explanation generation failure does not abort verification result
                pass

        error_summary = None
        if model_a_error or model_b_error:
            error_summary = f"A: {model_a_error or 'ok'} | B: {model_b_error or 'ok'}"

        return VerificationRunRecord(
            question_id=question_id,
            question_revision_id=question_revision_id,
            attempt_number=attempt_number,
            status=comparison.status,
            comparison=comparison,
            model_responses=model_responses,
            explanation=explanation_record,
            error_message=error_summary,
        )

    # -------------------------------------------------------------------------
    # Persisted Question Verification
    # -------------------------------------------------------------------------
    def verify_persisted_question(
        self,
        conn: sqlite3.Connection,
        question_id: int,
        question_revision_id: int | None = None,
        persist: bool = True,
    ) -> VerificationRunRecord:
        """
        Verify a question revision already persisted in study.db.
        Loads stem, choices, group passage, and source answer claims directly from database.
        """
        # 1. Fetch question row
        q_row = conn.execute("SELECT * FROM question WHERE id = ?;", (question_id,)).fetchone()
        if not q_row:
            raise ValueError(f"Question with id {question_id} not found in database.")

        rev_id = question_revision_id or q_row["current_revision_id"]
        if not rev_id:
            raise ValueError(f"No revision found for question {question_id}.")

        rev_row = conn.execute(
            "SELECT * FROM question_revision WHERE id = ? AND question_id = ?;",
            (rev_id, question_id),
        ).fetchone()
        if not rev_row:
            raise ValueError(f"Question revision {rev_id} not found for question {question_id}.")

        # 2. Fetch choices
        choice_rows = conn.execute(
            "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;",
            (rev_id,),
        ).fetchall()
        choices = [
            AIChoiceInput(
                choice_key=r["choice_key"],
                label=r["label"],
                text=_plain_from_markup(r["text_markup"] or ""),
            )
            for r in choice_rows
        ]

        # 3. Fetch source answer claims
        claim_rows = conn.execute(
            """
            SELECT sac.*, s.name AS source_name, rc.choice_key AS claimed_choice_key
            FROM source_answer_claim sac
            LEFT JOIN source s ON sac.source_id = s.id
            LEFT JOIN revision_choice rc ON sac.choice_id = rc.id
            WHERE sac.question_revision_id = ?
            ORDER BY sac.id ASC;
            """,
            (rev_id,),
        ).fetchall()

        source_claims: list[AISourceClaimInput] = []
        for r in claim_rows:
            key = r["claimed_choice_key"] or r["source_label"] or ""
            source_claims.append(
                AISourceClaimInput(
                    claim_id=r["id"],
                    source_name=r["source_name"] or "Unknown Source",
                    claimed_choice_key=str(key),
                    claimed_rationale=r["rationale"] or "",
                )
            )

        # 4. Fetch group context if question belongs to a group
        context_text = None
        if q_row["content_group_id"]:
            grp_rev = conn.execute(
                """
                SELECT grp.markup
                FROM group_revision_part grp
                JOIN content_group cg ON cg.current_revision_id = grp.group_revision_id
                WHERE cg.id = ?
                ORDER BY grp.ordinal ASC;
                """,
                (q_row["content_group_id"],),
            ).fetchall()
            if grp_rev:
                context_text = "\n\n".join(_plain_from_markup(r["markup"]) for r in grp_rev)

        stem_markup = rev_row["stem_markup"]
        stem_plain = _plain_from_markup(stem_markup)

        # Resolve structural family and audio transcript if present
        from app.study.formats import get_format
        fmt_meta = get_format(q_row["format_code"])
        family_str = fmt_meta.structural_family

        transcript_text = None
        if rev_row["payload_json"]:
            try:
                payload_data = json.loads(rev_row["payload_json"])
                transcript_raw = payload_data.get("transcript_markup")
                if transcript_raw:
                    transcript_text = _plain_from_markup(transcript_raw)
            except Exception:
                pass

        solve_req = AISolveRequest(
            question_id=str(question_id),
            format_code=q_row["format_code"],
            structural_family=family_str,
            level=q_row["level"],
            category=q_row["category"],
            stem_markup=stem_markup,
            stem_plain=stem_plain,
            choices=choices,
            context_text=context_text,
            audio_transcript=transcript_text,
        )

        record = self.verify_solve_request(
            req=solve_req,
            source_claims=source_claims,
            question_id=question_id,
            question_revision_id=rev_id,
        )

        if persist:
            self.persistence.save_verification_run(conn, record)

        return record

    def verify_candidate(
        self,
        candidate: CandidateQuestion,
        context_text: str | None = None,
    ) -> VerificationRunRecord:
        """Verify an individual CandidateQuestion directly."""
        req, source_claims = self.build_solve_request_from_candidate(candidate, context_text=context_text)
        return self.verify_solve_request(
            req=req,
            source_claims=source_claims,
            question_id=candidate.persisted_question_id,
            question_revision_id=candidate.persisted_revision_id,
        )

    # -------------------------------------------------------------------------
    # Batch Verification Workflow
    # -------------------------------------------------------------------------
    def batch_verify_candidates(
        self,
        candidates: Sequence[CandidateQuestion],
        conn: sqlite3.Connection | None = None,
        persist: bool = True,
    ) -> BatchVerificationResult:
        """Verify a collection of question candidates."""
        result = BatchVerificationResult(total_questions=len(candidates))

        for cand in candidates:
            try:
                req, source_claims = self.build_solve_request_from_candidate(cand)
                record = self.verify_solve_request(
                    req=req,
                    source_claims=source_claims,
                    question_id=cand.persisted_question_id,
                    question_revision_id=cand.persisted_revision_id,
                )

                if conn and persist and cand.persisted_revision_id:
                    self.persistence.save_verification_run(conn, record)

                result.records.append(record)
                result.verified_count += 1

                # Update counts by status
                if record.status in (VerificationStatus.AGREEMENT, VerificationStatus.AI_AGREEMENT_UNCONFIRMED):
                    result.agreement_count += 1
                elif record.status == VerificationStatus.MODEL_DISAGREEMENT:
                    result.disagreement_count += 1
                elif record.status in (VerificationStatus.SOURCE_ANSWER_CONFLICT, VerificationStatus.SOURCE_CLAIM_CONFLICT):
                    result.conflict_count += 1
                elif record.status == VerificationStatus.QUESTION_AMBIGUOUS:
                    result.ambiguous_count += 1
                elif record.status == VerificationStatus.VERIFICATION_FAILED:
                    result.failed_count += 1

            except Exception as exc:
                result.failed_count += 1
                result.errors.append(f"Failed verifying candidate {cand.candidate_id}: {exc}")

        return result

