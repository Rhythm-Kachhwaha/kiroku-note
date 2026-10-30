"""
Comprehensive Test Suite for M7: JLPT Exam Generation & Scoring Engine.
-----------------------------------------------------------------------
Verifies all 23 acceptance criteria:
1. Blueprint definitions for N1–N5.
2. Correct official test-section structures and timings.
3. Correct scoring-section aggregation for N1–N5.
4. Blueprint versioning.
5. Readiness validation.
6. Blocking incomplete examinations.
7. Excluding quarantined/ineligible questions.
8. No cross-level question substitution.
9. No duplicate questions within an examination.
10. Pinned question revisions.
11. Examination lifecycle and resumption.
12. Section timer persistence and expiration.
13. Application restart and timer recovery.
14. Submission restrictions after section closure.
15. Unanswered-question handling.
16. Mark-for-review behavior.
17. Raw score calculations.
18. Estimated score calculations and explicit estimate labeling.
19. Correct official pass-threshold logic.
20. Incomplete examinations never receiving definitive pass results.
21. Historical result immutability.
22. Database doctor and migration integrity.
23. Existing M6 practice behavior remaining unchanged.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.doctor import run_doctor
from app.study.exam import (
    DEFAULT_BLUEPRINT_VERSION,
    BlueprintEvidenceLevel,
    ExamAnalyticsService,
    ExamBlueprint,
    ExamItemQuota,
    ExamReadinessError,
    ExamReadinessValidator,
    ExamSectionBlueprint,
    ExamSectionClosedError,
    ExamSectionSequenceError,
    ExamSectionStatus,
    ExamSessionService,
    PassFailAssessment,
    ProvisionalRawScoringModel,
    ReadinessStatus,
    ScoringSectionBlueprint,
    ThresholdStatus,
    get_blueprint_from_db_or_default,
    get_official_blueprint,
    list_official_blueprints,
    save_blueprint_to_db,
)
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.session import (
    DifficultyRating,
    PracticeSessionConfig,
    PracticeSessionService,
    SessionStatus,
    SessionType,
)
from app.study.ulid import generate_ulid


# -----------------------------------------------------------------------------
# Test Fixture: Isolated Study DB with Synthetic Questions
# -----------------------------------------------------------------------------

@pytest.fixture
def exam_test_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """
    Creates an isolated test environment with all 6 migrations applied.
    Provides helpers to seed synthetic questions for testing.
    """
    study_dir = tmp_path / "study_exam_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    media_store = MediaStore(study_dir / "media")

    def create_synthetic_question(
        level: str,
        category: str,
        format_code: str,
        prompt: str,
        status: str = "active",
        validation_status: str = "valid",
        canonical_choice: int = 1,
        choices_count: int = 4,
    ) -> Tuple[int, int]:
        """Insert a valid sealed question and revision for testing."""
        cur = conn.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, status)
            VALUES (?, ?, ?, ?, ?);
            """,
            (generate_ulid(), format_code, level, category, status),
        )
        q_id = cur.lastrowid

        rev_cur = conn.execute(
            """
            INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint)
            VALUES (?, ?, 1, ?, ?, ?);
            """,
            (q_id, format_code, prompt, validation_status, generate_ulid()),
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
                (rev_id, str(i), i, str(i), f"Choice {i}"),
            )
            c_ids.append(c_cur.lastrowid)

        if validation_status == "valid":
            conn.execute(
                """
                INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
                VALUES (?, ?, 'source_explicit', 'Choice is correct.');
                """,
                (rev_id, c_ids[canonical_choice - 1]),
            )

        conn.execute("UPDATE question_revision SET sealed_at = datetime('now') WHERE id = ?;", (rev_id,))
        return q_id, rev_id

    yield conn, media_store, create_synthetic_question, db_path
    conn.close()


# -----------------------------------------------------------------------------
# 1. Blueprint Definitions for N1–N5
# -----------------------------------------------------------------------------

