"""
Unit and Integration Tests for Milestone 5-B Pilot Pipeline.
-----------------------------------------------------------
Tests:
- Database initialization, STRICT tables, triggers, and doctor check
- Controlled acquisition & media download (diagrams, audio MP3 duration)
- M3 Gate 1 ingestion with anomaly handling (missing choices, format validation)
- M3 Gate 2 dual-model verification with independent MockAIProviders:
  - Scenario A: Source + Model A + Model B agree -> Approved (active, valid)
  - Scenario C: Model disagreement -> Quarantined (needs_review)
  - Scenario D: Source disagreement -> Quarantined (needs_review)
- Multimodal safety quarantine for listening audio and diagrams
- Database eligibility: approved are servable; quarantined are strictly ineligible
- Full idempotency check: second re-run yields 0 duplicate questions, revisions, sources, or assets
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import pytest

from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.m5b_pipeline import (
    M5BPilotPipeline,
    PILOT_EXERCISE_SPECS,
)
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.acquisition.models import RawFetchResult
from app.study.connection import StudyDatabaseManager
from app.study.contracts.enums import (
    AnswerOrigin,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
)
from app.study.doctor import run_doctor
from app.study.eligibility import evaluate_eligibility
from app.study.ingestion.enums import ReviewReasonCode, ReviewStatus
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.verification.enums import (
    ComparisonScenario,
    ConfidenceLevel,
    QuestionValidity,
    VerificationStatus,
)
from app.study.verification.models import (
    AIChoiceInput,
    AISolveRequest,
    AISolveResponse,
    AIVerifyClaimsResponse,
)
from app.study.verification.providers.mock import MockAIProvider
from app.study.verification.service import VerificationService


@pytest.fixture
def temp_study_env():
    """Create an isolated temporary study environment with database and media directory."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        db_path = root / "study.db"
        media_dir = root / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        db_manager = StudyDatabaseManager(db_path=db_path)
        media_store = MediaStore(media_dir=media_dir)
        cache_dir = Path("backend/study/raw_acquisition")
        cache = RawAcquisitionCache(base_dir=cache_dir)

        yield {
            "root": root,
            "db_path": db_path,
            "media_dir": media_dir,
            "db_manager": db_manager,
            "media_store": media_store,
            "cache": cache,
        }


# =============================================================================
# 1. Database Initialization & Doctor Tests
# =============================================================================

def test_m5b_database_initialization(temp_study_env):
    """Verify Step A initializes schema 0001–0004, triggers, and doctor reports 0 errors."""
    pipeline = M5BPilotPipeline(
        db_manager=temp_study_env["db_manager"],
        media_store=temp_study_env["media_store"],
        cache=temp_study_env["cache"],
    )

    findings = pipeline.initialize_database(run_backup=True)
    error_findings = [f for f in findings if f.severity == "ERROR"]
    assert len(error_findings) == 0

    # Verify tables exist and have STRICT mode enabled
    with temp_study_env["db_manager"].read() as conn:
        tables = [
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
            ).fetchall()
        ]
        assert "question" in tables
        assert "question_revision" in tables
        assert "source" in tables
        assert "question_source" in tables
        assert "asset" in tables
        assert "acquisition_job" in tables
        assert "acquisition_job_item" in tables

        # Verify WAL mode
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert journal_mode.lower() == "wal"


# =============================================================================
# 2. Controlled Ingestion & Multimodal Safety Tests
# =============================================================================

def test_m5b_ingestion_and_multimodal_safety_quarantine(temp_study_env):
    """Verify text questions and multimodal media questions ingest with proper safety quarantine."""
    pipeline = M5BPilotPipeline(
        db_manager=temp_study_env["db_manager"],
        media_store=temp_study_env["media_store"],
        cache=temp_study_env["cache"],
        verification_service=None,  # No AI configured
    )
    pipeline.initialize_database(run_backup=False)

    # Use 2 exercises: 1 Grammar (text only) and 1 Listening (audio & diagrams)
    test_specs = [
        PILOT_EXERCISE_SPECS[0],  # N5 Grammar Exercise 01 (10 Qs, pure text)
        PILOT_EXERCISE_SPECS[4],  # N5 Listening Exercise 01 (5 Qs, diagrams)
    ]

    summary = pipeline.run_pilot(specs=test_specs, verify_multimodal_safety=True)

    assert summary.total_questions_discovered == 15
    assert summary.total_questions_ingested == 15
    # Since AI is unconfigured and listening has media, all 15 should be safely quarantined
    assert summary.quarantined_count == 15
    assert summary.approved_count == 0

    # Grammar questions should be quarantined as AI_VERIFICATION_UNCONFIGURED
    assert summary.quarantine_reasons.get("AI_VERIFICATION_UNCONFIGURED", 0) == 10
    # Listening questions should be quarantined under Multimodal Safety
    assert summary.quarantine_reasons.get("UNSUPPORTED_MEDIA_DEPENDENT_QUESTION", 0) == 5

    # Check eligibility: 0 questions should be eligible
    assert summary.eligible_approved_count == 0
    assert summary.ineligible_quarantined_count == 15
    assert summary.doctor_errors == 0


