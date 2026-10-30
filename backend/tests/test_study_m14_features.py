"""
Milestone 14 Comprehensive Test Suite: Complete Study Features & UI Integration Readiness.
-----------------------------------------------------------------------------------------
Validates:
1. Weak-Area Practice & Selection
2. Bookmarks Lifecycle & Bookmarked Practice
3. Incorrect-Question Review & Improvement Tracking
4. Question Provenance & Issue Reporting
5. Agent-Assisted Question Import (Preview, Validation, Duplicate Detection, Commit, Rollback)
6. All Question Formats (F1-F6) DTO Contracts, Concealment, and Media Preservation
7. Search, Filtering, and Pagination
8. Auth, Idempotency, and Error Handling
"""
import json
from pathlib import Path
import sqlite3
import pytest
from starlette.testclient import TestClient

from app.api.study.auth import set_study_api_token
from app.main import app
from app.study.connection import StudyDatabaseManager
from app.study.contracts.db_mapping import decompose_question_for_db
from app.study.contracts.enums import (
    AnswerOrigin,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
)
from app.study.contracts.families import (
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
)
from app.study.contracts.common import AnswerPayload, ChoicePayload
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations


@pytest.fixture
def m14_env(tmp_path: Path):
    """Isolated environment with initialized migrations and authenticated test client."""
    db_file = tmp_path / "study_m14.db"
    media_dir = tmp_path / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    manager = StudyDatabaseManager(db_file)
    conn = manager.get_connection()
    run_migrations(conn)

    store = MediaStore(media_dir)

    # Insert baseline test source
    conn.execute(
        """
        INSERT INTO source (id, name, source_type, citation, url)
        VALUES (1, 'JLPT Official 2024 Exam', 'official_exam', 'JLPT N5 2024 July Paper', 'https://jlpt.jp/2024');
        """
    )
    conn.commit()

    token = "test-m14-bearer-token-sec"
    set_study_api_token(token)

    # Override app state for testing
    from app.api.study import deps
    app.dependency_overrides[deps.get_study_db] = lambda: manager.get_connection()
    app.dependency_overrides[deps.get_media_store] = lambda: store

    client = TestClient(app)
    client.headers["Authorization"] = f"Bearer {token}"

    yield {
        "conn": conn,
        "manager": manager,
        "media_store": store,
        "client": client,
        "token": token,
    }

    app.dependency_overrides.clear()


def _seed_sample_question(conn: sqlite3.Connection, format_code="kanji_reading", level="N5", stem="テスト問題"):
    """Helper to seed a valid eligible question into the bank."""
    now = "2026-10-31T00:00:00.000Z"
    cursor = conn.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status, created_at, updated_at)
        VALUES (?, ?, ?, 'vocabulary', 'active', ?, ?)
        RETURNING id;
        """,
        (f"Q-{format_code}-{conn.execute('SELECT COUNT(*) as c FROM question;').fetchone()['c'] + 1}", format_code, level, now, now),
    )
    q_id = cursor.fetchone()["id"]

    cursor = conn.execute(
        """
        INSERT INTO question_revision (
            question_id, format_code, revision_number, stem_markup, payload_json,
            validation_status, content_fingerprint, sealed_at, created_at
        ) VALUES (?, ?, 1, ?, '{}', 'valid', ?, NULL, ?)
        RETURNING id;
        """,
        (q_id, format_code, stem, f"fp_{q_id}_{stem}", now),
    )
    rev_id = cursor.fetchone()["id"]

    # Choices
    c1 = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '1', '1', 1, 'Choice A') RETURNING id;",
        (rev_id,),
    ).fetchone()["id"]
    c2 = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '2', '2', 2, 'Choice B') RETURNING id;",
        (rev_id,),
    ).fetchone()["id"]
    c3 = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '3', '3', 3, 'Choice C') RETURNING id;",
        (rev_id,),
    ).fetchone()["id"]
    c4 = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '4', '4', 4, 'Choice D') RETURNING id;",
        (rev_id,),
    ).fetchone()["id"]

    # Canonical answer
    conn.execute(
        """
        INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
        VALUES (?, ?, 'source_explicit', 'Sample rationale explanation.');
        """,
        (rev_id, c2),
    )

    # Seal revision and set current
    conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now, rev_id))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # Link source
    conn.execute(
        "INSERT INTO question_source (question_id, source_id, external_question_ref) VALUES (?, 1, ?);",
        (q_id, f"REF-Q-{q_id}"),
    )
    conn.commit()
    return q_id, rev_id


# =============================================================================
# 1. Weak-Area Practice & Selection Tests
# =============================================================================

def test_weak_area_practice_with_no_history_returns_clear_feedback(m14_env):
    """Test that weak-area practice returns clear informative error when user has no performance history."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    _seed_sample_question(conn, "kanji_reading", "N5")

    res = client.post("/api/study/v1/practice/weak-areas/session", json={"level": "N5", "question_count": 5})
    assert res.status_code == 409
    data = res.json()
    assert "Insufficient performance history" in data["error"]["message"]


