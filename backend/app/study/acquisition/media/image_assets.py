"""
Image Asset Validation, Dimension Extraction, and Content-Addressed Metadata.
-----------------------------------------------------------------------------
Pure Python binary header inspection for PNG, JPEG, WEBP, and GIF assets.
Computes SHA-256 deduplication hashes and validates magic bytes without heavy
native image library dependencies.
"""
from __future__ import annotations

import hashlib
import struct
from typing import Literal

from pydantic import BaseModel


ImageMimeType = Literal["image/png", "image/jpeg", "image/webp", "image/gif"]

_JPEG_SOF_MARKERS = frozenset({
    0xC0, 0xC1, 0xC2, 0xC3,
    0xC5, 0xC6, 0xC7,
    0xC9, 0xCA, 0xCB,
    0xCD, 0xCE, 0xCF,
})

_JPEG_STANDALONE_MARKERS = frozenset({
    0x00, 0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9,
})


class ImageAssetMetadata(BaseModel):
    """Validated metadata and SHA-256 content address for a choice/diagram image."""

    sha256: str
    mime_type: str
    byte_size: int
    pixel_width: int | None = None
    pixel_height: int | None = None
    original_url: str = ""
    is_duplicate: bool = False


def detect_image_mime_type(data: bytes) -> str | None:
    """Detect image MIME type strictly from binary magic bytes."""
    if not data or len(data) < 6:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    return None


def validate_image_magic_bytes(data: bytes, expected_ext: str | None = None) -> str:
    """
    Validate binary magic bytes for PNG/JPEG/WEBP/GIF images.

    Raises ValueError if bytes are empty, corrupted, or contradict expected_ext.
    """
    detected = detect_image_mime_type(data)
    if detected is None:
        raise ValueError("Invalid or unsupported image binary signature.")

    if expected_ext:
        ext = expected_ext.lower().strip()
        ext_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        expected_mime = ext_map.get(ext)
        if expected_mime is not None and detected != expected_mime:
            raise ValueError(
                f"Image magic bytes ({detected}) do not match file extension ({ext})."
            )
    return detected


def _extract_png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0:
        return None
    return width, height


def _extract_gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10:
        return None
    width, height = struct.unpack("<HH", data[6:10])
    if width <= 0 or height <= 0:
        return None
    return width, height


def _extract_jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[0:2] != b"\xff\xd8":
        return None
    pos = 2
    limit = len(data)
    while pos + 1 < limit:
        if data[pos] != 0xFF:
            pos += 1
            continue
        while pos < limit and data[pos] == 0xFF:
            pos += 1
        if pos >= limit:
            break
        marker = data[pos]
        pos += 1
        if marker in _JPEG_STANDALONE_MARKERS:
            continue
        if marker == 0xDA:  # Start of Scan; image frame headers precede SOS
            break
        if pos + 2 > limit:
            break
        seg_len = struct.unpack(">H", data[pos : pos + 2])[0]
        if seg_len < 2 or pos + seg_len > limit:
            break
        if marker in _JPEG_SOF_MARKERS:
            if pos + 7 > limit:
                return None
            height, width = struct.unpack(">HH", data[pos + 3 : pos + 7])
            if width <= 0 or height <= 0:
                return None
            return width, height
        pos += seg_len
    return None


def _extract_webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 16 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk_id = data[12:16]
    if chunk_id == b"VP8 " and len(data) >= 30:
        # Lossy VP8 bitstream: 3-byte frame tag + 3-byte sync code 0x9d 0x01 0x2a
        if data[23:26] != b"\x9d\x01\x2a":
            return None
        raw_w, raw_h = struct.unpack("<HH", data[26:30])
        width = raw_w & 0x3FFF
        height = raw_h & 0x3FFF
        return (width, height) if width > 0 and height > 0 else None
    if chunk_id == b"VP8L" and len(data) >= 25:
        if data[20] != 0x2F:
            return None
        packed = struct.unpack("<I", data[21:25])[0]
        width = (packed & 0x3FFF) + 1
        height = ((packed >> 14) & 0x3FFF) + 1
        return (width, height) if width > 0 and height > 0 else None
    if chunk_id == b"VP8X" and len(data) >= 30:
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return (width, height) if width > 0 and height > 0 else None
    return None


def extract_image_dimensions(data: bytes) -> tuple[int, int] | None:
    """Extract (width, height) pixels in pure Python for PNG, JPEG, WEBP, and GIF."""
    mime = detect_image_mime_type(data)
    if mime == "image/png":
        return _extract_png_dimensions(data)
    if mime == "image/jpeg":
        return _extract_jpeg_dimensions(data)
    if mime == "image/webp":
        return _extract_webp_dimensions(data)
    if mime == "image/gif":
        return _extract_gif_dimensions(data)
    return None


class ImageAssetProcessor:
    """Validates image binaries, computes SHA-256 deduplication hashes, and extracts dimensions."""

    def __init__(self) -> None:
        self._seen_hashes: dict[str, ImageAssetMetadata] = {}

    def process_bytes(
        self,
        data: bytes,
        *,
        expected_ext: str | None = None,
        original_url: str = "",
    ) -> ImageAssetMetadata:
        """Validate image bytes, extract dimensions, and deduplicate by SHA-256."""
        mime_type = validate_image_magic_bytes(data, expected_ext=expected_ext)
        sha256 = hashlib.sha256(data).hexdigest()
        dims = extract_image_dimensions(data)
        pixel_width, pixel_height = dims if dims is not None else (None, None)

        is_dup = sha256 in self._seen_hashes
        meta = ImageAssetMetadata(
            sha256=sha256,
            mime_type=mime_type,
            byte_size=len(data),
            pixel_width=pixel_width,
            pixel_height=pixel_height,
            original_url=original_url,
            is_duplicate=is_dup,
        )
        if not is_dup:
            self._seen_hashes[sha256] = meta
        return meta
