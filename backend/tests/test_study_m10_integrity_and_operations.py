"""
Milestone 10: Data Integrity & Operations Verification Suite.
------------------------------------------------------------
Covers:
1. Backup and Restore (Database + Media Bundles, Hash Verification, Rollback Safety, Round-trip)
2. Gemini API Key Security (Header-only authentication, URL query stripping, Exception redaction)
3. Performance Database Indexes (Migration 0007, Query Plan Optimization, Upgrade on Existing DB)
4. Read-Only Diagnostics Service (Integrity, Foreign Keys, Migrations, Media, Bank Readiness)
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import urllib.error
import urllib.request
import zipfile

import pytest

from app.study.backup import (
    BackupError,
    RestoreError,
    create_study_bundle_backup,
    list_backups,
    restore_study_backup,
    restore_study_bundle_backup,
    validate_study_bundle_backup,
)
from app.study.connection import StudyDatabaseManager
from app.study.diagnostics import (
    DiagnosticSeverity,
    StudyDiagnosticReport,
    StudyDiagnosticService,
    run_study_diagnostics,
)
from app.study.media import MediaStore
from app.study.migrations.runner import get_current_user_version, run_migrations
from app.study.verification.models import AIChoiceInput, AISolveRequest
from app.study.verification.providers.gemini import (
    GeminiProvider,
    sanitize_gemini_error_message,
)
from app.study.verification.providers.base import (
    AIProviderAuthError,
    AIProviderError,
    AIProviderRateLimitError,
    AIProviderResponseError,
    AIProviderTimeoutError,
)


@pytest.fixture
def isolated_study_env(tmp_path: Path):
    """Provide isolated environment with db, media, and backups directories."""
    db_file = tmp_path / "study.db"
    media_dir = tmp_path / "media"
    backups_dir = tmp_path / "backups"
    media_dir.mkdir(parents=True, exist_ok=True)
    backups_dir.mkdir(parents=True, exist_ok=True)

    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    run_migrations(conn)

    return {
        "db_file": db_file,
        "media_dir": media_dir,
        "backups_dir": backups_dir,
        "manager": manager,
        "conn": conn,
        "tmp_path": tmp_path,
    }


# ============================================================================
# 1. Backup and Restore — Database + Media
# ============================================================================

def test_backup_and_restore_bundle_roundtrip(isolated_study_env):
    """Verify that a coordinated db+media bundle restores faithfully into a new destination."""
    conn = isolated_study_env["conn"]
    media_dir = isolated_study_env["media_dir"]
    backups_dir = isolated_study_env["backups_dir"]
    manager = isolated_study_env["manager"]

    store = MediaStore(media_dir)

    # 1. Register sample media assets
    img_data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtest_image_data_m10"
    audio_data = b"ID3\x03\x00\x00\x00\x00\x00#dummy_audio_bytes_m10"

    img_row = store.register_bytes(
        data=img_data,
        extension=".png",
        kind="illustration",
        mime_type="image/png",
        conn=conn,
    )
    audio_row = store.register_bytes(
        data=audio_data,
        extension=".mp3",
        kind="audio",
        mime_type="audio/mpeg",
        conn=conn,
    )

    # 2. Insert test question referencing assets
    conn.execute(
        """
        INSERT INTO source (name, source_type) VALUES ('M10 Roundtrip Source', 'official_sample');
        """
    )
    src_id = conn.execute("SELECT id FROM source WHERE name = 'M10 Roundtrip Source';").fetchone()["id"]

    conn.execute(
        """
        INSERT INTO question (external_id, level, category, format_code, status)
        VALUES ('M10-Q1', 'N5', 'vocabulary', 'kanji_reading', 'active');
        """
    )
    q_id = conn.execute("SELECT id FROM question WHERE external_id = 'M10-Q1';").fetchone()["id"]

    conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, content_fingerprint, stem_markup, validation_status)
        VALUES (?, 'kanji_reading', 1, 'fp_m10_1', 'Test Stem {ruby:日|に}{ruby:本|ほん}', 'valid');
        """,
        (q_id,),
    )
    rev_id = conn.execute("SELECT id FROM question_revision WHERE question_id = ?;", (q_id,)).fetchone()["id"]
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # Link media asset
    conn.execute(
        """
        INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required)
        VALUES (?, ?, 'illustration', 1, 1);
        """,
        (rev_id, img_row["id"]),
    )

    # 3. Create bundle backup
    bundle_path = create_study_bundle_backup(
        source_conn=conn,
        media_store=store,
        backups_dir=backups_dir,
    )
    assert bundle_path.exists()
    assert bundle_path.name.startswith("study-bundle-v")
    assert bundle_path.suffix == ".zip"

    # 4. Validate bundle before restore
    val_report = validate_study_bundle_backup(bundle_path)
    assert val_report["valid"] is True
    assert val_report["asset_count"] == 2
    assert val_report["metadata"]["database_schema_version"] == 7

    # 5. Restore into completely isolated target destination
    target_root = isolated_study_env["tmp_path"] / "dest_restore"
    target_db = target_root / "restored_study.db"
    target_media = target_root / "restored_media"

    restore_study_bundle_backup(
        bundle_path=bundle_path,
        target_db_path=target_db,
        target_media_dir=target_media,
        manager=manager,
    )

    # 6. Verify restored database contents
    assert target_db.exists()
    dest_mgr = StudyDatabaseManager(target_db)
    dest_conn = dest_mgr.get_connection()
    try:
        q_row = dest_conn.execute("SELECT external_id, level FROM question WHERE id = ?;", (q_id,)).fetchone()
        assert q_row is not None
        assert q_row["external_id"] == "M10-Q1"

        # Verify restored media files on disk and their hashes
        dest_store = MediaStore(target_media)
        assert dest_store.verify_asset(img_row["sha256"], dest_conn) is True
        assert dest_store.verify_asset(audio_row["sha256"], dest_conn) is True

        img_file = dest_store.get_asset_file_path(img_row["relative_path"])
        assert img_file.read_bytes() == img_data

        audio_file = dest_store.get_asset_file_path(audio_row["relative_path"])
        assert audio_file.read_bytes() == audio_data
    finally:
        dest_mgr.close_all()


