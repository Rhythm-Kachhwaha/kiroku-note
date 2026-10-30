"""
Comprehensive Integration Tests for Milestone 11: Study HTTP API (/api/study/v1).
----------------------------------------------------------------------------------
Validates:
- Structured error handling (400, 404, 409, 410, 422, 503) and JSON contract
- Study bank summary, format breakdown, and blueprint readiness
- Content-addressed media streaming and missing asset handling
- Complete practice session lifecycle: creation, next item presentation, deterministic
  grading, duplicate submission handling, difficulty feedback, completion, abandonment,
  and strict concealment of answers before submission
- Complete examination lifecycle: blueprint validation, readiness rejection (409),
  peek_state polling without state mutation, section start/pause/resume/submit,
  draft answer selection, review flagging, final scoring snapshot, and result persistence
- Supporting analytics, weak areas, trouble questions, incorrect question review,
  clear bookmarks domain status reporting, study settings, and M10 diagnostics
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.main import app
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


@pytest.fixture
def study_test_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """
    Sets up an isolated temporary study database, media storage,
    and seeds sample questions and a miniature test blueprint.
    """
    study_dir = tmp_path / "study_api_test_env"
    study_dir.mkdir(parents=True, exist_ok=True)
    media_dir = study_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    store = MediaStore(media_dir)

    # 1. Register a test media file
    asset_row = store.register_bytes(
        data=b"AUDIO_TEST_DATA_MPEG_STREAM",
        extension=".mp3",
        kind="audio",
        mime_type="audio/mpeg",
        conn=conn,
        duration_ms=5000,
    )
    test_asset_id = asset_row["id"]
    test_asset_sha = asset_row["sha256"]

    # 2. Seed helper
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

    # 3. Seed 6 N5 Vocabulary questions
    for i in range(1, 7):
        _create_question("N5", "vocabulary", "kanji_reading", f"N5 Kanji Reading Question {i}")

    # 4. Seed 4 N5 Grammar questions
    for i in range(1, 5):
        _create_question("N5", "grammar", "sentential_grammar_1", f"N5 Sentential Grammar Question {i}")

    # 5. Seed 1 N5 Listening question with audio asset
    _create_question("N5", "listening", "task_based_listening", "N5 Listening Question 1", audio_asset_id=test_asset_id)

    # 6. Seed a mini test blueprint for complete exam testing
    mini_blueprint = ExamBlueprint(
        level="N5",
        version="mini_test_v1",
        name="Miniature Test Blueprint",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC_VOCAB",
                label="Vocabulary Section",
                block_order=1,
                time_limit_minutes=10,
                categories=["vocabulary"],
                item_quotas=[
                    ExamItemQuota(
                        format_code="kanji_reading",
                        target_count=1,
                        source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE,
                    )
                ],
            ),
            ExamSectionBlueprint(
                section_code="SEC_GRAMMAR",
                label="Grammar Section",
                block_order=2,
                time_limit_minutes=15,
                categories=["grammar"],
                item_quotas=[
                    ExamItemQuota(
                        format_code="sentential_grammar_1",
                        target_count=1,
                        source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE,
                    )
                ],
            ),
        ],
        scoring_sections=[
            ScoringSectionBlueprint(
                code="SCORE_KNOW",
                label="Language Knowledge",
                categories=["vocabulary", "grammar"],
                max_score=120,
                pass_threshold=38,
            ),
            ScoringSectionBlueprint(
                code="SCORE_LIST",
                label="Listening",
                categories=["listening"],
                max_score=60,
                pass_threshold=19,
            ),
        ],
    )
    save_blueprint_to_db(conn, mini_blueprint)

    client = TestClient(app)

    yield {
        "client": client,
        "manager": manager,
        "conn": conn,
        "store": store,
        "asset_id": test_asset_id,
        "asset_sha": test_asset_sha,
        "study_dir": study_dir,
    }

    manager.close_all()
    reset_study_db_manager()


# =============================================================================
# 1. Error Handling Tests
# =============================================================================

def test_structured_error_responses(study_test_env):
    client: TestClient = study_test_env["client"]

    # 404 for unknown study path
    res = client.get("/api/study/v1/nonexistent-endpoint")
    assert res.status_code == 404
    body = res.json()
    assert "error" in body
    assert body["error"]["code"] == "NOT_FOUND"

    # 400 for invalid JLPT level in blueprint route
    res = client.get("/api/study/v1/exam/blueprints/N99")
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "INVALID_LEVEL"

    # 422 for malformed JSON body
    res = client.post("/api/study/v1/practice/sessions", json={"level": "INVALID_LEVEL"})
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "validation_errors" in body["error"]["details"]

    # 404 for nonexistent practice session
    res = client.get("/api/study/v1/practice/sessions/999999")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "SESSION_NOT_FOUND"


# =============================================================================
# 2. Bank & Readiness Tests
# =============================================================================

def test_bank_summary_and_readiness(study_test_env):
    client: TestClient = study_test_env["client"]

    # Overall summary
    res = client.get("/api/study/v1/bank/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["total_questions"] >= 11
    assert data["active_questions"] >= 11
    assert data["eligible_questions"] >= 11
    assert "N5" in data["levels"]
    n5_summary = data["levels"]["N5"]
    assert n5_summary["total_count"] >= 11
    assert n5_summary["eligible_count"] >= 11

    # Level-filtered summary
    res = client.get("/api/study/v1/bank/summary?level=N5")
    assert res.status_code == 200
    data = res.json()
    assert "N5" in data["levels"]
    assert len(data["levels"]) == 1

    # Official blueprint readiness for N5 (incomplete bank will report deficits)
    res = client.get("/api/study/v1/exam/readiness?level=N5")
    assert res.status_code == 200
    data = res.json()
    assert data["level"] == "N5"
    assert data["is_ready"] is False
    assert len(data["blocked_reasons"]) > 0

    # Official blueprint fetch
    res = client.get("/api/study/v1/exam/blueprints/N5")
    assert res.status_code == 200
    bp = res.json()
    assert bp["level"] == "N5"
    assert len(bp["test_sections"]) >= 3


# =============================================================================
# 3. Media Serving Tests
# =============================================================================

def test_media_streaming(study_test_env):
    client: TestClient = study_test_env["client"]
    asset_id = study_test_env["asset_id"]
    asset_sha = study_test_env["asset_sha"]

    # By ID
    res = client.get(f"/api/study/v1/media/{asset_id}")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/mpeg"
    assert res.content == b"AUDIO_TEST_DATA_MPEG_STREAM"

    # By SHA-256
    res = client.get(f"/api/study/v1/media/{asset_sha}")
    assert res.status_code == 200
    assert res.content == b"AUDIO_TEST_DATA_MPEG_STREAM"

    # Nonexistent asset returns 404
    res = client.get("/api/study/v1/media/999999")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "ASSET_NOT_FOUND"


# =============================================================================
# 4. Practice Session Lifecycle Tests
# =============================================================================

def test_practice_session_lifecycle(study_test_env):
    client: TestClient = study_test_env["client"]

    # 1. Create Practice Session
    create_res = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "category": "vocabulary", "question_count": 2, "session_type": "standard"},
    )
    assert create_res.status_code == 201
    sess = create_res.json()
    session_id = sess["session_id"]
    assert sess["status"] == "created"
    assert sess["total_questions"] == 2
    assert len(sess["items"]) == 2

    # Verify answers and rationales are strictly concealed
    for it in sess["items"]:
        assert it["canonical_choice_id"] is None
        assert it["canonical_choice_key"] is None
        assert it["is_correct"] is None
        assert it["explanation_markup"] is None

    # 2. List sessions
    list_res = client.get("/api/study/v1/practice/sessions")
    assert list_res.status_code == 200
    assert any(s["session_id"] == session_id for s in list_res.json()["items"])

    # 3. Present next item
    next_res = client.get(f"/api/study/v1/practice/sessions/{session_id}/next")
    assert next_res.status_code == 200
    first_item = next_res.json()
    assert first_item["canonical_choice_id"] is None
    item_id = first_item["attempt_item_id"]
    choices = first_item["choices"]
    assert len(choices) == 4

    # Find the wrong choice and correct choice
    # Option 2 is seeded as correct answer
    correct_choice = next(c for c in choices if c["label"] == "2")
    wrong_choice = next(c for c in choices if c["label"] == "1")

    # 4. Submit incorrect answer
    ans_res = client.post(
        f"/api/study/v1/practice/sessions/{session_id}/answers",
        json={
            "attempt_item_id": item_id,
            "selected_choice_id": wrong_choice["choice_id"],
            "time_spent_ms": 3500,
            "difficulty_rating": "hard",
        },
    )
    assert ans_res.status_code == 200
    ans_data = ans_res.json()
    assert ans_data["is_correct"] is False
    assert ans_data["canonical_choice_id"] == correct_choice["choice_id"]
    assert ans_data["explanation_markup"] is not None

    # 5. Duplicate submission on already answered item returns 409
    dup_res = client.post(
        f"/api/study/v1/practice/sessions/{session_id}/answers",
        json={
            "attempt_item_id": item_id,
            "selected_choice_id": correct_choice["choice_id"],
            "time_spent_ms": 2000,
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["error"]["code"] == "ALREADY_ANSWERED"

    # 6. Submit difficulty feedback adjustment
    fb_res = client.post(
        f"/api/study/v1/practice/sessions/{session_id}/feedback",
        json={"attempt_item_id": item_id, "difficulty_rating": "normal"},
    )
    assert fb_res.status_code == 200
    assert fb_res.json()["status"] == "ok"

    # 7. Answer second item correctly
    second_item = sess["items"][1]
    second_c = next(c for c in second_item["choices"] if c["label"] == "2")
    ans_res2 = client.post(
        f"/api/study/v1/practice/sessions/{session_id}/answers",
        json={
            "attempt_item_id": second_item["attempt_item_id"],
            "selected_choice_id": second_c["choice_id"],
            "time_spent_ms": 2100,
            "difficulty_rating": "easy",
        },
    )
    assert ans_res2.status_code == 200
    assert ans_res2.json()["is_correct"] is True

    # 8. Check results route
    results_res = client.get(f"/api/study/v1/practice/sessions/{session_id}/results")
    assert results_res.status_code == 200
    res_body = results_res.json()
    assert res_body["status"] == "completed"
    assert res_body["answered_count"] == 2
    # In review mode, canonical choices are revealed
    assert all(it["canonical_choice_id"] is not None for it in res_body["items"])

    # 9. Check question history
    hist_res = client.get("/api/study/v1/history/questions")
    assert hist_res.status_code == 200
    assert hist_res.json()["total"] >= 1


def test_practice_session_abandon(study_test_env):
    client: TestClient = study_test_env["client"]

    create_res = client.post(
        "/api/study/v1/practice/sessions",
        json={"level": "N5", "question_count": 2},
    )
    session_id = create_res.json()["session_id"]

    abandon_res = client.post(f"/api/study/v1/practice/sessions/{session_id}/abandon")
    assert abandon_res.status_code == 200
    assert abandon_res.json()["status"] == "abandoned"

    # Attempting to answer abandoned session returns 409
    item = create_res.json()["items"][0]
    choice = item["choices"][0]
    ans_res = client.post(
        f"/api/study/v1/practice/sessions/{session_id}/answers",
        json={
            "attempt_item_id": item["attempt_item_id"],
            "selected_choice_id": choice["choice_id"],
            "time_spent_ms": 1000,
        },
    )
    assert ans_res.status_code == 409
    assert ans_res.json()["error"]["code"] == "INVALID_STATE_TRANSITION"


# =============================================================================
# 5. Examination Lifecycle Tests
# =============================================================================

def test_exam_readiness_failure(study_test_env):
    client: TestClient = study_test_env["client"]

    # Official N5 blueprint requires ~80 questions across 14 formats; bank only has 11
    res = client.post(
        "/api/study/v1/exam/sessions",
        json={"level": "N5", "enforce_readiness": True},
    )
    assert res.status_code == 409
    body = res.json()
    assert body["error"]["code"] == "READINESS_FAILED"
    assert "blocked_reasons" in body["error"]["details"]


def test_exam_lifecycle_with_saved_blueprint(study_test_env):
    client: TestClient = study_test_env["client"]

    # 1. Create exam using seeded mini_test_v1 blueprint
    create_res = client.post(
        "/api/study/v1/exam/sessions",
        json={
            "level": "N5",
            "blueprint_version": "mini_test_v1",
            "strict_timing": False,
            "seed": 42,
        },
    )
    assert create_res.status_code == 201
    exam = create_res.json()
    session_id = exam["session_id"]
    assert exam["blueprint_version"] == "mini_test_v1"
    assert len(exam["sections"]) == 2
    assert exam["total_questions"] == 2

    # Verify answers are concealed
    for it in exam["current_section_items"]:
        assert it["canonical_choice_id"] is None
        assert it["canonical_choice_key"] is None

    # 2. State polling via peek_state: verify read-only nature
    poll_res1 = client.get(f"/api/study/v1/exam/sessions/{session_id}")
    assert poll_res1.status_code == 200
    state1 = poll_res1.json()
    assert state1["server_time"] is not None

    poll_res2 = client.get(f"/api/study/v1/exam/sessions/{session_id}")
    assert poll_res2.status_code == 200
    state2 = poll_res2.json()
    assert state1["sections"][0]["status"] == state2["sections"][0]["status"]

    # 3. Start Section 1 (SEC_VOCAB)
    start_sec1 = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_VOCAB/start")
    assert start_sec1.status_code == 200
    assert start_sec1.json()["sections"][0]["status"] == "in_progress"

    # 4. Draft answer selection and flag toggle on Item 1
    item1 = start_sec1.json()["current_section_items"][0]
    item1_id = item1["attempt_item_id"]
    chosen_c = item1["choices"][1]["choice_id"]

    ans_put = client.put(
        f"/api/study/v1/exam/sessions/{session_id}/items/{item1_id}/answer",
        json={"selected_choice_id": chosen_c},
    )
    assert ans_put.status_code == 200

    flag_put = client.put(
        f"/api/study/v1/exam/sessions/{session_id}/items/{item1_id}/flag",
        json={"is_flagged": True},
    )
    assert flag_put.status_code == 200

    # 5. Pause and resume Section 1 (relaxed mode)
    pause_res = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_VOCAB/pause")
    assert pause_res.status_code == 200
    assert pause_res.json()["sections"][0]["status"] == "paused"

    resume_res = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_VOCAB/resume")
    assert resume_res.status_code == 200
    assert resume_res.json()["sections"][0]["status"] == "in_progress"

    # 6. Submit Section 1
    sub_sec1 = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_VOCAB/submit")
    assert sub_sec1.status_code == 200
    assert sub_sec1.json()["sections"][0]["status"] == "completed"

    # 7. Start Section 2 (SEC_GRAMMAR)
    start_sec2 = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_GRAMMAR/start")
    assert start_sec2.status_code == 200
    item2 = start_sec2.json()["current_section_items"][0]
    chosen_c2 = item2["choices"][1]["choice_id"]

    client.put(
        f"/api/study/v1/exam/sessions/{session_id}/items/{item2['attempt_item_id']}/answer",
        json={"selected_choice_id": chosen_c2},
    )
    sub_sec2 = client.post(f"/api/study/v1/exam/sessions/{session_id}/sections/SEC_GRAMMAR/submit")
    assert sub_sec2.status_code == 200

    # 8. Complete exam
    comp_res = client.post(f"/api/study/v1/exam/sessions/{session_id}/complete")
    assert comp_res.status_code == 200
    exam_result = comp_res.json()
    assert exam_result["is_complete"] is True
    assert "estimated_total_score" in exam_result
    assert "readiness_assessment" in exam_result

    # 9. Retrieve immutable result snapshot
    res_get = client.get(f"/api/study/v1/exam/sessions/{session_id}/result")
    assert res_get.status_code == 200
    assert res_get.json()["estimated_total_score"] == exam_result["estimated_total_score"]

    # 10. List exam history
    hist_res = client.get("/api/study/v1/exam/history")
    assert hist_res.status_code == 200
    assert any(h["session_id"] == session_id for h in hist_res.json()["items"])


def test_exam_diagnostic_endpoint(study_test_env):
    client: TestClient = study_test_env["client"]

    diag_res = client.post(
        "/api/study/v1/exam/diagnostic",
        json={"level": "N5", "question_limit_per_format": 1},
    )
    assert diag_res.status_code == 200
    diag = diag_res.json()
    assert diag["session_type"] == "practice"
    assert diag["total_questions"] >= 1


# =============================================================================
# 6. Supporting Endpoints Tests
# =============================================================================

def test_supporting_endpoints(study_test_env):
    client: TestClient = study_test_env["client"]

    # Dashboard overview
    dash_res = client.get("/api/study/v1/dashboard/overview")
    assert dash_res.status_code == 200
    assert "learning_summary" in dash_res.json()

    # Analytics overview alias
    an_res = client.get("/api/study/v1/analytics/overview")
    assert an_res.status_code == 200
    assert "learning_summary" in an_res.json()

    # Weak areas
    weak_res = client.get("/api/study/v1/analytics/weak-areas")
    assert weak_res.status_code == 200
    assert isinstance(weak_res.json(), list)

    # Trouble questions
    tr_res = client.get("/api/study/v1/analytics/trouble-questions")
    assert tr_res.status_code == 200
    assert isinstance(tr_res.json(), list)

    # Incorrect history
    inc_res = client.get("/api/study/v1/history/incorrect")
    assert inc_res.status_code == 200
    assert "items" in inc_res.json()

    # Bookmarks (unsupported report)
    bm_res = client.get("/api/study/v1/bookmarks")
    assert bm_res.status_code == 200
    bm_data = bm_res.json()
    assert bm_data["supported"] is False
    assert "not currently supported" in bm_data["message"]

    # Study settings GET and PATCH
    set_get = client.get("/api/study/v1/settings")
    assert set_get.status_code == 200
    assert set_get.json()["default_exam_mode"] == "strict"

    set_patch = client.patch("/api/study/v1/settings", json={"default_exam_mode": "relaxed"})
    assert set_patch.status_code == 200
    assert set_patch.json()["default_exam_mode"] == "relaxed"

    # M10 Read-only diagnostics
    diag_res = client.get("/api/study/v1/diagnostics")
    assert diag_res.status_code == 200
    diag_body = diag_res.json()
    assert "sqlite_integrity" in diag_body
    assert "foreign_keys" in diag_body
    assert "bank_readiness" in diag_body


def test_missing_media_and_traversal(study_test_env):
    client: TestClient = study_test_env["client"]
    conn: sqlite3.Connection = study_test_env["conn"]

    # Insert an asset marked as status='missing'
    conn.execute(
        """
        INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
        VALUES ('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff', 'audio', 'audio/mpeg', 100, '11/missing.mp3', 'missing');
        """
    )
    res = client.get("/api/study/v1/media/11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff")
    assert res.status_code == 410
    body = res.json()
    assert body["error"]["code"] == "MEDIA_MISSING"

    # Verify database rejects path traversal insertion
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
            VALUES ('aabbccddeeff11223344556677889900aabbccddeeff11223344556677889900', 'audio', 'audio/mpeg', 100, '../escaped.mp3', 'present');
            """
        )


