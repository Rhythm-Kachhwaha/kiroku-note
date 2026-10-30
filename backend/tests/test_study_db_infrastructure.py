"""
Targeted tests for Study Database Infrastructure.
-------------------------------------------------
Covers:
- Paths and environment overrides (KIROKU_STUDY_DIR)
- Connection manager, WAL mode validation, foreign keys, pragmas
- Explicit transactions (read, write_tx), rollback on exception, commit on success
- Migration runner: bootstrap, forward-only execution, checksum verification
- Checksum tampering detection and newer user_version rejection
- Upgrade from older-version fixture with pre-migration backup
- Failure injection leaves migration and user_version unchanged
- WAL-safe backup creation, integrity check, retention (5 backups, never delete only backup)
- Restore round-trip with live db/wal/shm move-aside and verification
- Foreign key enforcement and ON DELETE RESTRICT behavior
"""
from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import pytest

from app.config import (
    get_study_backups_dir,
    get_study_db_path,
    get_study_dir,
    get_study_media_dir,
)
from app.study.backup import (
    BackupError,
    RestoreError,
    create_study_backup,
    list_backups,
    restore_study_backup,
)
from app.study.connection import (
    StudyDatabaseError,
    StudyDatabaseManager,
    get_study_db_manager,
    reset_study_db_manager,
)
from app.study.migrations.runner import (
    MigrationChecksumError,
    MigrationExecutionError,
    MigrationVersionError,
    discover_migrations,
    get_current_user_version,
    run_migrations,
)


