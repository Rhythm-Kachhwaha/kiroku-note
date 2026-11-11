"""
Media Asset Downloader for Study Bank Acquisition.
--------------------------------------------------
Downloads diagram and illustration images as well as audio tracks
from external question pages and registers them into Kiroku Study Bank's
content-addressed MediaStore.

Guarantees:
- Strict SSRF protection and hostname whitelisting (japanesetest4you.com)
- Rejection of private IP ranges (RFC 1918), localhost loopbacks, and non-HTTP protocols
- Validation of audio binary signatures (ID3 / MPEG sync frames)
- Automatic deduplication via SHA-256 content hashing
- Database-optional storage (supports disk-only content addressing when conn is None)
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
from pathlib import Path
import sqlite3
import urllib.parse

import httpx

from app.study.acquisition.media.audio_duration import (
    extract_audio_duration_ms,
    is_audio_duration_plausible,
)
from app.study.acquisition.media.image_assets import (
    extract_image_dimensions,
    validate_image_magic_bytes,
)
from app.study.media import MediaStore

logger = logging.getLogger(__name__)

# Hostnames permitted for media asset downloads
WHITELISTED_HOSTS = {
    "japanesetest4you.com",
    "www.japanesetest4you.com",
    "jlpt.jp",
    "www.jlpt.jp",
    "cotoacademy.com",
    "www.cotoacademy.com",
    "gyanmirai.com",
    "www.gyanmirai.com",
    "nihongomaster.com",
    "www.nihongomaster.com",
    "nihongo-pro.com",
    "www.nihongo-pro.com",
}

# MIME type mapping based on file extension
MIME_MAP = {
    # Images
    ".gif": "image/gif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    # Audio
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}


def _validate_media_url(
    url: str,
    allowed_hosts: set[str] | frozenset[str] | None = None,
) -> urllib.parse.ParseResult:
    """Validate that the URL belongs to a whitelisted domain and is not an SSRF attempt."""
    if not url or not url.startswith(("http://", "https://")):
        raise ValueError(f"Invalid image URL: {url}")

    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    permitted = allowed_hosts if allowed_hosts is not None else WHITELISTED_HOSTS

    if hostname not in permitted:
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


# Retain alias for backward compatibility
_validate_image_url = _validate_media_url


def is_valid_audio_bytes(data: bytes, ext: str) -> bool:
    """Check binary audio signatures to ensure valid, uncorrupted media."""
    if not data or len(data) < 4:
        return False

    ext_lower = ext.lower()
    if ext_lower == ".mp3":
        # Check ID3v2 header ('ID3') or MPEG sync frame (0xFF followed by 0xFB/FA/F3/F2/E0-FF)
        if data.startswith(b"ID3"):
            return True
        if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
            return True
        return False
    elif ext_lower == ".wav":
        return data.startswith(b"RIFF") and b"WAVE" in data[:12]
    elif ext_lower == ".ogg":
        return data.startswith(b"OggS")
    elif ext_lower == ".m4a":
        return b"ftyp" in data[:12]

    return True


class AssetDownloader:
    """Downloader fetching diagram images and audio tracks directly into content-addressed MediaStore."""

    def __init__(
        self,
        media_store: MediaStore,
        client: httpx.Client | None = None,
        allowed_hosts: set[str] | frozenset[str] | None = None,
    ) -> None:
        self._media_store = media_store
        self._client = client
        self._allowed_hosts = set(allowed_hosts) if allowed_hosts is not None else None

    def download_asset(
        self,
        asset_url: str,
        conn: sqlite3.Connection | None = None,
        timeout_seconds: float = 15.0,
        kind: str | None = None,
    ) -> dict[str, Any]:
        """
        Download media asset from whitelisted URL and commit to MediaStore.

        Returns:
            dict containing:
                - "asset_id": SHA-256 hex digest
                - "relative_path": storage path relative to media root
                - "mime_type": media MIME type
                - "byte_size": byte size of asset
                - "kind": "diagram", "choice_image", "illustration", or "audio"
        """
        parsed = _validate_media_url(asset_url, allowed_hosts=self._allowed_hosts)

        # Determine extension from path
        ext = Path(parsed.path).suffix.lower() or ".gif"
        mime_type = MIME_MAP.get(ext, "image/gif")

        # Infer kind if omitted
        inferred_kind = kind or ("audio" if ext in (".mp3", ".m4a", ".wav", ".ogg") else "diagram")

        # Fetch binary data
        client = self._client or httpx.Client(timeout=timeout_seconds)
        should_close = self._client is None

        headers = {
            "User-Agent": "KirokuStudyAssetFetcher/1.0",
            "Referer": f"{parsed.scheme}://{parsed.netloc}/",
        }

        try:
            resp = client.get(asset_url, headers=headers)
            resp.raise_for_status()
            data = resp.content

            if not data:
                raise ValueError(f"Downloaded asset from {asset_url} is empty.")

            pixel_width: int | None = None
            pixel_height: int | None = None

            # Validate binary signatures
            if inferred_kind == "audio":
                if not is_valid_audio_bytes(data, ext):
                    raise ValueError(f"Downloaded file from {asset_url} failed audio binary signature validation.")
            elif ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                detected_mime = validate_image_magic_bytes(data, expected_ext=ext)
                mime_type = detected_mime
                dims = extract_image_dimensions(data)
                if dims is not None:
                    pixel_width, pixel_height = dims

            # If content-type header returned, use it to refine mime type
            ct = resp.headers.get("content-type", "").split(";")[0].strip()
            if ct in MIME_MAP.values() and inferred_kind == "audio":
                mime_type = ct

            sha = hashlib.sha256(data).hexdigest()
            byte_size = len(data)

            duration_ms: int | None = None
            duration_plausible: bool | None = None
            if inferred_kind == "audio":
                try:
                    duration_ms = extract_audio_duration_ms(data, ext)
                    duration_plausible = is_audio_duration_plausible(duration_ms)
                except Exception as exc:
                    logger.warning("Could not extract audio duration from %s: %s", asset_url, exc)
                    duration_ms = None
                    duration_plausible = False

            if conn is not None:
                row = self._media_store.register_bytes(
                    data=data,
                    extension=ext,
                    kind=inferred_kind,
                    mime_type=mime_type,
                    conn=conn,
                    duration_ms=duration_ms,
                    pixel_width=pixel_width,
                    pixel_height=pixel_height,
                    original_url=asset_url,
                )
                return {
                    "asset_id": sha,
                    "relative_path": row["relative_path"],
                    "mime_type": mime_type,
                    "byte_size": byte_size,
                    "kind": inferred_kind,
                    "duration_ms": duration_ms,
                    "duration_plausible": duration_plausible,
                    "pixel_width": pixel_width,
                    "pixel_height": pixel_height,
                }
            else:
                # Content-addressed disk-only storage without DB writes
                prefix = sha[:2]
                dest_dir = self._media_store.media_dir / prefix
                dest_dir.mkdir(parents=True, exist_ok=True)
                filename = f"{sha}{ext}"
                dest_file = dest_dir / filename
                deduplicated = dest_file.exists()
                if not deduplicated:
                    dest_file.write_bytes(data)

                return {
                    "asset_id": sha,
                    "relative_path": f"{prefix}/{filename}",
                    "mime_type": mime_type,
                    "byte_size": byte_size,
                    "kind": inferred_kind,
                    "duration_ms": duration_ms,
                    "duration_plausible": duration_plausible,
                    "pixel_width": pixel_width,
                    "pixel_height": pixel_height,
                    "deduplicated": deduplicated,
                }

        finally:
            if should_close:
                client.close()
