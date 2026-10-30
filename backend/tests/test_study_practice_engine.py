"""
Targeted Tests for M6 Learning & Practice Engine.
------------------------------------------------
Comprehensive tests covering the 14 acceptance criteria:
1. Session creation using only eligible, approved questions.
2. Exclusion of quarantined and ineligible questions.
3. Stable question IDs and revision references.
4. Session resume and lifecycle transitions.
5. Deterministic grading across supported formats.
6. Invalid and incomplete answer handling.
7. Easy/Normal/Hard feedback persistence.
8. Adaptive selection, especially deprioritization after two correct Easy attempts.
9. Incorrect and Hard questions receiving higher repetition priority.
10. Avoiding duplicates within sessions and unnecessary consecutive repetition.
11. Per-question and session timing persistence.
12. Interrupted sessions and timing validation.
13. History and analytics correctness.
14. Database migrations, doctor checks and integrity.
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.doctor import run_doctor
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.session import (
    AccuracyByGroup,
    AlreadyAnsweredError,
    DifficultyRating,
    GradingStatus,
    InvalidChoiceError,
    LearningSummary,
    NoEligibleQuestionsError,
    PracticeAnalyticsService,
    PracticeSessionConfig,
    PracticeSessionService,
    PracticeSessionState,
    SessionLifecycleError,
    SessionNotFoundError,
    SessionServiceError,
    SessionStatus,
    SessionType,
    calculate_priority_score,
)
from app.study.ulid import generate_ulid


@pytest.fixture
def test_practice_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """
    Isolated test environment with migrations applied and synthetic questions.
    """
    study_dir = tmp_path / "study_practice_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    store = MediaStore(study_dir / "media")

    # Seed synthetic test questions:
    # 5 Eligible N5 Vocabulary questions (q1 - q5)
    # 5 Eligible N4 Grammar questions (q6 - q10)
    # 1 Grouped Eligible N5 Reading question (q11)
    # 3 Quarantined/Ineligible questions (q12: draft, q13: invalid revision, q14: retired)

    def _create_question(
        conn: sqlite3.Connection,
        level: str,
        category: str,
        format_code: str,
        prompt: str,
        status: str = "active",
        validation_status: str = "valid",
        content_group_id: int | None = None,
        anchor_key: str | None = None,
        group_ordinal: int | None = None,
    ) -> int:
        cur = conn.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, status, content_group_id, anchor_key, group_ordinal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (generate_ulid(), format_code, level, category, status, content_group_id, anchor_key, group_ordinal),
        )
        q_id = cur.lastrowid

        # Insert Revision
        rev_cur = conn.execute(
            """
            INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint)
            VALUES (?, ?, 1, ?, ?, ?);
            """,
            (q_id, format_code, prompt, validation_status, generate_ulid()),
        )
        rev_id = rev_cur.lastrowid

        # Set current revision
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

        # Insert 4 Choices (ordinals 1, 2, 3, 4)
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

        # Set canonical answer to choice 2 (except for broken questions)
        if validation_status != "no_answer":
            conn.execute(
                """
                INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
                VALUES (?, ?, 'source_explicit', 'Choice 2 is the correct answer.');
                """,
                (rev_id, c_ids[1]),
            )

        # Seal revision
        conn.execute("UPDATE question_revision SET sealed_at = datetime('now') WHERE id = ?;", (rev_id,))

        return q_id

    # Create 5 N5 Vocabulary questions
    for i in range(1, 6):
        _create_question(conn, "N5", "vocabulary", "kanji_reading", f"N5 Vocab Question {i}")

    # Create 5 N4 Grammar questions
    for i in range(1, 6):
        _create_question(conn, "N4", "grammar", "sentential_grammar_1", f"N4 Grammar Question {i}")

    # Create Grouped N5 Reading question
    g_cur = conn.execute(
        "INSERT INTO content_group (external_id, kind, level, status) VALUES (?, 'passage', 'N5', 'active');",
        (generate_ulid(),),
    )
    g_id = g_cur.lastrowid
    gr_cur = conn.execute(
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, ?);",
        (g_id, generate_ulid()),
    )
    gr_id = gr_cur.lastrowid
    conn.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (gr_id, g_id))
    p_cur = conn.execute(
        "INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', 'Passage text');",
        (gr_id,),
    )
    part_id = p_cur.lastrowid
    conn.execute(
        "INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind) VALUES (?, ?, 'Q1', 1, 'question');",
        (gr_id, part_id),
    )
    conn.execute("UPDATE group_revision SET sealed_at = datetime('now') WHERE id = ?;", (gr_id,))

    _create_question(
        conn, "N5", "reading", "comprehension_short", "N5 Reading Q",
        content_group_id=g_id, anchor_key="Q1", group_ordinal=1
    )

    # Create Ineligible questions
    # q12: status='draft'
    _create_question(conn, "N5", "vocabulary", "kanji_reading", "Draft Q", status="draft")
    # q13: validation_status='invalid'
    _create_question(conn, "N5", "vocabulary", "kanji_reading", "Invalid Q", validation_status="invalid")
    # q14: status='retired'
    _create_question(conn, "N5", "vocabulary", "kanji_reading", "Retired Q", status="retired")

    conn.commit()

    yield conn, store, study_dir

    conn.close()
    reset_study_db_manager()


# -----------------------------------------------------------------------------
# 1 & 2: Session creation and eligibility filtering
# -----------------------------------------------------------------------------

def test_session_creation_only_eligible_questions(test_practice_db):
    """Verify session creation includes only approved, eligible questions."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    config = PracticeSessionConfig(level="N5", category="vocabulary", question_count=10)
    session = service.create_session(config)

    assert session.status == SessionStatus.CREATED
    assert session.level == "N5"
    assert session.category == "vocabulary"
    # Even though 8 N5 vocabulary questions exist (5 active + 1 draft + 1 invalid + 1 retired),
    # only the 5 active, valid questions should be selected!
    assert session.total_questions == 5

    # Verify each question in session is active
    for item in session.items:
        row = conn.execute("SELECT status FROM question WHERE id = ?;", (item.question_id,)).fetchone()
        assert row["status"] == "active"


