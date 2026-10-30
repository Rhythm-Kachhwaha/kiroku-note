"""
Targeted Tests for Milestone 8: Core Reliability.
------------------------------------------------
Comprehensive tests covering transaction safety, unit of work, nested SAVEPOINTs,
pure read peek_state(), idempotent timer settlement, fault injection, rollback atomicity,
and concurrency safety.

Scenarios verified:
1. Unit of work commit on success and rollback on exception.
2. Nested unit-of-work SAVEPOINT rollback and successful completion.
3. Failure halfway through practice-session creation leaves no partial records.
4. Failure halfway through examination creation leaves no partial records.
5. Failure during answer submission rolls back response, feedback, and adaptive state.
6. Failure during exam finalization and snapshot creation rolls back completion and snapshot.
7. Rollback leaves no partial records across multi-statement operations.
8. Repeated peek_state() calls do not mutate database state.
9. Concurrent expiry requests settle a section exactly once without duplicate responses.
10. Concurrent answer submissions do not create duplicate responses.
11. Multiple independent SQLite connections behave correctly in WAL mode.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import threading
from typing import Any, Tuple
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.exam import (
    BlueprintEvidenceLevel,
    DEFAULT_BLUEPRINT_VERSION,
    ExamBlueprint,
    ExamItemQuota,
    ExamSectionBlueprint,
    ExamSectionStatus,
    ExamSessionService,
    ScoringSectionBlueprint,
)
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.session import (
    AlreadyAnsweredError,
    DifficultyRating,
    PracticeSessionConfig,
    PracticeSessionService,
    SessionStatus,
    SessionType,
)
from app.study.tx import unit_of_work
from app.study.ulid import generate_ulid


# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------

@pytest.fixture
def reliability_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """
    Isolated test environment with all migrations applied.
    """
    study_dir = tmp_path / "study_reliability_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    media_store = MediaStore(study_dir / "media")

    def create_synthetic_question(
        level: str = "N5",
        category: str = "vocabulary",
        format_code: str = "kanji_reading",
        prompt: str = "Test prompt",
        choices_count: int = 4,
        canonical_choice: int = 1,
    ) -> Tuple[int, int]:
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
                validation_status, content_fingerprint
            ) VALUES (?, ?, 1, ?, 'valid', ?);
            """,
            (q_id, format_code, prompt, generate_ulid()),
        )
        rev_id = rev_cur.lastrowid
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

        c_ids = []
        for i in range(1, choices_count + 1):
            c_cur = conn.execute(
                """
                INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup)
                VALUES (?, ?, ?, ?, ?);
                """,
                (rev_id, str(i), i, str(i), f"Option {i}"),
            )
            c_ids.append(c_cur.lastrowid)

        conn.execute(
            """
            INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
            VALUES (?, ?, 'source_explicit', 'Correct rationale');
            """,
            (rev_id, c_ids[canonical_choice - 1]),
        )

        conn.execute("UPDATE question_revision SET sealed_at = datetime('now') WHERE id = ?;", (rev_id,))
        return q_id, rev_id

    yield conn, manager, media_store, create_synthetic_question, db_path
    conn.close()


def create_mini_blueprint(level: str = "N5", quota_count: int = 2) -> ExamBlueprint:
    return ExamBlueprint(
        level=level,
        version="mini_reliability_test",
        name="Mini Reliability Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="TEST_SEC_1",
                label="Section 1",
                block_order=1,
                time_limit_minutes=10,
                categories=["vocabulary"],
                item_quotas=[
                    ExamItemQuota(
                        format_code="kanji_reading",
                        target_count=quota_count,
                        source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE,
                    )
                ],
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(
                code="SCORE_VOCAB",
                label="Vocabulary",
                categories=["vocabulary"],
                max_score=180,
                pass_threshold=80,
            )
        ],
    )


# -----------------------------------------------------------------------------
# 1. Transaction Safety & Nested Unit of Work
# -----------------------------------------------------------------------------

