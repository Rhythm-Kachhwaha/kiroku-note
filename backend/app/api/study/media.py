"""
Content-Addressed Media Serving & Streaming Router.
---------------------------------------------------
Implements:
- GET /media/{asset_id_or_sha256}

Security & Delivery Guarantees:
- Validates that the requested asset is referenced by an eligible question revision
  or active group revision context before serving it (403 MEDIA_INELIGIBLE).
- Full RFC 7233 / RFC 9110 HTTP Byte-Range streaming (206 Partial Content, 416 Range Not Satisfiable).
- Efficient 64 KB chunked streaming preventing memory bloat on large audio files.
- Strict path traversal prevention and identifier format validation.
- Consistent 410 MEDIA_MISSING when asset status is marked missing or file absent.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import sqlite3
from typing import Generator, Optional, Tuple

from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.study.deps import get_media_store, get_study_db
from app.api.study.errors import (
    StudyAPIError,
    StudyBadRequestError,
    StudyMediaError,
    StudyNotFoundError,
    map_domain_exception,
)
from app.study.media import MediaStore, PathTraversalError

media_router = APIRouter(tags=["study-media"])

CHUNK_SIZE = 65536


def is_asset_eligible(conn: sqlite3.Connection, asset_id: int) -> bool:
    """
    Verify that an asset is referenced by an active, eligible question revision
    or an active content group revision context.
    """
    query = """
        SELECT 1 FROM (
            -- 1. Linked directly to an active question's current revision
            SELECT 1
            FROM question_revision_asset qra
            JOIN question q ON q.current_revision_id = qra.question_revision_id
            JOIN v_question_eligibility vqe ON vqe.question_id = q.id
            WHERE qra.asset_id = :asset_id
              AND vqe.question_status = 'active'
              AND vqe.has_current_revision = 1
              AND vqe.validation_status = 'valid'
              AND vqe.has_answer = 1
              AND vqe.missing_required_assets_count = 0
              AND vqe.group_inconsistent = 0
              AND vqe.has_answer_conflict = 0

            UNION ALL

            -- 2. Linked to an active question's current choice
            SELECT 1
            FROM revision_choice rc
            JOIN question q ON q.current_revision_id = rc.question_revision_id
            JOIN v_question_eligibility vqe ON vqe.question_id = q.id
            WHERE rc.asset_id = :asset_id
              AND vqe.question_status = 'active'
              AND vqe.has_current_revision = 1
              AND vqe.validation_status = 'valid'
              AND vqe.has_answer = 1
              AND vqe.missing_required_assets_count = 0
              AND vqe.group_inconsistent = 0
              AND vqe.has_answer_conflict = 0

            UNION ALL

            -- 3. Linked to an active content group revision
            SELECT 1
            FROM group_revision_asset gra
            JOIN content_group cg ON cg.current_revision_id = gra.group_revision_id
            WHERE gra.asset_id = :asset_id
              AND cg.status != 'retired'
        ) LIMIT 1;
    """
    row = conn.execute(query, {"asset_id": asset_id}).fetchone()
    return row is not None


def parse_byte_range(range_header: str, file_size: int) -> Tuple[Optional[int], Optional[int], bool]:
    """
    Parse HTTP Range header: `bytes=start-end`, `bytes=start-`, `bytes=-suffix`.
    Returns (start, end, is_valid).
    If invalid or unsatisfiable, returns (None, None, False).
    """
    if not range_header or not range_header.startswith("bytes="):
        return None, None, False

    spec = range_header[6:].strip()
    if not spec or "," in spec or "-" not in spec:
        return None, None, False

    parts = spec.split("-", 1)
    start_str, end_str = parts[0].strip(), parts[1].strip()

    try:
        if not start_str and end_str:
            # Suffix range: bytes=-N (last N bytes)
            suffix = int(end_str)
            if suffix <= 0:
                return None, None, False
            if file_size == 0:
                return 0, 0, True
            start = max(0, file_size - suffix)
            end = file_size - 1
            return start, end, True

        elif start_str and not end_str:
            # Open-ended range: bytes=N-
            start = int(start_str)
            if start < 0 or start >= file_size:
                return None, None, False
            end = file_size - 1
            return start, end, True

        elif start_str and end_str:
            # Closed range: bytes=N-M
            start = int(start_str)
            end = int(end_str)
            if start < 0 or start > end or start >= file_size:
                return None, None, False
            end = min(end, file_size - 1)
            return start, end, True

        return None, None, False
    except ValueError:
        return None, None, False


def stream_file_chunks(file_path: Path, start: int, end: int, chunk_size: int = CHUNK_SIZE) -> Generator[bytes, None, None]:
    """Yield chunks of a file between start and end byte offsets."""
    with open(file_path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            read_size = min(chunk_size, remaining)
            chunk = f.read(read_size)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@media_router.get("/media/{asset_id_or_sha256}")
def get_media_asset(
    asset_id_or_sha256: str,
    range: Optional[str] = Header(None, alias="Range"),
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
):
    """
    Stream a content-addressed study asset (audio clip, image, document) by ID or SHA-256.
    Supports HTTP Byte-Range requests (RFC 7233) for efficient audio scrubbing and playback.
    """
    try:
        clean_id = asset_id_or_sha256.strip()

        # Reject path traversal tokens immediately
        if ".." in clean_id or "/" in clean_id or "\\" in clean_id or "%" in clean_id:
            raise StudyBadRequestError(
                code="INVALID_ASSET_IDENTIFIER",
                message="Security violation: path traversal characters rejected in asset identifier.",
            )

        # 1. Lookup in database by numeric ID or 64-char SHA-256
        if clean_id.isdigit():
            row = conn.execute(
                "SELECT * FROM asset WHERE id = ?;",
                (int(clean_id),),
            ).fetchone()
        elif re.match(r"^[0-9a-fA-F]{64}$", clean_id):
            row = conn.execute(
                "SELECT * FROM asset WHERE sha256 = ?;",
                (clean_id.lower(),),
            ).fetchone()
        else:
            raise StudyBadRequestError(
                code="INVALID_ASSET_IDENTIFIER",
                message=f"Invalid asset identifier format: '{asset_id_or_sha256}'. Expected integer ID or 64-character SHA-256 hex digest.",
            )

        if not row:
            raise StudyNotFoundError(
                message=f"Media asset '{asset_id_or_sha256}' not found.",
                code="ASSET_NOT_FOUND",
            )

        # 2. Check asset status in database
        if row["status"] == "missing":
            raise StudyMediaError(
                message=f"Media asset '{asset_id_or_sha256}' is marked missing from local storage.",
                code="MEDIA_MISSING",
                status_code=status.HTTP_410_GONE,
            )

        # 3. Verify asset is referenced by an eligible question revision or active group context
        if not is_asset_eligible(conn, row["id"]):
            raise StudyAPIError(
                code="MEDIA_INELIGIBLE",
                message=f"Media asset '{asset_id_or_sha256}' is not referenced by an eligible question revision or group context.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        # 4. Confinement and path resolution
        try:
            full_path = media_store.get_asset_file_path(row["relative_path"])
        except PathTraversalError as pte:
            raise StudyMediaError(
                message="Security violation: asset path traversal rejected.",
                code="PATH_TRAVERSAL",
                status_code=status.HTTP_400_BAD_REQUEST,
            ) from pte

        # 5. Disk existence check
        if not full_path.is_file():
            raise StudyMediaError(
                message=f"Media asset '{asset_id_or_sha256}' missing from disk.",
                code="MEDIA_MISSING",
                status_code=status.HTTP_410_GONE,
            )

        file_size = full_path.stat().st_size
        mime_type = row["mime_type"] or "application/octet-stream"

        # 6. Byte-Range Request Handling
        if range:
            start, end, is_valid = parse_byte_range(range, file_size)
            if not is_valid or start is None or end is None:
                return JSONResponse(
                    status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{file_size}"},
                    content={
                        "error": {
                            "code": "RANGE_NOT_SATISFIABLE",
                            "message": "Requested byte range is not satisfiable.",
                            "details": {"file_size": file_size, "range_header": range},
                        }
                    },
                )

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(end - start + 1),
                "Accept-Ranges": "bytes",
                "Content-Type": mime_type,
            }
            return StreamingResponse(
                stream_file_chunks(full_path, start, end),
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
            )

        # 7. Normal Full-File Response (streamed chunk-by-chunk)
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": mime_type,
        }
        return StreamingResponse(
            stream_file_chunks(full_path, 0, file_size - 1 if file_size > 0 else 0),
            status_code=status.HTTP_200_OK,
            headers=headers,
        )

    except Exception as exc:
        raise map_domain_exception(exc)