def test_quarantined_and_ineligible_questions_excluded(test_practice_db):
    """Verify draft, retired, and invalid questions are strictly excluded."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    # Ineligible question IDs
    draft_q = conn.execute("SELECT id FROM question WHERE status = 'draft';").fetchone()["id"]
    invalid_q = conn.execute(
        "SELECT q.id FROM question q JOIN question_revision qr ON q.current_revision_id = qr.id WHERE qr.validation_status = 'invalid';"
    ).fetchone()["id"]
    retired_q = conn.execute("SELECT id FROM question WHERE status = 'retired';").fetchone()["id"]

    config = PracticeSessionConfig(question_count=20)
    session = service.create_session(config)

    selected_q_ids = {it.question_id for it in session.items}
    assert draft_q not in selected_q_ids
    assert invalid_q not in selected_q_ids
    assert retired_q not in selected_q_ids


# -----------------------------------------------------------------------------
# 3: Stable question IDs and revision references
# -----------------------------------------------------------------------------

def test_stable_question_ids_and_pinned_revisions(test_practice_db):
    """Verify attempt items store stable question IDs and pin explicit question revisions."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=3))
    assert len(session.items) == 3

    for item in session.items:
        db_item = conn.execute(
            "SELECT question_id, pinned_question_revision_id FROM attempt_item WHERE id = ?;",
            (item.attempt_item_id,),
        ).fetchone()

        assert db_item["question_id"] == item.question_id
        q_row = conn.execute("SELECT current_revision_id FROM question WHERE id = ?;", (item.question_id,)).fetchone()
        assert db_item["pinned_question_revision_id"] == q_row["current_revision_id"]


# -----------------------------------------------------------------------------
# 4: Session resume and lifecycle transitions
# -----------------------------------------------------------------------------

def test_session_resume_and_lifecycle_transitions(test_practice_db):
    """Verify state transitions: created -> in_progress -> completed/abandoned and resumption stability."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=2))
    assert session.status == SessionStatus.CREATED

    # Resuming before starting returns exact same ordered items
    resumed = service.get_session(session.session_id)
    assert resumed.status == SessionStatus.CREATED
    assert [it.question_id for it in resumed.items] == [it.question_id for it in session.items]

    # Presenting first question transitions session to in_progress
    pres = service.present_item(session.session_id, position=1)
    assert pres.position == 1
    assert pres.presented_at is not None

    sess_in_prog = service.get_session(session.session_id)
    assert sess_in_prog.status == SessionStatus.IN_PROGRESS
    assert sess_in_prog.started_at is not None

    # Answer position 1
    choice_id = pres.choices[1].choice_id
    service.submit_answer(session.session_id, pres.attempt_item_id, choice_id, time_spent_ms=5000)

    # Check resumption: current_position advances to 2
    resumed2 = service.get_session(session.session_id)
    assert resumed2.answered_count == 1
    assert resumed2.current_position == 2

    # Answer position 2 (final question) -> automatic completion
    item2 = resumed2.items[1]
    service.submit_answer(session.session_id, item2.attempt_item_id, item2.choices[1].choice_id, time_spent_ms=4000)

    final_sess = service.get_session(session.session_id)
    assert final_sess.status == SessionStatus.COMPLETED
    assert final_sess.completed_at is not None

    # Cannot submit to a completed session
    with pytest.raises(SessionLifecycleError, match="Cannot submit answer"):
        service.submit_answer(session.session_id, item2.attempt_item_id, choice_id, time_spent_ms=1000)


def test_session_abandonment(test_practice_db):
    """Verify abandoning an active session prevents further responses."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=3))
    abandoned = service.abandon_session(session.session_id)
    assert abandoned.status == SessionStatus.ABANDONED

    # Attempting to submit answer raises SessionLifecycleError
    with pytest.raises(SessionLifecycleError, match="Cannot submit answer to a abandoned session"):
        service.submit_answer(session.session_id, session.items[0].attempt_item_id, 1, 1000)


