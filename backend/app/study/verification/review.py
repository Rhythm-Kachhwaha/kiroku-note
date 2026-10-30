"""
Human Review and Decision Service for AI Question Verification.
---------------------------------------------------------------
Provides the backend operational foundation for inspecting verification bundles,
evaluating independent model solutions, comparing against source answer claims,
and recording human review decisions.

Guarantees:
- Never mutates sealed revisions in place
- When a human corrects an answer on a sealed revision, creates a new sealed revision (revision_number + 1)
- Preserves all external source answer claims and model solutions immutably
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
from typing import Any

from app.study.ulid import generate_ulid
from app.study.verification.enums import (
    HumanDecisionType,
    VerificationStatus,
)
from app.study.verification.models import HumanReviewInput
from app.study.verification.persistence import VerificationPersistenceService


class VerificationReviewService:
    """Backend service for human inspection and review workflows."""

    def __init__(self, persistence: VerificationPersistenceService | None = None) -> None:
        self.persistence = persistence or VerificationPersistenceService()

    def get_review_bundle(
        self,
        conn: sqlite3.Connection,
        question_id: int,
        revision_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Gather all artifacts required for human review:
        - Question stem and metadata
        - All choices and canonical answer (if defined)
        - All external source answer claims with provenance
        - Latest AI verification run, Model A/B outputs, comparator result
        - AI-generated explanation
        - Historical human decisions
        """
        q_row = conn.execute("SELECT * FROM question WHERE id = ?;", (question_id,)).fetchone()
        if not q_row:
            raise ValueError(f"Question {question_id} not found.")

        target_rev_id = revision_id or q_row["current_revision_id"]
        rev_row = conn.execute(
            "SELECT * FROM question_revision WHERE id = ? AND question_id = ?;",
            (target_rev_id, question_id),
        ).fetchone()
        if not rev_row:
            raise ValueError(f"Revision {target_rev_id} not found for question {question_id}.")

        # 1. Choices
        choice_rows = conn.execute(
            "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;",
            (target_rev_id,),
        ).fetchall()

        # 2. Canonical Answer
        ans_row = conn.execute(
            """
            SELECT ra.*, rc.choice_key
            FROM revision_answer ra
            JOIN revision_choice rc ON ra.choice_id = rc.id
            WHERE ra.question_revision_id = ?;
            """,
            (target_rev_id,),
        ).fetchone()

        # 3. External Source Claims
        claim_rows = conn.execute(
            """
            SELECT sac.*, s.name AS source_name, s.source_type, rc.choice_key AS claimed_choice_key
            FROM source_answer_claim sac
            LEFT JOIN source s ON sac.source_id = s.id
            LEFT JOIN revision_choice rc ON sac.choice_id = rc.id
            WHERE sac.question_revision_id = ?
            ORDER BY sac.id ASC;
            """,
            (target_rev_id,),
        ).fetchall()

        # 4. Latest Verification Run
        run_bundle = self.persistence.get_latest_run_for_revision(conn, target_rev_id)

        return {
            "question": dict(q_row),
            "revision": dict(rev_row),
            "choices": [dict(c) for c in choice_rows],
            "canonical_answer": dict(ans_row) if ans_row else None,
            "source_claims": [dict(c) for c in claim_rows],
            "verification_run": run_bundle,
        }

    def apply_decision(
        self,
        conn: sqlite3.Connection,
        run_id: int,
        decision: HumanDecisionType,
        selected_choice_key: str | None = None,
        human_explanation: str = "",
        notes: str = "",
        reviewer_id: str = "local_user",
    ) -> dict[str, Any]:
        """
        Execute a human review action.
        If CORRECT is selected, creates a new sealed revision with the corrected answer.
        """
        run_row = conn.execute("SELECT * FROM verification_run WHERE id = ?;", (run_id,)).fetchone()
        if not run_row:
            raise ValueError(f"Verification run {run_id} not found.")

        q_id = run_row["question_id"]
        rev_id = run_row["question_revision_id"]

        # Validate & resolve choice key if correcting an answer
        target_choice_key = selected_choice_key
        choices: list[sqlite3.Row] = []
        if decision == HumanDecisionType.CORRECT:
            if not selected_choice_key:
                raise ValueError("Must provide selected_choice_key when correcting an answer.")

            # Validate that selected_choice_key exists in revision_choice
            choices = conn.execute(
                "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;",
                (rev_id,),
            ).fetchall()
            choice_map = {c["choice_key"]: c for c in choices}
            if selected_choice_key in choice_map:
                matched_choice = choice_map[selected_choice_key]
            else:
                matched_choice = None
                for c in choices:
                    if c["label"] == selected_choice_key or str(c["ordinal"]) == str(selected_choice_key):
                        matched_choice = c
                        break

            if not matched_choice:
                raise ValueError(
                    f"Selected choice key '{selected_choice_key}' not in valid choices: {list(choice_map.keys())}"
                )
            target_choice_key = matched_choice["choice_key"]

        decision_input = HumanReviewInput(
            decision=decision,
            selected_choice_key=target_choice_key,
            human_explanation=human_explanation,
            notes=notes,
            reviewer_id=reviewer_id,
        )

        decision_id = self.persistence.record_human_decision(conn, run_id, decision_input)
        now_iso = datetime.now(timezone.utc).isoformat()
        new_rev_id: int | None = None

        # Handle answer correction -> Branch to new revision
        if decision == HumanDecisionType.CORRECT:
            # Check latest revision number for this question
            max_rev_row = conn.execute(
                "SELECT COALESCE(MAX(revision_number), 1) AS max_num FROM question_revision WHERE question_id = ?;",
                (q_id,),
            ).fetchone()
            next_rev_num = (max_rev_row["max_num"] if max_rev_row else 1) + 1

            old_rev = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone()

            # Handle family-specific payload adjustments (e.g. F2 sentence composition)
            payload_dict = json.loads(old_rev["payload_json"]) if old_rev["payload_json"] else {}
            if old_rev["format_code"] == "sentence_composition":
                star_pos = payload_dict.get("star_position", 3)
                payload_dict["derived_star_choice_key"] = target_choice_key
                # If fragment_order exists but contradicts the new star choice, reset to None
                # so F2 contract validation succeeds without assuming the full permutation
                if "fragment_order" in payload_dict and payload_dict["fragment_order"]:
                    if payload_dict["fragment_order"][star_pos - 1] != matched_choice["ordinal"]:
                        payload_dict["fragment_order"] = None

            new_payload_json = json.dumps(payload_dict, ensure_ascii=False)

            # Compute content fingerprint
            from app.study.contracts.common import ChoicePayload
            from app.study.contracts.db_mapping import compute_question_content_fingerprint
            try:
                choice_payloads = [
                    ChoicePayload(
                        choice_key=c["choice_key"],
                        label=c["label"],
                        ordinal=c["ordinal"],
                        text_markup=c["text_markup"],
                        asset_id=c["asset_id"],
                    )
                    for c in choices
                ]
                new_fingerprint = compute_question_content_fingerprint(
                    stem_markup=old_rev["stem_markup"],
                    choices=choice_payloads,
                    payload_dict=payload_dict,
                )
            except Exception:
                new_fingerprint = old_rev["content_fingerprint"]

            # 1. Insert new unsealed revision
            new_rev_cursor = conn.execute(
                """
                INSERT INTO question_revision (
                    question_id, format_code, revision_number, stem_markup,
                    payload_json, validation_status, content_fingerprint, schema_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                RETURNING id;
                """,
                (
                    q_id,
                    old_rev["format_code"],
                    next_rev_num,
                    old_rev["stem_markup"],
                    new_payload_json,
                    "valid",
                    new_fingerprint,
                    now_iso,
                ),
            )
            new_rev_id = new_rev_cursor.fetchone()["id"]

            # 2. Duplicate choices onto new revision
            new_choice_map: dict[str, int] = {}
            for c in choices:
                c_cursor = conn.execute(
                    """
                    INSERT INTO revision_choice (
                        question_revision_id, choice_key, label, ordinal, text_markup, asset_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    RETURNING id;
                    """,
                    (new_rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"], c["asset_id"], now_iso),
                )
                new_choice_map[c["choice_key"]] = c_cursor.fetchone()["id"]

            # 3. Insert corrected revision_answer
            correct_choice_db_id = new_choice_map[target_choice_key]
            conn.execute(
                """
                INSERT INTO revision_answer (
                    question_revision_id, choice_id, answer_origin, rationale_markup, created_at
                ) VALUES (?, ?, 'user_entered', ?, ?);
                """,
                (new_rev_id, correct_choice_db_id, human_explanation or "Corrected by human reviewer.", now_iso),
            )

            # 4. Copy question_revision_asset relationships (listening audio, illustrations, diagrams)
            asset_rows = conn.execute(
                """
                SELECT asset_id, role, ordinal, is_required
                FROM question_revision_asset
                WHERE question_revision_id = ?
                ORDER BY ordinal ASC;
                """,
                (rev_id,),
            ).fetchall()
            for a in asset_rows:
                conn.execute(
                    """
                    INSERT INTO question_revision_asset (
                        question_revision_id, asset_id, role, ordinal, is_required, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?);
                    """,
                    (new_rev_id, a["asset_id"], a["role"], a["ordinal"], a["is_required"], now_iso),
                )

            # 5. Copy and preserve source answer claims with updated conflict evaluation
            claim_rows = conn.execute(
                """
                SELECT * FROM source_answer_claim
                WHERE question_revision_id = ?
                ORDER BY id ASC;
                """,
                (rev_id,),
            ).fetchall()
            old_choice_id_to_key = {c["id"]: c["choice_key"] for c in choices}
            for claim in claim_rows:
                old_cid = claim["choice_id"]
                new_cid = None
                if old_cid is not None and old_cid in old_choice_id_to_key:
                    old_key = old_choice_id_to_key[old_cid]
                    new_cid = new_choice_map.get(old_key)
                is_conflict = 1 if (new_cid is not None and new_cid != correct_choice_db_id) else 0
                conn.execute(
                    """
                    INSERT INTO source_answer_claim (
                        question_revision_id, source_id, choice_id, source_label,
                        source_text, answer_origin, rationale, is_conflict, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        new_rev_id,
                        claim["source_id"],
                        new_cid,
                        claim["source_label"],
                        claim["source_text"],
                        claim["answer_origin"],
                        claim["rationale"],
                        is_conflict,
                        now_iso,
                    ),
                )

            # 6. Record human explanation for the new revision
            conn.execute(
                """
                INSERT INTO question_explanation (
                    external_id, question_id, question_revision_id, run_id,
                    generated_by_slot, provider, model_name, target_choice_key,
                    summary_text, correct_choice_analysis, distractor_analysis_json,
                    is_human_approved, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'human', 'human', ?, ?, ?, ?, '{}', 1, ?, ?);
                """,
                (
                    generate_ulid(),
                    q_id,
                    new_rev_id,
                    run_id,
                    reviewer_id,
                    target_choice_key,
                    human_explanation or "Corrected by human reviewer.",
                    notes or "",
                    now_iso,
                    now_iso,
                ),
            )

            # 7. Seal new revision
            conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now_iso, new_rev_id))

            # 8. Point question to the new current revision
            conn.execute(
                "UPDATE question SET current_revision_id = ?, updated_at = ? WHERE id = ?;",
                (new_rev_id, now_iso, q_id),
            )

        elif decision in (HumanDecisionType.DEFECTIVE, HumanDecisionType.REJECT):
            # Update question status to retired if rejected
            conn.execute("UPDATE question SET status = 'retired', updated_at = ? WHERE id = ?;", (now_iso, q_id))

        return {
            "decision_id": decision_id,
            "run_id": run_id,
            "decision": decision.value,
            "new_revision_id": new_rev_id,
        }