def test_bundle_validation_detects_corrupt_media_hash(isolated_study_env, tmp_path: Path):
    """Test that a backup bundle with tampered media bytes is rejected during pre-validation."""
    conn = isolated_study_env["conn"]
    media_dir = isolated_study_env["media_dir"]
    backups_dir = isolated_study_env["backups_dir"]
    store = MediaStore(media_dir)

    data = b"legitimate_audio_bytes_m10"
    row = store.register_bytes(data=data, extension=".mp3", kind="audio", mime_type="audio/mpeg", conn=conn)

    bundle_path = create_study_bundle_backup(conn, store, backups_dir)

    # Tamper with the zip: replace asset bytes with corrupted data of exact same length
    corrupt_zip = tmp_path / "corrupt_bundle.zip"
    tampered_bytes = b"X" * len(data)
    with zipfile.ZipFile(bundle_path, "r") as z_in, zipfile.ZipFile(corrupt_zip, "w") as z_out:
        for item in z_in.infolist():
            if item.filename.startswith("media/"):
                z_out.writestr(item, tampered_bytes)
            else:
                z_out.writestr(item, z_in.read(item.filename))

    with pytest.raises(RestoreError, match="Corrupt media asset hash"):
        validate_study_bundle_backup(corrupt_zip)


def test_bundle_validation_detects_unmanifested_unexpected_files(isolated_study_env, tmp_path: Path):
    """Test that a backup bundle containing unmanifested files in media/ is rejected."""
    conn = isolated_study_env["conn"]
    media_dir = isolated_study_env["media_dir"]
    backups_dir = isolated_study_env["backups_dir"]
    store = MediaStore(media_dir)

    store.register_bytes(data=b"valid", extension=".png", kind="diagram", mime_type="image/png", conn=conn)
    bundle_path = create_study_bundle_backup(conn, store, backups_dir)

    injected_zip = tmp_path / "injected_bundle.zip"
    with zipfile.ZipFile(bundle_path, "r") as z_in, zipfile.ZipFile(injected_zip, "w") as z_out:
        for item in z_in.infolist():
            z_out.writestr(item, z_in.read(item.filename))
        z_out.writestr("media/unexpected_rogue_file.txt", b"malicious or untracked content")

    with pytest.raises(RestoreError, match="unmanifested unexpected media files"):
        validate_study_bundle_backup(injected_zip)