def test_unit_of_work_commit_and_rollback(reliability_env):
    """Verify unit_of_work commits on success and rolls back on exception."""
    conn, manager, _, _, db_path = reliability_env

    # 1. Successful commit
    with unit_of_work(conn):
        conn.execute(
            """
            INSERT INTO test_attempt (
                external_id, session_type, status, level, category, format_code,
                recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
            ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 1, datetime('now'), NULL, 0);
            """,
            (generate_ulid(),),
        )

    count_after_commit = conn.execute("SELECT COUNT(*) FROM test_attempt;").fetchone()[0]
    assert count_after_commit == 1

    # 2. Rollback on exception
    with pytest.raises(RuntimeError, match="abort test"):
        with unit_of_work(conn):
            conn.execute(
                """
                INSERT INTO test_attempt (
                    external_id, session_type, status, level, category, format_code,
                    recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
                ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 2, datetime('now'), NULL, 0);
                """,
                (generate_ulid(),),
            )
            raise RuntimeError("abort test")

    count_after_rollback = conn.execute("SELECT COUNT(*) FROM test_attempt;").fetchone()[0]
    assert count_after_rollback == 1  # The second insert must not exist


def test_nested_unit_of_work_savepoint_rollback_and_completion(reliability_env):
    """
    Verify nested unit_of_work uses SAVEPOINTs:
    - Inner savepoint rollback does not abort outer transaction if caught.
    - Outer commit preserves outer changes while discarding rolled back inner changes.
    """
    conn, _, _, _, _ = reliability_env
    id_outer_1 = generate_ulid()
    id_inner = generate_ulid()
    id_outer_2 = generate_ulid()

    with unit_of_work(conn):
        # Outer write 1
        conn.execute(
            """
            INSERT INTO test_attempt (
                external_id, session_type, status, level, category, format_code,
                recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
            ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 101, datetime('now'), NULL, 0);
            """,
            (id_outer_1,),
        )

        # Nested unit_of_work that fails and is caught
        try:
            with unit_of_work(conn):
                conn.execute(
                    """
                    INSERT INTO test_attempt (
                        external_id, session_type, status, level, category, format_code,
                        recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
                    ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 102, datetime('now'), NULL, 0);
                    """,
                    (id_inner,),
                )
                raise ValueError("Nested failure inside savepoint")
        except ValueError:
            pass

        # Outer write 2
        conn.execute(
            """
            INSERT INTO test_attempt (
                external_id, session_type, status, level, category, format_code,
                recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
            ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 103, datetime('now'), NULL, 0);
            """,
            (id_outer_2,),
        )

    # Outer 1 and Outer 2 must exist, but Inner must NOT exist
    rows = conn.execute("SELECT external_id FROM test_attempt;").fetchall()
    ext_ids = {r["external_id"] for r in rows}
    assert id_outer_1 in ext_ids
    assert id_outer_2 in ext_ids
    assert id_inner not in ext_ids

    # Also verify unhandled nested exception rolls back outer transaction
    id_outer_3 = generate_ulid()
    id_inner_3 = generate_ulid()
    with pytest.raises(RuntimeError, match="Uncaught nested error"):
        with unit_of_work(conn):
            conn.execute(
                """
                INSERT INTO test_attempt (
                    external_id, session_type, status, level, category, format_code,
                    recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
                ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 104, datetime('now'), NULL, 0);
                """,
                (id_outer_3,),
            )
            with unit_of_work(conn):
                conn.execute(
                    """
                    INSERT INTO test_attempt (
                        external_id, session_type, status, level, category, format_code,
                        recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
                    ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 105, datetime('now'), NULL, 0);
                    """,
                    (id_inner_3,),
                )
                raise RuntimeError("Uncaught nested error")

    rows_after = conn.execute("SELECT external_id FROM test_attempt;").fetchall()
    ext_ids_after = {r["external_id"] for r in rows_after}
    assert id_outer_3 not in ext_ids_after
    assert id_inner_3 not in ext_ids_after


# -----------------------------------------------------------------------------
# 2. Practice Session Failure & Atomicity Tests
# -----------------------------------------------------------------------------

class FaultyConnectionProxy:
    """Proxy wrapping sqlite3.Connection to allow injecting faults on specific queries."""

    def __init__(self, target: sqlite3.Connection, fault_predicate):
        self._target = target
        self._fault_predicate = fault_predicate

    def execute(self, sql: str, *args, **kwargs):
        self._fault_predicate(sql)
        return self._target.execute(sql, *args, **kwargs)

    def __getattr__(self, name: str):
        return getattr(self._target, name)


