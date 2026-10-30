"""
Data Models for Kiroku Study Bank Acquisition Subsystem.
--------------------------------------------------------
Pydantic schemas and dataclasses for provider communication,
crawling, disk caching, and job tracking.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field

from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
    CrawlStatus,
    ProviderKind,
)


class FetchOptions(BaseModel):
    """Options governing individual page fetch requests."""
    timeout_seconds: float = 30.0
    max_retries: int = 3
    force_live: bool = False
    prompt: str | None = None
    rate_limit_delay: float = 1.5
    rate_limit_jitter: float = 0.5


class RawFetchResult(BaseModel):
    """Normalized payload returned by an acquisition provider."""
    url: str
    title: str = ""
    raw_markdown: str = ""
    status_code: int = 200
    headers: dict[str, str] = Field(default_factory=dict)
    fetch_latency_ms: int = 0
    provider: str = ProviderKind.KEENABLE.value
    metadata: dict[str, Any] = Field(default_factory=dict)


class DiscoveredExercise(BaseModel):
    """An exercise link discovered by category crawling."""
    url: str
    title: str
    ordinal: int = 0
    jlpt_level: str = ""
    section: str = ""


class CrawlResult(BaseModel):
    """Outcome of a category crawl discovery run."""
    category_url: str
    discovered: list[DiscoveredExercise] = Field(default_factory=list)
    total_pages_visited: int = 0
    status: CrawlStatus = CrawlStatus.COMPLETED
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class AcquisitionJobRecord(BaseModel):
    """Database representation of an acquisition job."""
    id: str
    source_name: str
    target_category_url: str
    jlpt_level: str
    section_category: str
    status: AcquisitionJobStatus = AcquisitionJobStatus.PENDING
    total_discovered: int = 0
    total_acquired: int = 0
    total_failed: int = 0
    error_summary: str | None = None
    created_at: str = ""
    updated_at: str = ""


class AcquisitionItemRecord(BaseModel):
    """Database representation of an individual exercise item within a job."""
    id: str
    job_id: str
    exercise_url: str
    exercise_title: str = ""
    ordinal: int = 0
    status: AcquisitionItemStatus = AcquisitionItemStatus.QUEUED
    cache_path: str | None = None
    retry_count: int = 0
    error_message: str | None = None
    created_at: str = ""


class JobProgress(BaseModel):
    """Aggregate progress report for an acquisition job."""
    job_id: str
    status: AcquisitionJobStatus
    total_discovered: int
    total_acquired: int
    total_failed: int
    items: list[AcquisitionItemRecord] = Field(default_factory=list)

