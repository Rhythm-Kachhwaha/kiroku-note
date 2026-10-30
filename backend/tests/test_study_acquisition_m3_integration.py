"""
Unit and Integration Tests for Milestone 4 Acquisition to M3 Pipeline (Batch 3).
--------------------------------------------------------------------------------
Tests:
- End-to-end single-URL import: URL -> Acquisition -> Cache -> Parser -> Gate 1 -> Gate 2 -> NEEDS_REVIEW
- Category bulk crawl with relational job persistence and progress tracking
- Content fingerprinting and deduplication on re-import
- Interrupted job retry and resumption
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import pytest

from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.crawler import CategoryCrawler
from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
)
from app.study.acquisition.job_service import AcquisitionJobService
from app.study.acquisition.orchestrator import AcquisitionOrchestrator
from app.study.acquisition.parsers import JapaneseTest4YouParser
from app.study.acquisition.providers import MockAcquisitionProvider
from app.study.ingestion.enums import ReviewStatus, StageStatus
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.migrations.runner import run_migrations
from app.study.verification.config import AIVerificationConfig
from app.study.verification.providers.mock import MockAIProvider
from app.study.verification.service import VerificationService


@pytest.fixture
def fixtures_dir():
    return Path(__file__).resolve().parent / "fixtures" / "study_acquisition"


@pytest.fixture
def temp_cache_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def in_memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    run_migrations(conn)
    yield conn
    conn.close()


@pytest.fixture
def configured_orchestrator(fixtures_dir, temp_cache_dir):
    cache = RawAcquisitionCache(base_dir=temp_cache_dir)
    parser = JapaneseTest4YouParser()
    provider = MockAcquisitionProvider()

    # Pre-register grammar exercise 1
    ex1_url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    ex1_md = (fixtures_dir / "raw_keenable_exercise_1.md").read_text(encoding="utf-8")
    provider.register_page(ex1_url, ex1_md, title="JLPT N4 – Grammar Exercise 01")

    # Pre-register reading exercise 2
    read2_url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/"
    read2_md = (fixtures_dir / "raw_keenable_reading_2.md").read_text(encoding="utf-8")
    provider.register_page(read2_url, read2_md, title="JLPT N4 – Reading Exercise 02")

    # Pre-register category page
    cat_url = "https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/"
    cat_md = (fixtures_dir / "raw_keenable_category.md").read_text(encoding="utf-8")
    provider.register_page(cat_url, cat_md, title="JLPT N4 grammar test")

    # Setup Gate 2 VerificationService with Mock AI
    mock_ai_a = MockAIProvider()
    mock_ai_b = MockAIProvider()
    ver_config = AIVerificationConfig(is_enabled=True)
    ver_service = VerificationService(
        config=ver_config,
        provider_a=mock_ai_a,
        provider_b=mock_ai_b,
    )

    pipeline = IngestionPipeline()

    orchestrator = AcquisitionOrchestrator(
        provider=provider,
        cache=cache,
        parser=parser,
        pipeline=pipeline,
        verification_service=ver_service,
    )
    return orchestrator, provider, cache


# =============================================================================
# 1. Single URL Import End-to-End Tests
# =============================================================================

def test_single_url_import_pipeline_flow(configured_orchestrator, in_memory_db):
    """
    Verify complete flow:
    URL -> Acquisition -> Cache -> Parser -> Gate 1 -> Gate 2 -> NEEDS_REVIEW
    """
    orchestrator, provider, cache = configured_orchestrator
    conn = in_memory_db
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"

    result = orchestrator.acquire_exercise_url(
        url=url,
        conn=conn,
        force_live=False,
        persist=True,
        verify_gate2=True,
        auto_approve=False,  # Enforce Decision 4
    )

    # 1. Verify Pipeline status
    assert result.status == "needs_review"
    assert result.error is None
    assert result.raw_fetch is not None
    assert result.parsed_exercise is not None
    assert len(result.parsed_exercise.questions) == 10

    # 2. Verify Cache presence
    assert cache.has(url)
    assert result.cache_path is not None

    # 3. Verify Gate 1 Ingestion results
    ingest_res = result.ingestion_result
    assert ingest_res is not None
    assert ingest_res.total_questions == 10
    assert ingest_res.needs_review_questions == 10
    assert ingest_res.approved_questions == 0
    # Every question has review_status == NEEDS_REVIEW
    for q in ingest_res.questions:
        assert q.review_status == ReviewStatus.NEEDS_REVIEW

    # 4. Verify Gate 2 AI Verification
    assert result.gate2_result is not None
    assert result.gate2_result.total_questions == 10
    assert result.gate2_result.verified_count == 10

    # 5. Verify database audit records
    import_items = conn.execute("SELECT * FROM import_item WHERE import_batch_id = ?;", (ingest_res.batch_id,)).fetchall()
    assert len(import_items) == 10
    for it in import_items:
        assert it["review_status"] == "needs_review"


# =============================================================================
# 2. Category Bulk Crawling & Job Tracking Tests
# =============================================================================

def test_category_bulk_acquisition_and_job_tracking(configured_orchestrator, in_memory_db):
    """Verify category crawling creates acquisition_job and processes queued items."""
    orchestrator, provider, cache = configured_orchestrator
    conn = in_memory_db
    cat_url = "https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/"

    crawler = CategoryCrawler(provider=provider, cache=cache, delay_seconds=0.0, jitter_seconds=0.0)

    cat_result = orchestrator.acquire_category(
        category_url=cat_url,
        conn=conn,
        crawler=crawler,
        force_live=False,
        persist=True,
        verify_gate2=False,
        auto_approve=False,
    )

    assert cat_result.status == AcquisitionJobStatus.COMPLETED
    assert cat_result.total_discovered == 20
    # Exercise 1 is registered in mock; others fail gracefully or succeed
    assert cat_result.total_acquired >= 1

    # Verify job record in database
    job = AcquisitionJobService.get_job(conn, cat_result.job_id)
    assert job is not None
    assert job.status == AcquisitionJobStatus.COMPLETED
    assert job.total_discovered == 20

    # Verify job items in database
    items = AcquisitionJobService.get_job_items(conn, job.id)
    assert len(items) == 20
    assert items[0].exercise_url == "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    assert items[0].status == AcquisitionItemStatus.INGESTED


# =============================================================================
# 3. Duplicate Detection & Idempotency Tests
# =============================================================================

def test_duplicate_import_idempotency(configured_orchestrator, in_memory_db):
    """Verify re-importing the same exercise URL does not duplicate cache or corrupt records."""
    orchestrator, provider, cache = configured_orchestrator
    conn = in_memory_db
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"

    # First import
    res1 = orchestrator.acquire_exercise_url(url=url, conn=conn, persist=True)
    initial_call_count = len(provider.recorded_calls)

    # Second import: should be served directly from raw cache without calling provider
    res2 = orchestrator.acquire_exercise_url(url=url, conn=conn, persist=True)
    assert len(provider.recorded_calls) == initial_call_count  # Zero new provider calls!

    assert res2.status == "needs_review"
    assert len(res2.parsed_exercise.questions) == 10


# =============================================================================
# 4. Interrupted Job Retry Tests
# =============================================================================

def test_retry_failed_job_items(configured_orchestrator, in_memory_db):
    """Verify failed job items can be retried and marked completed upon success."""
    orchestrator, provider, cache = configured_orchestrator
    conn = in_memory_db

    # Create job manually with 1 failed item and 1 ingested item
    job = AcquisitionJobService.create_job(
        conn=conn,
        source_name="JapaneseTest4You",
        target_category_url="https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/",
        jlpt_level="N4",
        section_category="grammar",
    )
    ex1_url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    read2_url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/"

    from app.study.acquisition.models import DiscoveredExercise
    AcquisitionJobService.add_job_items(conn, job.id, [
        DiscoveredExercise(url=ex1_url, title="Ex 1", ordinal=1),
        DiscoveredExercise(url=read2_url, title="Read 2", ordinal=2),
    ])

    items = AcquisitionJobService.get_job_items(conn, job.id)
    # Simulate item 1 ingested, item 2 failed
    AcquisitionJobService.record_item_success(conn, items[0].id)
    AcquisitionJobService.record_item_failure(conn, items[1].id, "Network timeout")
    AcquisitionJobService.update_job_status(conn, job.id, AcquisitionJobStatus.FAILED)

    # Now retry the failed job
    retry_result = orchestrator.retry_failed_job(
        job_id=job.id,
        conn=conn,
        persist=True,
    )

    assert retry_result.status == AcquisitionJobStatus.COMPLETED
    assert retry_result.total_failed == 0
    assert retry_result.total_acquired == 2