def test_bundle_restore_rollback_safety_on_failure(isolated_study_env, tmp_path: Path):
    """Test that if restoration fails mid-operation, live database and media are restored from staging."""
    conn = isolated_study_env["conn"]
    media_dir = isolated_study_env["media_dir"]
    backups_dir = isolated_study_env["backups_dir"]
    manager = isolated_study_env["manager"]
    db_file = isolated_study_env["db_file"]

    store = MediaStore(media_dir)
    original_data = b"original_live_media_bytes"
    row = store.register_bytes(data=original_data, extension=".png", kind="illustration", mime_type="image/png", conn=conn)

    conn.execute("INSERT INTO source (name, source_type) VALUES ('Live Original Source', 'user_capture');")

    # Create a corrupted zip whose database fails integrity check
    bad_bundle = tmp_path / "bad_database_bundle.zip"
    with zipfile.ZipFile(bad_bundle, "w") as zf:
        zf.writestr(
            "backup_metadata.json",
            json.dumps({
                "format_version": "1.0",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "database_schema_version": 7,
                "asset_count": 0,
                "database_file": "study.db",
                "manifest_file": "media_manifest.json",
            }),
        )
        zf.writestr(
            "media_manifest.json",
            json.dumps({"format_version": "1.0", "asset_count": 0, "assets": []}),
        )
        # Random non-SQLite bytes
        zf.writestr("study.db", b"NOT_A_SQLITE_DATABASE_HEADER_CORRUPT")

    # Attempting to restore bad bundle must fail and preserve original live database and media
    with pytest.raises(RestoreError):
        restore_study_bundle_backup(
            bundle_path=bad_bundle,
            target_db_path=db_file,
            target_media_dir=media_dir,
            manager=manager,
        )

    # Verify live database and media were NOT destroyed or overwritten
    new_conn = manager.get_connection()
    try:
        live_src = new_conn.execute("SELECT name FROM source WHERE name = 'Live Original Source';").fetchone()
        assert live_src is not None
        assert store.verify_asset(row["sha256"], new_conn) is True
    finally:
        manager.close_all()


def test_backup_retention_policy_retains_five_and_never_deletes_only(isolated_study_env):
    """Test that creating >5 backups enforces retention policy of 5, and 1 backup is never deleted."""
    conn = isolated_study_env["conn"]
    media_dir = isolated_study_env["media_dir"]
    backups_dir = isolated_study_env["backups_dir"]
    store = MediaStore(media_dir)

    # Create 1st backup
    p1 = create_study_bundle_backup(conn, store, backups_dir)
    assert p1.exists()
    assert len(list_backups(backups_dir)) == 1

    # Create 6 more backups
    created = [p1]
    for _ in range(6):
        p = create_study_bundle_backup(conn, store, backups_dir)
        created.append(p)

    all_b = list_backups(backups_dir)
    assert len(all_b) == 5
    # Oldest backup should have been pruned
    assert not p1.exists()


# ============================================================================
# 2. Gemini API Key Security
# ============================================================================

def test_gemini_provider_url_and_header_credentials():
    """Verify that Gemini provider never passes api_key in URL and passes it in x-goog-api-key header."""
    fake_key = "AIzaSySecretTestKey12345"
    provider = GeminiProvider(
        model="gemini-3.5-flash-lite",
        api_key=fake_key,
        base_url="https://generativelanguage.googleapis.com",
    )

    resolved_url = provider._resolve_url()
    # 1. API key must NOT be in URL query parameters
    assert "key=" not in resolved_url
    assert fake_key not in resolved_url
    assert resolved_url == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"


