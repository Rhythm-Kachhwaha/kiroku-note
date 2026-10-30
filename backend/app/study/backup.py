"""
WAL-Safe Database and Media Backup and Restoration Service.
-----------------------------------------------------------
Provides atomic, verified SQLite backups, content-addressed media packaging,
and rollback-safe restoration for `study.db` and associated media assets.

Contracts:
- Uses SQLite's online backup API (`conn.backup()`)
- Bundles SQLite database + all referenced media assets + manifest + metadata into atomic zip archive
- Manifest contains relative path, byte size, and SHA-256 for all assets
- Metadata tracks format version, creation timestamp, schema version, and asset count
- Full pre-restoration validation: detects missing, corrupted, or unexpected media files and db corruption
- Rollback-safe restoration: moves aside live database and media before extraction, restoring on failure
- Retains 5 most recent verified backups; never deletes the only backup
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import time
from typing import Any, Dict, List, Optional
import uuid
import zipfile

from app.config import get_study_backups_dir, get_study_db_path, get_study_media_dir


BACKUP_FORMAT_VERSION = "1.0"


class BackupError(Exception):
    """Raised when backup creation or verification fails."""
    pass


class RestoreError(Exception):
    """Raised when backup restoration fails."""
    pass


def _sha256_of_file(path: Path) -> str:
    """Compute the SHA-256 hex digest of a local file."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def _enforce_retention_policy(backups_dir: Path) -> None:
    """
    Retain the 5 most recent verified backups (database and bundle archives).

    Guarantees that the only verified backup is never deleted.
    """
    db_candidates = list(backups_dir.glob("study-v*-to-v*.db"))
    bundle_candidates = list(backups_dir.glob("study-bundle-v*.zip"))
    all_candidates = db_candidates + bundle_candidates

    if len(all_candidates) <= 1:
        return

    # Sort by modification time ascending (oldest first)
    all_candidates.sort(key=lambda p: (p.stat().st_mtime, p.name))

    # Keep at least 5
    while len(all_candidates) > 5:
        oldest = all_candidates.pop(0)
        try:
            oldest.unlink()
        except Exception:
            pass


def list_backups(backups_dir: Path | str | None = None) -> list[Path]:
    """Return all verified backups (standalone and bundles) in chronological order (newest first)."""
    target_dir = Path(backups_dir) if backups_dir is not None else get_study_backups_dir()
    if not target_dir.exists():
        return []
    backups = list(target_dir.glob("study-v*-to-v*.db")) + list(target_dir.glob("study-bundle-v*.zip"))
    backups.sort(key=lambda p: (p.stat().st_mtime, p.name), reverse=True)
    return backups


