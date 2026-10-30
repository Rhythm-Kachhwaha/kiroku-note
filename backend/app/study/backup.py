"""
WAL-Safe Database Backup and Restoration Service.
------------------------------------------------
Provides atomic, verified SQLite backups and rollback-safe restoration for `study.db`.

Contracts:
- Uses SQLite's online backup API (`conn.backup()`)
- Creates temporary file in `backups/` and verifies `PRAGMA integrity_check` before publishing
- Atomically renames to `study-vFROM-to-vTO-<UTC timestamp>.db`
- Retains the 5 most recent verified backups; never deletes the only verified backup
- Restore requires all connections closed, moves aside live db & -wal/-shm, restores, verifies integrity
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sqlite3
import time
import uuid

from app.config import get_study_backups_dir, get_study_db_path


class BackupError(Exception):
    """Raised when backup creation or verification fails."""
    pass


class RestoreError(Exception):
    """Raised when backup restoration fails."""
    pass


def create_study_backup(
    source_conn: sqlite3.Connection,
    from_version: int,
    to_version: int,
    backups_dir: Path | str | None = None,
) -> Path:
    """
    Produce a verified WAL-safe backup of the study database.

    Returns the path to the verified backup file.
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

        # Apply retention policy
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


def _enforce_retention_policy(backups_dir: Path) -> None:
    """
    Retain the 5 most recent verified backups.

    Guarantees that the only verified backup is never deleted.
    """
    candidates = list(backups_dir.glob("study-v*-to-v*.db"))
    if len(candidates) <= 1:
        # Never delete the only backup
        return

    # Sort by modification time ascending (oldest first)
    candidates.sort(key=lambda p: (p.stat().st_mtime, p.name))

    # Keep at least 5
    while len(candidates) > 5:
        oldest = candidates.pop(0)
        try:
            oldest.unlink()
        except Exception:
            pass


def list_backups(backups_dir: Path | str | None = None) -> list[Path]:
    """Return all verified backups in chronological order (newest first)."""
    target_dir = Path(backups_dir) if backups_dir is not None else get_study_backups_dir()
    if not target_dir.exists():
        return []
    backups = list(target_dir.glob("study-v*-to-v*.db"))
    backups.sort(key=lambda p: (p.stat().st_mtime, p.name), reverse=True)
    return backups


def restore_study_backup(
    backup_path: Path | str,
    db_path: Path | str | None = None,
    manager: Any = None,
) -> None:
    """
    Restore a verified backup file into the target study database location.

    Safety procedure:
    1. Validates backup file existence and verifies its PRAGMA integrity_check.
    2. Closes all connections to the database.
    3. Moves aside live database and its -wal and -shm files.
    4. Copies backup into place.
    5. Verifies integrity of the restored database.
    6. If verification fails, rolls back the moved-aside files.
    """
    backup_file = Path(backup_path).resolve()
    if not backup_file.is_file():
        raise RestoreError(f"Backup file not found: {backup_file}")

    # Step 1: Pre-verify backup integrity
    try:
        test_conn = sqlite3.connect(str(backup_file))
        res = [r[0] for r in test_conn.execute("PRAGMA integrity_check;").fetchall()]
        test_conn.close()
        if res != ["ok"]:
            raise RestoreError(f"Target backup file {backup_file.name} is corrupt: {res}")
    except Exception as e:
        raise RestoreError(f"Integrity check on backup failed before restore: {e}") from e

    # Step 2: Close all connections
    if manager is not None:
        manager.close_all()
    else:
        from app.study.connection import get_study_db_manager
        get_study_db_manager().close_all()

    target_db = Path(db_path).resolve() if db_path is not None else get_study_db_path().resolve()
    target_wal = target_db.with_name(target_db.name + "-wal")
    target_shm = target_db.with_name(target_db.name + "-shm")

    # Step 3: Move aside existing files safely
    aside_dir = target_db.parent / f"_restore_moved_aside_{int(time.time() * 1000)}"
    aside_dir.mkdir(parents=True, exist_ok=True)
    moved_files: list[tuple[Path, Path]] = []

    try:
        for f in (target_db, target_wal, target_shm):
            if f.exists():
                dest = aside_dir / f.name
                shutil.move(str(f), str(dest))
                moved_files.append((dest, f))

        # Step 4: Copy backup into live location
        shutil.copy2(str(backup_file), str(target_db))

        # Step 5: Verify restored file integrity
        verify_conn = sqlite3.connect(str(target_db))
        v_res = [r[0] for r in verify_conn.execute("PRAGMA integrity_check;").fetchall()]
        verify_conn.close()

        if v_res != ["ok"]:
            raise RestoreError(f"Restored database failed integrity check: {v_res}")

        # Succeeded: clean up moved aside directory
        shutil.rmtree(str(aside_dir), ignore_errors=True)
    except Exception as exc:
        # Rollback moved-aside files
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

