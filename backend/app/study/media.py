"""
Content-Addressed Media Storage Service for Kiroku Study Assets.
----------------------------------------------------------------
Manages local immutable binary assets (audio, illustrations, diagrams, documents).

Folder structure:
    media/<first-two-sha256-hex>/<sha256><extension>

Guarantees:
- Ingestion streams file into a temporary file inside media/tmp
- SHA-256 calculated on the fly during streaming
- Atomic placement via flush, fsync, and os.replace
- Automatic deduplication (identical bytes share same asset)
- Path traversal guards: all relative and resolved paths must strictly reside within media root
- verify_asset(sha) verifies filesystem existence and SHA-256 hash
- reconcile_assets() checks disk existence against DB asset.status ('present' vs 'missing')
- No asset deletion API
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import sqlite3
import uuid

from app.config import get_study_media_dir


class MediaStorageError(Exception):
    """Base error for media storage operations."""
    pass


class PathTraversalError(MediaStorageError):
    """Raised when an asset path attempts directory traversal."""
    pass


class MediaStore:
    """Content-addressed local media storage engine."""

    def __init__(self, media_dir: Path | str | None = None) -> None:
        self._media_dir = Path(media_dir).resolve() if media_dir is not None else get_study_media_dir().resolve()
        self._media_dir.mkdir(parents=True, exist_ok=True)
        self._tmp_dir = self._media_dir / "tmp"
        self._tmp_dir.mkdir(parents=True, exist_ok=True)

    @property
    def media_dir(self) -> Path:
        return self._media_dir

    def _validate_path_contained(self, target_path: Path) -> Path:
        """Ensure the resolved target path is strictly within the media directory."""
        resolved = target_path.resolve()
        try:
            resolved.relative_to(self._media_dir)
        except ValueError as exc:
            raise PathTraversalError(f"Path traversal detected: {target_path} is outside media root {self._media_dir}") from exc
        return resolved

    def register_file(
        self,
        source_path: Path | str,
        kind: str,
        mime_type: str,
        conn: sqlite3.Connection,
        duration_ms: int | None = None,
        pixel_width: int | None = None,
        pixel_height: int | None = None,
        original_url: str | None = None,
    ) -> sqlite3.Row:
        """
        Ingest a local file into content-addressed media storage and record in database.

        If asset with identical SHA-256 already exists, reuses it without duplicating storage.
        """
        src = Path(source_path).resolve()
        if not src.is_file():
            raise MediaStorageError(f"Source media file not found: {src}")

        ext = src.suffix.lower()
        if ext and not ext.startswith("."):
            ext = f".{ext}"

        # 1. Stream into temporary file and compute SHA-256
        temp_file = self._tmp_dir / f"ingest_{uuid.uuid4().hex}.tmp"
        hasher = hashlib.sha256()
        total_bytes = 0

        try:
            with open(src, "rb") as s_in, open(temp_file, "wb") as t_out:
                while chunk := s_in.read(65536):
                    hasher.update(chunk)
                    t_out.write(chunk)
                    total_bytes += len(chunk)

                t_out.flush()
                os.fsync(t_out.fileno())

            sha = hasher.hexdigest()

            # 2. Compute content-addressed relative & destination path
            prefix = sha[:2]
            dest_dir = self._media_dir / prefix
            dest_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{sha}{ext}"
            final_dest = dest_dir / filename
            self._validate_path_contained(final_dest)
            rel_path = f"{prefix}/{filename}"

            # 3. Atomically move if not already present
            if final_dest.exists():
                # Already present on disk
                temp_file.unlink(missing_ok=True)
            else:
                os.replace(temp_file, final_dest)

            # 4. Upsert/Record in database
            cursor = conn.execute("SELECT * FROM asset WHERE sha256 = ?;", (sha,))
            existing = cursor.fetchone()
            if existing:
                if existing["status"] == "missing":
                    conn.execute("UPDATE asset SET status = 'present' WHERE id = ?;", (existing["id"],))
                    cursor = conn.execute("SELECT * FROM asset WHERE id = ?;", (existing["id"],))
                    return cursor.fetchone()
                return existing

            conn.execute(
                """
                INSERT INTO asset (
                    sha256, kind, mime_type, byte_size, relative_path,
                    duration_ms, pixel_width, pixel_height, original_url, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present');
                """,
                (sha, kind, mime_type, total_bytes, rel_path, duration_ms, pixel_width, pixel_height, original_url),
            )
            return conn.execute("SELECT * FROM asset WHERE sha256 = ?;", (sha,)).fetchone()
        finally:
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass

    def register_bytes(
        self,
        data: bytes,
        extension: str,
        kind: str,
        mime_type: str,
        conn: sqlite3.Connection,
        duration_ms: int | None = None,
        pixel_width: int | None = None,
        pixel_height: int | None = None,
        original_url: str | None = None,
    ) -> sqlite3.Row:
        """
        Ingest in-memory bytes into content-addressed media storage and record in database.

        If asset with identical SHA-256 already exists, reuses it without duplicating storage.
        """
        if not data:
            raise MediaStorageError("Cannot register empty bytes as media asset.")

        ext = extension.lower()
        if ext and not ext.startswith("."):
            ext = f".{ext}"

        temp_file = self._tmp_dir / f"ingest_{uuid.uuid4().hex}.tmp"
        try:
            with open(temp_file, "wb") as t_out:
                t_out.write(data)
                t_out.flush()
                os.fsync(t_out.fileno())

            sha = hashlib.sha256(data).hexdigest()
            total_bytes = len(data)

            prefix = sha[:2]
            dest_dir = self._media_dir / prefix
            dest_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{sha}{ext}"
            final_dest = dest_dir / filename
            self._validate_path_contained(final_dest)
            rel_path = f"{prefix}/{filename}"

            if final_dest.exists():
                temp_file.unlink(missing_ok=True)
            else:
                os.replace(temp_file, final_dest)

            cursor = conn.execute("SELECT * FROM asset WHERE sha256 = ?;", (sha,))
            existing = cursor.fetchone()
            if existing:
                if existing["status"] == "missing":
                    conn.execute("UPDATE asset SET status = 'present' WHERE id = ?;", (existing["id"],))
                    cursor = conn.execute("SELECT * FROM asset WHERE id = ?;", (existing["id"],))
                    return cursor.fetchone()
                return existing

            conn.execute(
                """
                INSERT INTO asset (
                    sha256, kind, mime_type, byte_size, relative_path,
                    duration_ms, pixel_width, pixel_height, original_url, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present');
                """,
                (sha, kind, mime_type, total_bytes, rel_path, duration_ms, pixel_width, pixel_height, original_url),
            )
            return conn.execute("SELECT * FROM asset WHERE sha256 = ?;", (sha,)).fetchone()
        finally:
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass

    def get_asset_file_path(self, relative_path: str) -> Path:
        """Resolve an asset's relative path to an absolute path, verifying confinement."""
        if relative_path.startswith("/") or relative_path.startswith("\\") or ".." in relative_path:
            raise PathTraversalError(f"Invalid relative path: {relative_path}")
        target = self._media_dir / relative_path
        return self._validate_path_contained(target)

    def verify_asset(self, sha256_hash: str, conn: sqlite3.Connection) -> bool:
        """Verify that an asset exists on disk and its content matches its SHA-256 hash."""
        row = conn.execute("SELECT relative_path FROM asset WHERE sha256 = ?;", (sha256_hash,)).fetchone()
        if not row:
            return False

        try:
            full_path = self.get_asset_file_path(row["relative_path"])
        except PathTraversalError:
            return False

        if not full_path.is_file():
            return False

        hasher = hashlib.sha256()
        with open(full_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)

        return hasher.hexdigest() == sha256_hash

    def reconcile_assets(self, conn: sqlite3.Connection) -> dict[str, int]:
        """
        Reconcile the database asset status ('present' vs 'missing') against disk existence.

        Returns statistics dict: {'checked': int, 'marked_present': int, 'marked_missing': int}.
        """
        cursor = conn.execute("SELECT id, sha256, relative_path, status FROM asset;")
        rows = cursor.fetchall()
        checked = len(rows)
        marked_present = 0
        marked_missing = 0

        for row in rows:
            exists = False
            try:
                p = self.get_asset_file_path(row["relative_path"])
                exists = p.is_file()
            except PathTraversalError:
                exists = False

            current_status = row["status"]
            if exists and current_status == "missing":
                conn.execute("UPDATE asset SET status = 'present' WHERE id = ?;", (row["id"],))
                marked_present += 1
            elif not exists and current_status == "present":
                conn.execute("UPDATE asset SET status = 'missing' WHERE id = ?;", (row["id"],))
                marked_missing += 1

        return {
            "checked": checked,
            "marked_present": marked_present,
            "marked_missing": marked_missing,
        }