def test_practice_session_creation_failure_leaves_no_partial_records(reliability_env):
    """
    Fault injection: failure during attempt_item persistence rolls back the entire
    practice session creation, leaving zero records in test_attempt and attempt_item.
    """
    conn, _, _, seed_q, _ = reliability_env
    for i in range(3):
        seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt=f"Q{i}")

    call_counter = [0]

    def fault_predicate(sql: str):
        if "INSERT INTO attempt_item " in sql:
            call_counter[0] += 1
            if call_counter[0] == 2:
                raise RuntimeError("Fault injected during attempt_item insertion")

    proxy_conn = FaultyConnectionProxy(conn, fault_predicate)
    service = PracticeSessionService(proxy_conn)
    config = PracticeSessionConfig(level="N5", category="vocabulary", question_count=3, seed=42)

    with pytest.raises(RuntimeError, match="Fault injected during attempt_item insertion"):
        service.create_session(config)

    # Ensure zero partial records survived in the underlying database
    assert conn.execute("SELECT COUNT(*) FROM test_attempt;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM attempt_item;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM attempt_item_choice_order;").fetchone()[0] == 0


def test_practice_answer_submission_failure_rolls_back_cleanly(reliability_env, monkeypatch):
    """
    Fault injection: failure during adaptive state update in submit_answer rolls back
    response table insertion and test_attempt time elapsed updates.
    """
    conn, _, _, seed_q, _ = reliability_env
    seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt="Q1")

    service = PracticeSessionService(conn)
    config = PracticeSessionConfig(level="N5", category="vocabulary", question_count=1, seed=42)
    session = service.create_session(config)
    item = session.items[0]

    # Monkeypatch adaptive state updater to crash
    def faulty_update_adaptive(*args, **kwargs):
        raise RuntimeError("Simulated crash in adaptive state update")

    monkeypatch.setattr(
        "app.study.session.service.update_question_adaptive_state",
        faulty_update_adaptive,
    )

    with pytest.raises(RuntimeError, match="Simulated crash in adaptive state update"):
        service.submit_answer(
            session_id=session.session_id,
            attempt_item_id=item.attempt_item_id,
            selected_choice_id=item.choices[0].choice_id,
            time_spent_ms=4500,
            difficulty_rating=DifficultyRating.NORMAL,
        )

    # Verify atomic rollback
    assert conn.execute("SELECT COUNT(*) FROM response;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM attempt_item_feedback;").fetchone()[0] == 0

    attempt_row = conn.execute("SELECT total_elapsed_ms, status FROM test_attempt WHERE id = ?;", (session.session_id,)).fetchone()
    assert attempt_row["total_elapsed_ms"] == 0
    assert attempt_row["status"] == SessionStatus.CREATED.value


# -----------------------------------------------------------------------------
# 3. Examination Failure & Atomicity Tests
# -----------------------------------------------------------------------------

def test_exam_creation_failure_leaves_no_partial_records(reliability_env):
    """
    Fault injection: failure halfway through examination creation rolls back
    all exam_section_attempt, attempt_item, and exam_item_state rows.
    """
    conn, _, media_store, seed_q, _ = reliability_env
    for i in range(2):
        seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt=f"ExamQ{i}")

    call_counter = [0]

    def fault_predicate(sql: str):
        if "INSERT INTO exam_item_state" in sql:
            call_counter[0] += 1
            if call_counter[0] == 2:
                raise RuntimeError("Fault injected during exam_item_state insertion")

    proxy_conn = FaultyConnectionProxy(conn, fault_predicate)
    service = ExamSessionService(proxy_conn, media_store=media_store)
    blueprint = create_mini_blueprint("N5", quota_count=2)

    with pytest.raises(RuntimeError, match="Fault injected during exam_item_state insertion"):
        service.create_examination(blueprint, seed=123)

    assert conn.execute("SELECT COUNT(*) FROM test_attempt;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM exam_section_attempt;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM attempt_item;").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM exam_item_state;").fetchone()[0] == 0


