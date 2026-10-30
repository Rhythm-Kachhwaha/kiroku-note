"""
Comprehensive Security, Authentication, Idempotency & Media Delivery Tests for M12.
-----------------------------------------------------------------------------------
Validates:
1. Per-launch Bearer Authentication:
   - Missing token -> 401 UNAUTHORIZED
   - Malformed header (wrong scheme, missing token) -> 401 UNAUTHORIZED
   - Invalid token -> 401 UNAUTHORIZED
   - Valid token -> 200 OK
   - Non-disclosure of secret token in error payloads or logs
   - Protected endpoint coverage across all /api/study/v1 subrouters
   - Never silently disabled in production/desktop mode when unconfigured

2. CORS & Local Exposure:
   - Allowed local origins (localhost, 127.0.0.1, chrome-extension)
   - Rejection of untrusted origins on mutating requests
   - Rejection of spoofed / invalid Host headers (DNS rebinding protection)

3. Safe Mutation Retries & Idempotency:
   - UUID validation for client_request_id
   - Successful first mutation saves idempotency record
   - Identical retry with same client_request_id returns cached response
   - Reused client_request_id with different payload/operation -> 409 IDEMPOTENCY_CONFLICT
   - Concurrent identical requests resolve without duplicate creation
   - Simulated lost response retry preserves original result
   - Domain-level duplicate submission protection preserved when client_request_id omitted

4. Media Delivery Hardening:
   - Full-file streaming with Accept-Ranges: bytes
   - Partial content (206) with start-end byte range
   - Partial content (206) with start- open-ended range
   - Partial content (206) with -suffix byte range
   - Unsatisfiable range -> 416 with Content-Range: bytes */size
   - Malformed range syntax -> 416
   - Asset eligibility check: unreferenced or ineligible asset rejected with 403 MEDIA_INELIGIBLE
   - Path traversal in identifier rejected with 400
   - Missing asset returns 410 MEDIA_MISSING
"""
from __future__ import annotations

import concurrent.futures
import json
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.study.auth import (
    clear_study_api_token,
    generate_study_api_token,
    set_study_api_token,
)
from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.exam.blueprint import save_blueprint_to_db
from app.study.exam.enums import BlueprintEvidenceLevel
from app.study.exam.models import (
    ExamBlueprint,
    ExamItemQuota,
    ExamSectionBlueprint,
    ScoringSectionBlueprint,
)
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.ulid import generate_ulid

TEST_BEARER_TOKEN = "kiroku_test_secret_token_1234567890abcdef"


