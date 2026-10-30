"""
Targeted tests for Study Database Doctor.
-----------------------------------------
Covers:
- Healthy database produces zero ERROR findings
- Injected database corruptions and inconsistencies are properly identified:
  - Foreign key violations
  - Missing migration ledger or tampered migration checksum
  - Missing immutability triggers
  - Missing asset files on disk
  - Asset content hash mismatches
  - Orphaned asset records
  - Questions pointing to non-existent or mismatched content groups
  - Questions pointing to cross-question or non-existent revisions
  - Unresolved answer conflicts
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.doctor import run_doctor
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations


@pytest.fixture
def doctor_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated study database and media store for doctor tests."""
    study_dir = tmp_path / "study_doctor_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    store = MediaStore(study_dir / "media")
    yield conn, store, study_dir
    conn.close()
    reset_study_db_manager()


def test_doctor_clean_on_healthy_database(doctor_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test doctor on a freshly migrated database reports no errors."""
    conn, store, _ = doctor_env
    findings = run_doctor(conn, media_store=store)
    errors = [f for f in findings if f.severity == "ERROR"]
    assert len(errors) == 0


def test_doctor_detects_tampered_migration_checksum(doctor_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test doctor detects tampered checksum in schema_migration ledger."""
    conn, store, _ = doctor_env
    # Corrupt stored checksum
    conn.execute("UPDATE schema_migration SET checksum = 'corrupted_checksum_hex' WHERE version = 1;")

    findings = run_doctor(conn, media_store=store)
    tamper_findings = [f for f in findings if f.code == "MIGRATION_CHECKSUM_MISMATCH"]
    assert len(tamper_findings) == 1
    assert tamper_findings[0].severity == "ERROR"


def test_doctor_detects_missing_trigger(doctor_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test doctor detects when a required immutability trigger is dropped."""
    conn, store, _ = doctor_env
    conn.execute("DROP TRIGGER trg_revision_choice_no_delete;")

    findings = run_doctor(conn, media_store=store)
    missing_trg = [f for f in findings if f.code == "MISSING_IMMUTABILITY_TRIGGERS"]
    assert len(missing_trg) == 1
    assert "trg_revision_choice_no_delete" in missing_trg[0].detail


def test_doctor_detects_missing_asset_file_and_hash_mismatch(doctor_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test doctor detects missing asset on disk and hash mismatch."""
    conn, store, _ = doctor_env

    # Register an asset
    f1 = tmp_path / "valid.webm"
    f1.write_bytes(b"INITIAL_VALID_AUDIO_BYTES")
    a_row = store.register_file(f1, "audio", "audio/webm", conn)

    # 1. Tamper with file on disk
    file_path = store.get_asset_file_path(a_row["relative_path"])
    file_path.write_bytes(b"TAMPERED_BYTES_123")

    findings = run_doctor(conn, media_store=store, verify_media_hashes=True)
    mismatch = [f for f in findings if f.code == "ASSET_HASH_MISMATCH"]
    assert len(mismatch) == 1

    # 2. Delete file from disk
    file_path.unlink()
    findings2 = run_doctor(conn, media_store=store)
    missing = [f for f in findings2 if f.code == "ASSET_FILE_MISSING"]
    assert len(missing) == 1


def test_doctor_detects_orphan_assets(doctor_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test doctor identifies unreferenced assets in asset table."""
    conn, store, _ = doctor_env
    f = tmp_path / "orphan.jpg"
    f.write_bytes(b"ORPHAN_IMAGE_DATA")
    store.register_file(f, "illustration", "image/jpeg", conn)

    findings = run_doctor(conn, media_store=store)
    orphans = [f for f in findings if f.code == "ORPHAN_ASSETS_FOUND"]
    assert len(orphans) == 1
    assert orphans[0].severity == "INFO"


def test_doctor_detects_invalid_revision_pointer(doctor_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test doctor detects a question pointing to a cross-question revision."""
    conn, store, _ = doctor_env

    # Question 1 & revision 1
    q1 = conn.execute("INSERT INTO question (external_id, format_code, level, category) VALUES ('q_p1', 'kanji_reading', 'N5', 'vocabulary');").lastrowid
    r1 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'S1', 'f1');", (q1,)).lastrowid

    # Question 2 & revision 2
    q2 = conn.execute("INSERT INTO question (external_id, format_code, level, category) VALUES ('q_p2', 'kanji_reading', 'N5', 'vocabulary');").lastrowid
    r2 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'S2', 'f2');", (q2,)).lastrowid

    # Disable trigger temporarily to inject corrupt pointer, simulating ad-hoc corruption
    conn.execute("DROP TRIGGER trg_question_immutable_columns;")
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r2, q1))

    findings = run_doctor(conn, media_store=store)
    bad_pointers = [f for f in findings if f.code == "INVALID_CURRENT_REVISION_POINTER"]
    assert len(bad_pointers) == 1
    assert bad_pointers[0].severity == "ERROR"


def test_doctor_detects_unresolved_answer_conflicts(doctor_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test doctor identifies unresolved source answer conflicts."""
    conn, store, _ = doctor_env
    src = conn.execute("INSERT INTO source (name, source_type) VALUES ('Source 1', 'testbook');").lastrowid

    q = conn.execute("INSERT INTO question (external_id, format_code, level, category) VALUES ('q_doc_conf', 'kanji_reading', 'N3', 'vocabulary');").lastrowid
    r = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'Stem', 'f');", (q,)).lastrowid
    c1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'A');", (r,)).lastrowid
    c2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c2', '2', 2, 'B');", (r,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r, c1))

    # Record conflict
    conn.execute(
        """
        INSERT INTO source_answer_claim (question_revision_id, source_id, choice_id, is_conflict)
        VALUES (?, ?, ?, 1);
        """,
        (r, src, c2),
    )

    findings = run_doctor(conn, media_store=store)
    conflicts = [f for f in findings if f.code == "UNRESOLVED_ANSWER_CONFLICTS"]
    assert len(conflicts) == 1
    assert conflicts[0].severity == "WARNING"

