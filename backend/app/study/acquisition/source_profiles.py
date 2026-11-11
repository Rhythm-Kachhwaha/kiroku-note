"""Validated, data-driven acquisition source profiles."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


DiscoveryStrategy = Literal[
    "paginated_category",
    "sitemap",
    "search",
    "manual_urls",
    "pdf_links",
]


SourceTier = Literal["A", "B", "C", "corpus"]


class SourceProfile(BaseModel):
    """Configuration selecting discovery and parsing behavior for a source."""

    profile_version: int = 1
    source_slug: str = Field(min_length=1, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    display_name: str = Field(min_length=1)
    tier: SourceTier = "B"
    allowed_domains: list[str] = Field(min_length=1)
    discovery_strategy: DiscoveryStrategy
    include_url_rules: list[str] = Field(default_factory=list)
    exclude_url_rules: list[str] = Field(default_factory=list)
    pagination: dict[str, Any] = Field(default_factory=dict)
    level_category_mapping: dict[str, str] = Field(default_factory=dict)
    search_queries: list[str] = Field(default_factory=list)
    error_threshold: float = Field(default=0.25, ge=0.0, le=1.0)
    parser_id: str = Field(min_length=1)
    polite_delay_seconds: float = Field(default=1.5, ge=0)
    concurrency_limit: int = Field(default=1, ge=1, le=8)
    license_or_permission: str = Field(min_length=1)

    @field_validator("allowed_domains")
    @classmethod
    def validate_domains(cls, domains: list[str]) -> list[str]:
        normalized: list[str] = []
        for domain in domains:
            value = domain.lower().strip().rstrip(".")
            if not value or "/" in value or ":" in value or "@" in value:
                raise ValueError(f"Unsafe allowed domain: {domain}")
            if value.startswith("*.") or "*" in value:
                raise ValueError(f"Wildcard domains are not supported: {domain}")
            normalized.append(value)
        return normalized

    @field_validator("include_url_rules", "exclude_url_rules")
    @classmethod
    def validate_rules(cls, rules: list[str]) -> list[str]:
        import re

        for rule in rules:
            try:
                re.compile(rule)
            except re.error as exc:
                raise ValueError(f"Invalid URL rule: {rule}") from exc
        return rules

    def accepts_url(self, url: str) -> bool:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"}:
            return False
        host = (parsed.hostname or "").lower().rstrip(".")
        if host not in self.allowed_domains:
            return False
        import re

        if any(re.search(rule, url) for rule in self.exclude_url_rules):
            return False
        return not self.include_url_rules or any(
            re.search(rule, url) for rule in self.include_url_rules
        )


PROFILE_DIR = Path(__file__).with_name("sources")


def load_source_profile(source_slug: str, profile_dir: Path = PROFILE_DIR) -> SourceProfile:
    """Load and validate one profile before a discovery job begins."""
    path = profile_dir / f"{source_slug}.json"
    if not path.is_file():
        raise ValueError(f"Unknown source profile: {source_slug}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        profile = SourceProfile.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Invalid source profile '{source_slug}': {exc}") from exc
    from app.study.acquisition.parsers.registry import get_source_parser

    get_source_parser(profile.parser_id)
    return profile


def load_source_profiles(profile_dir: Path = PROFILE_DIR) -> dict[str, SourceProfile]:
    """Load all profile files, failing closed on malformed configuration."""
    profiles: dict[str, SourceProfile] = {}
    for path in sorted(profile_dir.glob("*.json")):
        profile = SourceProfile.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if profile.source_slug in profiles:
            raise ValueError(f"Duplicate source profile: {profile.source_slug}")
        from app.study.acquisition.parsers.registry import get_source_parser

        get_source_parser(profile.parser_id)
        profiles[profile.source_slug] = profile
    return profiles
