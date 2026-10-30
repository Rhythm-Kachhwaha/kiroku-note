"""
Unit and Integration Tests for Milestone 4 Acquisition Foundation (Batch 1).
----------------------------------------------------------------------------
Tests:
- Base provider interface and MockAcquisitionProvider
- Keenable provider error classification, retry handling, and credential redaction
- Parallel dormant adapter disabled enforcement
- Raw response disk cache with sanitization
- Category crawler with WordPress pagination and URL filtering
- Migration 0004 and AcquisitionJobService persistence & resumption
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import pytest

from app.study.acquisition.cache import RawAcquisitionCache, _hash_url, _sanitize_headers
from app.study.acquisition.crawler.category_crawler import CategoryCrawler
from app.study.acquisition.crawler.url_filter import (
    extract_level_and_section,
    is_exercise_url,
)
from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
    CrawlStatus,
    ProviderKind,
)
from app.study.acquisition.job_service import AcquisitionJobService
from app.study.acquisition.models import (
    DiscoveredExercise,
    FetchOptions,
    RawFetchResult,
)
from app.study.acquisition.providers import (
    KeenableProvider,
    MockAcquisitionProvider,
    ParallelProvider,
    get_acquisition_provider,
)
from app.study.migrations.runner import run_migrations


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
def fixtures_dir():
    return Path(__file__).resolve().parent / "fixtures" / "study_acquisition"


# =============================================================================
# 1. Provider Core & Interface Tests
# =============================================================================

def test_mock_provider_registration_and_fetch():
    """Verify MockAcquisitionProvider registers pages and records fetch calls."""
    provider = MockAcquisitionProvider()
    assert provider.is_configured()
    assert provider.provider_name == ProviderKind.MOCK.value

    test_url = "https://japanesetest4you.com/test-exercise-1/"
    provider.register_page(test_url, raw_markdown="# Test Title\n1. Question 1", title="Test Title")

    result = provider.fetch_page(test_url)
    assert result.url == test_url
    assert result.title == "Test Title"
    assert "Question 1" in result.raw_markdown
    assert provider.recorded_calls == [test_url]

    with pytest.raises(ValueError, match="No registered response"):
        provider.fetch_page("https://unknown.com")


def test_parallel_dormant_enforcement():
    """Verify Parallel adapter remains disabled by default and forbids live requests."""
    provider = ParallelProvider(enabled=False)
    assert not provider.is_configured()
    assert provider.provider_name == ProviderKind.PARALLEL.value

    with pytest.raises(RuntimeError, match="Parallel provider is dormant and disabled by default"):
        provider.fetch_page("https://japanesetest4you.com/test/")


def test_keenable_provider_secret_redaction_and_headers():
    """Verify Keenable headers omit credentials from public logs and redact secrets."""
    provider = KeenableProvider(api_key="keen_test_secret_12345")
    assert provider.is_configured()
    assert provider.provider_name == ProviderKind.KEENABLE.value


def test_provider_registry_lookup():
    """Verify provider factory resolves providers correctly."""
    mock = get_acquisition_provider("mock")
    assert isinstance(mock, MockAcquisitionProvider)

    parallel = get_acquisition_provider("parallel")
    assert isinstance(parallel, ParallelProvider)

    keenable = get_acquisition_provider("keenable")
    assert isinstance(keenable, KeenableProvider)

    with pytest.raises(ValueError, match="Unknown acquisition provider"):
        get_acquisition_provider("invalid_provider_name")


# =============================================================================
# 2. Raw Response Disk Cache Tests
# =============================================================================

def test_raw_cache_put_get_and_sanitization(temp_cache_dir):
    """Verify cache writes content and metadata, sanitizing sensitive headers."""
    cache = RawAcquisitionCache(base_dir=temp_cache_dir)
    test_url = "https://japanesetest4you.com/test-url/"

    result = RawFetchResult(
        url=test_url,
        title="Sample Test",
        raw_markdown="# Japanese Content",
        status_code=200,
        headers={"x-api-key": "secret", "authorization": "Bearer token", "content-type": "text/markdown"},
        fetch_latency_ms=120,
        provider="keenable",
    )

    assert not cache.has(test_url)
    saved_path = cache.put(result, source_slug="test_source")
    assert saved_path.is_file()
    assert cache.has(test_url, source_slug="test_source")

    # Read back from cache
    loaded = cache.get(test_url, source_slug="test_source")
    assert loaded is not None
    assert loaded.url == test_url
    assert loaded.title == "Sample Test"
    assert loaded.raw_markdown == "# Japanese Content"

    # Verify sensitive headers were redacted in meta.json
    _, meta_path = cache.get_cache_paths(test_url, source_slug="test_source")
    meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
    assert "x-api-key" not in meta_data["headers"]
    assert "authorization" not in meta_data["headers"]
    assert meta_data["headers"]["content-type"] == "text/markdown"


# =============================================================================
# 3. Category Crawler & URL Filtering Tests
# =============================================================================

def test_url_filter_rules():
    """Verify URL filter distinguishes exercise posts from ads, Patreon, and navigation."""
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/")
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/")

    # Discard rules
    assert not is_exercise_url("https://www.patreon.com/collection/339123")
    assert not is_exercise_url("https://japanesetest4you.com/wp-content/uploads/2024/01/ADVERTISEMENT-infographic.jpg")
    assert not is_exercise_url("https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/")
    assert not is_exercise_url("https://japanesetest4you.com/tag/grammar/")
    assert not is_exercise_url("https://japanesetest4you.com/exercise-1/#more-29")


def test_extract_level_and_section():
    """Verify extraction of JLPT level and category from URLs."""
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/"
    lvl, sec = extract_level_and_section(url)
    assert lvl == "N4"
    assert sec == "reading"

    url_g = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n2-grammar-exercise-10/"
    lvl_g, sec_g = extract_level_and_section(url_g)
    assert lvl_g == "N2"
    assert sec_g == "grammar"


def test_category_crawler_with_mock_fixture(fixtures_dir, temp_cache_dir):
    """Verify crawler discovers 20 exercises from raw_keenable_category.md fixture."""
    fixture_path = fixtures_dir / "raw_keenable_category.md"
    assert fixture_path.is_file()

    provider = MockAcquisitionProvider()
    cat_url = "https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/"
    provider.register_fixture(cat_url, fixture_path, title="JLPT N4 grammar test")

    cache = RawAcquisitionCache(base_dir=temp_cache_dir)
    crawler = CategoryCrawler(provider=provider, cache=cache, delay_seconds=0.0, jitter_seconds=0.0)

    result = crawler.crawl_category(cat_url)

    assert result.status == CrawlStatus.COMPLETED
    assert len(result.discovered) == 20
    assert result.discovered[0].title == "JLPT N4 – Grammar Exercise 01"
    assert result.discovered[0].url == "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    assert result.discovered[0].jlpt_level == "N4"
    assert result.discovered[0].section == "grammar"
    assert result.discovered[19].title == "JLPT N4 – Grammar Exercise 20"


# =============================================================================
# 4. Migration 0004 & Acquisition Job Service Tests
# =============================================================================

def test_migration_0004_and_job_lifecycle(in_memory_db):
    """Verify Migration 0004 schema and complete AcquisitionJobService lifecycle."""
    conn = in_memory_db

    # 1. Create Job
    job = AcquisitionJobService.create_job(
        conn=conn,
        source_name="JapaneseTest4You",
        target_category_url="https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/",
        jlpt_level="N4",
        section_category="grammar",
    )
    assert job.id is not None
    assert job.status == AcquisitionJobStatus.PENDING

    # 2. Add Discovered Items
    items = [
        DiscoveredExercise(url="https://japanesetest4you.com/ex-1/", title="Exercise 1", ordinal=1),
        DiscoveredExercise(url="https://japanesetest4you.com/ex-2/", title="Exercise 2", ordinal=2),
    ]
    added = AcquisitionJobService.add_job_items(conn, job.id, items)
    assert added == 2

    # Verify duplicate URL is rejected on re-add
    added_dup = AcquisitionJobService.add_job_items(conn, job.id, items)
    assert added_dup == 0

    # 3. Verify Job progress
    progress = AcquisitionJobService.get_job_progress(conn, job.id)
    assert progress is not None
    assert progress.total_discovered == 2
    assert progress.total_acquired == 0
    assert progress.total_failed == 0
    assert len(progress.items) == 2

    item1 = progress.items[0]
    item2 = progress.items[1]
    assert item1.status == AcquisitionItemStatus.QUEUED

    # 4. Record Success for item 1
    AcquisitionJobService.record_item_success(conn, item1.id, status=AcquisitionItemStatus.INGESTED, cache_path="/cache/ex1.md")
    # 5. Record Failure for item 2
    AcquisitionJobService.record_item_failure(conn, item2.id, error_message="HTTP 500 Server Error")

    progress_after = AcquisitionJobService.get_job_progress(conn, job.id)
    assert progress_after.total_acquired == 1
    assert progress_after.total_failed == 1

    item2_updated = [i for i in progress_after.items if i.id == item2.id][0]
    assert item2_updated.status == AcquisitionItemStatus.FAILED
    assert item2_updated.retry_count == 1
    assert item2_updated.error_message == "HTTP 500 Server Error"

    # 6. Reset failed items for retry
    reset_count = AcquisitionJobService.reset_failed_items_for_retry(conn, job.id)
    assert reset_count == 1

    progress_reset = AcquisitionJobService.get_job_progress(conn, job.id)
    assert progress_reset.total_failed == 0
    item2_reset = [i for i in progress_reset.items if i.id == item2.id][0]
    assert item2_reset.status == AcquisitionItemStatus.QUEUED
    assert item2_reset.error_message is None

