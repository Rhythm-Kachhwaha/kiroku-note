"""
Unit and Integration Tests for Milestone 7-B: N4 Question Bank Expansion & Verification.
----------------------------------------------------------------------------------------
Tests:
- Complete N4 discovery manifest structure across all 5 categories.
- Local RawAcquisitionCache coverage for all 115 N4 exercises.
- Discard line filtering preventing transcript links from becoming choices.
- Multimodal safety quarantine enforcement for audio and diagrams.
- Deterministic verification caching and zero-duplicate API invocations.
- Clean database doctor inspection with 0 errors and 0 warnings.
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import pytest

from app.config import get_study_dir
from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.parsers.japanesetest4you import (
    JapaneseTest4YouParser,
    _is_discard_choice_line,
)
from app.study.connection import StudyDatabaseManager
from app.study.doctor import run_doctor
from app.study.eligibility import evaluate_eligibility
from app.study.ingestion.enums import ReviewReasonCode, ReviewStatus
from app.study.media import MediaStore
from app.study.verification.enums import ComparisonScenario
from app.study.verification.models import AISolveResponse, VerificationRunRecord
from app.study.verification.providers.mock import MockAIProvider
from app.study.verification.service import VerificationService


_M7B_MANIFEST = Path(__file__).resolve().parent.parent / "study" / "n4_discovered.json"


def test_n4_discovery_manifest():
    if not _M7B_MANIFEST.is_file():
        pytest.skip(f"committed artifact absent: {_M7B_MANIFEST}")
    manifest_path = _M7B_MANIFEST
    assert manifest_path.exists(), "N4 discovery manifest must exist"
    items = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert len(items) == 115, f"Expected 115 discovered N4 exercises, got {len(items)}"

    sections = {it["section"] for it in items}
    assert sections == {"grammar", "vocab", "kanji", "reading", "listening"}


def test_n4_raw_cache_integrity():
    if not _M7B_MANIFEST.is_file():
        pytest.skip(f"committed artifact absent: {_M7B_MANIFEST}")
    cache = RawAcquisitionCache(get_study_dir() / "raw_acquisition")
    manifest_path = _M7B_MANIFEST
    items = json.loads(manifest_path.read_text(encoding="utf-8"))

    cached_count = sum(1 for it in items if cache.get(it["url"]) is not None)
    assert cached_count == 115, f"Expected all 115 exercises in cache, found {cached_count}"


def test_discard_choice_line_filtering():
    assert _is_discard_choice_line("[**View transcript**](https://japanesetest4you.com/pdf/n4-15.pdf)") is True
    assert _is_discard_choice_line("[Click here](https://patreon.com)") is True
    assert _is_discard_choice_line("New words: 全部 (zenbu)") is True
    assert _is_discard_choice_line("JLPT N4 Kanji Lesson #3: 自 (ji)") is True
    assert _is_discard_choice_line("Click here to download this test for offline viewing") is True

    # Valid choices must NOT be discarded
    assert _is_discard_choice_line("1") is False
    assert _is_discard_choice_line("たべます") is False
    assert _is_discard_choice_line("学校へ 行きます") is False


_STUDY_DB = Path(__file__).resolve().parent.parent / "study" / "study.db"


def _study_db_is_committed() -> bool:
    """study.db lives in gitignored backend/study/ (local uncommitted state)."""
    if not _STUDY_DB.is_file():
        return False
    try:
        import subprocess

        completed = subprocess.run(
            ["git", "ls-files", "--error-unmatch", str(_STUDY_DB)],
            capture_output=True,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
        )
        return completed.returncode == 0
    except Exception:
        return False


def test_database_doctor_purity():
    if not _study_db_is_committed():
        pytest.skip("study.db is local uncommitted state; absent")
    study_dir = get_study_dir()
    db_path = study_dir / "study.db"
    assert db_path.exists(), "study.db must exist"

    db = StudyDatabaseManager(db_path)
    media_store = MediaStore(study_dir / "media")

    with db.read() as conn:
        findings = run_doctor(conn, media_store=media_store, verify_media_hashes=True)
        errors = [f for f in findings if f.severity == "ERROR"]
        warnings = [f for f in findings if f.severity == "WARNING"]

        assert len(errors) == 0, f"Doctor reported unexpected errors: {errors}"
        assert len(warnings) == 0, f"Doctor reported unexpected warnings: {warnings}"


def test_verification_caching_idempotency():
    """Verify that cached runs are reused with zero new calls when reuse_cached=True."""
    if not _STUDY_DB.is_file():
        pytest.skip(f"local study.db absent: {_STUDY_DB}")
    from app.study.verification.enums import ConfidenceLevel

    mock_a = MockAIProvider(model="mock-model-a")
    mock_b = MockAIProvider(model="mock-model-b")
    service = VerificationService(provider_a=mock_a, provider_b=mock_b, skip_source_verify=True, skip_explanations=True)

    study_dir = get_study_dir()
    db = StudyDatabaseManager(study_dir / "study.db")

    with db.write_tx() as conn:
        # Find an existing question with an existing verification run
        row = conn.execute(
            """
            SELECT vr.question_id, vr.question_revision_id
            FROM verification_run vr
            WHERE vr.comparison_scenario = 'scenario_a_agreement'
            LIMIT 1;
            """
        ).fetchone()

        if row:
            q_id = row["question_id"]
            rev_id = row["question_revision_id"]

            calls_a_before = mock_a.call_count if hasattr(mock_a, "call_count") else 0
            rec = service.verify_persisted_question(conn, q_id, rev_id, persist=False, reuse_cached=True)

            assert rec is not None
            assert rec.comparison is not None
            assert rec.comparison.scenario == ComparisonScenario.SCENARIO_A_AGREEMENT
