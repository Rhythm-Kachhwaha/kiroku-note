"""
Study Subsystem Diagnostic Service.
-----------------------------------
Provides comprehensive, strictly read-only diagnostics for:
- SQLite low-level database integrity
- Relational foreign-key consistency
- Migration ledger state and pending migrations
- Study database accessibility and WAL mode
- Media storage directory accessibility
- Media manifest and content-hash integrity
- Missing or corrupt referenced media detection
- JLPT question bank readiness across levels N1–N5

Contracts:
- Strictly read-only: NEVER mutates database rows, media files, or progress
- Structured, machine-readable output models
- Graceful handling of missing optional components (uninitialized DB, empty media)
- Secret redaction: never exposes credentials or personal information
- Actionable messages for identified warnings or errors
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
import hashlib
import os
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.config import get_study_db_path, get_study_media_dir
from app.study.exam.blueprint import get_official_blueprint
from app.study.exam.validator import ExamReadinessValidator
from app.study.media import MediaStore, PathTraversalError
from app.study.migrations.runner import (
    discover_migrations,
    get_current_user_version,
    get_migrations_dir,
)


class DiagnosticSeverity(str, Enum):
    HEALTHY = "HEALTHY"
    WARNING = "WARNING"
    ERROR = "ERROR"


class DatabaseAccessibilityReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    accessible: bool = True
    db_path: str
    exists: bool = True
    size_bytes: int = 0
    is_writable: bool = True
    journal_mode: str = "unknown"
    details: str = "Database file is accessible."


class SQLiteIntegrityReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    ok: bool = True
    details: List[str] = Field(default_factory=lambda: ["ok"])


class ForeignKeyReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    violations_count: int = 0
    violating_tables: List[str] = Field(default_factory=list)
    details: List[str] = Field(default_factory=list)


class MigrationReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    current_version: int = 0
    latest_available_version: int = 0
    applied_count: int = 0
    pending_count: int = 0
    checksums_valid: bool = True
    pending_migrations: List[str] = Field(default_factory=list)
    details: str = "Migration state verified."


class MediaAccessibilityReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    accessible: bool = True
    media_dir: str
    exists: bool = True
    is_writable: bool = True
    total_files_on_disk: int = 0
    details: str = "Media directory is accessible."


class ProblematicMediaAsset(BaseModel):
    asset_id: int
    sha256_prefix: str
    relative_path: str
    status: str
    issue: str


class MediaIntegrityReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    total_assets_in_db: int = 0
    marked_present: int = 0
    marked_missing: int = 0
    verified_valid_count: int = 0
    corrupted_count: int = 0
    missing_on_disk_count: int = 0
    problematic_assets: List[ProblematicMediaAsset] = Field(default_factory=list)
    details: str = "Media assets verified."


class LevelReadinessSummary(BaseModel):
    level: str
    status: str
    is_ready: bool
    total_eligible: int
    total_required: int
    deficit_count: int
    missing_formats: List[str] = Field(default_factory=list)


class BankReadinessReport(BaseModel):
    status: DiagnosticSeverity = DiagnosticSeverity.HEALTHY
    overall_readiness: str = "READY"
    total_active_questions: int = 0
    total_eligible_questions: int = 0
    levels: Dict[str, LevelReadinessSummary] = Field(default_factory=dict)
    details: str = "Bank readiness assessed."


class StudyDiagnosticReport(BaseModel):
    overall_status: DiagnosticSeverity
    timestamp: str
    database: DatabaseAccessibilityReport
    sqlite_integrity: SQLiteIntegrityReport
    foreign_keys: ForeignKeyReport
    migrations: MigrationReport
    media_storage: MediaAccessibilityReport
    media_integrity: MediaIntegrityReport
    bank_readiness: BankReadinessReport
    actionable_messages: List[str] = Field(default_factory=list)


class StudyDiagnosticService:
    """
    Reusable diagnostic engine for the Kiroku Study subsystem.
    Performs strictly read-only diagnostics across storage, relational integrity,
    media assets, migrations, and question-bank blueprint readiness.
    """

    def __init__(
        self,
        db_path: Path | str | None = None,
        media_dir: Path | str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        if isinstance(db_path, sqlite3.Connection):
            conn = db_path
            db_path = None
        self._db_path = Path(db_path).resolve() if db_path is not None else get_study_db_path().resolve()
        self._media_dir = Path(media_dir).resolve() if media_dir is not None else get_study_media_dir().resolve()
        self._explicit_conn = conn

    def run_diagnostics(
        self,
        verify_media_hashes: bool = True,
        check_bank_readiness: bool = True,
    ) -> StudyDiagnosticReport:
        """
        Execute comprehensive read-only diagnosis and return structured machine-readable report.
        """
        actionable_messages: List[str] = []
        timestamp = datetime.now(timezone.utc).isoformat()

        # 1. Database Accessibility
        db_report = self._check_database_accessibility()
        if db_report.status != DiagnosticSeverity.HEALTHY:
            actionable_messages.append(db_report.details)

        # Early return if database file does not exist or cannot be opened
        if not db_report.accessible:
            empty_report = StudyDiagnosticReport(
                overall_status=DiagnosticSeverity.ERROR,
                timestamp=timestamp,
                database=db_report,
                sqlite_integrity=SQLiteIntegrityReport(
                    status=DiagnosticSeverity.ERROR,
                    ok=False,
                    details=["Database file not accessible"],
                ),
                foreign_keys=ForeignKeyReport(
                    status=DiagnosticSeverity.ERROR,
                    violations_count=0,
                    details=["Database not accessible"],
                ),
                migrations=MigrationReport(
                    status=DiagnosticSeverity.ERROR,
                    details="Cannot inspect migrations on inaccessible database",
                ),
                media_storage=self._check_media_accessibility(),
                media_integrity=MediaIntegrityReport(
                    status=DiagnosticSeverity.WARNING,
                    details="Skipped media integrity check: database inaccessible",
                ),
                bank_readiness=BankReadinessReport(
                    status=DiagnosticSeverity.WARNING,
                    overall_readiness="UNAVAILABLE",
                    details="Database inaccessible",
                ),
                actionable_messages=actionable_messages,
            )
            return empty_report

        # Connect or use passed connection for remaining checks
        owns_conn = False
        conn = self._explicit_conn
        if conn is None:
            conn = sqlite3.connect(
                str(self._db_path),
                timeout=10.0,
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            owns_conn = True

        try:
            # 2. SQLite Low-Level Integrity
            integrity_report = self._check_sqlite_integrity(conn)
            if integrity_report.status != DiagnosticSeverity.HEALTHY:
                actionable_messages.append("SQLite corruption detected! Run recovery or restore from verified backup.")

            # 3. Foreign Key Checks
            fk_report = self._check_foreign_keys(conn)
            if fk_report.status != DiagnosticSeverity.HEALTHY:
                actionable_messages.append(
                    f"Foreign key violations detected in tables: {', '.join(fk_report.violating_tables)}."
                )

            # 4. Migrations & Ledger Checksums
            mig_report = self._check_migrations(conn)
            if mig_report.status == DiagnosticSeverity.WARNING:
                actionable_messages.append(
                    f"{mig_report.pending_count} pending migration(s) found. Run migrations to upgrade schema."
                )
            elif mig_report.status == DiagnosticSeverity.ERROR:
                actionable_messages.append(f"Migration error: {mig_report.details}")

            # 5. Media Storage Accessibility
            media_acc_report = self._check_media_accessibility()
            if media_acc_report.status != DiagnosticSeverity.HEALTHY:
                actionable_messages.append(media_acc_report.details)

            # 6. Media Integrity & Manifest
            store = MediaStore(self._media_dir)
            media_int_report = self._check_media_integrity(conn, store, verify_media_hashes)
            if media_int_report.status != DiagnosticSeverity.HEALTHY:
                actionable_messages.append(media_int_report.details)

            # 7. Bank Readiness
            bank_report = (
                self._check_bank_readiness(conn, store)
                if check_bank_readiness
                else BankReadinessReport(
                    status=DiagnosticSeverity.HEALTHY,
                    overall_readiness="SKIPPED",
                    details="Bank readiness check skipped by caller request.",
                )
            )
            if bank_report.status == DiagnosticSeverity.WARNING:
                actionable_messages.append("Question bank contains incomplete quotas for one or more JLPT levels.")

            # Compute overall status
            severities = [
                db_report.status,
                integrity_report.status,
                fk_report.status,
                mig_report.status,
                media_acc_report.status,
                media_int_report.status,
                bank_report.status,
            ]

            if DiagnosticSeverity.ERROR in severities:
                overall_status = DiagnosticSeverity.ERROR
            elif DiagnosticSeverity.WARNING in severities:
                overall_status = DiagnosticSeverity.WARNING
            else:
                overall_status = DiagnosticSeverity.HEALTHY

            return StudyDiagnosticReport(
                overall_status=overall_status,
                timestamp=timestamp,
                database=db_report,
                sqlite_integrity=integrity_report,
                foreign_keys=fk_report,
                migrations=mig_report,
                media_storage=media_acc_report,
                media_integrity=media_int_report,
                bank_readiness=bank_report,
                actionable_messages=actionable_messages,
            )
        finally:
            if owns_conn:
                conn.close()

    def _check_database_accessibility(self) -> DatabaseAccessibilityReport:
        """Check filesystem accessibility, size, and WAL mode of the SQLite file."""
        if not self._db_path.exists():
            return DatabaseAccessibilityReport(
                status=DiagnosticSeverity.WARNING,
                accessible=False,
                db_path=str(self._db_path),
                exists=False,
                size_bytes=0,
                is_writable=False,
                details=f"Study database does not exist at {self._db_path}.",
            )

        if not self._db_path.is_file():
            return DatabaseAccessibilityReport(
                status=DiagnosticSeverity.ERROR,
                accessible=False,
                db_path=str(self._db_path),
                exists=True,
                size_bytes=0,
                is_writable=False,
                details=f"Target path {self._db_path} is not a regular file.",
            )

        size_bytes = self._db_path.stat().st_size
        is_writable = os.access(self._db_path, os.W_OK) and os.access(self._db_path.parent, os.W_OK)

        journal_mode = "unknown"
        try:
            temp_conn = sqlite3.connect(str(self._db_path), timeout=5.0)
            try:
                row = temp_conn.execute("PRAGMA journal_mode;").fetchone()
                if row:
                    journal_mode = str(row[0]).lower()
            finally:
                temp_conn.close()
        except Exception as e:
            return DatabaseAccessibilityReport(
                status=DiagnosticSeverity.ERROR,
                accessible=False,
                db_path=str(self._db_path),
                exists=True,
                size_bytes=size_bytes,
                is_writable=is_writable,
                details=f"Cannot establish connection to study database: {e}",
            )

        status = DiagnosticSeverity.HEALTHY
        details = "Database file is accessible."
        if journal_mode != "wal":
            status = DiagnosticSeverity.WARNING
            details = f"Database journal_mode is '{journal_mode}', recommended is 'wal'."

        return DatabaseAccessibilityReport(
            status=status,
            accessible=True,
            db_path=str(self._db_path),
            exists=True,
            size_bytes=size_bytes,
            is_writable=is_writable,
            journal_mode=journal_mode,
            details=details,
        )

    def _check_sqlite_integrity(self, conn: sqlite3.Connection) -> SQLiteIntegrityReport:
        """Run SQLite low-level PRAGMA integrity_check."""
        try:
            rows = conn.execute("PRAGMA integrity_check;").fetchall()
            results = [r[0] for r in rows]
            if results == ["ok"]:
                return SQLiteIntegrityReport(
                    status=DiagnosticSeverity.HEALTHY,
                    ok=True,
                    details=results,
                )
            return SQLiteIntegrityReport(
                status=DiagnosticSeverity.ERROR,
                ok=False,
                details=results,
            )
        except Exception as exc:
            return SQLiteIntegrityReport(
                status=DiagnosticSeverity.ERROR,
                ok=False,
                details=[f"Integrity check raised exception: {exc}"],
            )

    def _check_foreign_keys(self, conn: sqlite3.Connection) -> ForeignKeyReport:
        """Run PRAGMA foreign_key_check to detect broken relational pointers."""
        try:
            violations = conn.execute("PRAGMA foreign_key_check;").fetchall()
            if not violations:
                return ForeignKeyReport(
                    status=DiagnosticSeverity.HEALTHY,
                    violations_count=0,
                    violating_tables=[],
                    details=["No foreign key violations detected."],
                )

            violating_tables = sorted(list({str(v[0]) for v in violations}))
            details = [
                f"Table '{v[0]}' rowid={v[1]} references missing parent '{v[2]}' (fk_index={v[3]})"
                for v in violations[:10]
            ]
            if len(violations) > 10:
                details.append(f"... and {len(violations) - 10} more violation(s)")

            return ForeignKeyReport(
                status=DiagnosticSeverity.ERROR,
                violations_count=len(violations),
                violating_tables=violating_tables,
                details=details,
            )
        except Exception as exc:
            return ForeignKeyReport(
                status=DiagnosticSeverity.ERROR,
                violations_count=-1,
                details=[f"Foreign key check raised exception: {exc}"],
            )

    def _check_migrations(self, conn: sqlite3.Connection) -> MigrationReport:
        """Inspect schema_migration ledger and verify against on-disk migration files."""
        try:
            ledger_row = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration';"
            ).fetchone()
            if not ledger_row:
                return MigrationReport(
                    status=DiagnosticSeverity.WARNING,
                    current_version=0,
                    details="Table 'schema_migration' does not exist; schema is uninitialized.",
                )

            current_version = get_current_user_version(conn)
            disk_migrations = discover_migrations(get_migrations_dir())
            disk_by_version = {m.version: m for m in disk_migrations}
            latest_version = disk_migrations[-1].version if disk_migrations else 0

            # Ledger rows
            applied_rows = conn.execute(
                "SELECT version, name, checksum, applied_at FROM schema_migration ORDER BY version ASC;"
            ).fetchall()
            applied_count = len(applied_rows)

            # Check for checksum tampering
            checksums_valid = True
            mismatches: List[str] = []
            for r in applied_rows:
                v = r["version"]
                if v not in disk_by_version:
                    checksums_valid = False
                    mismatches.append(f"Applied migration v{v} ('{r['name']}') missing from disk.")
                elif disk_by_version[v].checksum != r["checksum"]:
                    checksums_valid = False
                    mismatches.append(f"Migration v{v} checksum tampered on disk.")

            if not checksums_valid:
                return MigrationReport(
                    status=DiagnosticSeverity.ERROR,
                    current_version=current_version,
                    latest_available_version=latest_version,
                    applied_count=applied_count,
                    pending_count=0,
                    checksums_valid=False,
                    details=f"Checksum validation failed: {'; '.join(mismatches)}",
                )

            # Check for pending migrations
            pending = [m.name for m in disk_migrations if m.version > current_version]
            if pending:
                return MigrationReport(
                    status=DiagnosticSeverity.WARNING,
                    current_version=current_version,
                    latest_available_version=latest_version,
                    applied_count=applied_count,
                    pending_count=len(pending),
                    checksums_valid=True,
                    pending_migrations=pending,
                    details=f"{len(pending)} pending migration(s) available on disk.",
                )

            if current_version > latest_version:
                return MigrationReport(
                    status=DiagnosticSeverity.ERROR,
                    current_version=current_version,
                    latest_available_version=latest_version,
                    applied_count=applied_count,
                    pending_count=0,
                    checksums_valid=True,
                    details=f"Database user_version {current_version} is newer than latest disk migration {latest_version}.",
                )

            return MigrationReport(
                status=DiagnosticSeverity.HEALTHY,
                current_version=current_version,
                latest_available_version=latest_version,
                applied_count=applied_count,
                pending_count=0,
                checksums_valid=True,
                pending_migrations=[],
                details=f"Schema is up-to-date at version {current_version}.",
            )
        except Exception as exc:
            return MigrationReport(
                status=DiagnosticSeverity.ERROR,
                details=f"Migration check raised exception: {exc}",
            )

    def _check_media_accessibility(self) -> MediaAccessibilityReport:
        """Check filesystem accessibility and directory permissions for media storage."""
        if not self._media_dir.exists():
            return MediaAccessibilityReport(
                status=DiagnosticSeverity.WARNING,
                accessible=False,
                media_dir=str(self._media_dir),
                exists=False,
                is_writable=False,
                details=f"Media directory does not exist at {self._media_dir}.",
            )

        if not self._media_dir.is_dir():
            return MediaAccessibilityReport(
                status=DiagnosticSeverity.ERROR,
                accessible=False,
                media_dir=str(self._media_dir),
                exists=True,
                is_writable=False,
                details=f"Media path {self._media_dir} is not a directory.",
            )

        is_writable = os.access(self._media_dir, os.W_OK)
        total_files = sum(1 for _ in self._media_dir.rglob("*") if _.is_file())

        return MediaAccessibilityReport(
            status=DiagnosticSeverity.HEALTHY,
            accessible=True,
            media_dir=str(self._media_dir),
            exists=True,
            is_writable=is_writable,
            total_files_on_disk=total_files,
            details="Media directory is accessible and operational.",
        )

    def _check_media_integrity(
        self,
        conn: sqlite3.Connection,
        media_store: MediaStore,
        verify_hashes: bool,
    ) -> MediaIntegrityReport:
        """Inspect asset table against disk files, detecting missing or corrupted media."""
        try:
            asset_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset';"
            ).fetchone()
            if not asset_table_exists:
                return MediaIntegrityReport(
                    status=DiagnosticSeverity.WARNING,
                    details="Table 'asset' does not exist yet.",
                )

            rows = conn.execute("SELECT id, sha256, relative_path, byte_size, status FROM asset;").fetchall()
            total_in_db = len(rows)
            marked_present = sum(1 for r in rows if r["status"] == "present")
            marked_missing = sum(1 for r in rows if r["status"] == "missing")

            verified_valid = 0
            corrupted = 0
            missing_on_disk = 0
            problematic: List[ProblematicMediaAsset] = []

            for r in rows:
                rel = r["relative_path"]
                sha = r["sha256"]
                sha_prefix = sha[:8]

                try:
                    full_path = media_store.get_asset_file_path(rel)
                    exists = full_path.is_file()
                except PathTraversalError:
                    problematic.append(
                        ProblematicMediaAsset(
                            asset_id=r["id"],
                            sha256_prefix=sha_prefix,
                            relative_path=rel,
                            status=r["status"],
                            issue="path_traversal",
                        )
                    )
                    continue

                if r["status"] == "present" and not exists:
                    missing_on_disk += 1
                    problematic.append(
                        ProblematicMediaAsset(
                            asset_id=r["id"],
                            sha256_prefix=sha_prefix,
                            relative_path=rel,
                            status=r["status"],
                            issue="missing_on_disk",
                        )
                    )
                elif exists and verify_hashes:
                    if media_store.verify_asset(sha, conn):
                        verified_valid += 1
                    else:
                        corrupted += 1
                        problematic.append(
                            ProblematicMediaAsset(
                                asset_id=r["id"],
                                sha256_prefix=sha_prefix,
                                relative_path=rel,
                                status=r["status"],
                                issue="hash_mismatch",
                            )
                        )
                elif exists:
                    verified_valid += 1

            status = DiagnosticSeverity.HEALTHY
            details = "All media assets verified."
            if corrupted > 0 or any(p.issue == "path_traversal" for p in problematic):
                status = DiagnosticSeverity.ERROR
                details = f"{corrupted} corrupt asset(s) and {missing_on_disk} missing asset(s) detected."
            elif missing_on_disk > 0:
                status = DiagnosticSeverity.WARNING
                details = f"{missing_on_disk} asset(s) marked present in database are missing from disk."

            return MediaIntegrityReport(
                status=status,
                total_assets_in_db=total_in_db,
                marked_present=marked_present,
                marked_missing=marked_missing,
                verified_valid_count=verified_valid,
                corrupted_count=corrupted,
                missing_on_disk_count=missing_on_disk,
                problematic_assets=problematic[:20],
                details=details,
            )
        except Exception as exc:
            return MediaIntegrityReport(
                status=DiagnosticSeverity.ERROR,
                details=f"Media integrity check raised exception: {exc}",
            )

    def _check_bank_readiness(
        self,
        conn: sqlite3.Connection,
        media_store: MediaStore,
    ) -> BankReadinessReport:
        """Assess JLPT question bank readiness across levels N1–N5."""
        try:
            q_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'question';"
            ).fetchone()
            if not q_table:
                return BankReadinessReport(
                    status=DiagnosticSeverity.WARNING,
                    overall_readiness="UNAVAILABLE",
                    details="Question table does not exist yet.",
                )

            total_active_row = conn.execute(
                "SELECT COUNT(*) as c FROM question WHERE status = 'active';"
            ).fetchone()
            total_active = total_active_row["c"] if total_active_row else 0

            levels_data: Dict[str, LevelReadinessSummary] = {}
            any_incomplete = False
            total_eligible_overall = 0

            for lvl in ("N5", "N4", "N3", "N2", "N1"):
                try:
                    bp = get_official_blueprint(lvl)
                    report = ExamReadinessValidator.validate_readiness(
                        conn=conn,
                        blueprint=bp,
                        media_store=media_store,
                        verify_files=False,
                    )

                    missing_fmt: List[str] = []
                    deficit = 0
                    for sec in report.sections:
                        for fmt in sec.formats:
                            if not fmt.is_satisfied:
                                missing_fmt.append(f"{fmt.format_code} ({fmt.available_count}/{fmt.required_count})")
                                deficit += fmt.missing_count

                    total_eligible_overall += report.total_available
                    if not report.is_ready:
                        any_incomplete = True

                    levels_data[lvl] = LevelReadinessSummary(
                        level=lvl,
                        status=report.status.value,
                        is_ready=report.is_ready,
                        total_eligible=report.total_available,
                        total_required=report.total_required,
                        deficit_count=deficit,
                        missing_formats=missing_fmt,
                    )
                except Exception:
                    levels_data[lvl] = LevelReadinessSummary(
                        level=lvl,
                        status="ERROR",
                        is_ready=False,
                        total_eligible=0,
                        total_required=0,
                        deficit_count=0,
                        missing_formats=["Blueprint evaluation failed"],
                    )
                    any_incomplete = True

            overall_readiness = "READY" if not any_incomplete and total_active > 0 else "INCOMPLETE_BANK"
            status = DiagnosticSeverity.HEALTHY if overall_readiness == "READY" else DiagnosticSeverity.WARNING

            return BankReadinessReport(
                status=status,
                overall_readiness=overall_readiness,
                total_active_questions=total_active,
                total_eligible_questions=total_eligible_overall,
                levels=levels_data,
                details=f"Question bank overall status: {overall_readiness} ({total_active} active questions).",
            )
        except Exception as exc:
            return BankReadinessReport(
                status=DiagnosticSeverity.ERROR,
                overall_readiness="ERROR",
                details=f"Bank readiness evaluation raised exception: {exc}",
            )


def run_study_diagnostics(
    db_path: Path | str | None = None,
    media_dir: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
    verify_media_hashes: bool = True,
) -> StudyDiagnosticReport:
    """Convenience helper to run diagnostics and return structured report."""
    if isinstance(db_path, sqlite3.Connection):
        conn = db_path
        db_path = None
    service = StudyDiagnosticService(db_path=db_path, media_dir=media_dir, conn=conn)
    return service.run_diagnostics(verify_media_hashes=verify_media_hashes)