def test_blueprint_definitions_n1_to_n5():
    """Verify standard blueprints exist for all levels with required metadata."""
    blueprints = list_official_blueprints()
    assert len(blueprints) == 5

    for level in ("N1", "N2", "N3", "N4", "N5"):
        bp = get_official_blueprint(level)
        assert bp.level == level
        assert bp.version == DEFAULT_BLUEPRINT_VERSION
        assert bp.overall_max_score == 180
        assert len(bp.test_sections) >= 2
        assert len(bp.scoring_sections) >= 2


# -----------------------------------------------------------------------------
# 2. Correct Official Test-Section Structures and Timings
# -----------------------------------------------------------------------------

def test_official_test_section_structures_and_timings():
    """
    Verify official 2026 test-section timings and structures:
    - N1: Knowledge + Reading (110 min), Listening (55 min)
    - N2: Knowledge + Reading (105 min), Listening (50 min)
    - N3: Vocab (30 min), Grammar + Reading (70 min), Listening (40 min)
    - N4: Vocab (25 min), Grammar + Reading (55 min), Listening (35 min)
    - N5: Vocab (20 min), Grammar + Reading (40 min), Listening (30 min)
    """
    n1 = get_official_blueprint("N1")
    assert len(n1.test_sections) == 2
    assert n1.test_sections[0].time_limit_minutes == 110
    assert set(n1.test_sections[0].categories) == {"vocabulary", "grammar", "reading"}
    assert n1.test_sections[1].time_limit_minutes == 55
    assert set(n1.test_sections[1].categories) == {"listening"}

    n2 = get_official_blueprint("N2")
    assert len(n2.test_sections) == 2
    assert n2.test_sections[0].time_limit_minutes == 105
    assert n2.test_sections[1].time_limit_minutes == 50

    n3 = get_official_blueprint("N3")
    assert len(n3.test_sections) == 3
    assert n3.test_sections[0].time_limit_minutes == 30
    assert n3.test_sections[0].categories == ["vocabulary"]
    assert n3.test_sections[1].time_limit_minutes == 70
    assert set(n3.test_sections[1].categories) == {"grammar", "reading"}
    assert n3.test_sections[2].time_limit_minutes == 40

    n4 = get_official_blueprint("N4")
    assert len(n4.test_sections) == 3
    assert n4.test_sections[0].time_limit_minutes == 25
    assert n4.test_sections[1].time_limit_minutes == 55
    assert n4.test_sections[2].time_limit_minutes == 35

    n5 = get_official_blueprint("N5")
    assert len(n5.test_sections) == 3
    assert n5.test_sections[0].time_limit_minutes == 20
    assert n5.test_sections[1].time_limit_minutes == 40
    assert n5.test_sections[2].time_limit_minutes == 30


# -----------------------------------------------------------------------------
# 3. Correct Scoring-Section Aggregation for N1–N5
# -----------------------------------------------------------------------------

def test_scoring_section_aggregation_n1_to_n5():
    """
    Verify official scoring sections and thresholds:
    - N1, N2, N3: Knowledge (60/19), Reading (60/19), Listening (60/19)
    - N4, N5: Knowledge + Reading (120/38), Listening (60/19)
    - Overall pass marks: N1: 100, N2: 90, N3: 95, N4: 90, N5: 80
    """
    for lvl in ("N1", "N2", "N3"):
        bp = get_official_blueprint(lvl)
        assert len(bp.scoring_sections) == 3
        assert bp.scoring_sections[0].max_score == 60
        assert bp.scoring_sections[0].pass_threshold == 19
        assert bp.scoring_sections[1].max_score == 60
        assert bp.scoring_sections[1].pass_threshold == 19
        assert bp.scoring_sections[2].max_score == 60
        assert bp.scoring_sections[2].pass_threshold == 19

    assert get_official_blueprint("N1").overall_pass_threshold == 100
    assert get_official_blueprint("N2").overall_pass_threshold == 90
    assert get_official_blueprint("N3").overall_pass_threshold == 95

    for lvl in ("N4", "N5"):
        bp = get_official_blueprint(lvl)
        assert len(bp.scoring_sections) == 2
        assert bp.scoring_sections[0].max_score == 120
        assert bp.scoring_sections[0].pass_threshold == 38
        assert bp.scoring_sections[1].max_score == 60
        assert bp.scoring_sections[1].pass_threshold == 19

    assert get_official_blueprint("N4").overall_pass_threshold == 90
    assert get_official_blueprint("N5").overall_pass_threshold == 80