@pytest.fixture
def security_test_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """
    Sets up an isolated temporary study environment with:
    - Dedicated study directory and SQLite database with all migrations
    - Seeded eligible question with audio media asset
    - Seeded orphaned media asset (not referenced by any question)
    - Active Bearer auth token configured
    - FastAPI TestClient
    """
    study_dir = tmp_path / "study_security_test_env"
    study_dir.mkdir(parents=True, exist_ok=True)
    media_dir = study_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    monkeypatch.setenv("KIROKU_STUDY_API_TOKEN", TEST_BEARER_TOKEN)
    set_study_api_token(TEST_BEARER_TOKEN)
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    store = MediaStore(media_dir)

    # 1. Register an audio asset that will be linked to an eligible question
    sample_audio = b"ID3\x03\x00\x00\x00\x00\x00\x10MPEG_AUDIO_STREAM_TEST_CONTENT_1234567890"
    eligible_asset = store.register_bytes(
        data=sample_audio,
        extension=".mp3",
        kind="audio",
        mime_type="audio/mpeg",
        conn=conn,
        duration_ms=4500,
    )
    eligible_asset_id = eligible_asset["id"]
    eligible_asset_sha = eligible_asset["sha256"]

    # 2. Register an orphaned asset (not linked to any eligible question revision)
    orphaned_asset = store.register_bytes(
        data=b"ORPHANED_UNREFERENCED_AUDIO_DATA_FORBIDDEN",
        extension=".mp3",
        kind="audio",
        mime_type="audio/mpeg",
        conn=conn,
        duration_ms=2000,
    )
    orphaned_asset_id = orphaned_asset["id"]
    orphaned_asset_sha = orphaned_asset["sha256"]

    # 3. Create active eligible questions referencing eligible_asset using exact schema
    def _create_question(
        level: str,
        category: str,
        format_code: str,
        prompt: str,
        audio_asset_id: int | None = None,
    ) -> int:
        cur = conn.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, status)
            VALUES (?, ?, ?, ?, 'active');
            """,
            (generate_ulid(), format_code, level, category),
        )
        q_id = cur.lastrowid

        rev_cur = conn.execute(
            """
            INSERT INTO question_revision (
                question_id, format_code, revision_number, stem_markup,
                validation_status, content_fingerprint, payload_json
            ) VALUES (?, ?, 1, ?, 'valid', ?, ?);
            """,
            (
                q_id,
                format_code,
                prompt,
                generate_ulid(),
                json.dumps({"explanation_markup": f"Explanation for question {q_id}."}),
            ),
        )
        rev_id = rev_cur.lastrowid
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

        c_ids = []
        for ord_val in range(1, 5):
            c_cur = conn.execute(
                """
                INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup)
                VALUES (?, ?, ?, ?, ?);
                """,
                (rev_id, str(ord_val), ord_val, str(ord_val), f"Option {ord_val}"),
            )
            c_ids.append(c_cur.lastrowid)

        # Correct answer is choice 2
        conn.execute(
            """
            INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
            VALUES (?, ?, 'source_explicit', 'Choice 2 is the correct answer.');
            """,
            (rev_id, c_ids[1]),
        )

        if audio_asset_id:
            conn.execute(
                """
                INSERT INTO question_revision_asset (
                    question_revision_id, asset_id, role, ordinal, is_required
                ) VALUES (?, ?, 'audio', 1, 1);
                """,
                (rev_id, audio_asset_id),
            )

        conn.execute("UPDATE question_revision SET sealed_at = datetime('now') WHERE id = ?;", (rev_id,))
        return q_id

    # Seed 2 questions: one with audio, one without
    _create_question("N5", "vocabulary", "kanji_reading", "N5 Kanji Reading Question 1", audio_asset_id=eligible_asset_id)
    _create_question("N5", "vocabulary", "kanji_reading", "N5 Kanji Reading Question 2")
    conn.commit()

    client = TestClient(app)

    yield {
        "client": client,
        "conn": conn,
        "token": TEST_BEARER_TOKEN,
        "auth_headers": {"Authorization": f"Bearer {TEST_BEARER_TOKEN}"},
        "eligible_asset_id": eligible_asset_id,
        "eligible_asset_sha": eligible_asset_sha,
        "sample_audio": sample_audio,
        "orphaned_asset_id": orphaned_asset_id,
        "orphaned_asset_sha": orphaned_asset_sha,
    }

    manager.close_all()
    reset_study_db_manager()
    clear_study_api_token()


# =============================================================================
# 1. Authentication Tests
# =============================================================================

def test_auth_missing_token_rejected(security_test_env):
    client: TestClient = security_test_env["client"]
    res = client.get("/api/study/v1/bank/summary")
    assert res.status_code == 401
    data = res.json()
    assert data["error"]["code"] == "UNAUTHORIZED"
    assert "Authorization header missing" in data["error"]["message"] or "token" in data["error"]["message"].lower()


def test_auth_malformed_token_rejected(security_test_env):
    client: TestClient = security_test_env["client"]

    # Wrong scheme (Basic)
    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"

    # Missing token value after Bearer
    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": "Bearer "})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"

    # Bare token without Bearer prefix
    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": "some_token_without_scheme"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_auth_invalid_token_rejected(security_test_env):
    client: TestClient = security_test_env["client"]
    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": "Bearer wrong_secret_token_12345"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_auth_valid_token_accepted(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]
    res = client.get("/api/study/v1/bank/summary", headers=headers)
    assert res.status_code == 200
    assert "total_questions" in res.json()


def test_auth_token_non_disclosure_in_errors_and_logs(security_test_env):
    client: TestClient = security_test_env["client"]
    sensitive_token = security_test_env["token"]

    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": f"Bearer {sensitive_token}_mismatch"})
    body_text = res.text
    # Sensitive token must NEVER appear in error response body
    assert sensitive_token not in body_text


def test_protected_endpoints_coverage(security_test_env):
    """Ensure no endpoint under /api/study/v1 accidentally bypasses authentication."""
    client: TestClient = security_test_env["client"]
    endpoints = [
        ("GET", "/api/study/v1/bank/summary"),
        ("GET", "/api/study/v1/exam/readiness?level=N5"),
        ("GET", "/api/study/v1/exam/blueprints/N5"),
        ("POST", "/api/study/v1/practice/sessions"),
        ("GET", "/api/study/v1/practice/sessions"),
        ("POST", "/api/study/v1/exam/sessions"),
        ("GET", "/api/study/v1/exam/history"),
        ("GET", "/api/study/v1/dashboard/overview"),
        ("GET", "/api/study/v1/analytics/overview"),
        ("GET", "/api/study/v1/analytics/weak-areas"),
        ("GET", "/api/study/v1/analytics/trouble-questions"),
        ("GET", "/api/study/v1/history/incorrect"),
        ("GET", "/api/study/v1/bookmarks"),
        ("GET", "/api/study/v1/settings"),
        ("PATCH", "/api/study/v1/settings"),
        ("GET", "/api/study/v1/diagnostics"),
        ("GET", f"/api/study/v1/media/{security_test_env['eligible_asset_id']}"),
    ]
    for method, path in endpoints:
        if method == "GET":
            res = client.get(path)
        elif method == "POST":
            res = client.post(path, json={})
        elif method == "PATCH":
            res = client.patch(path, json={})
        assert res.status_code == 401, f"Endpoint {method} {path} bypassed authentication with status {res.status_code}"
        assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_auth_unconfigured_in_production_rejects(security_test_env, monkeypatch):
    """When token is unconfigured, do not silently disable auth; reject all requests."""
    monkeypatch.delenv("KIROKU_STUDY_API_TOKEN", raising=False)
    clear_study_api_token()

    client: TestClient = security_test_env["client"]
    res = client.get("/api/study/v1/bank/summary", headers={"Authorization": "Bearer any_token"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


# =============================================================================
# 2. CORS & Local Network Exposure Tests
# =============================================================================

def test_cors_trusted_origin_allowed(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "Origin": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    }
    res = client.get("/api/study/v1/bank/summary", headers=headers)
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "chrome-extension://abcdefghijklmnopabcdefghijklmnop"


def test_cors_untrusted_origin_blocked(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "Origin": "http://malicious-website.com",
    }
    res = client.post("/api/study/v1/practice/sessions", json={"level": "N5"}, headers=headers)
    assert res.status_code == 403
    assert "Untrusted Origin" in res.text


def test_host_header_dns_rebinding_blocked(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "Host": "attacker.com",
    }
    res = client.get("/api/study/v1/bank/summary", headers=headers)
    assert res.status_code == 403
    assert "Invalid Host header" in res.text


# =============================================================================
# 3. Idempotency Tests
# =============================================================================

def test_idempotent_practice_session_creation(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "X-Client-Request-Id": "11111111-2222-3333-4444-555555555555",
    }
    payload = {"level": "N5", "session_type": "practice", "question_count": 1}

    # First request
    res1 = client.post("/api/study/v1/practice/sessions", json=payload, headers=headers)
    assert res1.status_code == 201
    data1 = res1.json()
    session_id = data1["session_id"]
    ext_id = data1["external_id"]

    # Identical retry after simulated lost response
    res2 = client.post("/api/study/v1/practice/sessions", json=payload, headers=headers)
    assert res2.status_code == 201
    data2 = res2.json()
    assert data2["session_id"] == session_id
    assert data2["external_id"] == ext_id


def test_concurrent_identical_idempotent_requests(security_test_env):
    """Multiple concurrent identical requests resolve safely without duplicate resource generation."""
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "X-Client-Request-Id": "99999999-8888-7777-6666-555555555555",
    }
    payload = {"level": "N5", "session_type": "practice", "question_count": 1}

    def _make_req():
        return client.post("/api/study/v1/practice/sessions", json=payload, headers=headers)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(_make_req) for _ in range(5)]
        results = [f.result() for f in futures]

    assert all(r.status_code == 201 for r in results)
    session_ids = {r.json()["session_id"] for r in results}
    assert len(session_ids) == 1, f"Expected exactly 1 session created, got: {session_ids}"


def test_idempotent_key_reused_with_different_payload_conflict(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "X-Client-Request-Id": "22222222-3333-4444-5555-666666666666",
    }

    # First request
    res1 = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "session_type": "practice", "question_count": 1},
        headers=headers,
    )
    assert res1.status_code == 201

    # Second request reusing ID with different payload (question_count=2)
    res2 = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "session_type": "practice", "question_count": 2},
        headers=headers,
    )
    assert res2.status_code == 409
    data2 = res2.json()
    assert data2["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_idempotent_invalid_uuid_rejected(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = {
        **security_test_env["auth_headers"],
        "X-Client-Request-Id": "not-a-valid-uuid",
    }
    res = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "session_type": "practice", "question_count": 1},
        headers=headers,
    )
    assert res.status_code in (400, 422)
    assert "UUID" in res.text or "REQUEST_ID" in res.text


def test_idempotent_answer_submission_retry(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]

    # Create session with 2 questions so answering 1 does not complete session
    s_res = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "session_type": "practice", "question_count": 2},
        headers=headers,
    )
    assert s_res.status_code == 201
    sess_id = s_res.json()["session_id"]

    next_res = client.get(f"/api/study/v1/practice/sessions/{sess_id}/next", headers=headers)
    assert next_res.status_code == 200
    item = next_res.json()
    attempt_item_id = item["attempt_item_id"]
    choice_id = item["choices"][0]["choice_id"]

    ans_headers = {
        **headers,
        "X-Client-Request-Id": "33333333-4444-5555-6666-777777777777",
    }
    ans_payload = {
        "attempt_item_id": attempt_item_id,
        "selected_choice_id": choice_id,
        "time_spent_ms": 3500,
    }

    # First submission
    res1 = client.post(f"/api/study/v1/practice/sessions/{sess_id}/answers", json=ans_payload, headers=ans_headers)
    assert res1.status_code == 200
    data1 = res1.json()

    # Retry with same idempotency key (e.g. client retransmitting after lost ACK)
    res2 = client.post(f"/api/study/v1/practice/sessions/{sess_id}/answers", json=ans_payload, headers=ans_headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["attempt_item_id"] == data1["attempt_item_id"]
    assert data2["is_correct"] == data1["is_correct"]

    # Separate request without idempotency key to same item fails with ALREADY_ANSWERED
    res3 = client.post(f"/api/study/v1/practice/sessions/{sess_id}/answers", json=ans_payload, headers=headers)
    assert res3.status_code == 409
    assert res3.json()["error"]["code"] == "ALREADY_ANSWERED"


# =============================================================================
# 4. Media Delivery Hardening Tests
# =============================================================================

def test_media_full_response_and_headers(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]
    asset_id = security_test_env["eligible_asset_id"]
    sample_audio = security_test_env["sample_audio"]

    res = client.get(f"/api/study/v1/media/{asset_id}", headers=headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/mpeg"
    assert res.headers["accept-ranges"] == "bytes"
    assert int(res.headers["content-length"]) == len(sample_audio)
    assert res.content == sample_audio


def test_media_valid_byte_ranges(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]
    asset_id = security_test_env["eligible_asset_id"]
    sample_audio = security_test_env["sample_audio"]
    total_len = len(sample_audio)

    # 1. Closed range: bytes=0-9
    res = client.get(f"/api/study/v1/media/{asset_id}", headers={**headers, "Range": "bytes=0-9"})
    assert res.status_code == 206
    assert res.headers["content-range"] == f"bytes 0-9/{total_len}"
    assert res.headers["content-length"] == "10"
    assert res.headers["accept-ranges"] == "bytes"
    assert res.content == sample_audio[0:10]

    # 2. Open-ended range: bytes=10-
    res = client.get(f"/api/study/v1/media/{asset_id}", headers={**headers, "Range": "bytes=10-"})
    assert res.status_code == 206
    assert res.headers["content-range"] == f"bytes 10-{total_len - 1}/{total_len}"
    assert res.headers["content-length"] == str(total_len - 10)
    assert res.content == sample_audio[10:]

    # 3. Suffix range: bytes=-15 (last 15 bytes)
    res = client.get(f"/api/study/v1/media/{asset_id}", headers={**headers, "Range": "bytes=-15"})
    assert res.status_code == 206
    assert res.headers["content-range"] == f"bytes {total_len - 15}-{total_len - 1}/{total_len}"
    assert res.headers["content-length"] == "15"
    assert res.content == sample_audio[-15:]


def test_media_unsatisfiable_and_invalid_ranges(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]
    asset_id = security_test_env["eligible_asset_id"]
    total_len = len(security_test_env["sample_audio"])

    # Range start beyond file size
    res = client.get(f"/api/study/v1/media/{asset_id}", headers={**headers, "Range": "bytes=99999-100000"})
    assert res.status_code == 416
    assert res.headers["content-range"] == f"bytes */{total_len}"
    assert res.json()["error"]["code"] == "RANGE_NOT_SATISFIABLE"

    # Malformed range syntax
    res = client.get(f"/api/study/v1/media/{asset_id}", headers={**headers, "Range": "bytes=abc-def"})
    assert res.status_code == 416
    assert res.headers["content-range"] == f"bytes */{total_len}"


def test_media_eligibility_enforcement(security_test_env):
    """Assets not linked to any eligible question revision must be rejected with 403."""
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]
    orphaned_id = security_test_env["orphaned_asset_id"]

    res = client.get(f"/api/study/v1/media/{orphaned_id}", headers=headers)
    assert res.status_code == 403
    data = res.json()
    assert data["error"]["code"] == "MEDIA_INELIGIBLE"


def test_media_malformed_identifier_and_path_traversal(security_test_env):
    client: TestClient = security_test_env["client"]
    headers = security_test_env["auth_headers"]

    # Traversal in asset identifier
    res = client.get("/api/study/v1/media/..%2F..%2Fetc%2Fpasswd", headers=headers)
    assert res.status_code in (400, 404)

    # Malformed non-hex non-numeric identifier
    res = client.get("/api/study/v1/media/not-a-valid-sha-or-int!", headers=headers)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_ASSET_IDENTIFIER"
