"""
Raw Response Disk Cache for Study Bank Acquisition.
---------------------------------------------------
Persists raw provider responses immutably to disk:
- Content-addressed via SHA-256 of canonical URL
- Companion .meta.json file storing HTTP metadata, latency, and content hash
- Strips any authorization headers or sensitive tokens before writing
- Allows offline parser iteration and idempotency without remote API calls
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from app.config import get_study_dir
from app.study.acquisition.models import RawFetchResult

logger = logging.getLogger(__name__)

# Headers to exclude from cached metadata to avoid leaking credentials
SENSITIVE_HEADER_KEYS = {
    "authorization",
    "x-api-key",
    "cookie",
    "set-cookie",
    "proxy-authorization",
}


def _hash_url(url: str) -> str:
    """Compute deterministic SHA-256 hash of a normalized URL."""
    norm_url = url.strip().rstrip("/")
    return hashlib.sha256(norm_url.encode("utf-8")).hexdigest()


def _sanitize_headers(headers: dict[str, str]) -> dict[str, str]:
    """Return headers dictionary with credentials and auth tokens removed."""
    return {k: v for k, v in headers.items() if k.lower() not in SENSITIVE_HEADER_KEYS}


class RawAcquisitionCache:
    """Local-first cache storing pristine raw provider responses."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self._base_dir = base_dir or (get_study_dir() / "raw_acquisition")

    @property
    def base_dir(self) -> Path:
        return self._base_dir

    def _get_source_dir(self, source_slug: str) -> Path:
        """Resolve and ensure source-specific cache directory."""
        slug = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in source_slug.lower())
        path = self._base_dir / slug
        path.mkdir(parents=True, exist_ok=True)
        return path

    def get_cache_paths(self, url: str, source_slug: str = "japanesetest4you") -> tuple[Path, Path]:
        """Return (markdown_path, meta_path) for a given URL."""
        src_dir = self._get_source_dir(source_slug)
        url_hash = _hash_url(url)
        md_path = src_dir / f"{url_hash}.md"
        meta_path = src_dir / f"{url_hash}.meta.json"
        return md_path, meta_path

    def has(self, url: str, source_slug: str = "japanesetest4you") -> bool:
        """Check if both content and metadata exist in cache."""
        md_path, meta_path = self.get_cache_paths(url, source_slug)
        return md_path.is_file() and meta_path.is_file()

    def get(self, url: str, source_slug: str = "japanesetest4you") -> RawFetchResult | None:
        """Retrieve cached RawFetchResult, or None if not found or corrupted."""
        md_path, meta_path = self.get_cache_paths(url, source_slug)
        if not (md_path.is_file() and meta_path.is_file()):
            return None

        try:
            markdown = md_path.read_text(encoding="utf-8")
            meta = json.loads(meta_path.read_text(encoding="utf-8"))

            return RawFetchResult(
                url=meta.get("url", url),
                title=meta.get("title", ""),
                raw_markdown=markdown,
                status_code=meta.get("status_code", 200),
                headers=meta.get("headers", {}),
                fetch_latency_ms=meta.get("fetch_latency_ms", 0),
                provider=meta.get("provider", "cached"),
                metadata=meta.get("metadata", {}),
            )
        except Exception as exc:
            logger.warning("Failed to read raw acquisition cache for %s: %s", url, exc)
            return None

    def put(self, result: RawFetchResult, source_slug: str = "japanesetest4you") -> Path:
        """
        Store a RawFetchResult to disk.
        Returns the path to the saved markdown file.
        """
        md_path, meta_path = self.get_cache_paths(result.url, source_slug)
        content_hash = hashlib.sha256(result.raw_markdown.encode("utf-8")).hexdigest()

        # 1. Write markdown content
        md_path.write_text(result.raw_markdown, encoding="utf-8")

        # 2. Write companion metadata
        meta_payload: dict[str, Any] = {
            "url": result.url,
            "title": result.title,
            "provider": result.provider,
            "status_code": result.status_code,
            "headers": _sanitize_headers(result.headers),
            "fetch_latency_ms": result.fetch_latency_ms,
            "content_sha256": content_hash,
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "metadata": result.metadata,
        }
        meta_path.write_text(json.dumps(meta_payload, indent=2, ensure_ascii=False), encoding="utf-8")

        return md_path

