"""Focused tests for profile validation and generic discovery strategies."""
from __future__ import annotations

import pytest

from app.study.acquisition.discovery import DiscoveryStrategyRunner
from app.study.acquisition.source_profiles import SourceProfile, load_source_profile


@pytest.fixture
def profile() -> SourceProfile:
    return load_source_profile("japanesetest4you")


def test_sitemap_and_manual_discovery_apply_profile_rules(profile: SourceProfile) -> None:
    runner = DiscoveryStrategyRunner(profile)
    sitemap = """<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/</loc></url>
      <url><loc>https://japanesetest4you.com/about/</loc></url>
    </urlset>"""
    found = runner.sitemap(sitemap)
    assert [item.url for item in found] == [
        "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    ]
    with pytest.raises(ValueError, match="outside source profile"):
        runner.manual_urls(["https://example.com/exercise-1/"])


def test_search_is_capability_based_and_approval_gated(profile: SourceProfile) -> None:
    class SearchProvider:
        provider_name = "mock"

        def search(self, query: str) -> list[dict[str, str]]:
            return [{
                "title": "Exercise",
                "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/",
                "match_reason": query,
            }]

    runner = DiscoveryStrategyRunner(profile)
    candidates = runner.search(SearchProvider(), "grammar")
    assert candidates[0].approved is False
    assert runner.approve(candidates, set()) == []
    approved = runner.approve(candidates, {candidates[0].url})
    assert approved[0].url == candidates[0].url


def test_pdf_links_are_candidates_not_auto_imports(profile: SourceProfile) -> None:
    pdf_profile = profile.model_copy(
        update={"discovery_strategy": "pdf_links", "include_url_rules": [r"\.pdf"]}
    )
    runner = DiscoveryStrategyRunner(pdf_profile)
    candidates = runner.pdf_links(
        "https://japanesetest4you.com/resources/",
        '<a href="/resources/test.pdf">Practice PDF</a>',
    )
    assert candidates[0].url.endswith("/resources/test.pdf")
    assert candidates[0].approved is False


def test_profile_rejects_unknown_strategy_and_unsafe_domain() -> None:
    with pytest.raises(ValueError):
        SourceProfile(
            source_slug="bad",
            display_name="Bad",
            allowed_domains=["*.example.com"],
            discovery_strategy="unknown",
            parser_id="japanesetest4you",
            license_or_permission="test",
        )
