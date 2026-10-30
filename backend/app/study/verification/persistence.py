"""
Database Persistence Service for AI Question Verification.
-----------------------------------------------------------
Stores verification runs, model responses, generated explanations, and human review decisions.
Guarantees:
- Reusable attempt history per question revision
- Immutability of individual model execution records and human decisions
- Strict exclusion of secrets and API keys from persistence
- Atomic transactions conforming to study.db relational triggers
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
from typing import Any

from app.study.ulid import generate_ulid
from app.study.verification.enums import (
    ConfidenceLevel,
    HumanDecisionType,
    QuestionValidity,
    VerificationStatus,
)
from app.study.verification.models import (
    ComparisonResult,
    ExplanationRecord,
    HumanReviewInput,
    ModelExecutionRecord,
    VerificationRunRecord,
)


class VerificationPersistenceService:
    """Manages transactional persistence and retrieval of verification records."""

    def save_verification_run(
        self,
        conn: sqlite3.Connection,
        record: VerificationRunRecord,
    ) -> int:
        """
        Persist a complete verification run and its associated model execution records.
        """
        assert record.question_id is not None, "question_id must be set to persist verification run"
        assert record.question_revision_id is not None, "question_revision_id must be set to persist verification run"

        now_iso = datetime.now(timezone.utc).isoformat()
        external_id = record.external_id or generate_ulid()

        # Find models from responses
        model_a_info = next((m for m in record.model_responses if m.model_slot == "model_a"), None)
        model_b_info = next((m for m in record.model_responses if m.model_slot == "model_b"), None)

        model_a_provider = model_a_info.provider if model_a_info else "unknown"
        model_a_model = model_a_info.model_name if model_a_info else "unknown"
        model_b_provider = model_b_info.provider if model_b_info else "unknown"
        model_b_model = model_b_info.model_name if model_b_info else "unknown"

        # Determine next attempt number if not explicitly specified
        if not record.attempt_number or record.attempt_number <= 1:
            row = conn.execute(
                "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_att FROM verification_run WHERE question_revision_id = ?;",
                (record.question_revision_id,),
            ).fetchone()
            attempt_number = row["next_att"] if row else 1
        else:
            attempt_number = record.attempt_number

        scenario_val = record.comparison.scenario.value if record.comparison else None

        # 1. Insert verification_run
        cursor = conn.execute(
            """
            INSERT INTO verification_run (
                external_id, question_id, question_revision_id, attempt_number,
                status, comparison_scenario, model_a_provider, model_a_model,
                model_b_provider, model_b_model, model_a_choice_key, model_b_choice_key,
                source_answer_keys_json, is_ambiguous, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id;
            """,
            (
                external_id,
                record.question_id,
                record.question_revision_id,
                attempt_number,
                record.status.value,
                scenario_val,
                model_a_provider,
                model_a_model,
                model_b_provider,
                model_b_model,
                record.comparison.model_a_choice if record.comparison else None,
                record.comparison.model_b_choice if record.comparison else None,
                json.dumps(record.comparison.source_choices if record.comparison else [], ensure_ascii=False),
                1 if (record.comparison and record.comparison.is_ambiguous) else 0,
                record.error_message,
                now_iso,
                now_iso,
            ),
        )
        run_id = cursor.fetchone()["id"]

        # 2. Insert individual model responses
        for m in record.model_responses:
            conn.execute(
                """
                INSERT INTO verification_model_response (
                    run_id, model_slot, stage, provider, model_name,
                    selected_choice_key, confidence, question_validity, ambiguity_detected,
                    reasoning_markup, choice_analysis_json, source_assessment_json,
                    raw_response_text, execution_time_ms, token_usage_json, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    run_id,
                    m.model_slot.value if hasattr(m.model_slot, "value") else str(m.model_slot),
                    m.stage.value if hasattr(m.stage, "value") else str(m.stage),
                    m.provider,
                    m.model_name,
                    m.selected_choice_key,
                    m.confidence.value if (m.confidence and hasattr(m.confidence, "value")) else m.confidence,
                    m.question_validity.value if (m.question_validity and hasattr(m.question_validity, "value")) else m.question_validity,
                    1 if m.ambiguity_detected else 0,
                    m.reasoning_markup,
                    json.dumps(m.choice_analysis, ensure_ascii=False),
                    json.dumps(m.source_assessment, ensure_ascii=False),
                    m.raw_response_text,
                    m.execution_time_ms,
                    json.dumps(m.token_usage, ensure_ascii=False),
                    m.error_message,
                    now_iso,
                ),
            )

        # 3. Insert generated explanation (if present)
        if record.explanation:
            exp = record.explanation
            exp_ext_id = exp.external_id or generate_ulid()
            conn.execute(
                """
                INSERT INTO question_explanation (
                    external_id, question_id, question_revision_id, run_id,
                    generated_by_slot, provider, model_name, target_choice_key,
                    summary_text, correct_choice_analysis, distractor_analysis_json,
                    grammar_notes, kanji_vocabulary_notes, reading_context_notes,
                    is_human_approved, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    exp_ext_id,
                    record.question_id,
                    record.question_revision_id,
                    run_id,
                    exp.generated_by_slot,
                    exp.provider,
                    exp.model_name,
                    exp.target_choice_key,
                    exp.summary_text,
                    exp.correct_choice_analysis,
                    json.dumps(exp.distractor_analysis, ensure_ascii=False),
                    exp.grammar_notes,
                    exp.kanji_vocabulary_notes,
                    exp.reading_context_notes,
                    1 if exp.is_human_approved else 0,
                    now_iso,
                    now_iso,
                ),
            )

        return run_id

    def get_latest_run_for_revision(
        self,
        conn: sqlite3.Connection,
        question_revision_id: int,
    ) -> dict[str, Any] | None:
        """Fetch the latest verification run and associated responses for a question revision."""
        row = conn.execute(
            """
            SELECT * FROM verification_run
            WHERE question_revision_id = ?
            ORDER BY attempt_number DESC
            LIMIT 1;
            """,
            (question_revision_id,),
        ).fetchone()

        if not row:
            return None

        run_dict = dict(row)
        run_id = run_dict["id"]

        # Fetch model responses
        resp_rows = conn.execute(
            "SELECT * FROM verification_model_response WHERE run_id = ? ORDER BY id ASC;",
            (run_id,),
        ).fetchall()
        run_dict["model_responses"] = [dict(r) for r in resp_rows]

        # Fetch explanation
        exp_row = conn.execute(
            "SELECT * FROM question_explanation WHERE run_id = ? LIMIT 1;",
            (run_id,),
        ).fetchone()
        run_dict["explanation"] = dict(exp_row) if exp_row else None

        # Fetch human decisions
        dec_rows = conn.execute(
            "SELECT * FROM verification_human_decision WHERE run_id = ? ORDER BY id ASC;",
            (run_id,),
        ).fetchall()
        run_dict["human_decisions"] = [dict(d) for d in dec_rows]

        return run_dict

    def list_runs_for_revision(
        self,
        conn: sqlite3.Connection,
        question_revision_id: int,
    ) -> list[dict[str, Any]]:
        """List all historical verification attempts for a question revision."""
        rows = conn.execute(
            """
            SELECT * FROM verification_run
            WHERE question_revision_id = ?
            ORDER BY attempt_number ASC;
            """,
            (question_revision_id,),
        ).fetchall()

        results: list[dict[str, Any]] = []
        for r in rows:
            run_dict = dict(r)
            run_id = run_dict["id"]
            resp_rows = conn.execute(
                "SELECT * FROM verification_model_response WHERE run_id = ? ORDER BY id ASC;",
                (run_id,),
            ).fetchall()
            run_dict["model_responses"] = [dict(resp) for resp in resp_rows]

            exp_row = conn.execute(
                "SELECT * FROM question_explanation WHERE run_id = ? LIMIT 1;",
                (run_id,),
            ).fetchone()
            run_dict["explanation"] = dict(exp_row) if exp_row else None

            dec_rows = conn.execute(
                "SELECT * FROM verification_human_decision WHERE run_id = ? ORDER BY id ASC;",
                (run_id,),
            ).fetchall()
            run_dict["human_decisions"] = [dict(d) for d in dec_rows]

            results.append(run_dict)

        return results

    def record_human_decision(
        self,
        conn: sqlite3.Connection,
        run_id: int,
        decision_input: HumanReviewInput,
    ) -> int:
        """
        Record a human review decision, update run status, and update explanation approval state.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        external_id = generate_ulid()

        # Fetch parent run
        run_row = conn.execute("SELECT * FROM verification_run WHERE id = ?;", (run_id,)).fetchone()
        if not run_row:
            raise ValueError(f"Verification run {run_id} not found.")

        q_id = run_row["question_id"]
        rev_id = run_row["question_revision_id"]

        # Insert immutable decision
        cursor = conn.execute(
            """
            INSERT INTO verification_human_decision (
                external_id, run_id, question_id, question_revision_id,
                decision, selected_choice_key, human_explanation, notes,
                reviewer_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id;
            """,
            (
                external_id,
                run_id,
                q_id,
                rev_id,
                decision_input.decision.value,
                decision_input.selected_choice_key,
                decision_input.human_explanation,
                decision_input.notes,
                decision_input.reviewer_id,
                now_iso,
            ),
        )
        decision_id = cursor.fetchone()["id"]

        # Map decision to new verification run status
        new_status = VerificationStatus.NEEDS_HUMAN_REVIEW
        if decision_input.decision == HumanDecisionType.ACCEPT:
            new_status = VerificationStatus.HUMAN_APPROVED
        elif decision_input.decision == HumanDecisionType.CORRECT:
            new_status = VerificationStatus.HUMAN_CORRECTED
        elif decision_input.decision in (HumanDecisionType.REJECT, HumanDecisionType.DEFECTIVE):
            new_status = VerificationStatus.HUMAN_REJECTED
        elif decision_input.decision == HumanDecisionType.AMBIGUOUS:
            new_status = VerificationStatus.QUESTION_AMBIGUOUS
        elif decision_input.decision == HumanDecisionType.REVERIFY:
            new_status = VerificationStatus.PENDING

        conn.execute(
            "UPDATE verification_run SET status = ?, updated_at = ? WHERE id = ?;",
            (new_status.value, now_iso, run_id),
        )

        # If accepted, mark associated explanation as approved
        if decision_input.decision == HumanDecisionType.ACCEPT:
            conn.execute(
                "UPDATE question_explanation SET is_human_approved = 1, updated_at = ? WHERE run_id = ?;",
                (now_iso, run_id),
            )

        return decision_id

