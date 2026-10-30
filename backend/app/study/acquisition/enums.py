"""
Enumerations for Kiroku Study Bank Acquisition Subsystem.
---------------------------------------------------------
Defines provider types, job lifecycle statuses, and crawl states.
"""
from __future__ import annotations

from enum import Enum


class ProviderKind(str, Enum):
    """Supported acquisition providers."""
    KEENABLE = "keenable"
    PARALLEL = "parallel"
    MOCK = "mock"


class AcquisitionJobStatus(str, Enum):
    """Lifecycle statuses for acquisition jobs."""
    PENDING = "pending"
    CRAWLING = "crawling"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class AcquisitionItemStatus(str, Enum):
    """Processing stage status for individual exercise URLs in an acquisition job."""
    QUEUED = "queued"
    FETCHED = "fetched"
    PARSED = "parsed"
    INGESTED = "ingested"
    FAILED = "failed"


class CrawlStatus(str, Enum):
    """Status of category crawling runs."""
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"