def test_exam_section_sequence_enforcement(study_test_env):
    client: TestClient = study_test_env["client"]

    # Create exam
    create_res = client.post(
        "/api/study/v1/exam/sessions",
        json={"level": "N5", "blueprint_version": "mini_test_v1", "strict_timing": True},
    )
    exam_id = create_res.json()["session_id"]

    # Attempting to start Section 2 before Section 1 is submitted must fail with 409
    res = client.post(f"/api/study/v1/exam/sessions/{exam_id}/sections/SEC_GRAMMAR/start")
    assert res.status_code == 409
    body = res.json()
    assert body["error"]["code"] == "INVALID_SECTION_SEQUENCE"


def test_peek_state_immutability(study_test_env):
    client: TestClient = study_test_env["client"]

    create_res = client.post(
        "/api/study/v1/exam/sessions",
        json={"level": "N5", "blueprint_version": "mini_test_v1", "strict_timing": True},
    )
    exam_id = create_res.json()["session_id"]

    # Multiple state polls
    res1 = client.get(f"/api/study/v1/exam/sessions/{exam_id}")
    res2 = client.get(f"/api/study/v1/exam/sessions/{exam_id}")
    res3 = client.get(f"/api/study/v1/exam/sessions/{exam_id}")

    assert res1.status_code == 200
    assert res2.status_code == 200
    assert res3.status_code == 200

    # Ensure status remained untouched (not started or mutated)
    assert res1.json()["status"] == res2.json()["status"] == res3.json()["status"]
    assert res1.json()["sections"][0]["status"] == "pending"


def test_database_busy_mapping():
    from app.api.study.errors import map_domain_exception
    exc = sqlite3.OperationalError("database is locked")
    api_err = map_domain_exception(exc)
    assert api_err.status_code == 503
    assert api_err.code == "DATABASE_BUSY"

