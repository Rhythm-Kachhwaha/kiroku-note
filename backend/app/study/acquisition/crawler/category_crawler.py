"""
Deterministic Category Crawler for JapaneseTest4You.
----------------------------------------------------
Discovers all exercise URLs within a JLPT category archive by:
1. Fetching the initial category root page
2. Extracting exercise links and titles via deterministic regex
3. Incrementing WordPress pagination (/page/2/, /page/3/...)
4. Enforcing polite delays (1.5s ± 0.5s jitter) and single-threaded execution
5. Terminating safely on empty pages, loops, or 404 responses
6. Cross-checking discovered count with category counters
"""
from __future__ import annotations

import logging
import random
import re
import time

from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.crawler.url_filter import (
    extract_level_and_section,
    is_exercise_url,
)
from app.study.acquisition.enums import CrawlStatus
from app.study.acquisition.models import (
    CrawlResult,
    DiscoveredExercise,
    FetchOptions,
)
from app.study.acquisition.providers.base import BaseAcquisitionProvider

logger = logging.getLogger(__name__)

# Pattern to extract markdown links: [Title](URL) or ## [Title](URL)
MARKDOWN_LINK_PATTERN = re.compile(r"\[([^\]]+)\]\((https?://[^\s\)]+)\)")

# Pattern to detect reported category counts, e.g. "(30)" or "30 items"
REPORTED_COUNT_PATTERN = re.compile(r"\b(?:test|exercise|grammar|reading|vocabulary)\s*\((\d+)\)", re.IGNORECASE)


class CategoryCrawler:
    """Crawler for discovering exercises across paginated category pages."""

    def __init__(
        self,
        provider: BaseAcquisitionProvider,
        cache: RawAcquisitionCache | None = None,
        delay_seconds: float = 1.5,
        jitter_seconds: float = 0.5,
        max_pages: int = 50,
    ) -> None:
        self._provider = provider
        self._cache = cache or RawAcquisitionCache()
        self._delay_seconds = delay_seconds
        self._jitter_seconds = jitter_seconds
        self._max_pages = max_pages

    def crawl_category(
        self,
        category_url: str,
        force_live: bool = False,
    ) -> CrawlResult:
        """
        Crawl a category URL and discover all exercise links across pages.
        """
        discovered: list[DiscoveredExercise] = []
        seen_urls: set[str] = set()
        warnings: list[str] = []
        total_pages = 0
        reported_count: int | None = None

        base_clean_url = category_url.strip().rstrip("/")
        if not base_clean_url.startswith(("http://", "https://")):
            return CrawlResult(
                category_url=category_url,
                status=CrawlStatus.FAILED,
                error=f"Invalid category URL: {category_url}",
            )

        current_page = 1
        options = FetchOptions(
            timeout_seconds=30.0,
            force_live=force_live,
            rate_limit_delay=self._delay_seconds,
            rate_limit_jitter=self._jitter_seconds,
        )

        while current_page <= self._max_pages:
            # Build page URL: page 1 is root with trailing slash, page 2+ is /page/N/
            page_url = f"{base_clean_url}/" if current_page == 1 else f"{base_clean_url}/page/{current_page}/"

            # Check cache or fetch
            fetch_result = None
            if not force_live and self._cache.has(page_url):
                fetch_result = self._cache.get(page_url)

            if fetch_result is None:
                # Polite sleep between live fetches (after the first live fetch)
                if total_pages > 0 and self._delay_seconds > 0:
                    jitter = random.uniform(-self._jitter_seconds, self._jitter_seconds)
                    sleep_time = max(0.2, self._delay_seconds + jitter)
                    time.sleep(sleep_time)

                try:
                    fetch_result = self._provider.fetch_page(page_url, options=options)
                    self._cache.put(fetch_result)
                except PermissionError as exc:
                    return CrawlResult(
                        category_url=category_url,
                        discovered=discovered,
                        total_pages_visited=total_pages,
                        status=CrawlStatus.FAILED,
                        warnings=warnings,
                        error=f"Access blocked (403 Forbidden): {exc}",
                    )
                except Exception as exc:
                    # If page 2+ gets 404, not found, or unprovided page, pagination has terminated normally
                    if current_page > 1:
                        logger.info("Pagination reached end at page %d: %s", current_page, exc)
                        break
                    return CrawlResult(
                        category_url=category_url,
                        discovered=discovered,
                        total_pages_visited=total_pages,
                        status=CrawlStatus.FAILED,
                        warnings=warnings,
                        error=f"Fetch failed on page {current_page} ({page_url}): {exc}",
                    )

            total_pages += 1
            markdown = fetch_result.raw_markdown

            # Check for reported total count on page 1
            if current_page == 1 and reported_count is None:
                match = REPORTED_COUNT_PATTERN.search(markdown)
                if match:
                    try:
                        reported_count = int(match.group(1))
                    except ValueError:
                        pass

            # Extract exercise links
            page_new_urls = 0
            for title_match, link_url in MARKDOWN_LINK_PATTERN.findall(markdown):
                norm_link = link_url.strip().split("#")[0]
                if is_exercise_url(norm_link) and norm_link not in seen_urls:
                    seen_urls.add(norm_link)
                    lvl, sec = extract_level_and_section(norm_link, title_match)
                    ordinal = len(discovered) + 1
                    discovered.append(
                        DiscoveredExercise(
                            url=norm_link,
                            title=title_match.strip(),
                            ordinal=ordinal,
                            jlpt_level=lvl,
                            section=sec,
                        )
                    )
                    page_new_urls += 1

            # Termination conditions:
            # 1. No new exercise URLs found on this page
            if page_new_urls == 0:
                logger.info("No new exercise URLs on page %d; terminating crawl.", current_page)
                break

            current_page += 1

        # Validation: Compare discovered count with reported count if present
        if reported_count is not None and len(discovered) != reported_count:
            warn_msg = f"Discovered count ({len(discovered)}) does not match reported category count ({reported_count})."
            warnings.append(warn_msg)
            logger.warning(warn_msg)

        return CrawlResult(
            category_url=category_url,
            discovered=discovered,
            total_pages_visited=total_pages,
            status=CrawlStatus.COMPLETED,
            warnings=warnings,
        )

