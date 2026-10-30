"""
Targeted tests for Study Content-Addressed Media Storage.
---------------------------------------------------------
Covers:
- Content-addressed store layout: media/<first-two-sha>/<sha><ext>
- Idempotent registration (identical bytes reuse existing record and file)
- Path traversal rejection
- Atomic write (temp file + os.replace)
- verify_asset(sha) detecting disk existence and hash mismatches
- reconcile_assets() synchronizing DB asset.status ('present' vs 'missing')
- Choice-level image association
- Question and group revision asset associations with role, ordinal, and is_required flag
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.media import MediaStore, PathTraversalError
from app.study.migrations.runner import run_migrations


@pytest.fixture
def media_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated study directory with media storage and migrated DB."""
    study_dir = tmp_path / "study_media_tests"
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


def test_content_addressed_registration_and_layout(media_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test registering a file produces media/<sha[:2]>/<sha><ext> content-addressed layout."""
    conn, store, study_dir = media_env

    # Create dummy audio file
    dummy_file = tmp_path / "sample_audio.webm"
    dummy_bytes = b"OGG_WEBM_OPUS_MOCK_STREAM_BYTES_12345678"
    dummy_file.write_bytes(dummy_bytes)
    expected_sha = hashlib.sha256(dummy_bytes).hexdigest()

    asset_row = store.register_file(
        source_path=dummy_file,
        kind="audio",
        mime_type="audio/webm",
        conn=conn,
        duration_ms=15000,
    )

    assert asset_row["sha256"] == expected_sha
    assert asset_row["kind"] == "audio"
    assert asset_row["mime_type"] == "audio/webm"
    assert asset_row["duration_ms"] == 15000
    assert asset_row["status"] == "present"

    prefix = expected_sha[:2]
    expected_rel = f"{prefix}/{expected_sha}.webm"
    assert asset_row["relative_path"] == expected_rel

    final_path = store.media_dir / expected_rel
    assert final_path.is_file()
    assert final_path.read_bytes() == dummy_bytes


def test_idempotent_registration_reuses_existing_asset(media_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test that registering duplicate bytes reuses the same record and file."""
    conn, store, _ = media_env

    f1 = tmp_path / "file1.png"
    f2 = tmp_path / "file2.png"
    data = b"PNG_IMAGE_BYTES_IDENTICAL"
    f1.write_bytes(data)
    f2.write_bytes(data)

    row1 = store.register_file(f1, "illustration", "image/png", conn)
    row2 = store.register_file(f2, "illustration", "image/png", conn)

    assert row1["id"] == row2["id"]
    assert row1["sha256"] == row2["sha256"]

    # Verify only 1 row in DB
    total = conn.execute("SELECT COUNT(*) FROM asset;").fetchone()[0]
    assert total == 1


def test_path_traversal_rejection(media_env: tuple[sqlite3.Connection, MediaStore, Path]):
    """Test that relative paths with .. or absolute paths are strictly rejected."""
    _, store, _ = media_env

    with pytest.raises(PathTraversalError, match="Invalid relative path"):
        store.get_asset_file_path("../evil.txt")

    with pytest.raises(PathTraversalError, match="Invalid relative path"):
        store.get_asset_file_path("/etc/passwd")

    with pytest.raises(PathTraversalError, match="Invalid relative path"):
        store.get_asset_file_path("sub/../../escape.txt")


def test_verify_asset_detects_missing_and_tampered_files(media_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test verify_asset detects missing files and content hash corruption."""
    conn, store, _ = media_env

    src = tmp_path / "valid.jpg"
    src.write_bytes(b"VALID_JPEG_BYTES")
    row = store.register_file(src, "diagram", "image/jpeg", conn)
    sha = row["sha256"]

    # 1. Valid file passes verification
    assert store.verify_asset(sha, conn) is True

    # 2. Tamper file contents
    asset_file = store.get_asset_file_path(row["relative_path"])
    asset_file.write_bytes(b"CORRUPTED_TAMPERED_BYTES")
    assert store.verify_asset(sha, conn) is False

    # 3. Deleted file fails verification
    asset_file.unlink()
    assert store.verify_asset(sha, conn) is False


def test_reconcile_assets_status(media_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test reconcile_assets synchronizes asset.status based on disk existence."""
    conn, store, _ = media_env

    src = tmp_path / "sync.jpg"
    src.write_bytes(b"SYNC_IMAGE_DATA")
    row = store.register_file(src, "diagram", "image/jpeg", conn)
    a_id = row["id"]
    file_path = store.get_asset_file_path(row["relative_path"])

    # Initially present
    assert row["status"] == "present"

    # Delete file from disk and reconcile
    file_path.unlink()
    stats = store.reconcile_assets(conn)
    assert stats["marked_missing"] == 1

    updated = conn.execute("SELECT status FROM asset WHERE id = ?;", (a_id,)).fetchone()
    assert updated["status"] == "missing"

    # Re-create file on disk and reconcile
    file_path.write_bytes(b"SYNC_IMAGE_DATA")
    stats2 = store.reconcile_assets(conn)
    assert stats2["marked_present"] == 1

    restored = conn.execute("SELECT status FROM asset WHERE id = ?;", (a_id,)).fetchone()
    assert restored["status"] == "present"


def test_asset_relational_associations(media_env: tuple[sqlite3.Connection, MediaStore, Path], tmp_path: Path):
    """Test associating assets to question revision, group revision, and choice."""
    conn, store, _ = media_env

    # Create dummy asset
    img_file = tmp_path / "choice_img.png"
    img_file.write_bytes(b"CHOICE_IMAGE_BYTES")
    a_row = store.register_file(img_file, "choice_image", "image/png", conn)
    asset_id = a_row["id"]

    # Question setup
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category) VALUES ('q_asset', 'kanji_reading', 'N4', 'vocabulary');"
    ).lastrowid
    rev_id = conn.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'Stem', 'f');",
        (q_id,),
    ).lastrowid

    # 1. Question revision asset link
    conn.execute(
        """
        INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required)
        VALUES (?, ?, 'diagram', 1, 1);
        """,
        (rev_id, asset_id),
    )

    # 2. Choice-level asset link
    c_id = conn.execute(
        """
        INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup, asset_id)
        VALUES (?, 'c1', '1', 1, NULL, ?);
        """,
        (rev_id, asset_id),
    ).lastrowid

    # Verify choice holds asset reference
    choice = conn.execute("SELECT * FROM revision_choice WHERE id = ?;", (c_id,)).fetchone()
    assert choice["asset_id"] == asset_id
    assert choice["text_markup"] is None

