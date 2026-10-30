"""
Content-Addressed Media Serving Router.
---------------------------------------
Implements:
- GET /media/{asset_id_or_sha256}
Safely streams audio, illustrations, diagrams, and other study assets
with strict containment validation and accurate MIME types.
"""
from __future__ import annotations

from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse

from app.api.study.deps import get_media_store, get_study_db
from app.api.study.errors import (
    StudyMediaError,
    StudyNotFoundError,
    map_domain_exception,
)
from app.study.media import MediaStore, PathTraversalError

media_router = APIRouter(tags=["study-media"])


@media_router.get("/media/{asset_id_or_sha256}")
def get_media_asset(
    asset_id_or_sha256: str,
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> FileResponse:
    """
    Stream a content-addressed study asset (audio clip, image, document) by ID or SHA-256.
    """
    try:
        # 1. Lookup in database by ID or SHA-256
        if asset_id_or_sha256.isdigit():
            row = conn.execute(
                "SELECT * FROM asset WHERE id = ?;",
                (int(asset_id_or_sha256),),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM asset WHERE sha256 = ?;",
                (asset_id_or_sha256.lower().strip(),),
            ).fetchone()

        if not row:
            raise StudyNotFoundError(
                message=f"Media asset '{asset_id_or_sha256}' not found.",
                code="ASSET_NOT_FOUND",
            )

        if row["status"] == "missing":
            raise StudyMediaError(
                message=f"Media asset '{asset_id_or_sha256}' is marked missing from local storage.",
                code="MEDIA_MISSING",
                status_code=status.HTTP_410_GONE,
            )

        # 2. Confinement and path resolution
        try:
            full_path = media_store.get_asset_file_path(row["relative_path"])
        except PathTraversalError as pte:
            raise StudyMediaError(
                message="Security violation: asset path traversal rejected.",
                code="PATH_TRAVERSAL",
                status_code=status.HTTP_400_BAD_REQUEST,
            ) from pte

        # 3. Disk existence check
        if not full_path.is_file():
            raise StudyMediaError(
                message=f"Media asset '{asset_id_or_sha256}' missing from disk.",
                code="MEDIA_MISSING",
                status_code=status.HTTP_410_GONE,
            )

        mime_type = row["mime_type"] or "application/octet-stream"
        return FileResponse(
            path=str(full_path),
            media_type=mime_type,
            filename=full_path.name,
        )
    except Exception as exc:
        raise map_domain_exception(exc)