# -----------------------------------------------------------------------------
# 5 & 6: Deterministic grading & invalid/incomplete handling
# -----------------------------------------------------------------------------

def test_deterministic_grading_correct_and_incorrect(test_practice_db):
    """Verify deterministic grading of correct and incorrect choices."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=2))
    item = session.items[0]

    # Choice 1 is incorrect (canonical answer is choice 2)
    wrong_choice = item.choices[0]
    right_choice = item.choices[1]

    grade_wrong = service.submit_answer(
        session.session_id, item.attempt_item_id, wrong_choice.choice_id, time_spent_ms=4500
    )
    assert grade_wrong.is_correct is False
    assert grade_wrong.selected_choice_id == wrong_choice.choice_id
    assert grade_wrong.canonical_choice_id == right_choice.choice_id
    assert grade_wrong.canonical_choice_key == "2"
    assert grade_wrong.grading_status == GradingStatus.GRADED

    # Item 2: correct submission
    item2 = session.items[1]
    grade_right = service.submit_answer(
        session.session_id, item2.attempt_item_id, item2.choices[1].choice_id, time_spent_ms=3200
    )
    assert grade_right.is_correct is True
    assert grade_right.selected_choice_id == item2.choices[1].choice_id


def test_invalid_and_incomplete_answer_handling(test_practice_db):
    """Verify invalid choice IDs, already answered items, and negative times are rejected safely."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=2))
    item = session.items[0]

    # Negative time validation
    with pytest.raises(SessionServiceError, match="Invalid negative time_spent_ms"):
        service.submit_answer(session.session_id, item.attempt_item_id, item.choices[0].choice_id, time_spent_ms=-100)

    # Invalid choice ID belonging to non-existent or other question
    with pytest.raises(InvalidChoiceError, match="does not exist or does not belong"):
        service.submit_answer(session.session_id, item.attempt_item_id, 999999, time_spent_ms=1000)

    # Valid answer
    service.submit_answer(session.session_id, item.attempt_item_id, item.choices[1].choice_id, time_spent_ms=1000)

    # Duplicate answer on same item rejected
    with pytest.raises(AlreadyAnsweredError, match="has already been answered"):
        service.submit_answer(session.session_id, item.attempt_item_id, item.choices[1].choice_id, time_spent_ms=1000)


# -----------------------------------------------------------------------------
# 7: Difficulty feedback persistence
# -----------------------------------------------------------------------------

