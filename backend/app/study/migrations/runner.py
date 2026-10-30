"""
Forward-Only Migration Runner for Kiroku Study Database.
--------------------------------------------------------
Deterministic, transactional migration engine enforcing:
- Forward-only migrations tracked by PRAGMA user_version
- Checksum validation against schema_migration ledger
- Atomic execution of SQL statements via sqlite3.complete_statement (never executescript)
- Hard abort on checksum tampering or newer database user_version
- Automatic verified backup creation prior to upgrading existing databases
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import sqlite3
from typing import NamedTuple

from app.study.backup import create_study_backup


class MigrationError(Exception):
    """Base error for study migration failures."""
    pass


class MigrationChecksumError(MigrationError):
    """Raised when an applied migration file checksum does not match the ledger."""
    pass


class MigrationVersionError(MigrationError):
    """Raised when a database's user_version is newer than latest supported migration."""
    pass


class MigrationExecutionError(MigrationError):
    """Raised when executing a migration statement fails."""
    pass


class MigrationFile(NamedTuple):
    version: int
    name: str
    path: Path
    checksum: str


def get_migrations_dir() -> Path:
    """Return the directory containing SQL migration files."""
    return Path(__file__).resolve().parent


def compute_file_sha256(file_path: Path) -> str:
    """Compute the SHA-256 hex digest of a migration file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def discover_migrations(migrations_dir: Path | None = None) -> list[MigrationFile]:
    """
    Discover all ordered migration files in the migrations directory.

    Files must match the pattern: `NNNN_name.sql` (e.g. `0001_initial.sql`).
    """
    target_dir = migrations_dir or get_migrations_dir()
    pattern = re.compile(r"^(\d{4})_(.+)\.sql$")
    migrations: list[MigrationFile] = []

    for file_path in target_dir.glob("*.sql"):
        match = pattern.match(file_path.name)
        if match:
            version = int(match.group(1))
            name = match.group(2)
            checksum = compute_file_sha256(file_path)
            migrations.append(MigrationFile(version=version, name=file_path.name, path=file_path, checksum=checksum))

    migrations.sort(key=lambda m: m.version)
    return migrations


def split_sql_statements(sql_text: str) -> list[str]:
    """
    Split a SQL script into individual executable statements using sqlite3.complete_statement.

    Guarantees correct handling of triggers, multi-line blocks, and comments without
    calling executescript() which would implicitly commit.
    """
    statements: list[str] = []
    buffer: list[str] = []

    for line in sql_text.splitlines(keepends=True):
        # Ignore comments if buffer is empty
        stripped = line.strip()
        if not buffer and (not stripped or stripped.startswith("--")):
            continue

        buffer.append(line)
        current = "".join(buffer)
        if sqlite3.complete_statement(current):
            statement_clean = current.strip()
            if statement_clean:
                # Remove trailing semicolon if needed or keep standard
                statements.append(statement_clean)
            buffer.clear()

    remaining = "".join(buffer).strip()
    if remaining:
        statements.append(remaining)

    return statements


def ensure_migration_ledger(conn: sqlite3.Connection) -> None:
    """Safely create the schema_migration ledger table if it does not exist."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migration (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        """
    )


def verify_applied_checksums(conn: sqlite3.Connection, available_migrations: list[MigrationFile]) -> None:
    """
    Verify checksums of all previously applied migrations against disk.

    Raises MigrationChecksumError on mismatch.
    """
    ensure_migration_ledger(conn)
    cursor = conn.execute("SELECT version, name, checksum FROM schema_migration ORDER BY version ASC;")
    applied_records = {row["version"]: row for row in cursor.fetchall()}
    available_by_version = {m.version: m for m in available_migrations}

    for version, record in applied_records.items():
        if version not in available_by_version:
            raise MigrationChecksumError(
                f"Migration {version} ('{record['name']}') is recorded in schema_migration but missing from disk."
            )
        disk_migration = available_by_version[version]
        if record["checksum"] != disk_migration.checksum:
            raise MigrationChecksumError(
                f"Migration checksum mismatch for version {version} ({disk_migration.name}): "
                f"database recorded '{record['checksum']}', file on disk has '{disk_migration.checksum}'."
            )


def get_current_user_version(conn: sqlite3.Connection) -> int:
    """Return the database's current PRAGMA user_version."""
    row = conn.execute("PRAGMA user_version;").fetchone()
    return int(row[0]) if row else 0


def run_migrations(
    conn: sqlite3.Connection,
    migrations_dir: Path | None = None,
    backups_dir: Path | None = None,
) -> int:
    """
    Execute forward-only database migrations.

    Steps:
    1. Bootstrap schema_migration ledger.
    2. Discover on-disk migrations.
    3. Verify checksums of already-applied migrations.
    4. Guard against future database versions.
    5. If upgrading an existing database (user_version > 0), create a verified backup first.
    6. Apply each pending migration in its own explicit IMMEDIATE transaction.
    7. Atomically record migration in ledger and update PRAGMA user_version.

    Returns the number of migrations applied.
    """
    ensure_migration_ledger(conn)
    migrations = discover_migrations(migrations_dir)
    latest_available = migrations[-1].version if migrations else 0

    # 1. Verify checksums of applied migrations
    verify_applied_checksums(conn, migrations)

    # 2. Check current version
    current_version = get_current_user_version(conn)
    if current_version > latest_available:
        raise MigrationVersionError(
            f"Database schema version {current_version} is newer than latest supported migration ({latest_available}). "
            f"Refusing to open or mutate future database schema."
        )

    # 3. Determine pending migrations
    pending = [m for m in migrations if m.version > current_version]
    if not pending:
        return 0

    target_version = pending[-1].version

    # 4. If existing database is being upgraded, create verified pre-migration backup
    if current_version > 0:
        create_study_backup(
            source_conn=conn,
            from_version=current_version,
            to_version=target_version,
            backups_dir=backups_dir,
        )

    # 5. Apply each pending migration
    applied_count = 0
    for migration in pending:
        sql_content = migration.path.read_text(encoding="utf-8")
        statements = split_sql_statements(sql_content)

        # Atomic transaction per migration
        conn.execute("BEGIN IMMEDIATE;")
        try:
            for stmt in statements:
                conn.execute(stmt)

            # Record in ledger and update user_version in the same transaction
            applied_at = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                INSERT INTO schema_migration (version, name, checksum, applied_at)
                VALUES (?, ?, ?, ?);
                """,
                (migration.version, migration.name, migration.checksum, applied_at),
            )
            conn.execute(f"PRAGMA user_version = {migration.version};")
            conn.execute("COMMIT;")
            applied_count += 1
        except Exception as exc:
            try:
                conn.execute("ROLLBACK;")
            except Exception:
                pass
            raise MigrationExecutionError(
                f"Failed applying migration {migration.version} ({migration.name}): {exc}"
            ) from exc

    return applied_count