def test_exam_finalization_failure_rolls_back_snapshot(reliability_env, monkeypatch):
    """
    Fault injection: failure during scoring model calculation rolls back
    exam_result_snapshot and preserves test_attempt status as in_progress.
    """
    conn, _, media_store, seed_q, _ = reliability_env
    for i in range(2):
        seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt=f"ExamQ{i}")

    service = ExamSessionService(conn, media_store=media_store)
    blueprint = create_mini_blueprint("N5", quota_count=2)
    state = service.create_examination(blueprint, seed=123)
    service.start_section(state.session_id, block_order=1)

    # Monkeypatch scoring model to crash
    def faulty_calculate_scores(*args, **kwargs):
        raise RuntimeError("Crash inside scoring algorithm")

    monkeypatch.setattr(service.scoring_model, "calculate_scores", faulty_calculate_scores)

    with pytest.raises(RuntimeError, match="Crash inside scoring algorithm"):
        service.complete_exam(state.session_id)

    # Verify exam_result_snapshot was NOT written and attempt is not completed
    assert conn.execute("SELECT COUNT(*) FROM exam_result_snapshot;").fetchone()[0] == 0
    att_row = conn.execute("SELECT status FROM test_attempt WHERE id = ?;", (state.session_id,)).fetchone()
    assert att_row["status"] == SessionStatus.IN_PROGRESS.value


# -----------------------------------------------------------------------------
# 4. Pure Reads & Idempotent Timer Settlement
# -----------------------------------------------------------------------------

def test_peek_state_is_pure_read_and_does_not_mutate(reliability_env):
    """
    Verify peek_state() is a 100% pure read operation:
    - Calculates remaining time in memory from the stored deadline.
    - Never mutates SQLite tables (no updates to remaining_time_seconds, no status transitions).
    - Can be called repeatedly during UI polling without disk writes.
    """
    conn, _, media_store, seed_q, _ = reliability_env
    for i in range(2):
        seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt=f"ExamQ{i}")

    service = ExamSessionService(conn, media_store=media_store)
    blueprint = create_mini_blueprint("N5", quota_count=2)
    state = service.create_examination(blueprint, seed=123)
    started = service.start_section(state.session_id, block_order=1)

    # Inspect initial DB row
    sec_row_before = conn.execute(
        "SELECT status, remaining_time_seconds, deadline_at, completed_at FROM exam_section_attempt WHERE id = ?;",
        (started.sections[0].section_id,),
    ).fetchone()

    # Simulate deadline expiring into the past
    past_iso = "2020-01-01T00:00:00+00:00"
    conn.execute(
        "UPDATE exam_section_attempt SET deadline_at = ? WHERE id = ?;",
        (past_iso, started.sections[0].section_id),
    )

    # Call peek_state 10 times consecutively
    for _ in range(10):
        peeked = service.peek_state(state.session_id)
        # In memory, remaining time is calculated as 0
        assert peeked.sections[0].remaining_time_seconds == 0

    # Verify that in SQLite, peek_state did NOT write or settle anything:
    sec_row_after = conn.execute(
        "SELECT status, remaining_time_seconds, deadline_at, completed_at FROM exam_section_attempt WHERE id = ?;",
        (started.sections[0].section_id,),
    ).fetchone()

    # DB status is still in_progress, completed_at is still NULL, and no responses were committed
    assert sec_row_after["status"] == ExamSectionStatus.IN_PROGRESS.value
    assert sec_row_after["completed_at"] is None
    assert conn.execute("SELECT COUNT(*) FROM response;").fetchone()[0] == 0


