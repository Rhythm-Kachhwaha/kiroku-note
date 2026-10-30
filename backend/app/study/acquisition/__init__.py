"""
Kiroku Study Bank Question Acquisition Subsystem (Milestone 4).
---------------------------------------------------------------
Discovers, acquires, caches, and parses external question content
from educational sources (e.g. JapaneseTest4You) into structured M3 candidates.
"""
from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.crawler import (
    CategoryCrawler,
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
from app.study.acquisition.media import AssetDownloader
from app.study.acquisition.models import (
    AcquisitionItemRecord,
    AcquisitionJobRecord,
    CrawlResult,
    DiscoveredExercise,
    FetchOptions,
    JobProgress,
    RawFetchResult,
)
from app.study.acquisition.orchestrator import (
    AcquisitionOrchestrator,
    CategoryAcquisitionResult,
    SingleAcquisitionResult,
)
from app.study.acquisition.parsers import (
    BaseSourceParser,
    JapaneseTest4YouParser,
    ParsedAnswerClaim,
    ParsedChoice,
    ParsedExercise,
    ParsedPassage,
    ParsedQuestion,
)
from app.study.acquisition.providers import (
    BaseAcquisitionProvider,
    KeenableProvider,
    MockAcquisitionProvider,
    ParallelProvider,
    get_acquisition_provider,
)

__all__ = [
    # Orchestrator
    "AcquisitionOrchestrator",
    "SingleAcquisitionResult",
    "CategoryAcquisitionResult",
    # Cache & Job Service
    "RawAcquisitionCache",
    "AcquisitionJobService",
    # Crawling
    "CategoryCrawler",
    "is_exercise_url",
    "extract_level_and_section",
    # Media
    "AssetDownloader",
    # Parsers
    "BaseSourceParser",
    "JapaneseTest4YouParser",
    "ParsedExercise",
    "ParsedQuestion",
    "ParsedChoice",
    "ParsedPassage",
    "ParsedAnswerClaim",
    # Providers
    "BaseAcquisitionProvider",
    "KeenableProvider",
    "ParallelProvider",
    "MockAcquisitionProvider",
    "get_acquisition_provider",
    # Enums & Models
    "ProviderKind",
    "AcquisitionJobStatus",
    "AcquisitionItemStatus",
    "CrawlStatus",
    "RawFetchResult",
    "FetchOptions",
    "DiscoveredExercise",
    "CrawlResult",
    "AcquisitionJobRecord",
    "AcquisitionItemRecord",
    "JobProgress",
]