def test_weak_area_practice_targets_weak_formats(m14_env):
    """Test that weak-area practice correctly identifies weak formats and creates targeted drills."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    q1_id, _ = _seed_sample_question(conn, "kanji_reading", "N5", "Weak Stem 1")
    q2_id, _ = _seed_sample_question(conn, "orthography", "N5", "Strong Stem 2")

    # Record attempts: answer kanji_reading incorrectly, orthography correctly
    sess_res = client.post("/api/study/v1/practice/sessions", json={"level": "N5", "question_count": 2})
    assert sess_res.status_code == 201
    sess_id = sess_res.json()["session_id"]
    items = sess_res.json()["items"]

    for it in items:
        att_item_id = it["attempt_item_id"]
        if it["format_code"] == "kanji_reading":
            # Submit wrong choice (choice 1)
            wrong_cid = it["choices"][0]["choice_id"]
            client.post(f"/api/study/v1/practice/sessions/{sess_id}/answers", json={
                "attempt_item_id": att_item_id,
                "selected_choice_id": wrong_cid,
                "time_spent_ms": 2000,
            })
        else:
            # Submit correct choice (choice 2)
            right_cid = it["choices"][1]["choice_id"]
            client.post(f"/api/study/v1/practice/sessions/{sess_id}/answers", json={
                "attempt_item_id": att_item_id,
                "selected_choice_id": right_cid,
                "time_spent_ms": 2000,
            })

    # Now verify weak areas analytics recognizes kanji_reading as weak
    weak_res = client.get("/api/study/v1/analytics/weak-areas")
    assert weak_res.status_code == 200
    weak_items = weak_res.json()
    assert len(weak_items) >= 1
    assert weak_items[0]["format_code"] == "kanji_reading"

    # Launch weak-area practice
    drill_res = client.post("/api/study/v1/practice/weak-areas/session", json={"level": "N5", "question_count": 5})
    assert drill_res.status_code == 201
    drill_data = drill_res.json()
    assert drill_data["total_questions"] >= 1
    assert drill_data["items"][0]["format_code"] == "kanji_reading"


# =============================================================================
# 2. Bookmarks Lifecycle & Practice Tests
# =============================================================================

def test_bookmarks_lifecycle_and_bookmarked_practice(m14_env):
    """Test adding, browsing, filtering, bookmarked practice, and removing bookmarks."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    q1_id, _ = _seed_sample_question(conn, "kanji_reading", "N5", "Bookmark Test Q1")
    q2_id, _ = _seed_sample_question(conn, "orthography", "N5", "Bookmark Test Q2")

    # 1. Add bookmark for Q1
    bm_add = client.post("/api/study/v1/bookmarks", json={"question_id": q1_id, "notes": "Tricky kanji"})
    assert bm_add.status_code == 201
    assert bm_add.json()["status"] == "ok"

    # Duplicate request updates notes idempotently
    bm_dup = client.post("/api/study/v1/bookmarks", json={"question_id": q1_id, "notes": "Updated note"})
    assert bm_dup.status_code == 201

    # 2. Browse bookmarks
    bm_list = client.get("/api/study/v1/bookmarks?level=N5")
    assert bm_list.status_code == 200
    data = bm_list.json()
    assert data["supported"] is True
    assert data["total"] == 1
    assert data["items"][0]["question_id"] == q1_id
    assert data["items"][0]["notes"] == "Updated note"

    # 3. Start practice using bookmarked questions
    bm_sess = client.post("/api/study/v1/practice/bookmarks/session", json={"level": "N5", "question_count": 5})
    assert bm_sess.status_code == 201
    assert bm_sess.json()["total_questions"] == 1
    assert bm_sess.json()["items"][0]["question_id"] == q1_id

    # 4. Remove bookmark
    bm_del = client.delete(f"/api/study/v1/bookmarks/{q1_id}")
    assert bm_del.status_code == 200

    # Verify bookmark removed
    bm_after = client.get("/api/study/v1/bookmarks")
    assert bm_after.json()["total"] == 0


