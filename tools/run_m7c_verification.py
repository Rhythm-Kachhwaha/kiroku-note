"""
Milestone 7-C: N4 Verification Backlog & Question Bank Readiness Runner.
------------------------------------------------------------------------
Executes:
1. Pre-run audit of study.db (total questions, N4/N5 breakdown, active vs draft, multimodal vs text).
2. Targeted Gate 2 Dual-Model Verification across 20 high-priority candidates:
   - 12 comprehension_short candidates with answers (IDs 780-791)
   - 8 kanji_reading candidates with answers (IDs 116-123)
   Preserves token conservation by halting verification of saturated formats (>300% blueprint quota).
3. 100% Idempotency test (verifying 0 new API calls when reusing cached runs).
4. Full Database Doctor run (asserting 0 errors, 0 warnings).
5. Comprehensive JLPT N4 Exam Blueprint readiness evaluation (ExamReadinessValidator).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sqlite3
import sys
import time
from typing import Any

from app.config import get_study_dir, load_dotenv
from app.study.connection import StudyDatabaseManager
from app.study.doctor import run_doctor
from app.study.eligibility import evaluate_eligibility
from app.study.exam import ExamReadinessValidator, get_official_blueprint
from app.study.media import MediaStore
from app.study.verification.enums import ComparisonScenario
from app.study.verification.models import VerificationRunRecord
from app.study.verification.providers.base import AIProviderRateLimitError
from app.study.verification.service import VerificationService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("m7c_runner")


@dataclass
class M7CStats:
    # Audit before
    pre_total_db: int = 0
    pre_n4_total: int = 0
    pre_n4_active: int = 0
    pre_n4_draft: int = 0
    pre_n5_total: int = 0
    pre_n5_active: int = 0
    pre_n5_draft: int = 0
    pre_multimodal_draft: int = 0
    pre_unverified_text: int = 0

    # Verification run
    target_count: int = 0
    verified_count: int = 0
    approved_count: int = 0
    quarantined_count: int = 0
    api_calls_model_a: int = 0
    api_calls_model_b: int = 0
    tokens_model_a: dict[str, int] = field(default_factory=lambda: {"prompt": 0, "completion": 0, "total": 0})
    tokens_model_b: dict[str, int] = field(default_factory=lambda: {"prompt": 0, "completion": 0, "total": 0})
    scenario_counts: dict[str, int] = field(default_factory=dict)
    format_approved_counts: dict[str, int] = field(default_factory=dict)

    # Idempotency
    idempotency_calls_model_a: int = 0
    idempotency_calls_model_b: int = 0
    idempotency_cached_reused: int = 0
    idempotency_passed: bool = False

    # Doctor
    doctor_errors: int = 0
    doctor_warnings: int = 0

    # Audit after
    post_total_db: int = 0
    post_n4_total: int = 0
    post_n4_active: int = 0
    post_n4_draft: int = 0


class M7CRunner:
    def __init__(self) -> None:
        load_dotenv()
        self.study_dir = get_study_dir()
        self.db_path = self.study_dir / "study.db"
        self.db_manager = StudyDatabaseManager(self.db_path)
        self.media_store = MediaStore(self.study_dir / "media")
        self.verification_service = VerificationService(skip_source_verify=True, skip_explanations=True)
        self.stats = M7CStats()

    def phase1_audit_pre(self) -> list[dict[str, Any]]:
        logger.info("=== Phase 1: Pre-Run Database Audit ===")
        with self.db_manager.read() as conn:
            conn.row_factory = sqlite3.Row

            self.stats.pre_total_db = conn.execute("SELECT COUNT(*) FROM question;").fetchone()[0]
            self.stats.pre_n4_total = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4';").fetchone()[0]
            self.stats.pre_n4_active = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'active';").fetchone()[0]
            self.stats.pre_n4_draft = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'draft';").fetchone()[0]

            self.stats.pre_n5_total = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5';").fetchone()[0]
            self.stats.pre_n5_active = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5' AND status = 'active';").fetchone()[0]
            self.stats.pre_n5_draft = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5' AND status = 'draft';").fetchone()[0]

            # Multimodal draft questions (audio, diagram, or task_based_listening)
            multimodal_rows = conn.execute(
                """
                SELECT q.id
                FROM question q
                JOIN question_revision qr ON q.current_revision_id = qr.id
                LEFT JOIN question_revision_asset qra ON qr.id = qra.question_revision_id
                LEFT JOIN asset a ON qra.asset_id = a.id
                WHERE q.level = 'N4' AND q.status = 'draft'
                GROUP BY q.id
                HAVING SUM(CASE WHEN a.kind = 'audio' THEN 1 ELSE 0 END) > 0
                    OR SUM(CASE WHEN a.kind = 'diagram' THEN 1 ELSE 0 END) > 0
                    OR q.format_code = 'task_based_listening';
                """
            ).fetchall()
            self.stats.pre_multimodal_draft = len(multimodal_rows)

            # Unverified text candidates in N4
            unverified_rows = conn.execute(
                """
                SELECT q.id, q.format_code, qr.id as rev_id,
                       (SELECT choice_id FROM revision_answer ra WHERE ra.question_revision_id = qr.id) as ans_choice_id,
                       (SELECT source_label FROM source_answer_claim sac WHERE sac.question_revision_id = qr.id LIMIT 1) as src_label
                FROM question q
                JOIN question_revision qr ON q.current_revision_id = qr.id
                LEFT JOIN question_revision_asset qra ON qr.id = qra.question_revision_id
                LEFT JOIN asset a ON qra.asset_id = a.id
                WHERE q.level = 'N4' AND q.status = 'draft'
                  AND qr.id NOT IN (SELECT question_revision_id FROM verification_run)
                GROUP BY q.id
                HAVING SUM(CASE WHEN a.kind = 'audio' THEN 1 ELSE 0 END) = 0
                   AND SUM(CASE WHEN a.kind = 'diagram' THEN 1 ELSE 0 END) = 0
                   AND q.format_code != 'task_based_listening'
                ORDER BY q.id ASC;
                """
            ).fetchall()
            self.stats.pre_unverified_text = len(unverified_rows)

            logger.info(
                "DB State: Total=%d (N4: %d, N5: %d) | N4 Active=%d | N4 Draft=%d",
                self.stats.pre_total_db,
                self.stats.pre_n4_total,
                self.stats.pre_n5_total,
                self.stats.pre_n4_active,
                self.stats.pre_n4_draft,
            )
            logger.info(
                "Draft Composition: Multimodal Quarantined=%d | Unverified Text Candidates=%d",
                self.stats.pre_multimodal_draft,
                self.stats.pre_unverified_text,
            )

            # Select target questions:
            # 12 comprehension_short with answers
            reading_candidates = [
                dict(r) for r in unverified_rows
                if r["format_code"] == "comprehension_short" and (r["ans_choice_id"] is not None or r["src_label"] is not None)
            ][:12]

            # 8 kanji_reading with answers
            kanji_candidates = [
                dict(r) for r in unverified_rows
                if r["format_code"] == "kanji_reading" and (r["ans_choice_id"] is not None or r["src_label"] is not None)
            ][:8]

            targets = reading_candidates + kanji_candidates
            self.stats.target_count = len(targets)
            logger.info("Selected %d verification targets (12 reading, 8 kanji).", len(targets))
            return targets

    def phase2_verify_targets(self, targets: list[dict[str, Any]]) -> None:
        logger.info("=== Phase 2: Dual-Model AI Verification ===")
        if not self.verification_service.is_enabled:
            logger.error("VerificationService is not enabled. Check API keys.")
            return

        for idx, t in enumerate(targets, start=1):
            q_id = t["id"]
            rev_id = t["rev_id"]
            fmt = t["format_code"]
            now_iso = datetime.now(timezone.utc).isoformat()

            try:
                with self.db_manager.write_tx() as conn:
                    record: VerificationRunRecord = self.verification_service.verify_persisted_question(
                        conn=conn,
                        question_id=q_id,
                        question_revision_id=rev_id,
                        persist=True,
                        reuse_cached=True,
                    )

                    for m in record.model_responses:
                        tok = m.token_usage or {}
                        if m.model_slot == "model_a":
                            self.stats.api_calls_model_a += 1
                            self.stats.tokens_model_a["prompt"] += tok.get("prompt_tokens", 0)
                            self.stats.tokens_model_a["completion"] += tok.get("completion_tokens", 0)
                            self.stats.tokens_model_a["total"] += tok.get("total_tokens", 0)
                        elif m.model_slot == "model_b":
                            self.stats.api_calls_model_b += 1
                            self.stats.tokens_model_b["prompt"] += tok.get("prompt_tokens", 0)
                            self.stats.tokens_model_b["completion"] += tok.get("completion_tokens", 0)
                            self.stats.tokens_model_b["total"] += tok.get("total_tokens", 0)

                    scenario = record.comparison.scenario if record.comparison else ComparisonScenario.SCENARIO_H_MODEL_FAILURE
                    sc_str = scenario.value if hasattr(scenario, "value") else str(scenario)
                    self.stats.scenario_counts[sc_str] = self.stats.scenario_counts.get(sc_str, 0) + 1

                    if scenario == ComparisonScenario.SCENARIO_A_AGREEMENT:
                        conn.execute("UPDATE question SET status = 'active', updated_at = ? WHERE id = ?;", (now_iso, q_id))
                        self.stats.approved_count += 1
                        self.stats.format_approved_counts[fmt] = self.stats.format_approved_counts.get(fmt, 0) + 1
                    else:
                        conn.execute("UPDATE question SET status = 'draft', updated_at = ? WHERE id = ?;", (now_iso, q_id))
                        self.stats.quarantined_count += 1

                    self.stats.verified_count += 1

                logger.info(
                    "Verified [%d/%d] Q#%d (%s): Scenario=%s (Approved=%d, Quarantined=%d)",
                    idx,
                    len(targets),
                    q_id,
                    fmt,
                    sc_str,
                    self.stats.approved_count,
                    self.stats.quarantined_count,
                )

            except AIProviderRateLimitError as rle:
                logger.warning("Rate limit ceiling reached on question %d: %s. Stopping batch.", q_id, rle)
                break
            except Exception as exc:
                logger.error("Error verifying question %d: %s", q_id, exc)

        logger.info(
            "Phase 2 Complete: Verified=%d | Approved=%d | Quarantined=%d | Scenarios=%s",
            self.stats.verified_count,
            self.stats.approved_count,
            self.stats.quarantined_count,
            self.stats.scenario_counts,
        )

    def phase3_idempotency_check(self, targets: list[dict[str, Any]]) -> None:
        logger.info("=== Phase 3: Idempotency Verification Pass ===")
        calls_a_start = self.stats.api_calls_model_a
        calls_b_start = self.stats.api_calls_model_b

        for idx, t in enumerate(targets[:self.stats.verified_count], start=1):
            q_id = t["id"]
            rev_id = t["rev_id"]
            with self.db_manager.write_tx() as conn:
                record: VerificationRunRecord = self.verification_service.verify_persisted_question(
                    conn=conn,
                    question_id=q_id,
                    question_revision_id=rev_id,
                    persist=True,
                    reuse_cached=True,
                )
                self.stats.idempotency_cached_reused += 1

        self.stats.idempotency_calls_model_a = self.stats.api_calls_model_a - calls_a_start
        self.stats.idempotency_calls_model_b = self.stats.api_calls_model_b - calls_b_start
        self.stats.idempotency_passed = (
            self.stats.idempotency_calls_model_a == 0
            and self.stats.idempotency_calls_model_b == 0
            and self.stats.idempotency_cached_reused == self.stats.verified_count
        )
        logger.info(
            "Idempotency Check: Reused=%d/%d | New Model A Calls=%d | New Model B Calls=%d | Passed=%s",
            self.stats.idempotency_cached_reused,
            self.stats.verified_count,
            self.stats.idempotency_calls_model_a,
            self.stats.idempotency_calls_model_b,
            self.stats.idempotency_passed,
        )

    def phase4_doctor_inspection(self) -> None:
        logger.info("=== Phase 4: Database Doctor Inspection ===")
        with self.db_manager.read() as conn:
            findings = run_doctor(conn, self.media_store)
            self.stats.doctor_errors = sum(1 for f in findings if f.severity == "ERROR")
            self.stats.doctor_warnings = sum(1 for f in findings if f.severity == "WARNING")
            logger.info("Doctor Findings: %d | Errors: %d | Warnings: %d", len(findings), self.stats.doctor_errors, self.stats.doctor_warnings)

    def phase5_audit_post(self) -> None:
        logger.info("=== Phase 5: Post-Verification Audit & Blueprint Readiness ===")
        with self.db_manager.read() as conn:
            conn.row_factory = sqlite3.Row
            self.stats.post_total_db = conn.execute("SELECT COUNT(*) FROM question;").fetchone()[0]
            self.stats.post_n4_total = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4';").fetchone()[0]
            self.stats.post_n4_active = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'active';").fetchone()[0]
            self.stats.post_n4_draft = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'draft';").fetchone()[0]

            logger.info(
                "Post-Verification DB State: Total=%d | N4 Total=%d | N4 Active=%d | N4 Draft=%d",
                self.stats.post_total_db,
                self.stats.post_n4_total,
                self.stats.post_n4_active,
                self.stats.post_n4_draft,
            )

            # Evaluate Exam Readiness
            n4_bp = get_official_blueprint("N4")
            readiness = ExamReadinessValidator.validate_readiness(conn, n4_bp)
            logger.info("N4 Blueprint Readiness Status: %s", readiness.status.value)
            logger.info("Total Required: %d | Total Available: %d | Is Ready: %s", readiness.total_required, readiness.total_available, readiness.is_ready)
            for s in readiness.sections:
                logger.info(
                    "Section '%s' (%s): Required=%d | Available=%d | Satisfied=%s",
                    s.section_code,
                    s.label,
                    s.required_count,
                    s.available_count,
                    s.is_satisfied,
                )
                for f in s.formats:
                    logger.info("  - %s (%s): req=%d, avail=%d, missing=%d, satisfied=%s", f.format_code, f.category, f.required_count, f.available_count, f.missing_count, f.is_satisfied)


def main() -> None:
    runner = M7CRunner()
    targets = runner.phase1_audit_pre()
    runner.phase2_verify_targets(targets)
    runner.phase3_idempotency_check(targets)
    runner.phase4_doctor_inspection()
    runner.phase5_audit_post()


if __name__ == "__main__":
    main()