def test_gemini_provider_sends_x_goog_api_key_header(monkeypatch):
    """Verify that urllib.request.Request receives x-goog-api-key header and clean URL."""
    fake_key = "AIzaSyTestHeaderVerification999"
    provider = GeminiProvider(
        model="gemini-3.5-flash-lite",
        api_key=fake_key,
        min_delay=0.0,
    )

    captured_requests = []

    def mock_urlopen(req, timeout=None):
        captured_requests.append(req)
        # Return valid empty candidate JSON
        resp_body = json.dumps({
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": json.dumps({"selected_answer": "1", "confidence": "high"})}
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15},
        }).encode("utf-8")

        mock_resp = io.BytesIO(resp_body)
        mock_resp.read = mock_resp.read
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = lambda s, *a: None
        return mock_resp

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    req = AISolveRequest(
        format_code="kanji_reading",
        structural_family="f1_standard_mc",
        level="N5",
        category="vocabulary",
        stem_markup="テスト問題",
        stem_plain="テスト問題",
        choices=[AIChoiceInput(choice_key="1", label="1", text="選択肢1"), AIChoiceInput(choice_key="2", label="2", text="選択肢2")],
    )
    resp = provider.solve_question(req)

    assert resp.selected_choice_key == "1"
    assert len(captured_requests) == 1

    http_req = captured_requests[0]
    # Check headers
    assert http_req.get_header("X-goog-api-key") == fake_key
    # Check URL
    assert "key=" not in http_req.full_url
    assert fake_key not in http_req.full_url


def test_gemini_error_redaction_http_errors(monkeypatch):
    """Verify that representative HTTP errors (401, 403, 429, 500) redact the API key from messages."""
    fake_key = "AIzaSySensitiveCredentialsShouldNeverLeak"
    provider = GeminiProvider(
        model="gemini-3.5-flash-lite",
        api_key=fake_key,
        max_retries=0,
        min_delay=0.0,
    )

    test_scenarios = [
        (401, AIProviderAuthError, f"API key {fake_key} invalid or expired"),
        (403, AIProviderAuthError, f"Permission denied for key {fake_key} on project"),
        (429, AIProviderRateLimitError, f"Rate limit exceeded for key={fake_key}"),
        (500, AIProviderError, f"Internal server error processing key {fake_key}"),
    ]

    for status_code, exc_type, raw_body in test_scenarios:
        def mock_failing_urlopen(req, timeout=None):
            err_io = io.BytesIO(raw_body.encode("utf-8"))
            raise urllib.error.HTTPError(
                url="https://generativelanguage.googleapis.com/v1beta/models/test:generateContent",
                code=status_code,
                msg=f"HTTP Error {status_code} with key {fake_key}",
                hdrs={},
                fp=err_io,
            )

        monkeypatch.setattr(urllib.request, "urlopen", mock_failing_urlopen)

        with pytest.raises(exc_type) as exc_info:
            provider._send_generate_content("system", "prompt")

        err_str = str(exc_info.value)
        # The raw API key must NEVER appear in the exception message
        assert fake_key not in err_str
        assert "[REDACTED]" in err_str


def test_gemini_error_redaction_connection_and_timeout_errors(monkeypatch):
    """Verify that URLError and TimeoutError redact sensitive credentials."""
    fake_key = "AIzaSyConnectionErrorKeyTest"
    provider = GeminiProvider(
        model="gemini-3.5-flash-lite",
        api_key=fake_key,
        max_retries=0,
        min_delay=0.0,
    )

    def mock_conn_fail(req, timeout=None):
        raise urllib.error.URLError(f"Failed to reach server for key={fake_key}")

    monkeypatch.setattr(urllib.request, "urlopen", mock_conn_fail)

    with pytest.raises(AIProviderError) as exc_info:
        provider._send_generate_content("system", "prompt")

    err_str = str(exc_info.value)
    assert fake_key not in err_str
    assert "[REDACTED]" in err_str


# ============================================================================
# 3. Database Indexes
# ============================================================================