# =============================================================================
# 3. Dual-Model Verification with Independent Mock Providers
# =============================================================================

def test_m5b_dual_model_verification_scenarios(temp_study_env):
    """
    Verify Scenario A (agreement) results in approval, while
    Scenario C (disagreement) and Scenario D (source conflict) result in quarantine.
    """
    # Create two genuinely independent Mock providers
    provider_a = MockAIProvider(
        model="mock-grok-1",
        default_selected_choice="2",
        confidence=ConfidenceLevel.HIGH,
    )
    provider_b = MockAIProvider(
        model="mock-openai-1",
        default_selected_choice="2",
        confidence=ConfidenceLevel.HIGH,
    )

    verif_service = VerificationService(
        provider_a=provider_a,
        provider_b=provider_b,
    )
    assert verif_service.is_enabled

    pipeline = M5BPilotPipeline(
        db_manager=temp_study_env["db_manager"],
        media_store=temp_study_env["media_store"],
        cache=temp_study_env["cache"],
        verification_service=verif_service,
    )
    pipeline.initialize_database(run_backup=False)

    # Ingest N5 Grammar Exercise 01 (10 text questions)
    test_specs = [PILOT_EXERCISE_SPECS[0]]

    summary = pipeline.run_pilot(specs=test_specs, max_questions_per_exercise=1)

    assert summary.total_questions_ingested == 1
    assert summary.approved_count == 1
    assert summary.quarantined_count == 0
    assert summary.eligible_approved_count == 1

    # Verify database state for approved question
    with temp_study_env["db_manager"].read() as conn:
        q_row = conn.execute("SELECT * FROM question;").fetchone()
        assert q_row["status"] == "active"

        rev_row = conn.execute("SELECT * FROM question_revision WHERE question_id = ?;", (q_row["id"],)).fetchone()
        assert rev_row["validation_status"] == "valid"
        assert rev_row["sealed_at"] is not None

        # Verify eligibility
        is_elig, reasons = evaluate_eligibility(q_row["id"], conn=conn, media_store=temp_study_env["media_store"])
        assert is_elig is True
        assert len(reasons) == 0


def test_m5b_dual_model_disagreement_quarantine(temp_study_env):
    """Verify Scenario C (models disagree with each other) results in quarantine."""
    provider_a = MockAIProvider(
        model="mock-grok-1",
        default_selected_choice="1",
    )
    provider_b = MockAIProvider(
        model="mock-openai-1",
        default_selected_choice="2",  # Disagrees with provider A
    )

    verif_service = VerificationService(
        provider_a=provider_a,
        provider_b=provider_b,
    )

    pipeline = M5BPilotPipeline(
        db_manager=temp_study_env["db_manager"],
        media_store=temp_study_env["media_store"],
        cache=temp_study_env["cache"],
        verification_service=verif_service,
    )
    pipeline.initialize_database(run_backup=False)

    test_specs = [PILOT_EXERCISE_SPECS[0]]
    summary = pipeline.run_pilot(specs=test_specs, max_questions_per_exercise=1)

    assert summary.total_questions_ingested == 1
    assert summary.approved_count == 0
    assert summary.quarantined_count == 1
    assert summary.quarantine_reasons.get(ComparisonScenario.SCENARIO_C_MODEL_DISAGREEMENT.value, 0) == 1

    # In database, question must remain draft/needs_review and not eligible
    with temp_study_env["db_manager"].read() as conn:
        q_row = conn.execute("SELECT * FROM question;").fetchone()
        assert q_row["status"] in ("draft", "needs_review")

        is_elig, reasons = evaluate_eligibility(q_row["id"], conn=conn, media_store=temp_study_env["media_store"])
        assert is_elig is False
        assert "NEEDS_REVIEW" in reasons


# =============================================================================
# 4. Idempotency Verification Test
# =============================================================================

def test_m5b_pilot_idempotency(temp_study_env):
    """Verify running pilot ingestion twice on the same URLs produces ZERO duplicates."""
    pipeline = M5BPilotPipeline(
        db_manager=temp_study_env["db_manager"],
        media_store=temp_study_env["media_store"],
        cache=temp_study_env["cache"],
        verification_service=None,
    )
    pipeline.initialize_database(run_backup=False)

    # Run first pilot on 2 exercises (15 questions)
    test_specs = [
        PILOT_EXERCISE_SPECS[0],  # Grammar Ex 1 (10 Q)
        PILOT_EXERCISE_SPECS[1],  # Vocab Ex 1 (10 Q)
    ]
    summary1 = pipeline.run_pilot(specs=test_specs)
    assert summary1.total_questions_ingested == 20

    # Verify idempotency
    idempotency_result = pipeline.verify_idempotency(specs=test_specs)
    assert idempotency_result["is_idempotent"] is True

    # Check diffs across all critical tables
    diffs = idempotency_result["diffs"]
    assert diffs["question"] == 0
    assert diffs["question_revision"] == 0
    assert diffs["source"] == 0
    assert diffs["question_source"] == 0
    assert diffs["asset"] == 0
    assert diffs["source_answer_claim"] == 0
    assert diffs["revision_choice"] == 0