@pytest.fixture
def study_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate study environment to a temporary directory."""
    study_dir = tmp_path / "study_root"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()
    yield study_dir
    reset_study_db_manager()


def test_study_paths_resolution(study_env: Path):
    """Test that study path helpers respect KIROKU_STUDY_DIR override."""
    assert get_study_dir() == study_env
    assert get_study_db_path() == study_env / "study.db"
    assert get_study_media_dir() == study_env / "media"
    assert get_study_backups_dir() == study_env / "backups"


def test_connection_manager_pragmas_and_wal(study_env: Path):
    """Test that manager configures WAL mode, foreign keys, and busy timeout."""
    manager = StudyDatabaseManager(study_env / "test_pragmas.db")
    conn = manager.get_connection()
    try:
        # Foreign keys check
        fk = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
        assert fk == 1

        # Journal mode check
        jm = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert jm.lower() == "wal"

        # Busy timeout check
        bt = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert bt == 10000

        # Recursive triggers
        rt = conn.execute("PRAGMA recursive_triggers;").fetchone()[0]
        assert rt == 1
    finally:
        conn.close()


def test_write_tx_commit_and_rollback(study_env: Path):
    """Test write_tx explicit transaction committing on success and rolling back on failure."""
    db_file = study_env / "tx_test.db"
    manager = StudyDatabaseManager(db_file)

    # Setup a simple table
    conn = manager.get_connection()
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT);")
    conn.close()

    # Success commit
    with manager.write_tx() as tx_conn:
        tx_conn.execute("INSERT INTO items (id, val) VALUES (1, 'alpha');")

    with manager.read() as r_conn:
        row = r_conn.execute("SELECT val FROM items WHERE id = 1;").fetchone()
        assert row["val"] == "alpha"

    # Rollback on exception
    with pytest.raises(ValueError, match="intentional abort"):
        with manager.write_tx() as tx_conn:
            tx_conn.execute("INSERT INTO items (id, val) VALUES (2, 'beta');")
            raise ValueError("intentional abort")

    # Value 2 must not exist
    with manager.read() as r_conn:
        row = r_conn.execute("SELECT val FROM items WHERE id = 2;").fetchone()
        assert row is None


def test_fresh_migrations_and_ledger(study_env: Path):
    """Test running migrations on a fresh database creates ledger and sets user_version."""
    db_file = study_env / "migration_fresh.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()

    try:
        applied = run_migrations(conn)
        assert applied == 3
        assert get_current_user_version(conn) == 3

        # Verify ledger records
        rows = conn.execute("SELECT version, name, checksum, applied_at FROM schema_migration ORDER BY version ASC;").fetchall()
        assert len(rows) == 3
        assert rows[0]["version"] == 1
        assert rows[0]["name"] == "0001_initial.sql"
        assert rows[1]["version"] == 2
        assert rows[1]["name"] == "0002_seed_formats_and_exams.sql"
        assert rows[2]["version"] == 3
        assert rows[2]["name"] == "0003_ai_verification.sql"

        # Re-running migrations is an idempotent no-op
        applied_again = run_migrations(conn)
        assert applied_again == 0
    finally:
        conn.close()


def test_checksum_tampering_detection(study_env: Path, tmp_path: Path):
    """Test that altering an already-applied migration file triggers MigrationChecksumError."""
    # Create a custom migrations folder
    custom_mig_dir = tmp_path / "custom_migrations"
    custom_mig_dir.mkdir()
    mig1 = custom_mig_dir / "0001_test.sql"
    mig1.write_text("CREATE TABLE alpha (id INT);", encoding="utf-8")

    db_file = study_env / "tamper_test.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()

    try:
        run_migrations(conn, migrations_dir=custom_mig_dir)
        assert get_current_user_version(conn) == 1

        # Tamper with file content
        mig1.write_text("CREATE TABLE alpha (id INT, tampered INT);", encoding="utf-8")

        with pytest.raises(MigrationChecksumError, match="checksum mismatch"):
            run_migrations(conn, migrations_dir=custom_mig_dir)
    finally:
        conn.close()


def test_newer_user_version_rejection(study_env: Path, tmp_path: Path):
    """Test that a database with a future user_version is rejected."""
    custom_mig_dir = tmp_path / "custom_migrations"
    custom_mig_dir.mkdir()
    (custom_mig_dir / "0001_test.sql").write_text("CREATE TABLE a (id INT);", encoding="utf-8")

    db_file = study_env / "future_version.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()

    try:
        run_migrations(conn, migrations_dir=custom_mig_dir)
        # Artificially set user_version higher than supported migrations
        conn.execute("PRAGMA user_version = 99;")

        with pytest.raises(MigrationVersionError, match="newer than latest supported"):
            run_migrations(conn, migrations_dir=custom_mig_dir)
    finally:
        conn.close()


def test_migration_failure_leaves_db_unchanged(study_env: Path, tmp_path: Path):
    """Test that a syntax/runtime error in a migration rolls back and preserves previous version."""
    custom_mig_dir = tmp_path / "failing_migrations"
    custom_mig_dir.mkdir()
    (custom_mig_dir / "0001_ok.sql").write_text("CREATE TABLE ok_table (id INT);", encoding="utf-8")
    (custom_mig_dir / "0002_fail.sql").write_text(
        "CREATE TABLE partial (id INT);\nINVALID SQL SYNTAX HERE;",
        encoding="utf-8",
    )

    db_file = study_env / "failure_injection.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()

    try:
        applied = run_migrations(conn, migrations_dir=custom_mig_dir)
    except MigrationExecutionError:
        pass

    try:
        # Migration 1 succeeded, Migration 2 failed and rolled back
        assert get_current_user_version(conn) == 1
        # Table from migration 2 must not exist
        res = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='partial';").fetchone()
        assert res is None
    finally:
        conn.close()


def test_upgrade_creates_pre_migration_backup(study_env: Path, tmp_path: Path):
    """Test that upgrading an existing database (user_version > 0) creates a verified backup."""
    custom_mig_dir = tmp_path / "incremental_migrations"
    custom_mig_dir.mkdir()
    (custom_mig_dir / "0001_initial.sql").write_text("CREATE TABLE t1 (id INT);", encoding="utf-8")

    db_file = study_env / "upgrade_test.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    backups_dir = study_env / "backups"

    try:
        # Version 1 (fresh db -> no backup required)
        run_migrations(conn, migrations_dir=custom_mig_dir, backups_dir=backups_dir)
        assert len(list_backups(backups_dir)) == 0

        # Add migration 2
        (custom_mig_dir / "0002_add_t2.sql").write_text("CREATE TABLE t2 (id INT);", encoding="utf-8")

        # Upgrade from v1 to v2 -> backup MUST be created before applying v2
        run_migrations(conn, migrations_dir=custom_mig_dir, backups_dir=backups_dir)
        assert get_current_user_version(conn) == 2

        backups = list_backups(backups_dir)
        assert len(backups) == 1
        assert "study-v1-to-v2-" in backups[0].name
    finally:
        conn.close()


def test_backup_retention_and_protection_of_only_backup(study_env: Path):
    """Test that retention keeps 5 backups and never deletes the only backup."""
    db_file = study_env / "retention_test.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    conn.execute("CREATE TABLE test_data (id INT);")

    backups_dir = study_env / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    # 1. Single backup created: must not be deleted
    p1 = create_study_backup(conn, from_version=1, to_version=2, backups_dir=backups_dir)
    assert p1.exists()
    assert len(list_backups(backups_dir)) == 1

    # 2. Create 6 more backups
    created: list[Path] = [p1]
    for i in range(2, 8):
        p = create_study_backup(conn, from_version=i, to_version=i+1, backups_dir=backups_dir)
        created.append(p)

    current_backups = list_backups(backups_dir)
    assert len(current_backups) == 5
    # The oldest backup should have been pruned
    assert not p1.exists()
    conn.close()


def test_restore_roundtrip_with_move_aside(study_env: Path):
    """Test restoring a backup file safely moves aside live files and verifies integrity."""
    db_file = study_env / "restore_test.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    run_migrations(conn)

    # Insert test row
    conn.execute(
        "INSERT INTO source (name, source_type) VALUES ('Original Source', 'official_sample');"
    )

    # Backup the original state
    backup_file = create_study_backup(conn, from_version=2, to_version=2, backups_dir=study_env / "backups")

    # Modify live DB
    conn.execute(
        "INSERT INTO source (name, source_type) VALUES ('Modified In Live', 'user_capture');"
    )
    manager.close_all()

    # Restore from backup
    restore_study_backup(backup_path=backup_file, db_path=db_file, manager=manager)

    # Verify restored state
    new_conn = manager.get_connection()
    try:
        rows = new_conn.execute("SELECT name FROM source;").fetchall()
        names = [r["name"] for r in rows]
        assert "Original Source" in names
        assert "Modified In Live" not in names
    finally:
        new_conn.close()


def test_foreign_key_restrict_behavior(study_env: Path):
    """Test that ON DELETE RESTRICT prevents deleting referenced parent records."""
    db_file = study_env / "fk_restrict.db"
    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    run_migrations(conn)

    try:
        # Insert a source
        cursor = conn.execute("INSERT INTO source (name, source_type) VALUES ('S1', 'official');")
        s_id = cursor.lastrowid

        # Insert an import batch referencing source
        conn.execute("INSERT INTO import_batch (source_id, adapter_name) VALUES (?, 'json');", (s_id,))

        # Attempting to delete source must be blocked by ON DELETE RESTRICT
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
            conn.execute("DELETE FROM source WHERE id = ?;", (s_id,))
    finally:
        conn.close()