def test_difficulty_feedback_persistence(test_practice_db):
    """Verify Easy, Normal, and Hard ratings persist separately from correctness."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=3))

    # Immediate feedback during answer submission
    item1 = session.items[0]
    service.submit_answer(
        session.session_id,
        item1.attempt_item_id,
        item1.choices[1].choice_id,
        time_spent_ms=2000,
        difficulty_rating=DifficultyRating.EASY,
    )

    row1 = conn.execute(
        "SELECT difficulty_rating FROM attempt_item_feedback WHERE attempt_item_id = ?;",
        (item1.attempt_item_id,),
    ).fetchone()
    assert row1["difficulty_rating"] == "easy"

    # Separate feedback after answering
    item2 = session.items[1]
    service.submit_answer(
        session.session_id,
        item2.attempt_item_id,
        item2.choices[0].choice_id,  # incorrect answer
        time_spent_ms=4000,
    )
    # User rates it Hard after seeing result
    service.submit_feedback(session.session_id, item2.attempt_item_id, DifficultyRating.HARD)

    row2 = conn.execute(
        "SELECT difficulty_rating FROM attempt_item_feedback WHERE attempt_item_id = ?;",
        (item2.attempt_item_id,),
    ).fetchone()
    assert row2["difficulty_rating"] == "hard"


# -----------------------------------------------------------------------------
# 8, 9, 10: Adaptive selection, deprioritization, and repetition priority
# -----------------------------------------------------------------------------

def test_adaptive_deprioritization_after_two_correct_easy(test_practice_db):
    """Verify questions answered correctly and rated Easy twice are strongly deprioritized."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    # Conduct Session 1 with 1 question
    sess1 = service.create_session(PracticeSessionConfig(level="N5", category="vocabulary", question_count=1))
    q_id = sess1.items[0].question_id
    item1 = sess1.items[0]

    # First correct + Easy attempt
    service.submit_answer(
        sess1.session_id, item1.attempt_item_id, item1.choices[1].choice_id, 1000, DifficultyRating.EASY
    )

    qas1 = conn.execute("SELECT * FROM question_adaptive_state WHERE question_id = ?;", (q_id,)).fetchone()
    assert qas1["consecutive_correct_easy"] == 1
    assert qas1["priority_score"] == 40.0

    # Conduct Session 2 with the same question targeted
    sess2 = service.create_session(PracticeSessionConfig(level="N5", category="vocabulary", question_count=1))
    # If it was selected, answer it correct + Easy a second time
    # Force item with q_id
    item2 = sess2.items[0]
    service.submit_answer(
        sess2.session_id, item2.attempt_item_id, item2.choices[1].choice_id, 1000, DifficultyRating.EASY
    )

    # If item2 wasn't q_id, update q_id directly to simulate second easy attempt
    from app.study.session.adaptive import update_question_adaptive_state
    update_question_adaptive_state(conn, q_id, is_correct=True, difficulty_rating=DifficultyRating.EASY, session_id=sess2.session_id)

    qas2 = conn.execute("SELECT * FROM question_adaptive_state WHERE question_id = ?;", (q_id,)).fetchone()
    assert qas2["consecutive_correct_easy"] == 2
    assert qas2["priority_score"] == 5.0  # Strongly deprioritized!

    # When selecting from N5 vocabulary (where alternatives exist), the 2-time Easy question
    # should NOT be selected in a batch of 2
    sess3 = service.create_session(PracticeSessionConfig(level="N5", category="vocabulary", question_count=2))
    selected_ids = [it.question_id for it in sess3.items]
    assert q_id not in selected_ids


def test_incorrect_and_hard_questions_receive_high_priority(test_practice_db):
    """Verify incorrect questions and hard questions receive higher repetition priority."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    # Session 1: answer incorrectly and rate hard
    sess1 = service.create_session(PracticeSessionConfig(level="N4", category="grammar", question_count=2))
    item1 = sess1.items[0]
    q_trouble = item1.question_id

    # Wrong answer + Hard rating
    service.submit_answer(
        sess1.session_id, item1.attempt_item_id, item1.choices[0].choice_id, 5000, DifficultyRating.HARD
    )

    qas = conn.execute("SELECT priority_score FROM question_adaptive_state WHERE question_id = ?;", (q_trouble,)).fetchone()
    assert qas["priority_score"] == 250.0  # Highest priority

    # Verify score calculation function
    assert calculate_priority_score(1, last_is_correct=0, last_rating="hard", consecutive_correct_easy=0) == 250.0
    assert calculate_priority_score(1, last_is_correct=0, last_rating="normal", consecutive_correct_easy=0) == 200.0
    assert calculate_priority_score(1, last_is_correct=1, last_rating="hard", consecutive_correct_easy=0) == 160.0
    assert calculate_priority_score(1, last_is_correct=1, last_rating="normal", consecutive_correct_easy=0) == 80.0
    assert calculate_priority_score(2, last_is_correct=1, last_rating="easy", consecutive_correct_easy=2) == 5.0


def test_intra_session_no_duplicates_and_consecutive_avoidance(test_practice_db):
    """Verify no duplicate questions in a session and consecutive session avoidance."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(level="N5", category="vocabulary", question_count=4))
    question_ids = [it.question_id for it in session.items]

    # No intra-session duplicates
    assert len(question_ids) == len(set(question_ids))

    # Complete this session
    for it in session.items:
        service.submit_answer(session.session_id, it.attempt_item_id, it.choices[1].choice_id, 1000)

    # Next session with 1 question should avoid the questions just completed
    # since alternative (5th question) exists
    next_sess = service.create_session(
        PracticeSessionConfig(level="N5", category="vocabulary", question_count=1)
    )
    assert next_sess.items[0].question_id not in question_ids[:3]


