"""
Kiroku Study Module
-------------------
Local-first Japanese JLPT question bank, relational schema, and examination foundation.
"""
from __future__ import annotations

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
from app.study.doctor import DoctorFinding, run_doctor
from app.study.eligibility import (
    ORDERED_REASON_CODES,
    evaluate_eligibility,
)
from app.study.media import (
    MediaStorageError,
    MediaStore,
    PathTraversalError,
)
from app.study.migrations.runner import (
    MigrationChecksumError,
    MigrationError,
    MigrationExecutionError,
    MigrationVersionError,
    discover_migrations,
    run_migrations,
)
from app.study.provenance import ProvenanceService
from app.study.ulid import generate_ulid, is_valid_ulid

__all__ = [
    "BackupError",
    "DoctorFinding",
    "MediaStorageError",
    "MediaStore",
    "MigrationChecksumError",
    "MigrationError",
    "MigrationExecutionError",
    "MigrationVersionError",
    "ORDERED_REASON_CODES",
    "PathTraversalError",
    "ProvenanceService",
    "RestoreError",
    "StudyDatabaseError",
    "StudyDatabaseManager",
    "create_study_backup",
    "discover_migrations",
    "evaluate_eligibility",
    "generate_ulid",
    "get_study_db_manager",
    "is_valid_ulid",
    "list_backups",
    "reset_study_db_manager",
    "restore_study_backup",
    "run_doctor",
    "run_migrations",
]