def test_migration_0007_creates_all_expected_indexes(isolated_study_env):
    """Verify that migration 0007 creates all 5 query-justified performance indexes."""
    conn = isolated_study_env["conn"]

    cursor = conn.execute("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index';")
    indexes = {(r["name"], r["tbl_name"]) for r in cursor.fetchall()}

    expected_indexes = {
        ("idx_question_level_format_status", "question"),
        ("idx_source_answer_claim_rev", "source_answer_claim"),
        ("idx_attempt_item_question", "attempt_item"),
        ("idx_exam_item_state_section", "exam_item_state"),
        ("idx_test_attempt_status_created", "test_attempt"),
    }

    for idx_name, tbl_name in expected_indexes:
        assert (idx_name, tbl_name) in indexes, f"Missing index {idx_name} on {tbl_name}"


def test_migration_0007_upgrade_on_existing_database(tmp_path: Path):
    """Verify that applying migration 0007 to an existing database preserves data and creates indexes."""
    db_file = tmp_path / "upgrade_test.db"
    conn = sqlite3.connect(str(db_file), isolation_level=None)
    conn.row_factory = sqlite3.Row

    # Manually apply migrations 1 through 6
    migrations_dir = Path(__file__).resolve().parent.parent / "app" / "study" / "migrations"
    from app.study.migrations.runner import compute_file_sha256, ensure_migration_ledger, split_sql_statements

    ensure_migration_ledger(conn)
    for v in range(1, 7):
        sql_file = next(migrations_dir.glob(f"000{v}_*.sql"))
        checksum = compute_file_sha256(sql_file)
        for stmt in split_sql_statements(sql_file.read_text(encoding="utf-8")):
            conn.execute(stmt)
        conn.execute(
            "INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (?, ?, ?, 'now');",
            (v, sql_file.name, checksum),
        )
        conn.execute(f"PRAGMA user_version = {v};")

    assert get_current_user_version(conn) == 6

    # Insert test data prior to upgrading to v7
    conn.execute("INSERT INTO question (external_id, level, category, format_code) VALUES ('UPG-1', 'N1', 'vocabulary', 'kanji_reading');")
    conn.execute("INSERT INTO test_attempt (external_id, session_type, status, seed) VALUES ('ATT-UPG-1', 'casual', 'completed', 123);")

    # Run migrations -> applies 0007
    applied = run_migrations(conn)
    assert applied == 1
    assert get_current_user_version(conn) == 7

    # Verify data preserved
    q_row = conn.execute("SELECT external_id FROM question WHERE external_id = 'UPG-1';").fetchone()
    assert q_row is not None

    att_row = conn.execute("SELECT external_id, status FROM test_attempt WHERE external_id = 'ATT-UPG-1';").fetchone()
    assert att_row is not None
    assert att_row["status"] == "completed"

    # Verify query plan utilizes newly added index for format-level query
    plan_rows = conn.execute(
        """
        EXPLAIN QUERY PLAN
        SELECT id, current_revision_id
        FROM question
        WHERE level = 'N1' AND format_code = 'kanji_reading' AND status = 'active';
        """
    ).fetchall()
    plan_text = " ".join([str(r[3]) for r in plan_rows])
    assert "idx_question_level_format_status" in plan_text

    conn.close()


# ============================================================================
# 4. Diagnostics Service
# ============================================================================

def test_diagnostics_on_healthy_database(isolated_study_env):
    """Verify that diagnostics on an initialized, healthy database returns HEALTHY overall."""
    db_file = isolated_study_env["db_file"]
    media_dir = isolated_study_env["media_dir"]
    conn = isolated_study_env["conn"]

    service = StudyDiagnosticService(db_path=db_file, media_dir=media_dir, conn=conn)
    report = service.run_diagnostics(verify_media_hashes=True, check_bank_readiness=True)

    assert isinstance(report, StudyDiagnosticReport)
    assert report.database.accessible is True
    assert report.database.journal_mode == "wal"
    assert report.sqlite_integrity.ok is True
    assert report.foreign_keys.violations_count == 0
    assert report.migrations.checksums_valid is True
    assert report.migrations.current_version == 7
    assert report.media_storage.accessible is True
    assert report.media_integrity.corrupted_count == 0


