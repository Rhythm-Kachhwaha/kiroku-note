"""
Acquisition Orchestrator and M3 Integration Bridge.
---------------------------------------------------
Connects M4 acquisition with existing M3 services:
URL Discovery -> Content Acquisition -> Raw Cache -> Deterministic Parser -> M3 Gate 1 -> M3 Gate 2

Guarantees:
- Zero duplication of M3 Ingestion or AI Verification logic
- Strict adherence to Decision 4: default ReviewStatus.NEEDS_REVIEW
- Idempotency and deduplication through content fingerprinting
- Transactional persistence in study.db
"""
from __future__ import annotations

import logging
from pathlib import Path
import sqlite3
from typing import Any
from pydantic import BaseModel, Field

from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.crawler.category_crawler import CategoryCrawler
from app.study.acquisition.crawler.url_filter import extract_level_and_section
from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
    CrawlStatus,
)
from app.study.acquisition.job_service import AcquisitionJobService
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.acquisition.models import RawFetchResult
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.models import ParsedExercise
from app.study.acquisition.providers.base import BaseAcquisitionProvider
from app.study.acquisition.providers.registry import get_acquisition_provider
from app.study.contracts.enums import JlptLevel
from app.study.ingestion.enums import IngestAdapterKind, ReviewStatus, StageStatus
from app.study.ingestion.models import IngestInput, IngestionResult
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.verification.config import AIVerificationConfig
from app.study.verification.models import BatchVerificationResult
from app.study.verification.service import VerificationService

logger = logging.getLogger(__name__)


class SingleAcquisitionResult(BaseModel):
    """Result of acquiring and processing a single exercise URL."""
    url: str
    status: str
    raw_fetch: RawFetchResult | None = None
    parsed_exercise: ParsedExercise | None = None
    ingestion_result: IngestionResult | None = None
    gate2_result: BatchVerificationResult | None = None
    cache_path: str | None = None
    error: str | None = None