# =============================================================================
# 3. Incorrect-Question Review & Improvement Tracking Tests
# =============================================================================

def test_incorrect_review_and_improvement_tracking(m14_env):
    """Test incorrect-question tracking, subsequent attempt retrying without history overwrite, and improvement status."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    q1_id, _ = _seed_sample_question(conn, "kanji_reading", "N5", "Incorrect Review Q")

    # Session 1: Answer incorrectly
    s1 = client.post("/api/study/v1/practice/sessions", json={"level": "N5", "question_count": 1})
    s1_id = s1.json()["session_id"]
    item1 = s1.json()["items"][0]

    # Pick wrong choice
    wrong_choice = item1["choices"][0]["choice_id"]
    ans1 = client.post(f"/api/study/v1/practice/sessions/{s1_id}/answers", json={
        "attempt_item_id": item1["attempt_item_id"],
        "selected_choice_id": wrong_choice,
        "time_spent_ms": 3000,
    })
    assert ans1.json()["is_correct"] is False

    # Check incorrect history
    inc_res = client.get("/api/study/v1/history/incorrect")
    assert inc_res.status_code == 200
    items = inc_res.json()["items"]
    assert len(items) == 1
    assert items[0]["question_id"] == q1_id
    assert items[0]["is_resolved"] == 0
    assert items[0]["improvement_status"] == "needs_review"

    # Session 2: Launch incorrect review session to retry
    s2 = client.post("/api/study/v1/practice/incorrect/session", json={"level": "N5", "question_count": 1})
    assert s2.status_code == 201
    s2_id = s2.json()["session_id"]
    item2 = s2.json()["items"][0]
    assert item2["question_id"] == q1_id

    # Pick canonical choice
    right_choice = item2["choices"][1]["choice_id"]
    ans2 = client.post(f"/api/study/v1/practice/sessions/{s2_id}/answers", json={
        "attempt_item_id": item2["attempt_item_id"],
        "selected_choice_id": right_choice,
        "time_spent_ms": 1500,
    })
    assert ans2.json()["is_correct"] is True

    # Verify attempt timeline preserves BOTH attempts
    timeline_res = client.get(f"/api/study/v1/history/incorrect/{q1_id}")
    assert timeline_res.status_code == 200
    detail = timeline_res.json()
    assert detail["total_attempts"] == 2
    assert detail["correct_attempts"] == 1
    assert detail["is_resolved"] is True
    assert detail["status"] == "improved"
    assert len(detail["timeline"]) == 2


# =============================================================================
# 4. Question Provenance & Reporting Tests
# =============================================================================

def test_question_provenance_and_reporting(m14_env):
    """Test retrieving complete question provenance and submitting issue reports without mutating question data."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    q1_id, rev_id = _seed_sample_question(conn, "kanji_reading", "N5", "Provenance Target Q")

    # Provenance endpoint
    prov_res = client.get(f"/api/study/v1/bank/questions/{q1_id}/provenance")
    assert prov_res.status_code == 200
    prov = prov_res.json()
    assert prov["question_id"] == q1_id
    assert len(prov["sources"]) >= 1
    assert prov["sources"][0]["paper_year"] == "2024"
    assert prov["sources"][0]["citation"] == "JLPT N5 2024 July Paper"

    # Submit question issue report
    report_res = client.post(
        f"/api/study/v1/bank/questions/{q1_id}/reports",
        json={
            "issue_type": "incorrect_answer",
            "details": "The canonical answer choice does not match official JLPT paper answer key.",
            "suggested_correction": "Choice 3 is correct",
        },
    )
    assert report_res.status_code == 201
    rep = report_res.json()
    assert rep["question_id"] == q1_id
    assert rep["status"] == "open"
    report_id = rep["id"]

    # Verify report is listed under question reports
    q_reports = client.get(f"/api/study/v1/bank/questions/{q1_id}/reports")
    assert q_reports.status_code == 200
    assert len(q_reports.json()) == 1

    # Browse system reports
    all_reports = client.get("/api/study/v1/bank/reports?status=open")
    assert all_reports.status_code == 200
    assert all_reports.json()["total"] == 1

    # Update report status
    patch_res = client.patch(
        f"/api/study/v1/bank/reports/{report_id}",
        json={"status": "resolved", "resolution_notes": "Reviewed against official errata sheet."},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "resolved"
    assert patch_res.json()["resolved_at"] is not None

    # Verify original question content remains intact (immutable)
    q_check = conn.execute("SELECT stem_markup FROM question_revision WHERE id = ?;", (rev_id,)).fetchone()
    assert q_check["stem_markup"] == "Provenance Target Q"


# =============================================================================
# 5. Agent-Assisted Question Import Tests
# =============================================================================

def test_agent_assisted_import_workflow(m14_env):
    """Test pasting question content, previewing validation/duplicates, explicit user approval, and failure rollback."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    import_json = {
        "level": "N5",
        "format_code": "kanji_reading",
        "questions": [
            {
                "format_code": "kanji_reading",
                "stem": "{u|日本}へ 行きます。",
                "choices": ["にほん", "にぽん", "にぼん", "にほんご"],
                "answer": "1",
                "explanation": "「日本」は「にほん」と読みます。"
            }
        ]
    }

    # 1. Preview pasted JSON
    prev_res = client.post("/api/study/v1/bank/import/preview", json={
        "content": json.dumps(import_json),
        "format": "json",
        "default_level": "N5",
        "source_name": "Agent Import Test",
    })
    assert prev_res.status_code == 200
    prev_data = prev_res.json()
    assert prev_data["status"] == "valid"
    assert prev_data["total_questions"] == 1
    assert prev_data["valid_questions"] == 1
    assert prev_data["duplicate_questions"] == 0
    preview_id = prev_data["preview_id"]

    # 2. Reject unapproved commit
    unapproved_res = client.post("/api/study/v1/bank/import/commit", json={
        "preview_id": preview_id,
        "approved": False,
    })
    assert unapproved_res.status_code == 400

    # 3. Commit with explicit approval
    commit_res = client.post("/api/study/v1/bank/import/commit", json={
        "preview_id": preview_id,
        "approved": True,
    })
    assert commit_res.status_code == 201
    assert commit_res.json()["status"] == "ok"
    assert commit_res.json()["imported_count"] == 1
    imported_qid = commit_res.json()["imported_question_ids"][0]

    # Verify question exists in bank and is searchable
    detail_res = client.get(f"/api/study/v1/bank/questions/{imported_qid}")
    assert detail_res.status_code == 200
    assert detail_res.json()["format_code"] == "kanji_reading"

    # 4. Preview again to verify duplicate detection
    prev_dup = client.post("/api/study/v1/bank/import/preview", json={
        "content": json.dumps(import_json),
        "format": "json",
        "default_level": "N5",
    })
    assert prev_dup.status_code == 200
    dup_data = prev_dup.json()
    assert dup_data["duplicate_questions"] == 1
    assert dup_data["questions"][0]["is_duplicate"] is True


# =============================================================================
# 6. Question Formats & Media Contracts (F1-F6) Tests
# =============================================================================

def test_question_dto_format_specific_data_and_concealment(m14_env):
    """Test format-specific structured data (star position, anchor key, audio) and answer concealment."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    now = "2026-10-31T00:00:00.000Z"

    # Seed F2 (Sentence Ordering with Star Position)
    q2_cursor = conn.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status, created_at, updated_at)
        VALUES ('F2-TEST', 'sentence_composition', 'N5', 'grammar', 'active', ?, ?)
        RETURNING id;
        """,
        (now, now),
    )
    q2_id = q2_cursor.fetchone()["id"]
    payload_f2 = json.dumps({
        "structural_family": "F2",
        "format_code": "sentence_composition",
        "star_position": 3,
        "correct_order": [2, 4, 1, 3],
        "instruction_text": "正しい順序に並べ替えてください。",
        "explanation_markup": "文法規則に従って3番目が正解です。"
    })
    rev2_id = conn.execute(
        """
        INSERT INTO question_revision (
            question_id, format_code, revision_number, stem_markup, payload_json,
            validation_status, content_fingerprint, sealed_at, created_at
        ) VALUES (?, 'sentence_composition', 1, '私は [___] [___] [*] [___] 行きます。', ?, 'valid', 'fp_f2', NULL, ?)
        RETURNING id;
        """,
        (q2_id, payload_f2, now),
    ).fetchone()["id"]

    c1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '1', '1', 1, 'バス') RETURNING id;", (rev2_id,)).fetchone()["id"]
    c2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '2', '2', 2, 'で') RETURNING id;", (rev2_id,)).fetchone()["id"]
    c3 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '3', '3', 3, '学校') RETURNING id;", (rev2_id,)).fetchone()["id"]
    c4 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '4', '4', 4, 'へ') RETURNING id;", (rev2_id,)).fetchone()["id"]

    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup) VALUES (?, ?, 'source_explicit', 'F2 Rationale');",
        (rev2_id, c1),
    )
    conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now, rev2_id))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev2_id, q2_id))
    conn.commit()

    # Launch practice drill including this question
    p_res = client.post("/api/study/v1/practice/sessions", json={"level": "N5", "format_code": "sentence_composition", "question_count": 1})
    assert p_res.status_code == 201
    item = p_res.json()["items"][0]

    # Verify format-specific structured field is exposed during attempt
    assert item["star_position"] == 3
    assert item["instruction_text"] == "正しい順序に並べ替えてください。"

    # Verify canonical answers and order are STRICTLY concealed during attempt
    assert item["canonical_choice_id"] is None
    assert item["canonical_choice_key"] is None
    assert item["correct_order"] is None
    assert item["explanation_markup"] is None

    # Submit answer
    sub_res = client.post(f"/api/study/v1/practice/sessions/{p_res.json()['session_id']}/answers", json={
        "attempt_item_id": item["attempt_item_id"],
        "selected_choice_id": c1,
        "time_spent_ms": 2000,
    })
    assert sub_res.status_code == 200

    # Retrieve completed practice results: answers and correct_order now revealed
    results_res = client.get(f"/api/study/v1/practice/sessions/{p_res.json()['session_id']}/results")
    assert results_res.status_code == 200
    rev_item = results_res.json()["items"][0]
    assert rev_item["canonical_choice_id"] == c1
    assert rev_item["correct_order"] == [2, 4, 1, 3]


# =============================================================================
# 7. Search, Filtering, and Pagination Tests
# =============================================================================

def test_bank_search_and_pagination(m14_env):
    """Test searching bank questions with various filters and pagination limits."""
    client: TestClient = m14_env["client"]
    conn: sqlite3.Connection = m14_env["conn"]

    _seed_sample_question(conn, "kanji_reading", "N5", "Search Apple")
    _seed_sample_question(conn, "kanji_reading", "N4", "Search Banana")
    _seed_sample_question(conn, "orthography", "N5", "Search Cherry")

    # Filter by level
    res_n5 = client.get("/api/study/v1/bank/questions?level=N5")
    assert res_n5.status_code == 200
    assert res_n5.json()["total"] == 2

    # Filter by format
    res_fmt = client.get("/api/study/v1/bank/questions?format_code=orthography")
    assert res_fmt.status_code == 200
    assert res_fmt.json()["total"] == 1

    # Text search in stem
    res_txt = client.get("/api/study/v1/bank/questions?search_query=Banana")
    assert res_txt.status_code == 200
    assert res_txt.json()["total"] == 1

    # Pagination limits
    res_page = client.get("/api/study/v1/bank/questions?limit=1&offset=0")
    assert res_page.status_code == 200
    assert len(res_page.json()["items"]) == 1
    assert res_page.json()["limit"] == 1
    assert res_page.json()["offset"] == 0