def test_diagnostics_handles_missing_database_gracefully(tmp_path: Path):
    """Verify that diagnostics handles a non-existent database file gracefully without crashing."""
    non_existent_db = tmp_path / "does_not_exist.db"
    non_existent_media = tmp_path / "no_media"

    report = run_study_diagnostics(db_path=non_existent_db, media_dir=non_existent_media)

    assert report.overall_status in (DiagnosticSeverity.WARNING, DiagnosticSeverity.ERROR)
    assert report.database.accessible is False
    assert report.database.exists is False
    assert any("does not exist" in msg for msg in report.actionable_messages)


def test_diagnostics_detects_foreign_key_violation(isolated_study_env):
    """Verify that diagnostics flags foreign key violations if foreign_keys pragma is bypassed."""
    conn = isolated_study_env["conn"]
    db_file = isolated_study_env["db_file"]
    media_dir = isolated_study_env["media_dir"]

    # Temporarily disable foreign keys to insert orphan record
    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute(
        """
        INSERT INTO import_batch (source_id, adapter_name) VALUES (999999, 'test_adapter');
        """
    )
    conn.execute("PRAGMA foreign_keys = ON;")

    service = StudyDiagnosticService(db_path=db_file, media_dir=media_dir, conn=conn)
    report = service.run_diagnostics(verify_media_hashes=False, check_bank_readiness=False)

    assert report.foreign_keys.status == DiagnosticSeverity.ERROR
    assert report.foreign_keys.violations_count > 0
    assert "import_batch" in report.foreign_keys.violating_tables
    assert report.overall_status == DiagnosticSeverity.ERROR


def test_diagnostics_detects_missing_referenced_media(isolated_study_env):
    """Verify that diagnostics flags media assets marked 'present' in DB that are missing on disk."""
    conn = isolated_study_env["conn"]
    db_file = isolated_study_env["db_file"]
    media_dir = isolated_study_env["media_dir"]

    # Insert asset record marked present with fake file path
    conn.execute(
        """
        INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
        VALUES ('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'audio', 'audio/mpeg', 1234, '00/phantom_asset.mp3', 'present');
        """
    )

    service = StudyDiagnosticService(db_path=db_file, media_dir=media_dir, conn=conn)
    report = service.run_diagnostics(verify_media_hashes=True, check_bank_readiness=False)

    assert report.media_integrity.missing_on_disk_count >= 1
    assert any(p.issue == "missing_on_disk" for p in report.media_integrity.problematic_assets)
    assert report.overall_status in (DiagnosticSeverity.WARNING, DiagnosticSeverity.ERROR)


def test_core_llm_service_gemini_header_credentials_and_redaction(monkeypatch):
    """Verify that core app.services.llm_service GeminiProvider sends header-only credentials and redacts errors."""
    from app.services.llm_service import GeminiProvider as CoreGeminiProvider, LLMAPIError

    fake_key = "AIzaSyCoreGeminiSecurityKey"
    provider = CoreGeminiProvider(api_key=fake_key, model="gemini-2.0-flash")

    captured = []

    def mock_urlopen(req, timeout=None):
        captured.append(req)
        resp_body = json.dumps({
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": "Hello response"}]
                    }
                }
            ]
        }).encode("utf-8")
        bio = io.BytesIO(resp_body)
        bio.read = bio.read
        bio.__enter__ = lambda s: s
        bio.__exit__ = lambda s, *a: None
        return bio

    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    res = provider.ask("Hello")
    assert res == "Hello response"
    assert len(captured) == 1

    http_req = captured[0]
    assert http_req.get_header("X-goog-api-key") == fake_key
    assert "key=" not in http_req.full_url
    assert fake_key not in http_req.full_url

    # Test error redaction
    def mock_failing_urlopen(req, timeout=None):
        err_io = io.BytesIO(f"Error echoing key: {fake_key}".encode("utf-8"))
        raise urllib.error.HTTPError(
            url="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            code=403,
            msg=f"Forbidden with key {fake_key}",
            hdrs={},
            fp=err_io,
        )

    monkeypatch.setattr(urllib.request, "urlopen", mock_failing_urlopen)

    with pytest.raises(LLMAPIError) as exc_info:
        provider.ask("Hello failing")

    err_msg = str(exc_info.value)
    assert fake_key not in err_msg
    assert "[REDACTED]" in err_msg