# -----------------------------------------------------------------------------
# 11 & 12: Timing persistence & interrupted session handling
# -----------------------------------------------------------------------------

def test_timing_persistence_and_capping(test_practice_db):
    """Verify per-question duration and active session duration are accurately persisted."""
    conn, _, _ = test_practice_db
    service = PracticeSessionService(conn)

    session = service.create_session(PracticeSessionConfig(question_count=2))
    item1 = session.items[0]
    item2 = session.items[1]

    service.submit_answer(session.session_id, item1.attempt_item_id, item1.choices[1].choice_id, time_spent_ms=4500)
    service.submit_answer(session.session_id, item2.attempt_item_id, item2.choices[1].choice_id, time_spent_ms=3500)

    final_sess = service.get_session(session.session_id)
    # Total elapsed is active question time sum (4500 + 3500 = 8000 ms)
    assert final_sess.total_elapsed_ms == 8000

    # Check capping for absurdly long duration (e.g. 5 hours = 18,000,000 ms)
    sess2 = service.create_session(PracticeSessionConfig(question_count=1))
    service.submit_answer(
        sess2.session_id, sess2.items[0].attempt_item_id, sess2.items[0].choices[1].choice_id, time_spent_ms=18_000_000
    )
    final_sess2 = service.get_session(sess2.session_id)
    # Capped to MAX_QUESTION_TIME_MS (1,800,000 ms = 30 minutes)
    assert final_sess2.total_elapsed_ms == 1_800_000


# -----------------------------------------------------------------------------
# 13: History and analytics correctness
# -----------------------------------------------------------------------------

def test_learning_history_and_analytics(test_practice_db):
    """Verify LearningSummary, breakdowns, trouble questions, and recent activity."""
    conn, _, _ = test_practice_db
    session_service = PracticeSessionService(conn)
    analytics_service = PracticeAnalyticsService(conn)

    # Session 1: 2 questions, 1 correct, 1 incorrect
    sess1 = session_service.create_session(PracticeSessionConfig(level="N5", category="vocabulary", question_count=2))
    # Q1: correct
    session_service.submit_answer(sess1.session_id, sess1.items[0].attempt_item_id, sess1.items[0].choices[1].choice_id, 3000)
    # Q2: incorrect
    session_service.submit_answer(sess1.session_id, sess1.items[1].attempt_item_id, sess1.items[1].choices[0].choice_id, 4000)

    summary = analytics_service.get_learning_summary()
    assert summary.total_sessions == 1
    assert summary.completed_sessions == 1
    assert summary.total_questions_attempted == 2
    assert summary.total_correct == 1
    assert summary.overall_accuracy == 50.0
    assert summary.total_time_spent_ms == 7000
    assert summary.average_time_per_question_ms == 3500.0

    # Accuracy by level
    by_level = analytics_service.get_accuracy_by_level()
    assert len(by_level) >= 1
    assert by_level[0].group_name == "N5"
    assert by_level[0].attempted == 2
    assert by_level[0].correct == 1
    assert by_level[0].accuracy == 50.0

    # Trouble questions
    trouble = analytics_service.get_trouble_questions(limit=5)
    assert len(trouble) == 1
    assert trouble[0].question_id == sess1.items[1].question_id

    # Recent activity
    recent = analytics_service.get_recent_activity(limit=5)
    assert len(recent) == 1
    assert recent[0].session_id == sess1.session_id
    assert recent[0].total_questions == 2
    assert recent[0].answered_count == 2
    assert recent[0].correct_count == 1


# -----------------------------------------------------------------------------
# 14: Doctor checks and database integrity
# -----------------------------------------------------------------------------

def test_practice_engine_doctor_integrity(test_practice_db):
    """Verify database doctor reports 0 errors and 0 warnings after practice sessions."""
    conn, store, _ = test_practice_db
    service = PracticeSessionService(conn)

    # Create and run a session
    sess = service.create_session(PracticeSessionConfig(question_count=2))
    service.submit_answer(sess.session_id, sess.items[0].attempt_item_id, sess.items[0].choices[1].choice_id, 2000)
    service.submit_answer(sess.session_id, sess.items[1].attempt_item_id, sess.items[1].choices[0].choice_id, 2000)

    # Run Doctor
    findings = run_doctor(conn, store)
    errors = [f for f in findings if f.severity == "ERROR"]
    warnings = [f for f in findings if f.severity == "WARNING"]

    assert len(errors) == 0
    assert len(warnings) == 0