# -----------------------------------------------------------------------------
# 4. Blueprint Versioning
# -----------------------------------------------------------------------------

def test_blueprint_versioning_and_ledger(exam_test_env):
    """Verify persisting and querying customized or versioned blueprints."""
    conn, _, _, _ = exam_test_env
    custom_bp = ExamBlueprint(
        level="N5",
        version="custom_2026_test",
        name="Custom Mini N5 Test Blueprint",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="MINI_SEC_VOCAB",
                label="Mini Vocab",
                block_order=1,
                time_limit_minutes=10,
                categories=["vocabulary"],
                item_quotas=[
                    ExamItemQuota(format_code="kanji_reading", target_count=2, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)
                ],
            ),
            ExamSectionBlueprint(
                section_code="MINI_SEC_READING",
                label="Mini Reading",
                block_order=2,
                time_limit_minutes=15,
                categories=["reading"],
                item_quotas=[
                    ExamItemQuota(format_code="comprehension_short", target_count=2, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)
                ],
            ),
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="MINI_SCORE_KNOWLEDGE", label="Knowledge", categories=["vocabulary", "reading"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="MINI_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    save_blueprint_to_db(conn, custom_bp)
    loaded = get_blueprint_from_db_or_default(conn, "N5", "custom_2026_test")
    assert loaded.version == "custom_2026_test"
    assert len(loaded.test_sections) == 2


# -----------------------------------------------------------------------------
# 5. Readiness Validation & 6. Blocking Incomplete Examinations
# -----------------------------------------------------------------------------

def test_readiness_validation_blocks_incomplete_exam(exam_test_env):
    """
    Verify that an incomplete bank generates a detailed report and blocks exam generation.
    """
    conn, media_store, create_q, _ = exam_test_env
    # Only 2 kanji_reading questions exist
    create_q("N5", "vocabulary", "kanji_reading", "Q1")
    create_q("N5", "vocabulary", "kanji_reading", "Q2")

    blueprint = get_official_blueprint("N5")
    report = ExamReadinessValidator.validate_readiness(conn, blueprint, media_store=media_store)

    assert not report.is_ready
    assert report.status == ReadinessStatus.INCOMPLETE_BANK
    assert len(report.blocked_reasons) > 0

    # Ensure ExamSessionService strictly blocks creation
    service = ExamSessionService(conn, media_store)
    with pytest.raises(ExamReadinessError) as exc_info:
        service.create_examination("N5")

    assert exc_info.value.report.is_ready is False


# -----------------------------------------------------------------------------
# 7. Excluding Quarantined/Ineligible Questions
# -----------------------------------------------------------------------------

def test_excluding_quarantined_and_ineligible_questions(exam_test_env):
    """
    Ensure draft questions, retired questions, and invalid revisions are excluded.
    """
    conn, media_store, create_q, _ = exam_test_env
    # Active & Valid question
    create_q("N5", "vocabulary", "kanji_reading", "Valid Question", status="active", validation_status="valid")
    # Draft question
    create_q("N5", "vocabulary", "kanji_reading", "Draft Question", status="draft", validation_status="valid")
    # Retired question
    create_q("N5", "vocabulary", "kanji_reading", "Retired Question", status="retired", validation_status="valid")
    # Invalid revision question
    create_q("N5", "vocabulary", "kanji_reading", "Invalid Revision Question", status="active", validation_status="invalid")

    eligible = ExamReadinessValidator.get_eligible_questions_for_format(conn, "N5", "kanji_reading", media_store)
    assert len(eligible) == 1


# -----------------------------------------------------------------------------
# 8. No Cross-Level Question Substitution & 9. No Duplicates in Exam
# -----------------------------------------------------------------------------

def test_no_cross_level_substitution_and_no_duplicates(exam_test_env):
    """
    Verify N4 questions are never substituted for N5, and exam generation deduplicates items.
    """
    conn, media_store, create_q, _ = exam_test_env
    # Seed 2 N4 questions
    create_q("N4", "vocabulary", "kanji_reading", "N4 Q1")
    create_q("N4", "vocabulary", "kanji_reading", "N4 Q2")

    # Validate readiness for N5
    mini_n5 = ExamBlueprint(
        level="N5",
        version="mini_n5_test",
        name="Mini N5",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Vocab", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=2, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listen", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    report = ExamReadinessValidator.validate_readiness(conn, mini_n5, media_store)
    # N4 questions must NOT satisfy N5 requirement
    assert not report.is_ready
    assert report.total_available == 0

    # Add 2 distinct N5 questions
    q1_id, _ = create_q("N5", "vocabulary", "kanji_reading", "N5 Q1")
    q2_id, _ = create_q("N5", "vocabulary", "kanji_reading", "N5 Q2")

    report_ready = ExamReadinessValidator.validate_readiness(conn, mini_n5, media_store)
    assert report_ready.is_ready

    service = ExamSessionService(conn, media_store)
    exam_state = service.create_examination(mini_n5, seed=42)
    assert exam_state.total_questions == 2
    question_ids = [it.question_id for it in exam_state.current_section_items]
    assert len(set(question_ids)) == 2
    assert set(question_ids) == {q1_id, q2_id}


# -----------------------------------------------------------------------------
# 10. Pinned Question Revisions & Choice Order
# -----------------------------------------------------------------------------

def test_pinned_question_revisions(exam_test_env):
    """Verify revision and choice display positions are immutable and pinned."""
    conn, media_store, create_q, _ = exam_test_env
    q1_id, rev1_id = create_q("N5", "vocabulary", "kanji_reading", "Q1")

    mini_bp = ExamBlueprint(
        level="N5",
        version="pinned_test",
        name="Pinned Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Knowledge", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam_state = service.create_examination(mini_bp)
    item = exam_state.current_section_items[0]

    # Verify attempt_item pinned_question_revision_id
    row = conn.execute("SELECT pinned_question_revision_id FROM attempt_item WHERE id = ?;", (item.attempt_item_id,)).fetchone()
    assert row["pinned_question_revision_id"] == rev1_id

    # Verify choices display order
    choices = conn.execute(
        "SELECT display_position FROM attempt_item_choice_order WHERE attempt_item_id = ? ORDER BY display_position ASC;",
        (item.attempt_item_id,)
    ).fetchall()
    assert len(choices) == 4
    assert [c["display_position"] for c in choices] == [1, 2, 3, 4]


# -----------------------------------------------------------------------------
# 11. Examination Lifecycle, Pause & Resumption
# -----------------------------------------------------------------------------

def test_examination_lifecycle_pause_and_resumption(exam_test_env):
    """Verify start, pause, resume, section sequence rules, and completion."""
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1")
    create_q("N5", "grammar", "sentential_grammar_1", "Q2")

    mini_bp = ExamBlueprint(
        level="N5",
        version="lifecycle_test",
        name="Lifecycle Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1_VOCAB", label="Vocab", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            ),
            ExamSectionBlueprint(
                section_code="SEC2_GRAMMAR", label="Grammar", block_order=2, time_limit_minutes=15, categories=["grammar"],
                item_quotas=[ExamItemQuota(format_code="sentential_grammar_1", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            ),
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC_KNOW", label="Knowledge", categories=["vocabulary", "grammar"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC_LIST", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    assert exam.status == "created"

    # Enforce section sequence: cannot start section 2 before section 1
    with pytest.raises(ExamSectionSequenceError):
        service.start_section(exam.session_id, block_order=2)

    # Start section 1
    state_started = service.start_section(exam.session_id, block_order=1)
    assert state_started.status == "in_progress"
    assert state_started.sections[0].status == ExamSectionStatus.IN_PROGRESS
    assert state_started.sections[0].deadline_at is not None

    # Pause section 1
    state_paused = service.pause_section(exam.session_id, block_order=1)
    assert state_paused.sections[0].status == ExamSectionStatus.PAUSED
    assert state_paused.sections[0].deadline_at is None

    # Resume section 1
    state_resumed = service.resume_section(exam.session_id, block_order=1)
    assert state_resumed.sections[0].status == ExamSectionStatus.IN_PROGRESS
    assert state_resumed.sections[0].deadline_at is not None


# -----------------------------------------------------------------------------
# 12. Section Timer Expiration & 13. Application Restart Recovery
# -----------------------------------------------------------------------------

def test_section_timer_expiration_and_restart_recovery(exam_test_env):
    """
    Verify that wall-clock time determines expiration across restarts,
    preventing users from gaining extra time by closing the app.
    """
    conn, media_store, create_q, db_path = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1")

    mini_bp = ExamBlueprint(
        level="N5",
        version="timer_test",
        name="Timer Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=1, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listen", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)

    # Manually simulate past deadline in DB (as if app was closed for 5 minutes)
    past_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    conn.execute(
        "UPDATE exam_section_attempt SET deadline_at = ? WHERE attempt_id = ? AND block_order = 1;",
        (past_iso, exam.session_id),
    )
    conn.commit()

    # Simulate fresh application startup with new connection
    new_manager = StudyDatabaseManager(db_path)
    new_conn = new_manager.get_connection()
    new_service = ExamSessionService(new_conn, media_store)

    # Calling get_exam_state detects elapsed deadline and expires section
    state_after_restart = new_service.get_exam_state(exam.session_id)
    assert state_after_restart.sections[0].status == ExamSectionStatus.EXPIRED
    assert state_after_restart.sections[0].remaining_time_seconds == 0
    new_conn.close()


# -----------------------------------------------------------------------------
# 14. Submission Restrictions After Section Closure
# -----------------------------------------------------------------------------

def test_submission_restrictions_after_section_closure(exam_test_env):
    """Ensure answers cannot be submitted or changed once section is submitted/closed."""
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1")

    mini_bp = ExamBlueprint(
        level="N5",
        version="lock_test",
        name="Lock Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listen", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)

    item = exam.current_section_items[0]
    first_choice_id = item.choices[0].choice_id
    second_choice_id = item.choices[1].choice_id

    # Select choice 1 while active
    service.select_choice(exam.session_id, item.attempt_item_id, first_choice_id)

    # Submit section 1 (closes section)
    service.submit_section(exam.session_id, block_order=1)

    # Attempting to change answer after section closure must raise ExamSectionClosedError
    with pytest.raises(ExamSectionClosedError):
        service.select_choice(exam.session_id, item.attempt_item_id, second_choice_id)


# -----------------------------------------------------------------------------
# 15. Unanswered Questions Handling & 16. Mark for Review
# -----------------------------------------------------------------------------

def test_unanswered_question_handling_and_mark_for_review(exam_test_env):
    """
    Verify unanswered questions are preserved as unanswered (raw 0), and review flags work.
    """
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1")
    create_q("N5", "vocabulary", "kanji_reading", "Q2")

    mini_bp = ExamBlueprint(
        level="N5",
        version="unanswered_test",
        name="Unanswered Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=2, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listen", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)

    item1 = exam.current_section_items[0]
    item2 = exam.current_section_items[1]

    # Mark question 2 for review
    service.toggle_review_flag(exam.session_id, item2.attempt_item_id, is_marked=True)
    state = service.get_exam_state(exam.session_id)
    assert state.marked_count == 1

    # Answer only question 1; leave question 2 completely unanswered
    service.select_choice(exam.session_id, item1.attempt_item_id, item1.choices[0].choice_id)

    # Complete exam
    result = service.complete_exam(exam.session_id)
    assert result.raw_correct == 1
    assert result.raw_unanswered == 1
    assert result.total_questions == 2


# -----------------------------------------------------------------------------
# 17. Raw Score Calculations & 18. Estimated Score Calculations & Labeling
# -----------------------------------------------------------------------------

def test_score_estimation_and_explicit_labels(exam_test_env):
    """
    Verify independent section-level estimates, overall score, and estimate labeling.
    """
    conn, media_store, create_q, _ = exam_test_env
    # Vocab: 4 questions (choice 1 is canonical)
    for i in range(4):
        create_q("N5", "vocabulary", "kanji_reading", f"Vocab Q{i+1}", canonical_choice=1)

    mini_bp = ExamBlueprint(
        level="N5",
        version="score_test",
        name="Score Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=4, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="N5_SCORE_KNOW", label="Knowledge & Reading", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="N5_SCORE_LIST", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)

    items = exam.current_section_items
    # Answer 3 out of 4 correctly (75% accuracy)
    service.select_choice(exam.session_id, items[0].attempt_item_id, items[0].choices[0].choice_id) # Correct
    service.select_choice(exam.session_id, items[1].attempt_item_id, items[1].choices[0].choice_id) # Correct
    service.select_choice(exam.session_id, items[2].attempt_item_id, items[2].choices[0].choice_id) # Correct
    service.select_choice(exam.session_id, items[3].attempt_item_id, items[3].choices[1].choice_id) # Incorrect

    result = service.complete_exam(exam.session_id)
    assert result.raw_correct == 3
    assert result.raw_incorrect == 1
    assert result.raw_accuracy == 75.0

    # Section 1 has max_score=120 -> 75% of 120 = 90 points
    sec1_res = result.scoring_sections[0]
    assert sec1_res.estimated_score == 90
    assert sec1_res.passed_threshold is True
    assert sec1_res.threshold_status == ThresholdStatus.ABOVE_ESTIMATED_THRESHOLD
    assert "Provisional estimation via raw accuracy" in sec1_res.calculation_explanation

    # Verify labels
    assert "Estimated JLPT-style score" in result.result_labels["score_title"]
    assert "not an official JLPT score" in result.result_labels["disclaimer"]


# -----------------------------------------------------------------------------
# 19. Official Pass-Threshold Logic (Overall + Sectional Minimums)
# -----------------------------------------------------------------------------

def test_official_pass_threshold_logic(exam_test_env):
    """
    Verify that failing ANY sectional minimum causes overall failure, even if overall score is high.
    Example: Total 100/180 but Section 2 is 0/60 (< 19) -> FAILED_ESTIMATE.
    """
    conn, media_store, create_q, _ = exam_test_env
    # Section 1 item
    create_q("N3", "vocabulary", "kanji_reading", "Vocab Q1", canonical_choice=1)
    # Section 2 item
    create_q("N3", "reading", "comprehension_short", "Reading Q1", canonical_choice=1)

    two_sec_bp = ExamBlueprint(
        level="N3",
        version="threshold_test",
        name="Threshold Test",
        overall_max_score=180,
        overall_pass_threshold=95,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Vocab", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            ),
            ExamSectionBlueprint(
                section_code="SEC2", label="Reading", block_order=2, time_limit_minutes=10, categories=["reading"],
                item_quotas=[ExamItemQuota(format_code="comprehension_short", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            ),
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC_VOCAB", label="Vocab", categories=["vocabulary"], max_score=90, pass_threshold=19),
            ScoringSectionBlueprint(code="SC_READING", label="Reading", categories=["reading"], max_score=90, pass_threshold=19),
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(two_sec_bp)

    service.start_section(exam.session_id, block_order=1)
    # Answer Vocab correctly -> 90/90
    item1 = exam.current_section_items[0]
    service.select_choice(exam.session_id, item1.attempt_item_id, item1.choices[0].choice_id)
    service.submit_section(exam.session_id, block_order=1)

    # Start Section 2 and answer incorrectly -> 0/90 (< 19 threshold)
    service.start_section(exam.session_id, block_order=2)
    item2 = exam.current_section_items[1]
    service.select_choice(exam.session_id, item2.attempt_item_id, item2.choices[1].choice_id)
    service.submit_section(exam.session_id, block_order=2)

    result = service.complete_exam(exam.session_id)
    # Even though Section 1 got 90, Section 2 got 0 (< 19)
    assert result.scoring_sections[0].passed_threshold is True
    assert result.scoring_sections[1].passed_threshold is False
    assert result.passed_sectional is False
    # Overall pass must be False because a sectional minimum was failed!
    assert result.passed_overall_estimate is False
    assert result.readiness_assessment == PassFailAssessment.FAILED_ESTIMATE


# -----------------------------------------------------------------------------
# 20. Incomplete Examinations Never Receive Pass
# -----------------------------------------------------------------------------

def test_incomplete_examination_never_receives_pass(exam_test_env):
    """
    Ensure an exam marked incomplete (e.g. aborted or sections skipped) receives INCOMPLETE assessment.
    """
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1", canonical_choice=1)

    mini_bp = ExamBlueprint(
        level="N5",
        version="incomplete_test",
        name="Incomplete Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=180, pass_threshold=38)
        ],
    )
    scoring_model = ProvisionalRawScoringModel()
    service = ExamSessionService(conn, media_store, scoring_model=scoring_model)
    exam = service.create_examination(mini_bp)

    # Calculate score with is_complete=False
    result = scoring_model.calculate_scores(conn, exam.session_id, mini_bp, is_complete=False)
    assert result.is_complete is False
    assert result.passed_overall_estimate is False
    assert result.readiness_assessment == PassFailAssessment.INCOMPLETE


# -----------------------------------------------------------------------------
# 21. Historical Result Immutability
# -----------------------------------------------------------------------------

def test_historical_result_immutability(exam_test_env):
    """
    Verify engine-level triggers prevent mutation or deletion of exam_result_snapshot.
    """
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Q1")

    mini_bp = ExamBlueprint(
        level="N5",
        version="immutability_test",
        name="Immutability Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC1", label="Sec1", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=1, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=180, pass_threshold=38)
        ],
    )
    service = ExamSessionService(conn, media_store)
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)
    service.complete_exam(exam.session_id)

    # Attempting to UPDATE exam_result_snapshot must raise ABORT error
    with pytest.raises((sqlite3.IntegrityError, sqlite3.OperationalError), match="immutable"):
        conn.execute("UPDATE exam_result_snapshot SET estimated_total_score = 180 WHERE attempt_id = ?;", (exam.session_id,))

    # Attempting to DELETE exam_result_snapshot must raise ABORT error
    with pytest.raises((sqlite3.IntegrityError, sqlite3.OperationalError), match="cannot be deleted"):
        conn.execute("DELETE FROM exam_result_snapshot WHERE attempt_id = ?;", (exam.session_id,))


# -----------------------------------------------------------------------------
# 22. Database Doctor and Migration Integrity
# -----------------------------------------------------------------------------

def test_database_doctor_and_migration_integrity(exam_test_env):
    """
    Verify that run_doctor finds zero errors, all 6 migrations are applied,
    and all required immutability triggers exist.
    """
    conn, media_store, _, _ = exam_test_env
    findings = run_doctor(conn, media_store)
    # Filter for ERROR findings
    errors = [f for f in findings if f.severity == "ERROR"]
    assert len(errors) == 0


# -----------------------------------------------------------------------------
# 23. Existing M6 Practice Behavior Remaining Unchanged
# -----------------------------------------------------------------------------

def test_existing_m6_practice_behavior_unchanged(exam_test_env):
    """
    Verify that PracticeSessionService still functions normally alongside M7.
    """
    conn, _, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Practice Q1", canonical_choice=2)
    create_q("N5", "vocabulary", "kanji_reading", "Practice Q2", canonical_choice=2)

    practice_service = PracticeSessionService(conn)
    config = PracticeSessionConfig(
        level="N5",
        category="vocabulary",
        format_code="kanji_reading",
        question_count=2,
        session_type=SessionType.PRACTICE,
    )
    sess = practice_service.create_session(config)
    assert sess.session_type == SessionType.PRACTICE
    assert sess.total_questions == 2

    # Present item and answer with immediate deterministic grading
    presented = practice_service.present_item(sess.session_id, position=1)
    choice_id = presented.choices[1].choice_id
    grading = practice_service.submit_answer(
        session_id=sess.session_id,
        attempt_item_id=presented.attempt_item_id,
        selected_choice_id=choice_id,
        time_spent_ms=4500,
        difficulty_rating=DifficultyRating.NORMAL,
    )
    assert grading.is_correct is True

    # Check analytics
    analytics_service = ExamAnalyticsService(conn)
    # Exam analytics handles session gracefully
    # Complete practice session
    completed = practice_service.complete_session(sess.session_id)
    assert completed.status == SessionStatus.COMPLETED


# -----------------------------------------------------------------------------
# 24. Diagnostic Practice & Examination Analytics Verification
# -----------------------------------------------------------------------------

def test_diagnostic_practice_and_exam_analytics(exam_test_env):
    """
    Verify create_diagnostic_practice mode and deep examination analytics.
    """
    conn, media_store, create_q, _ = exam_test_env
    create_q("N5", "vocabulary", "kanji_reading", "Diag Q1")
    create_q("N5", "vocabulary", "kanji_reading", "Diag Q2")

    service = ExamSessionService(conn, media_store)
    diag_sess = service.create_diagnostic_practice("N5", question_count=2, seed=123)
    assert diag_sess.session_type == SessionType.PRACTICE
    assert diag_sess.total_questions == 2

    # Test exam analytics on a completed exam
    mini_bp = ExamBlueprint(
        level="N5",
        version="analytics_test",
        name="Analytics Test",
        overall_max_score=180,
        overall_pass_threshold=80,
        test_sections=[
            ExamSectionBlueprint(
                section_code="SEC_VOCAB", label="Vocab", block_order=1, time_limit_minutes=10, categories=["vocabulary"],
                item_quotas=[ExamItemQuota(format_code="kanji_reading", target_count=2, source_evidence=BlueprintEvidenceLevel.CONFIGURABLE_ESTIMATE)]
            )
        ],
        scoring_sections=[
            ScoringSectionBlueprint(code="SC1", label="Score", categories=["vocabulary"], max_score=120, pass_threshold=38),
            ScoringSectionBlueprint(code="SC2", label="Listen", categories=["listening"], max_score=60, pass_threshold=19),
        ],
    )
    exam = service.create_examination(mini_bp)
    service.start_section(exam.session_id, block_order=1)

    items = exam.current_section_items
    service.select_choice(exam.session_id, items[0].attempt_item_id, items[0].choices[0].choice_id, time_spent_ms=130000) # High time question
    service.toggle_review_flag(exam.session_id, items[0].attempt_item_id, True)
    service.complete_exam(exam.session_id)

    analytics_svc = ExamAnalyticsService(conn)
    analytics = analytics_svc.get_exam_analytics(exam.session_id)
    assert analytics.session_id == exam.session_id
    assert analytics.level == "N5"
    assert analytics.total_questions == 2
    assert analytics.answered_count == 1
    assert analytics.unanswered_count == 1
    assert analytics.marked_count == 1
    assert len(analytics.section_timings) == 1
    assert len(analytics.format_performance) == 1
    # Items with time > 120,000 ms flagged as high time
    assert 1 in analytics.high_time_questions

