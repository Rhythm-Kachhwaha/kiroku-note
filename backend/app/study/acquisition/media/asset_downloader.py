"""
Media Asset Downloader for Study Bank Acquisition.
--------------------------------------------------
Downloads diagram and illustration images from external question pages
and registers them into Kiroku Study Bank's content-addressed MediaStore.

Guarantees:
- Strict SSRF protection and hostname whitelisting (japanesetest4you.com)
- Rejection of private IP ranges (RFC 1918), localhost loopbacks, and non-HTTP protocols
- Automatic deduplication via SHA-256 content hashing
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
from pathlib import Path
import sqlite3
import urllib.parse

import httpx

from app.study.media import MediaStore

logger = logging.getLogger(__name__)

# Hostnames permitted for diagram asset downloads
WHITELISTED_HOSTS = {
    "japanesetest4you.com",
    "www.japanesetest4you.com",
}

# MIME type mapping based on file extension
MIME_MAP = {
    ".gif": "image/gif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


def _validate_image_url(url: str) -> urllib.parse.ParseResult:
    """Validate that the URL belongs to a whitelisted domain and is not an SSRF attempt."""
    if not url or not url.startswith(("http://", "https://")):
        raise ValueError(f"Invalid image URL: {url}")

    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()

    if hostname not in WHITELISTED_HOSTS:
        raise PermissionError(f"Host '{hostname}' is not in the acquisition image whitelist.")

    # Prevent loopback or private IP resolution
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_loopback or ip.is_private or ip.is_reserved:
            raise PermissionError(f"Private IP access is forbidden: {hostname}")
    except ValueError:
        # Hostname is a domain name, not an IP literal
        pass

    return parsed


class AssetDownloader:
    """Downloader fetching diagram images directly into content-addressed MediaStore."""

    def __init__(
        self,
        media_store: MediaStore,
        client: httpx.Client | None = None,
    ) -> None:
        self._media_store = media_store
        self._client = client

    def download_asset(
        self,
        image_url: str,
        conn: sqlite3.Connection | None = None,
        timeout_seconds: float = 15.0,
    ) -> dict[str, str]:
        """
        Download diagram image from whitelisted URL and commit to MediaStore.

        Returns:
            dict containing:
                - "asset_id": SHA-256 hex digest
                - "relative_path": storage path relative to media root
                - "mime_type": media MIME type
        """
        parsed = _validate_image_url(image_url)

        # Determine extension from path
        ext = Path(parsed.path).suffix.lower() or ".gif"
        mime_type = MIME_MAP.get(ext, "image/gif")

        # Fetch binary data
        client = self._client or httpx.Client(timeout=timeout_seconds)
        should_close = self._client is None

        try:
            resp = client.get(image_url, headers={"User-Agent": "KirokuStudyAssetFetcher/1.0"})
            resp.raise_for_status()
            data = resp.content

            if not data:
                raise ValueError(f"Downloaded asset from {image_url} is empty.")

            # If content-type header returned, use it to refine mime type
            ct = resp.headers.get("content-type", "").split(";")[0].strip()
            if ct in MIME_MAP.values():
                mime_type = ct

            sha = hashlib.sha256(data).hexdigest()

            if conn is not None:
                row = self._media_store.register_bytes(
                    data=data,
                    extension=ext,
                    kind="diagram",
                    mime_type=mime_type,
                    conn=conn,
                    original_url=image_url,
                )
                return {
                    "asset_id": sha,
                    "relative_path": row["relative_path"],
                    "mime_type": mime_type,
                }
            else:
                # Store without DB record
                prefix = sha[:2]
                dest_dir = self._media_store.media_dir / prefix
                dest_dir.mkdir(parents=True, exist_ok=True)
                filename = f"{sha}{ext}"
                dest_file = dest_dir / filename
                if not dest_file.exists():
                    dest_file.write_bytes(data)

                return {
                    "asset_id": sha,
                    "relative_path": f"{prefix}/{filename}",
                    "mime_type": mime_type,
                }

        finally:
            if should_close:
                client.close()