def create_study_backup(
    source_conn: sqlite3.Connection,
    from_version: int,
    to_version: int,
    backups_dir: Path | str | None = None,
) -> Path:
    """
    Produce a verified WAL-safe standalone SQLite backup of the study database.

    Retained for lightweight pre-migration snapshots and backwards compatibility.
    """
    target_dir = Path(backups_dir) if backups_dir is not None else get_study_backups_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    temp_name = f"_tmp_backup_{uuid.uuid4().hex}.db"
    temp_path = target_dir / temp_name

    try:
        dest_conn = sqlite3.connect(str(temp_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()

        # Run PRAGMA integrity_check on the backup
        check_conn = sqlite3.connect(str(temp_path))
        try:
            rows = check_conn.execute("PRAGMA integrity_check;").fetchall()
            results = [r[0] for r in rows]
            if results != ["ok"]:
                raise BackupError(f"Backup failed integrity check: {results}")
        finally:
            check_conn.close()

        # Atomically rename to timestamped pattern
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        final_name = f"study-v{from_version}-to-v{to_version}-{timestamp}.db"
        final_path = target_dir / final_name
        os.replace(temp_path, final_path)

        _enforce_retention_policy(target_dir)
        return final_path
    except Exception as exc:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass
        if isinstance(exc, BackupError):
            raise
        raise BackupError(f"Failed to create study backup: {exc}") from exc


def create_study_bundle_backup(
    source_conn: sqlite3.Connection,
    media_store: Any = None,
    backups_dir: Path | str | None = None,
) -> Path:
    """
    Produce a verified, coordinated database + media archive bundle.

    Includes:
    - Consistent SQLite database backup using online backup API (`conn.backup()`)
    - All media assets required by the backed-up database (marked present)
    - `media_manifest.json` containing relative path, size, and SHA-256 for each asset
    - `backup_metadata.json` tracking format version, creation timestamp, schema version, asset count
    - Atomic zip archive publishing with retention enforcement
    """
    from app.study.media import MediaStore
    from app.study.migrations.runner import get_current_user_version

    target_dir = Path(backups_dir) if backups_dir is not None else get_study_backups_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    store: MediaStore = media_store if media_store is not None else MediaStore()
    schema_version = get_current_user_version(source_conn)

    staging_dir = target_dir / f"_tmp_bundle_stage_{uuid.uuid4().hex}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staged_db = staging_dir / "study.db"
    staged_media_dir = staging_dir / "media"
    staged_media_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Consistent SQLite online backup
        dest_conn = sqlite3.connect(str(staged_db))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()

        # Verify staged database integrity
        check_conn = sqlite3.connect(str(staged_db))
        try:
            chk_rows = check_conn.execute("PRAGMA integrity_check;").fetchall()
            chk_res = [r[0] for r in chk_rows]
            if chk_res != ["ok"]:
                raise BackupError(f"Database backup failed integrity check: {chk_res}")
        finally:
            check_conn.close()

        # 2. Collect and verify required media assets from database
        cursor = source_conn.execute(
            """
            SELECT id, sha256, relative_path, byte_size, kind, mime_type
            FROM asset
            WHERE status = 'present'
            ORDER BY id ASC;
            """
        )
        asset_rows = cursor.fetchall()
        manifest_assets: List[Dict[str, Any]] = []

        for row in asset_rows:
            rel_path = row["relative_path"]
            expected_sha = row["sha256"]
            expected_size = row["byte_size"]

            try:
                local_asset_path = store.get_asset_file_path(rel_path)
            except Exception as e:
                raise BackupError(f"Path traversal or invalid path in asset {rel_path}: {e}") from e

            if not local_asset_path.is_file():
                raise BackupError(f"Required media asset is missing on disk: {rel_path} (sha={expected_sha})")

            actual_size = local_asset_path.stat().st_size
            actual_sha = _sha256_of_file(local_asset_path)

            if actual_size != expected_size:
                raise BackupError(
                    f"Corrupt media asset size for {rel_path}: expected {expected_size}, found {actual_size}"
                )
            if actual_sha != expected_sha:
                raise BackupError(
                    f"Corrupt media asset hash for {rel_path}: expected {expected_sha}, found {actual_sha}"
                )

            # Copy to staging media directory preserving relative path
            dest_path = staged_media_dir / rel_path
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(local_asset_path), str(dest_path))

            manifest_assets.append({
                "id": row["id"],
                "relative_path": rel_path,
                "sha256": expected_sha,
                "byte_size": expected_size,
                "kind": row["kind"],
                "mime_type": row["mime_type"],
            })

        # 3. Create media manifest
        manifest_data = {
            "format_version": BACKUP_FORMAT_VERSION,
            "asset_count": len(manifest_assets),
            "assets": manifest_assets,
        }
        manifest_file = staging_dir / "media_manifest.json"
        manifest_file.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

        # 4. Create backup metadata
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        created_at_iso = datetime.now(timezone.utc).isoformat()
        metadata = {
            "format_version": BACKUP_FORMAT_VERSION,
            "created_at": created_at_iso,
            "database_schema_version": schema_version,
            "asset_count": len(manifest_assets),
            "database_file": "study.db",
            "manifest_file": "media_manifest.json",
        }
        metadata_file = staging_dir / "backup_metadata.json"
        metadata_file.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        # 5. Pack atomic zip archive
        temp_zip = target_dir / f"_tmp_bundle_{uuid.uuid4().hex}.zip"
        with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(metadata_file, "backup_metadata.json")
            zf.write(manifest_file, "media_manifest.json")
            zf.write(staged_db, "study.db")

            for asset_item in manifest_assets:
                rel = asset_item["relative_path"]
                file_on_disk = staged_media_dir / rel
                zf.write(file_on_disk, f"media/{rel}")

        unique_suffix = uuid.uuid4().hex[:6]
        final_name = f"study-bundle-v{schema_version}-{timestamp_str}-{unique_suffix}.zip"
        final_path = target_dir / final_name
        os.replace(temp_zip, final_path)

        _enforce_retention_policy(target_dir)
        return final_path
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def validate_study_bundle_backup(bundle_path: Path | str) -> Dict[str, Any]:
    """
    Validate a backup bundle archive before restoration.

    Verifies:
    1. Valid zip archive with required metadata, manifest, and database.
    2. Format version compatibility.
    3. Media manifest count matches asset list.
    4. All referenced media assets exist within archive with exact size and SHA-256 match.
    5. No unexpected or unmanifested files reside in the media archive folder.
    6. Database passes SQLite `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.

    Raises RestoreError on any validation violation.
    Returns parsed metadata dict on success.
    """
    bundle_file = Path(bundle_path).resolve()
    if not bundle_file.is_file():
        raise RestoreError(f"Backup bundle not found: {bundle_file}")

    if not zipfile.is_zipfile(bundle_file):
        raise RestoreError(f"File is not a valid zip archive: {bundle_file.name}")

    with zipfile.ZipFile(bundle_file, "r") as zf:
        namelist = set(zf.namelist())

        for name in namelist:
            if name.startswith("/") or name.startswith("\\") or ".." in name:
                raise RestoreError(f"Archive entry attempts path traversal: {name}")

        if "backup_metadata.json" not in namelist:
            raise RestoreError("Backup bundle is missing backup_metadata.json")
        if "media_manifest.json" not in namelist:
            raise RestoreError("Backup bundle is missing media_manifest.json")
        if "study.db" not in namelist:
            raise RestoreError("Backup bundle is missing study.db")

        # Parse and validate metadata
        try:
            metadata = json.loads(zf.read("backup_metadata.json").decode("utf-8"))
        except Exception as e:
            raise RestoreError(f"Failed to parse backup_metadata.json: {e}") from e

        if metadata.get("format_version") != BACKUP_FORMAT_VERSION:
            raise RestoreError(
                f"Unsupported backup format version '{metadata.get('format_version')}', expected '{BACKUP_FORMAT_VERSION}'"
            )

        # Parse and validate media manifest
        try:
            manifest = json.loads(zf.read("media_manifest.json").decode("utf-8"))
        except Exception as e:
            raise RestoreError(f"Failed to parse media_manifest.json: {e}") from e

        assets = manifest.get("assets", [])
        if not isinstance(assets, list):
            raise RestoreError("Media manifest assets must be a list")

        if manifest.get("asset_count") != len(assets):
            raise RestoreError(
                f"Media manifest asset_count mismatch: declared {manifest.get('asset_count')}, found {len(assets)}"
            )

        expected_media_names = set()
        for a in assets:
            rel = a.get("relative_path")
            if not rel:
                raise RestoreError("Asset entry in manifest missing relative_path")
            expected_zip_entry = f"media/{rel}"
            expected_media_names.add(expected_zip_entry)

            if expected_zip_entry not in namelist:
                raise RestoreError(f"Media asset declared in manifest is missing in archive: {expected_zip_entry}")

            # Verify size and sha256 of media asset in archive
            asset_bytes = zf.read(expected_zip_entry)
            actual_size = len(asset_bytes)
            actual_sha = hashlib.sha256(asset_bytes).hexdigest()

            if actual_size != a.get("byte_size"):
                raise RestoreError(
                    f"Corrupt media asset size for {rel}: declared {a.get('byte_size')}, archive has {actual_size}"
                )
            if actual_sha != a.get("sha256"):
                raise RestoreError(
                    f"Corrupt media asset hash for {rel}: declared {a.get('sha256')}, archive has {actual_sha}"
                )

        # Detect unexpected files under media/ in archive
        actual_media_entries = {n for n in namelist if n.startswith("media/") and not n.endswith("/")}
        unexpected_files = actual_media_entries - expected_media_names
        if unexpected_files:
            raise RestoreError(f"Backup archive contains unmanifested unexpected media files: {sorted(unexpected_files)}")

        # Validate database integrity inside archive
        tmp_val_dir = bundle_file.parent / f"_tmp_val_{uuid.uuid4().hex}"
        tmp_val_dir.mkdir(parents=True, exist_ok=True)
        tmp_db = tmp_val_dir / "val_study.db"
        try:
            with open(tmp_db, "wb") as f_out:
                f_out.write(zf.read("study.db"))

            val_conn = sqlite3.connect(str(tmp_db))
            try:
                res = [r[0] for r in val_conn.execute("PRAGMA integrity_check;").fetchall()]
                if res != ["ok"]:
                    raise RestoreError(f"Database in backup bundle failed integrity check: {res}")
                fk_violations = val_conn.execute("PRAGMA foreign_key_check;").fetchall()
                if fk_violations:
                    raise RestoreError(f"Database in backup bundle has foreign key violations: {fk_violations}")
            finally:
                val_conn.close()
        except sqlite3.Error as exc:
            raise RestoreError(f"Database in backup bundle is corrupted or unreadable: {exc}") from exc
        finally:
            shutil.rmtree(tmp_val_dir, ignore_errors=True)

    return {
        "valid": True,
        "metadata": metadata,
        "manifest": manifest,
        "asset_count": len(assets),
    }


def restore_study_bundle_backup(
    bundle_path: Path | str,
    target_db_path: Path | str | None = None,
    target_media_dir: Path | str | None = None,
    manager: Any = None,
) -> None:
    """
    Restore a verified database and media backup bundle with rollback safety.

    Safety procedure:
    1. Validates entire backup bundle integrity before modifying any existing data.
    2. Closes all connections to the database.
    3. Moves aside live database (-wal, -shm) and live media directory to a temporary rollback folder.
    4. Extracts restored database and media assets into target locations.
    5. Verifies restored database integrity and media file existence.
    6. If any step fails, automatically rolls back moved-aside data and cleans up staging.
    7. On complete success, cleans up the rollback folder.
    """
    bundle_file = Path(bundle_path).resolve()
    val_info = validate_study_bundle_backup(bundle_file)
    manifest = val_info["manifest"]

    # Close active connections
    if manager is not None:
        manager.close_all()
    else:
        from app.study.connection import get_study_db_manager
        get_study_db_manager().close_all()

    target_db = Path(target_db_path).resolve() if target_db_path is not None else get_study_db_path().resolve()
    target_media = Path(target_media_dir).resolve() if target_media_dir is not None else get_study_media_dir().resolve()

    target_wal = target_db.with_name(target_db.name + "-wal")
    target_shm = target_db.with_name(target_db.name + "-shm")

    # Staging rollback aside folder
    aside_dir = target_db.parent / f"_restore_bundle_aside_{uuid.uuid4().hex}"
    aside_dir.mkdir(parents=True, exist_ok=True)
    aside_db_dir = aside_dir / "db"
    aside_db_dir.mkdir(parents=True, exist_ok=True)
    aside_media_dir = aside_dir / "media"

    moved_db_files: list[tuple[Path, Path]] = []
    media_moved_aside = False

    try:
        # Move aside existing db files
        for f in (target_db, target_wal, target_shm):
            if f.exists():
                dst = aside_db_dir / f.name
                shutil.move(str(f), str(dst))
                moved_db_files.append((dst, f))

        # Move aside existing media directory
        if target_media.exists():
            shutil.move(str(target_media), str(aside_media_dir))
            media_moved_aside = True

        # Extract restored assets into live locations
        target_db.parent.mkdir(parents=True, exist_ok=True)
        target_media.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(bundle_file, "r") as zf:
            # Extract database
            with open(target_db, "wb") as f_db:
                f_db.write(zf.read("study.db"))

            # Extract media files
            for a in manifest.get("assets", []):
                rel = a["relative_path"]
                zip_entry = f"media/{rel}"
                dest_file = target_media / rel
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                with open(dest_file, "wb") as f_m:
                    f_m.write(zf.read(zip_entry))

        # Verify restored database integrity
        verify_conn = sqlite3.connect(str(target_db))
        try:
            v_res = [r[0] for r in verify_conn.execute("PRAGMA integrity_check;").fetchall()]
            if v_res != ["ok"]:
                raise RestoreError(f"Restored database failed integrity check: {v_res}")
        finally:
            verify_conn.close()

        # Success: delete rollback aside directory
        shutil.rmtree(aside_dir, ignore_errors=True)
    except Exception as exc:
        # Rollback moved-aside files
        if target_db.exists():
            try:
                target_db.unlink()
            except Exception:
                pass
        for f in (target_wal, target_shm):
            if f.exists():
                try:
                    f.unlink()
                except Exception:
                    pass

        if target_media.exists():
            shutil.rmtree(target_media, ignore_errors=True)

        for src, original_dst in moved_db_files:
            if src.exists():
                try:
                    shutil.move(str(src), str(original_dst))
                except Exception:
                    pass

        if media_moved_aside and aside_media_dir.exists():
            try:
                shutil.move(str(aside_media_dir), str(target_media))
            except Exception:
                pass

        shutil.rmtree(aside_dir, ignore_errors=True)
        if isinstance(exc, RestoreError):
            raise
        raise RestoreError(f"Failed to restore backup bundle: {exc}") from exc


def restore_study_backup(
    backup_path: Path | str,
    db_path: Path | str | None = None,
    manager: Any = None,
) -> None:
    """
    Restore a verified backup file into the target study database location.

    Supports both bundle zip archives (`.zip`) and standalone `.db` backups.
    """
    backup_file = Path(backup_path).resolve()
    if not backup_file.is_file():
        raise RestoreError(f"Backup file not found: {backup_file}")

    if zipfile.is_zipfile(backup_file):
        restore_study_bundle_backup(backup_file, target_db_path=db_path, manager=manager)
        return

    # Standalone SQLite database restoration
    try:
        test_conn = sqlite3.connect(str(backup_file))
        res = [r[0] for r in test_conn.execute("PRAGMA integrity_check;").fetchall()]
        test_conn.close()
        if res != ["ok"]:
            raise RestoreError(f"Target backup file {backup_file.name} is corrupt: {res}")
    except Exception as e:
        raise RestoreError(f"Integrity check on backup failed before restore: {e}") from e

    if manager is not None:
        manager.close_all()
    else:
        from app.study.connection import get_study_db_manager
        get_study_db_manager().close_all()

    target_db = Path(db_path).resolve() if db_path is not None else get_study_db_path().resolve()
    target_wal = target_db.with_name(target_db.name + "-wal")
    target_shm = target_db.with_name(target_db.name + "-shm")

    aside_dir = target_db.parent / f"_restore_moved_aside_{int(time.time() * 1000)}"
    aside_dir.mkdir(parents=True, exist_ok=True)
    moved_files: list[tuple[Path, Path]] = []

    try:
        for f in (target_db, target_wal, target_shm):
            if f.exists():
                dest = aside_dir / f.name
                shutil.move(str(f), str(dest))
                moved_files.append((dest, f))

        shutil.copy2(str(backup_file), str(target_db))

        verify_conn = sqlite3.connect(str(target_db))
        v_res = [r[0] for r in verify_conn.execute("PRAGMA integrity_check;").fetchall()]
        verify_conn.close()

        if v_res != ["ok"]:
            raise RestoreError(f"Restored database failed integrity check: {v_res}")

        shutil.rmtree(str(aside_dir), ignore_errors=True)
    except Exception as exc:
        if target_db.exists():
            try:
                target_db.unlink()
            except Exception:
                pass
        for src, original_dst in moved_files:
            if src.exists():
                try:
                    shutil.move(str(src), str(original_dst))
                except Exception:
                    pass
        shutil.rmtree(str(aside_dir), ignore_errors=True)
        raise RestoreError(f"Failed to restore backup: {exc}") from exc