class CategoryAcquisitionResult(BaseModel):
    """Aggregate result of an entire category crawling and ingestion run."""
    job_id: str
    category_url: str
    status: AcquisitionJobStatus
    total_discovered: int
    total_acquired: int
    total_failed: int
    exercise_results: list[SingleAcquisitionResult] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class AcquisitionOrchestrator:
    """The central coordinator executing M4 acquisition and bridging to M3."""

    def __init__(
        self,
        provider: BaseAcquisitionProvider | None = None,
        cache: RawAcquisitionCache | None = None,
        parser: BaseSourceParser | None = None,
        asset_downloader: AssetDownloader | None = None,
        pipeline: IngestionPipeline | None = None,
        verification_service: VerificationService | None = None,
    ) -> None:
        self._provider = provider or get_acquisition_provider()
        self._cache = cache or RawAcquisitionCache()
        self._parser = parser or JapaneseTest4YouParser()
        self._downloader = asset_downloader
        self._pipeline = pipeline or IngestionPipeline()
        self._verification_service = verification_service

    def acquire_exercise_url(
        self,
        url: str,
        conn: sqlite3.Connection | None = None,
        force_live: bool = False,
        persist: bool = True,
        verify_gate2: bool = False,
        auto_approve: bool = False,
    ) -> SingleAcquisitionResult:
        """
        Execute full M4 -> M3 pipeline for a single exercise URL:
        Fetch -> Cache -> Parse -> Gate 1 Ingestion -> Optional Gate 2 AI Verification
        """
        cache_path_str: str | None = None

        # 1. Fetch & Cache Stage
        raw_fetch: RawFetchResult | None = None
        if not force_live and self._cache.has(url):
            raw_fetch = self._cache.get(url)
            md_path, _ = self._cache.get_cache_paths(url)
            cache_path_str = str(md_path)

        if raw_fetch is None:
            try:
                raw_fetch = self._provider.fetch_page(url)
                saved_path = self._cache.put(raw_fetch)
                cache_path_str = str(saved_path)
            except Exception as exc:
                logger.error("Failed to fetch %s: %s", url, exc)
                return SingleAcquisitionResult(
                    url=url,
                    status="fetch_failed",
                    error=f"Fetch failed: {exc}",
                )

        # 2. Parse Stage
        try:
            parsed = self._parser.parse(raw_fetch.raw_markdown, url=url, title=raw_fetch.title)
        except Exception as exc:
            logger.error("Failed to parse %s: %s", url, exc)
            return SingleAcquisitionResult(
                url=url,
                status="parse_failed",
                raw_fetch=raw_fetch,
                cache_path=cache_path_str,
                error=f"Parse failed: {exc}",
            )

        # 3. Optional Asset Downloading
        if self._downloader is not None and conn is not None:
            for p in parsed.passages:
                for img_url in p.image_urls:
                    try:
                        self._downloader.download_asset(img_url, conn=conn)
                    except Exception as exc:
                        logger.warning("Failed to download diagram asset %s: %s", img_url, exc)

        # 4. Bridge to M3 Gate 1 Ingestion Pipeline
        structured_payload = parsed.to_m3_structured_payload()
        level_enum = None
        if parsed.jlpt_level:
            try:
                level_enum = JlptLevel(parsed.jlpt_level.upper())
            except ValueError:
                pass

        ingest_input = IngestInput(
            adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
            content=structured_payload,
            source_name="JapaneseTest4You",
            source_type="web_capture",
            url=url,
            citation=parsed.title,
            license_or_permission="Public educational web exercise",
            default_level=level_enum,
            auto_approve=auto_approve,  # Default False: remains NEEDS_REVIEW
            metadata={"cache_path": cache_path_str},
        )

        ingestion_res = self._pipeline.run(
            input_data=ingest_input,
            conn=conn,
            persist=persist,
        )

        # 5. Optional Bridge to M3 Gate 2 AI Verification
        gate2_res: BatchVerificationResult | None = None
        if verify_gate2 and self._verification_service is not None and ingestion_res.questions:
            try:
                gate2_res = self._verification_service.batch_verify_candidates(
                    candidates=ingestion_res.questions,
                    conn=conn,
                    persist=persist,
                )
            except Exception as exc:
                logger.warning("Gate 2 AI verification encountered error for %s: %s", url, exc)

        final_status = "needs_review"
        if ingestion_res.status == StageStatus.PERSISTED:
            final_status = "persisted"
        elif ingestion_res.status == StageStatus.FAILED:
            final_status = "ingest_failed"
        elif auto_approve and ingestion_res.status == StageStatus.APPROVED:
            final_status = "approved"

        return SingleAcquisitionResult(
            url=url,
            status=final_status,
            raw_fetch=raw_fetch,
            parsed_exercise=parsed,
            ingestion_result=ingestion_res,
            gate2_result=gate2_res,
            cache_path=cache_path_str,
            error=ingestion_res.errors[0] if ingestion_res.errors else None,
        )

    def acquire_category(
        self,
        category_url: str,
        conn: sqlite3.Connection,
        crawler: CategoryCrawler | None = None,
        force_live: bool = False,
        persist: bool = True,
        verify_gate2: bool = False,
        auto_approve: bool = False,
    ) -> CategoryAcquisitionResult:
        """
        Crawl a category, discover exercises, track in acquisition_job,
        and acquire each exercise URL through M3.
        """
        level, sec = extract_level_and_section(category_url)
        level = level or "N4"

        # 1. Create Job in study.db
        job = AcquisitionJobService.create_job(
            conn=conn,
            source_name="JapaneseTest4You",
            target_category_url=category_url,
            jlpt_level=level,
            section_category=sec,
        )

        # 2. Category Crawl Discovery
        active_crawler = crawler or CategoryCrawler(
            provider=self._provider,
            cache=self._cache,
        )
        crawl_res = active_crawler.crawl_category(category_url, force_live=force_live)

        if crawl_res.status == CrawlStatus.FAILED:
            AcquisitionJobService.update_job_status(
                conn, job.id, AcquisitionJobStatus.FAILED, error_summary=crawl_res.error
            )
            return CategoryAcquisitionResult(
                job_id=job.id,
                category_url=category_url,
                status=AcquisitionJobStatus.FAILED,
                total_discovered=0,
                total_acquired=0,
                total_failed=0,
                warnings=crawl_res.warnings,
                error=crawl_res.error,
            )

        # 3. Add Discovered Items to Job
        AcquisitionJobService.add_job_items(conn, job.id, crawl_res.discovered)
        AcquisitionJobService.update_job_status(conn, job.id, AcquisitionJobStatus.CRAWLING)

        # 4. Process Each Queued Item
        queued_items = AcquisitionJobService.get_job_items(conn, job.id, status=AcquisitionItemStatus.QUEUED)
        exercise_results: list[SingleAcquisitionResult] = []

        for item in queued_items:
            res = self.acquire_exercise_url(
                url=item.exercise_url,
                conn=conn,
                force_live=force_live,
                persist=persist,
                verify_gate2=verify_gate2,
                auto_approve=auto_approve,
            )
            exercise_results.append(res)

            if res.status in ("needs_review", "persisted", "approved"):
                AcquisitionJobService.record_item_success(
                    conn=conn,
                    item_id=item.id,
                    status=AcquisitionItemStatus.INGESTED,
                    cache_path=res.cache_path,
                )
            else:
                AcquisitionJobService.record_item_failure(
                    conn=conn,
                    item_id=item.id,
                    error_message=res.error or "Acquisition failed",
                )

        # 5. Finalize Job Status
        progress = AcquisitionJobService.get_job_progress(conn, job.id)
        final_job_status = AcquisitionJobStatus.COMPLETED
        if progress and progress.total_acquired == 0 and progress.total_failed > 0:
            final_job_status = AcquisitionJobStatus.FAILED

        AcquisitionJobService.update_job_status(conn, job.id, final_job_status)

        return CategoryAcquisitionResult(
            job_id=job.id,
            category_url=category_url,
            status=final_job_status,
            total_discovered=progress.total_discovered if progress else 0,
            total_acquired=progress.total_acquired if progress else 0,
            total_failed=progress.total_failed if progress else 0,
            exercise_results=exercise_results,
            warnings=crawl_res.warnings,
        )

    def retry_failed_job(
        self,
        job_id: str,
        conn: sqlite3.Connection,
        force_live: bool = False,
        persist: bool = True,
        verify_gate2: bool = False,
        auto_approve: bool = False,
    ) -> CategoryAcquisitionResult:
        """Retry all failed items in an acquisition job."""
        job = AcquisitionJobService.get_job(conn, job_id)
        if not job:
            raise ValueError(f"Acquisition job {job_id} not found.")

        AcquisitionJobService.reset_failed_items_for_retry(conn, job_id)
        queued_items = AcquisitionJobService.get_job_items(conn, job_id, status=AcquisitionItemStatus.QUEUED)
        exercise_results: list[SingleAcquisitionResult] = []

        for item in queued_items:
            res = self.acquire_exercise_url(
                url=item.exercise_url,
                conn=conn,
                force_live=force_live,
                persist=persist,
                verify_gate2=verify_gate2,
                auto_approve=auto_approve,
            )
            exercise_results.append(res)

            if res.status in ("needs_review", "persisted", "approved"):
                AcquisitionJobService.record_item_success(
                    conn=conn,
                    item_id=item.id,
                    status=AcquisitionItemStatus.INGESTED,
                    cache_path=res.cache_path,
                )
            else:
                AcquisitionJobService.record_item_failure(
                    conn=conn,
                    item_id=item.id,
                    error_message=res.error or "Acquisition failed on retry",
                )

        progress = AcquisitionJobService.get_job_progress(conn, job_id)
        final_status = AcquisitionJobStatus.COMPLETED
        if progress and progress.total_acquired == 0 and progress.total_failed > 0:
            final_status = AcquisitionJobStatus.FAILED

        AcquisitionJobService.update_job_status(conn, job_id, final_status)

        return CategoryAcquisitionResult(
            job_id=job_id,
            category_url=job.target_category_url,
            status=final_status,
            total_discovered=progress.total_discovered if progress else 0,
            total_acquired=progress.total_acquired if progress else 0,
            total_failed=progress.total_failed if progress else 0,
            exercise_results=exercise_results,
        )