def test_concurrent_settle_timers_settles_section_exactly_once(reliability_env):
    """
    Verify settle_timers() uses conditional state transitions:
    - Multiple concurrent settle requests on an expired section settle it exactly once.
    - Exactly one call claims the expired section and commits responses.
    - Duplicate response inserts and integrity errors are avoided.
    """
    conn, manager, media_store, seed_q, db_path = reliability_env
    for i in range(2):
        seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt=f"ExamQ{i}")

    service = ExamSessionService(conn, media_store=media_store)
    blueprint = create_mini_blueprint("N5", quota_count=2)
    state = service.create_examination(blueprint, seed=123)
    service.start_section(state.session_id, block_order=1)

    # Answer one item
    item_id = state.current_section_items[0].attempt_item_id
    choice_id = state.current_section_items[0].choices[0].choice_id
    service.select_choice(state.session_id, item_id, choice_id)

    # Set deadline in the past
    conn.execute(
        "UPDATE exam_section_attempt SET deadline_at = ? WHERE id = ?;",
        ("2020-01-01T00:00:00+00:00", state.sections[0].section_id),
    )

    # Prepare two separate connections
    conn1 = manager.get_connection()
    conn2 = manager.get_connection()

    srv1 = ExamSessionService(conn1, media_store=media_store)
    srv2 = ExamSessionService(conn2, media_store=media_store)

    results = []
    errors = []

    def run_settle(srv):
        try:
            res = srv.settle_timers(state.session_id)
            results.append(res)
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=run_settle, args=(srv1,))
    t2 = threading.Thread(target=run_settle, args=(srv2,))

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    conn1.close()
    conn2.close()

    assert not errors, f"Concurrent settle raised errors: {errors}"
    assert len(results) == 2

    # Exactly one thread claimed the section expiry
    claimed_counts = [len(r) for r in results]
    assert sorted(claimed_counts) == [0, 1]

    # Verify response table has exactly 1 response for the answered item
    resp_count = conn.execute("SELECT COUNT(*) FROM response WHERE attempt_item_id = ?;", (item_id,)).fetchone()[0]
    assert resp_count == 1

    # Section is marked expired in DB
    sec_row = conn.execute("SELECT status FROM exam_section_attempt WHERE id = ?;", (state.sections[0].section_id,)).fetchone()
    assert sec_row["status"] == ExamSectionStatus.EXPIRED.value


# -----------------------------------------------------------------------------
# 5. Concurrency & Independent Connections
# -----------------------------------------------------------------------------

def test_concurrent_answer_submissions_no_duplicates(reliability_env):
    """
    Verify concurrent answer submissions on the same item do not produce duplicate rows
    or integrity constraint crashes: one succeeds, other receives AlreadyAnsweredError.
    """
    conn, manager, _, seed_q, _ = reliability_env
    seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt="Q1")
    seed_q(level="N5", category="vocabulary", format_code="kanji_reading", prompt="Q2")

    service = PracticeSessionService(conn)
    config = PracticeSessionConfig(level="N5", category="vocabulary", question_count=2, seed=42)
    session = service.create_session(config)
    item = session.items[0]

    conn1 = manager.get_connection()
    conn2 = manager.get_connection()

    srv1 = PracticeSessionService(conn1)
    srv2 = PracticeSessionService(conn2)

    successes = []
    already_answered = []
    other_errors = []

    def submit(srv):
        try:
            res = srv.submit_answer(
                session_id=session.session_id,
                attempt_item_id=item.attempt_item_id,
                selected_choice_id=item.choices[0].choice_id,
                time_spent_ms=2000,
            )
            successes.append(res)
        except AlreadyAnsweredError as e:
            already_answered.append(e)
        except Exception as e:
            other_errors.append(e)

    t1 = threading.Thread(target=submit, args=(srv1,))
    t2 = threading.Thread(target=submit, args=(srv2,))

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    conn1.close()
    conn2.close()

    assert not other_errors, f"Unexpected errors during concurrent submit: {other_errors}"
    assert len(successes) == 1
    assert len(already_answered) == 1

    # Exactly one response row in table
    resp_count = conn.execute("SELECT COUNT(*) FROM response WHERE attempt_item_id = ?;", (item.attempt_item_id,)).fetchone()[0]
    assert resp_count == 1


def test_multiple_independent_sqlite_connections(reliability_env):
    """
    Verify WAL-mode isolation and immediate visibility across independent connections.
    """
    _, manager, _, _, _ = reliability_env
    conn1 = manager.get_connection()
    conn2 = manager.get_connection()

    # Connection 1 writes inside unit_of_work
    test_ext_id = generate_ulid()
    with unit_of_work(conn1):
        conn1.execute(
            """
            INSERT INTO test_attempt (
                external_id, session_type, status, level, category, format_code,
                recipe_snapshot_json, seed, created_at, started_at, total_elapsed_ms
            ) VALUES (?, 'practice', 'created', 'N5', NULL, NULL, '{}', 999, datetime('now'), NULL, 0);
            """,
            (test_ext_id,),
        )

    # After commit, connection 2 can immediately read the record
    row = conn2.execute("SELECT id, status FROM test_attempt WHERE external_id = ?;", (test_ext_id,)).fetchone()
    assert row is not None
    assert row["status"] == "created"

    conn1.close()
    conn2.close()
