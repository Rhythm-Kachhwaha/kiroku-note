"""Profile-driven discovery strategies."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

from app.study.acquisition.models import DiscoveredExercise
from app.study.acquisition.source_profiles import SourceProfile
from app.study.provenance import normalize_source_url


@dataclass(frozen=True)
class DiscoveryCandidate:
    """Search/PDF candidate requiring explicit user approval."""

    title: str
    url: str
    source_slug: str
    match_reason: str
    approved: bool = False


class DiscoveryStrategyRunner:
    """Runs non-paginated strategies without coupling them to a provider."""

    def __init__(self, profile: SourceProfile) -> None:
        self.profile = profile

    def manual_urls(self, urls: list[str]) -> list[DiscoveredExercise]:
        result: list[DiscoveredExercise] = []
        for ordinal, url in enumerate(urls, 1):
            normalized = normalize_source_url(url)
            if not self.profile.accepts_url(normalized):
                raise ValueError(f"URL is outside source profile '{self.profile.source_slug}': {url}")
            result.append(DiscoveredExercise(url=normalized, title=normalized, ordinal=ordinal))
        return result

    def sitemap(self, xml_text: str) -> list[DiscoveredExercise]:
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            raise ValueError("Invalid sitemap XML") from exc
        urls: list[DiscoveredExercise] = []
        for ordinal, loc in enumerate(root.findall(".//{*}loc"), 1):
            url = normalize_source_url((loc.text or "").strip())
            if url and self.profile.accepts_url(url):
                urls.append(DiscoveredExercise(url=url, title=url, ordinal=ordinal))
        return urls

    def pdf_links(self, page_url: str, content: str) -> list[DiscoveryCandidate]:
        candidates: list[DiscoveryCandidate] = []
        seen: set[str] = set()
        pattern = re.compile(
            r'(?:href|url)=["\'](?P<html_url>[^"\']+\.pdf(?:\?[^"\']*)?)["\']|'
            r"\[(?P<md_title>[^\]]*)\]\((?P<md_url>[^)\s]+\.pdf(?:\?[^)\s]*)?)\)",
            flags=re.IGNORECASE,
        )
        for match in pattern.finditer(content):
            href = match.group("html_url") or match.group("md_url") or ""
            title = match.group("md_title") or ""
            url = normalize_source_url(urljoin(page_url, href))
            if url in seen or not self.profile.accepts_url(url):
                continue
            seen.add(url)
            candidates.append(
                DiscoveryCandidate(
                    title=title or url,
                    url=url,
                    source_slug=self.profile.source_slug,
                    match_reason="profile pdf_links rule",
                )
            )
        return candidates

    def search(self, provider: Any, query: str) -> list[DiscoveryCandidate]:
        search = getattr(provider, "search", None)
        if not callable(search):
            raise ValueError(f"Provider '{provider.provider_name}' does not support search")
        candidates: list[DiscoveryCandidate] = []
        for item in search(query):
            url = normalize_source_url(str(item.get("url", "")))
            if url and self.profile.accepts_url(url):
                candidates.append(
                    DiscoveryCandidate(
                        title=str(item.get("title", url)),
                        url=url,
                        source_slug=self.profile.source_slug,
                        match_reason=str(item.get("match_reason", f"search: {query}")),
                    )
                )
        return candidates

    @staticmethod
    def approve(candidates: list[DiscoveryCandidate], urls: set[str]) -> list[DiscoveredExercise]:
        approved: list[DiscoveredExercise] = []
        for candidate in candidates:
            if normalize_source_url(candidate.url) in urls:
                approved.append(
                    DiscoveredExercise(
                        url=candidate.url,
                        title=candidate.title,
                        ordinal=len(approved) + 1,
                    )
                )
        return approved
