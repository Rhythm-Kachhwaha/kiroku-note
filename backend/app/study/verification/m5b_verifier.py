"""
M5-B Final Verification Pipeline Runner.
---------------------------------------
Verifies quarantined text questions in study.db using independent dual-model AI
verification (Groq openai/gpt-oss-120b + Gemini gemini-3.5-flash-lite).
Strictly adheres to:
- Token conservation (compact prompts, minimal output tokens, no explanations)
- Free-tier rate limits (Groq 30 RPM, Gemini 15 RPM)
- Caching of all successful runs (100% idempotency, no repeated calls)
- Immutability of sealed question revisions
- Servable evaluation through evaluate_eligibility
- Multimodal safety (all 20 listening questions remain quarantined)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sqlite3
import time
from typing import Any

from app.config import get_study_dir, load_dotenv
from app.study.connection import StudyDatabaseManager
from app.study.doctor import run_doctor
from app.study.eligibility import evaluate_eligibility
from app.study.media import MediaStore
from app.study.verification.enums import ComparisonScenario, VerificationStatus
from app.study.verification.models import VerificationRunRecord
from app.study.verification.service import VerificationService

logger = logging.getLogger("kiroku.study.m5b_verifier")


@dataclass
class VerificationStats:
    total_database_questions: int = 0
    multimodal_listening_quarantined: int = 0
    target_text_questions: int = 0
    processed_count: int = 0
    approved_count: int = 0
    quarantined_count: int = 0
    cached_runs_reused: int = 0
    api_calls_model_a: int = 0
    api_calls_model_b: int = 0
    scenario_counts: dict[str, int] = field(default_factory=dict)
    quarantine_reasons: dict[str, int] = field(default_factory=dict)
    model_a_tokens: dict[str, int] = field(default_factory=lambda: {"prompt": 0, "completion": 0, "total": 0})
    model_b_tokens: dict[str, int] = field(default_factory=lambda: {"prompt": 0, "completion": 0, "total": 0})
    execution_times_ms: list[int] = field(default_factory=list)
    doctor_errors: int = 0
    doctor_warnings: int = 0
    servable_count: int = 0
    ineligible_count: int = 0


class M5BVerifier:
    """Orchestrates dual-model verification for Milestone 5-B."""

    def __init__(
        self,
        study_dir: Path | None = None,
        service: VerificationService | None = None,
        media_store: MediaStore | None = None,
    ) -> None:
        load_dotenv()
        self.study_dir = study_dir or get_study_dir()
        self.db_path = self.study_dir / "study.db"
        self.media_store = media_store or MediaStore(self.study_dir / "media")
        self.db_manager = StudyDatabaseManager(self.db_path)
        self.service = service or VerificationService(skip_source_verify=True, skip_explanations=True)

    def identify_questions(self, conn: sqlite3.Connection) -> tuple[list[sqlite3.Row], list[sqlite3.Row]]:
        """
        Reconcile and separate questions in study.db into:
        1. Target text questions (71 questions)
        2. Media-dependent listening questions (20 questions)
        """
        conn.row_factory = sqlite3.Row
        all_questions = conn.execute(
            """
            SELECT q.id, q.external_id, q.format_code, q.level, q.category, q.status,
                   q.current_revision_id,
                   COUNT(qra.asset_id) as asset_count,
                   SUM(CASE WHEN a.kind = 'audio' THEN 1 ELSE 0 END) as audio_count
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN question_revision_asset qra ON qr.id = qra.question_revision_id
            LEFT JOIN asset a ON qra.asset_id = a.id
            GROUP BY q.id
            ORDER BY q.id ASC;
            """
        ).fetchall()

        target_text: list[sqlite3.Row] = []
        listening_media: list[sqlite3.Row] = []

        for q in all_questions:
            if q["format_code"] == "task_based_listening" or (q["audio_count"] and q["audio_count"] > 0):
                listening_media.append(q)
            else:
                target_text.append(q)

        return target_text, listening_media

    def run_verification(self, reuse_cached: bool = True) -> VerificationStats:
        """
        Execute dual-model verification across all target text questions.
        Approve only questions matching Scenario A (AGREEMENT between both models and source).
        """
        stats = VerificationStats()

        with self.db_manager.read() as conn:
            target_text, listening_media = self.identify_questions(conn)

        stats.total_database_questions = len(target_text) + len(listening_media)
        stats.multimodal_listening_quarantined = len(listening_media)
        stats.target_text_questions = len(target_text)

        logger.info(
            "M5-B Verification Start: Total DB=%d, Target Text=%d, Listening Quarantined=%d",
            stats.total_database_questions,
            stats.target_text_questions,
            stats.multimodal_listening_quarantined,
        )

        for q_row in target_text:
            q_id = q_row["id"]
            rev_id = q_row["current_revision_id"]

            stats.processed_count += 1
            now_iso = datetime.now(timezone.utc).isoformat()

            # Execute verification (with reuse_cached enabled)
            with self.db_manager.write_tx() as conn:
                # Check if cached run exists before verifying
                cached = self.service.persistence.get_latest_run_for_revision(conn, rev_id) if reuse_cached else None
                was_cached = cached is not None

                t0 = time.perf_counter()
                record: VerificationRunRecord = self.service.verify_persisted_question(
                    conn=conn,
                    question_id=q_id,
                    question_revision_id=rev_id,
                    persist=True,
                    reuse_cached=reuse_cached,
                )
                duration_ms = int((time.perf_counter() - t0) * 1000)
                stats.execution_times_ms.append(duration_ms)

                if was_cached:
                    stats.cached_runs_reused += 1
                else:
                    # Update token statistics from responses
                    for m in record.model_responses:
                        tokens = m.token_usage or {}
                        if m.model_slot == "model_a":
                            stats.api_calls_model_a += 1
                            stats.model_a_tokens["prompt"] += tokens.get("prompt_tokens", 0)
                            stats.model_a_tokens["completion"] += tokens.get("completion_tokens", 0)
                            stats.model_a_tokens["total"] += tokens.get("total_tokens", 0)
                        elif m.model_slot == "model_b":
                            stats.api_calls_model_b += 1
                            stats.model_b_tokens["prompt"] += tokens.get("prompt_tokens", 0)
                            stats.model_b_tokens["completion"] += tokens.get("completion_tokens", 0)
                            stats.model_b_tokens["total"] += tokens.get("total_tokens", 0)

                # Evaluate Scenario
                scenario = record.comparison.scenario if record.comparison else ComparisonScenario.SCENARIO_H_MODEL_FAILURE
                scenario_key = scenario.value if hasattr(scenario, "value") else str(scenario)
                stats.scenario_counts[scenario_key] = stats.scenario_counts.get(scenario_key, 0) + 1

                if scenario == ComparisonScenario.SCENARIO_A_AGREEMENT:
                    # Approved: activate question
                    conn.execute(
                        "UPDATE question SET status = 'active', updated_at = ? WHERE id = ?;",
                        (now_iso, q_id),
                    )
                    stats.approved_count += 1
                else:
                    # Quarantined: maintain draft status
                    conn.execute(
                        "UPDATE question SET status = 'draft', updated_at = ? WHERE id = ?;",
                        (now_iso, q_id),
                    )
                    stats.quarantined_count += 1
                    stats.quarantine_reasons[scenario_key] = stats.quarantine_reasons.get(scenario_key, 0) + 1

            # Log progress every 5 questions
            if stats.processed_count % 5 == 0 or stats.processed_count == stats.target_text_questions:
                logger.info(
                    "Progress: %d/%d (Approved: %d, Quarantined: %d)",
                    stats.processed_count,
                    stats.target_text_questions,
                    stats.approved_count,
                    stats.quarantined_count,
                )

        # Validate servability and non-servability across entire database
        with self.db_manager.read() as conn:
            all_db_questions = conn.execute("SELECT id FROM question ORDER BY id ASC;").fetchall()
            for r in all_db_questions:
                is_eligible, reasons = evaluate_eligibility(
                    r["id"],
                    conn,
                    verify_files=True,
                    media_store=self.media_store,
                )
                if is_eligible:
                    stats.servable_count += 1
                else:
                    stats.ineligible_count += 1

            # Run doctor
            findings = run_doctor(conn, self.media_store)
            stats.doctor_errors = sum(1 for f in findings if f.severity == "ERROR")
            stats.doctor_warnings = sum(1 for f in findings if f.severity == "WARNING")

        return stats

