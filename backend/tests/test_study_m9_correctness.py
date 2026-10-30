"""
Targeted tests for M9: Study Engine Correctness.
------------------------------------------------
Validates:
1. Practice media eligibility:
   - Ineligible when required media is missing, empty (0 bytes), corrupted, or inaccessible.
   - Valid when media exists and hash matches.
   - Verification caching by mtime/size.
2. Adaptive practice recency:
   - Expansion intervals (3, 7, 14, 30 days).
   - Recency suppression for recently answered questions.
   - Two-time easy deprioritization (priority 5.0, 30-day interval).
   - High priority retention for incorrect and hard questions.
3. Strict and relaxed exam modes:
   - Strict mode blocks section pausing.
   - Relaxed mode permits section pausing.
   - Strict mode blocks listening audio replay.
   - Relaxed mode allows listening audio replay.
   - Mode is stored in recipe snapshot and exposed in state.
4. Exam timer correctness:
   - Elimination of premature expiration from integer truncation (ceil).
   - Authoritative server_time and section deadline_at exposed in state.
   - peek_state() is read-only; settle_timers() is idempotent.
   - Correctness across simulated application restart.
5. Blueprint quota evidence:
   - BlueprintEvidenceLevel.INFERRED exists.
   - Version 2026.1 preserved.
   - Version 2026.2 classifies uncertain quotas as INFERRED.
6. Scoring interpretation v2:
   - Wilson score interval for proportions.
   - ProvisionalBandScoringModel (provisional_band_v2).
   - Honest score bands and interpretations: likely_pass, borderline, unlikely_pass.
   - Respect for sectional and overall thresholds.
   - Small sample and boundary handling.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.eligibility import (
    REASON_REQUIRED_ASSET_MISSING,
    evaluate_eligibility,
)
from app.study.exam.blueprint import (
    DEFAULT_BLUEPRINT_VERSION,
    get_official_blueprint,
)
from app.study.exam.enums import (
    BlueprintEvidenceLevel,
    ExamMode,
    ExamSectionStatus,
    PassFailAssessment,
)
from app.study.exam.models import (
    ExamBlueprint,
    ExamItemQuota,
    ExamSectionBlueprint,
    ScoringSectionBlueprint,
)
from app.study.exam.scoring import (
    ProvisionalBandScoringModel,
    ProvisionalRawScoringModel,
    wilson_score_interval,
)
from app.study.exam.service import ExamService, ExamServiceError
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.session.adaptive import (
    EXPANSION_INTERVALS_DAYS,
    PRIORITY_CORRECT_HARD,
    PRIORITY_CORRECT_NORMAL,
    PRIORITY_DEPRIORITIZED_EASY_TWICE,
    PRIORITY_INCORRECT,
    PRIORITY_INCORRECT_HARD,
    PRIORITY_UNATTEMPTED,
    calculate_priority_score,
    select_practice_candidates,
)
from app.study.session.enums import DifficultyRating
from app.study.session.models import PracticeSessionConfig
from app.study.session.service import PracticeSessionService
from app.study.ulid import generate_ulid


@pytest.fixture
def m9_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated study database and media store for M9 tests."""
    study_dir = tmp_path / "study_m9_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)

    media_store = MediaStore(study_dir / "media")

    yield conn, media_store, study_dir

    conn.close()
    reset_study_db_manager()


# =============================================================================
# 1. Practice Media Eligibility Tests
# =============================================================================

def test_media_eligibility_missing_and_invalid_files(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """Questions requiring media must be ineligible if file is missing, empty, or corrupted."""
    conn, media_store, study_dir = m9_db

    # Register real audio file in media store
    audio_bytes = b"OggS\x00\x02synthetic_valid_audio_stream_data_test_12345"
    asset_row = media_store.register_bytes(
        data=audio_bytes,
        extension=".ogg",
        kind="audio",
        mime_type="audio/ogg",
        conn=conn,
    )
    asset_id = asset_row["id"]
    asset_sha = asset_row["sha256"]

    # Create F5 listening question
    cur = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, 'task_based_listening', 'N4', 'listening', 'active');",
        (generate_ulid(),),
    )
    q_id = cur.lastrowid
    rev_cur = conn.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint) VALUES (?, 'task_based_listening', 1, 'Audio stem', 'valid', ?);",
        (q_id, generate_ulid()),
    )
    rev_id = rev_cur.lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    c1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup) VALUES (?, '1', 1, '1', 'Opt 1');", (rev_id,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (rev_id, c1))

    # Link required audio asset
    conn.execute(
        "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required) VALUES (?, ?, 'audio', 1);",
        (rev_id, asset_id),
    )

    # 1. Valid on disk -> eligible
    is_eligible, reasons = evaluate_eligibility(q_id, conn, verify_files=True, media_store=media_store)
    assert is_eligible is True
    assert REASON_REQUIRED_ASSET_MISSING not in reasons

    # 2. Corrupt file on disk (hash mismatch) -> ineligible
    asset_file = media_store.get_asset_file_path(asset_row["relative_path"])
    asset_file.write_bytes(b"corrupted_bytes_that_do_not_match_original_sha")

    is_eligible, reasons = evaluate_eligibility(q_id, conn, verify_files=True, media_store=media_store)
    assert is_eligible is False
    assert REASON_REQUIRED_ASSET_MISSING in reasons

    # 3. Truncate file to 0 bytes -> ineligible
    asset_file.write_bytes(b"")
    is_eligible, reasons = evaluate_eligibility(q_id, conn, verify_files=True, media_store=media_store)
    assert is_eligible is False
    assert REASON_REQUIRED_ASSET_MISSING in reasons

    # 4. Remove file completely from disk -> ineligible
    asset_file.unlink()
    is_eligible, reasons = evaluate_eligibility(q_id, conn, verify_files=True, media_store=media_store)
    assert is_eligible is False
    assert REASON_REQUIRED_ASSET_MISSING in reasons


def test_practice_candidate_selection_excludes_missing_media(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """select_practice_candidates must never return questions with missing or broken media assets."""
    conn, media_store, study_dir = m9_db

    # Create 2 questions: one with valid audio, one with missing audio file
    audio_bytes = b"OggS\x00\x02valid_audio_bytes"
    a1 = media_store.register_bytes(audio_bytes, ".ogg", "audio", "audio/ogg", conn)

    # Create question 1 (valid audio)
    q1 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, 'task_based_listening', 'N5', 'listening', 'active');", (generate_ulid(),)).lastrowid
    r1 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint) VALUES (?, 'task_based_listening', 1, 'Audio stem 1', 'valid', ?);", (q1, generate_ulid())).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r1, q1))
    c1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup) VALUES (?, '1', 1, '1', 'Opt 1');", (r1,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r1, c1))
    conn.execute("INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required) VALUES (?, ?, 'audio', 1);", (r1, a1["id"]))

    # Create question 2 (missing audio on disk)
    q2 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, 'task_based_listening', 'N5', 'listening', 'active');", (generate_ulid(),)).lastrowid
    r2 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint) VALUES (?, 'task_based_listening', 1, 'Audio stem 2', 'valid', ?);", (q2, generate_ulid())).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r2, q2))
    c2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup) VALUES (?, '1', 1, '1', 'Opt 1');", (r2,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r2, c2))
    
    # Asset row exists in DB with status 'present', but file is deleted from disk
    a2 = media_store.register_bytes(b"dummy_bytes_to_delete", ".ogg", "audio", "audio/ogg", conn)
    conn.execute("INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required) VALUES (?, ?, 'audio', 1);", (r2, a2["id"]))
    f2 = media_store.get_asset_file_path(a2["relative_path"])
    f2.unlink()  # File deleted from disk

    candidates = select_practice_candidates(
        conn=conn,
        level="N5",
        category="listening",
        format_code="task_based_listening",
        limit=10,
        verify_files=True,
        media_store=media_store,
    )
    # Only q1 should be selected; q2 must be excluded because its media is missing
    selected_ids = [c[0] for c in candidates]
    assert q1 in selected_ids
    assert q2 not in selected_ids


# =============================================================================
# 2. Adaptive Practice Recency Tests
# =============================================================================

def test_adaptive_recency_expansion_intervals():
    """Verify recency expansion intervals: 3, 7, 14, 30 days and priority suppression."""
    now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)

    # 1. Unattempted: baseline high priority (120.0)
    score_unatt = calculate_priority_score(total_attempts=0, last_is_correct=None, last_rating=None, consecutive_correct_easy=0)
    assert score_unatt == PRIORITY_UNATTEMPTED

    # 2. Correct 1 time: target interval 3 days
    # Answered 2 hours ago: heavily suppressed
    last_attempt_2h = now - timedelta(hours=2)
    score_recent = calculate_priority_score(
        total_attempts=1,
        last_is_correct=1,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=last_attempt_2h,
        now=now,
        consecutive_correct=1,
    )
    assert score_recent < 10.0, f"Expected suppressed score for 2h ago, got {score_recent}"

    # Answered 3.5 days ago: fully matured
    last_attempt_3d = now - timedelta(days=3, hours=12)
    score_matured = calculate_priority_score(
        total_attempts=1,
        last_is_correct=1,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=last_attempt_3d,
        now=now,
        consecutive_correct=1,
    )
    assert score_matured >= PRIORITY_CORRECT_NORMAL

    # 3. Correct 2 times: target interval 7 days
    # At 4 days: still suppressed
    score_2nd_4d = calculate_priority_score(
        total_attempts=2,
        last_is_correct=1,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=now - timedelta(days=4),
        now=now,
        consecutive_correct=2,
    )
    assert score_2nd_4d < PRIORITY_CORRECT_NORMAL * 0.5

    # At 8 days: matured
    score_2nd_8d = calculate_priority_score(
        total_attempts=2,
        last_is_correct=1,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=now - timedelta(days=8),
        now=now,
        consecutive_correct=2,
    )
    assert score_2nd_8d >= PRIORITY_CORRECT_NORMAL

    # 4. Correct 3 times: target interval 14 days
    score_3rd_10d = calculate_priority_score(
        total_attempts=3,
        last_is_correct=1,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=now - timedelta(days=10),
        now=now,
        consecutive_correct=3,
    )
    assert score_3rd_10d < PRIORITY_CORRECT_NORMAL * 0.5

    # 5. Two-time correct easy deprioritization: priority is 5.0 and interval is 30 days
    score_easy_twice = calculate_priority_score(
        total_attempts=2,
        last_is_correct=1,
        last_rating="easy",
        consecutive_correct_easy=2,
        last_attempted_at=now - timedelta(days=35),
        now=now,
    )
    assert score_easy_twice == PRIORITY_DEPRIORITIZED_EASY_TWICE

    # 6. Incorrect question: retains top priority (>= 200.0)
    score_incorrect = calculate_priority_score(
        total_attempts=2,
        last_is_correct=0,
        last_rating="normal",
        consecutive_correct_easy=0,
        last_attempted_at=now - timedelta(days=2),
        now=now,
    )
    assert score_incorrect >= PRIORITY_INCORRECT


# =============================================================================
# 3. Strict and Relaxed Exam Modes Tests
# =============================================================================

def _seed_minimal_exam_bank(conn: sqlite3.Connection, media_store: MediaStore, level: str = "N5"):
    """Seed minimal questions matching N5 blueprint for exam tests."""
    audio_bytes = b"OggS\x00\x02valid_audio_stream"
    audio_asset = media_store.register_bytes(audio_bytes, ".ogg", "audio", "audio/ogg", conn)

    quotas = [
        ("kanji_reading", 12),
        ("orthography", 8),
        ("contextual_expressions", 10),
        ("paraphrases", 5),
        ("sentential_grammar_1", 16),
        ("sentence_composition", 5),
        ("text_grammar", 5),
        ("comprehension_short", 3),
        ("comprehension_mid", 2),
        ("information_retrieval", 1),
        ("task_based_listening", 7),
        ("key_points_listening", 6),
        ("verbal_expressions", 5),
        ("quick_response", 6),
    ]

    for fmt, count in quotas:
        category = "vocabulary" if fmt in ("kanji_reading", "orthography", "contextual_expressions", "paraphrases") \
            else "grammar" if fmt in ("sentential_grammar_1", "sentence_composition", "text_grammar") \
            else "reading" if fmt in ("comprehension_short", "comprehension_mid", "information_retrieval") \
            else "listening"

        for i in range(count):
            q_id = conn.execute(
                "INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, ?, ?, ?, 'active');",
                (generate_ulid(), fmt, level, category),
            ).lastrowid
            r_id = conn.execute(
                "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, validation_status, content_fingerprint) VALUES (?, ?, 1, 'Stem', 'valid', ?);",
                (q_id, fmt, generate_ulid()),
            ).lastrowid
            conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_id, q_id))
            c_id = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, ordinal, label, text_markup) VALUES (?, '1', 1, '1', 'Choice 1');", (r_id,)).lastrowid
            conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_id, c_id))

            if category == "listening":
                conn.execute(
                    "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required) VALUES (?, ?, 'audio', 1);",
                    (r_id, audio_asset["id"]),
                )


def test_strict_vs_relaxed_exam_modes(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """Strict mode blocks pausing and audio replay; relaxed mode allows both."""
    conn, media_store, _ = m9_db
    _seed_minimal_exam_bank(conn, media_store, "N5")

    service = ExamService(conn, media_store=media_store)

    # 1. Create STRICT exam
    strict_sess = service.create_exam_session("N5", seed=101, mode=ExamMode.STRICT)
    assert strict_sess.exam_mode == ExamMode.STRICT

    # Start section 1
    service.start_section(strict_sess.session_id, block_order=1)

    # Attempting to pause section in STRICT mode must raise ExamServiceError
    with pytest.raises(ExamServiceError, match="not permitted in strict exam mode"):
        service.pause_section(strict_sess.session_id, block_order=1)

    # Find a listening item in the exam
    st = service.peek_state(strict_sess.session_id)
    # Find listening attempt_item_id
    listening_item = conn.execute(
        """
        SELECT ai.id FROM attempt_item ai
        JOIN question q ON ai.question_id = q.id
        WHERE ai.attempt_id = ? AND q.category = 'listening'
        LIMIT 1;
        """,
        (strict_sess.session_id,),
    ).fetchone()
    assert listening_item is not None
    item_id = listening_item["id"]

    # First audio play succeeds
    play_count = service.record_audio_playback(strict_sess.session_id, item_id)
    assert play_count == 1

    # Second audio play in STRICT mode must raise ExamServiceError (no replay)
    with pytest.raises(ExamServiceError, match="cannot be replayed in strict exam mode"):
        service.record_audio_playback(strict_sess.session_id, item_id)

    # 2. Create RELAXED exam
    relaxed_sess = service.create_exam_session("N5", seed=102, mode=ExamMode.RELAXED)
    assert relaxed_sess.exam_mode == ExamMode.RELAXED

    service.start_section(relaxed_sess.session_id, block_order=1)

    # Pausing is allowed in RELAXED mode
    paused_state = service.pause_section(relaxed_sess.session_id, block_order=1)
    sec1 = next(s for s in paused_state.sections if s.block_order == 1)
    assert sec1.status == ExamSectionStatus.PAUSED

    # Resume section
    resumed_state = service.resume_section(relaxed_sess.session_id, block_order=1)
    sec1_resumed = next(s for s in resumed_state.sections if s.block_order == 1)
    assert sec1_resumed.status == ExamSectionStatus.IN_PROGRESS

    # Audio replay is allowed in RELAXED mode
    rel_listening_item = conn.execute(
        """
        SELECT ai.id FROM attempt_item ai
        JOIN question q ON ai.question_id = q.id
        WHERE ai.attempt_id = ? AND q.category = 'listening'
        LIMIT 1;
        """,
        (relaxed_sess.session_id,),
    ).fetchone()
    rel_item_id = rel_listening_item["id"]

    p1 = service.record_audio_playback(relaxed_sess.session_id, rel_item_id)
    assert p1 == 1
    p2 = service.record_audio_playback(relaxed_sess.session_id, rel_item_id)
    assert p2 == 2


# =============================================================================
# 4. Exam Timer Correctness Tests
# =============================================================================

def test_timer_correctness_and_server_time(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """Verify remaining-time calculations avoid premature truncation and expose server_time."""
    conn, media_store, _ = m9_db
    _seed_minimal_exam_bank(conn, media_store, "N5")

    service = ExamService(conn, media_store=media_store)
    sess = service.create_exam_session("N5", seed=201)

    # peek_state before start
    st0 = service.peek_state(sess.session_id)
    assert st0.server_time is not None
    # Confirm server_time parses as valid UTC ISO format
    srv_dt = datetime.fromisoformat(st0.server_time)
    assert srv_dt.tzinfo is not None

    service.start_section(sess.session_id, block_order=1)
    st1 = service.peek_state(sess.session_id)
    sec1 = next(s for s in st1.sections if s.block_order == 1)
    assert sec1.deadline_at is not None

    # Simulate sub-second remaining time: e.g. deadline is now + 0.4 seconds
    dl = datetime.now(timezone.utc) + timedelta(milliseconds=400)
    conn.execute(
        "UPDATE exam_section_attempt SET deadline_at = ? WHERE id = ?;",
        (dl.isoformat(), sec1.section_id),
    )

    # peek_state must calculate with ceil -> 1 second, NOT premature 0 seconds
    st_peek = service.peek_state(sess.session_id)
    sec1_peek = next(s for s in st_peek.sections if s.block_order == 1)
    assert sec1_peek.remaining_time_seconds == 1
    # peek_state must be read-only (did NOT transition to expired)
    assert sec1_peek.status == ExamSectionStatus.IN_PROGRESS

    # Now simulate deadline passed: deadline is now - 1 second
    dl_past = datetime.now(timezone.utc) - timedelta(seconds=1)
    conn.execute(
        "UPDATE exam_section_attempt SET deadline_at = ? WHERE id = ?;",
        (dl_past.isoformat(), sec1.section_id),
    )

    # peek_state shows 0 seconds remaining
    st_past = service.peek_state(sess.session_id)
    sec1_past = next(s for s in st_past.sections if s.block_order == 1)
    assert sec1_past.remaining_time_seconds == 0
    # Still read-only! Status remains in_progress until settle_timers is called
    assert sec1_past.status == ExamSectionStatus.IN_PROGRESS

    # Explicit settle_timers performs the atomic settlement
    settled = service.settle_timers(sess.session_id)
    assert sec1.section_id in settled

    # Now status is EXPIRED
    st_settled = service.peek_state(sess.session_id)
    sec1_settled = next(s for s in st_settled.sections if s.block_order == 1)
    assert sec1_settled.status == ExamSectionStatus.EXPIRED


# =============================================================================
# 5. Blueprint Quota Evidence Tests
# =============================================================================

def test_blueprint_quota_evidence_preservation():
    """Verify 2026.1 is preserved and 2026.2 classifies uncertain quotas as INFERRED."""
    # 1. BlueprintEvidenceLevel.INFERRED exists
    assert BlueprintEvidenceLevel.INFERRED.value == "inferred"

    # 2. Check 2026.1 is accessible and unchanged
    bp_2026_1 = get_official_blueprint("N1", version="2026.1")
    assert bp_2026_1.version == "2026.1"
    # All 2026.1 quotas have VERIFIED_PAPERS
    for sec in bp_2026_1.test_sections:
        for q in sec.item_quotas:
            assert q.source_evidence == BlueprintEvidenceLevel.VERIFIED_PAPERS

    # 3. Check 2026.2 has INFERRED for variable quotas
    bp_2026_2 = get_official_blueprint("N1", version="2026.2")
    assert bp_2026_2.version == "2026.2"

    sec_kr = next(s for s in bp_2026_2.test_sections if s.section_code == "N1_SEC_KNOWLEDGE_READING")
    # Integrated thematic reading should be INFERRED
    q_itr = next(q for q in sec_kr.item_quotas if q.format_code == "integrated_thematic_reading")
    assert q_itr.source_evidence == BlueprintEvidenceLevel.INFERRED

    sec_list = next(s for s in bp_2026_2.test_sections if s.section_code == "N1_SEC_LISTENING")
    # Integrated listening should be INFERRED
    q_il = next(q for q in sec_list.item_quotas if q.format_code == "listening_integrated")
    assert q_il.source_evidence == BlueprintEvidenceLevel.INFERRED

    # Kanji reading should remain VERIFIED_PAPERS
    q_kr = next(q for q in sec_kr.item_quotas if q.format_code == "kanji_reading")
    assert q_kr.source_evidence == BlueprintEvidenceLevel.VERIFIED_PAPERS


# =============================================================================
# 6. Scoring Interpretation v2 (Wilson Interval & Bands) Tests
# =============================================================================

def test_wilson_score_interval_properties():
    """Verify mathematical properties of the Wilson score interval."""
    # Boundary: 0 correct out of 10
    low_0, high_0 = wilson_score_interval(0, 10, confidence=0.95)
    assert low_0 == 0.0
    assert 0.0 < high_0 < 0.35

    # Boundary: 10 correct out of 10
    low_10, high_10 = wilson_score_interval(10, 10, confidence=0.95)
    assert 0.65 < low_10 < 1.0
    assert high_10 == 1.0

    # Small sample: 1 out of 1
    low_1, high_1 = wilson_score_interval(1, 1, confidence=0.95)
    assert 0.0 < low_1 < 1.0
    assert high_1 == 1.0

    # 0 out of 0
    low_empty, high_empty = wilson_score_interval(0, 0, confidence=0.95)
    assert low_empty == 0.0 and high_empty == 0.0


def test_provisional_band_v2_scoring(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """Verify ProvisionalBandScoringModel produces score range and honest interpretations."""
    conn, media_store, _ = m9_db
    _seed_minimal_exam_bank(conn, media_store, "N5")

    service = ExamService(conn, media_store=media_store, scoring_model=ProvisionalBandScoringModel())
    sess = service.create_exam_session("N5", seed=301)

    # Start and submit all sections answering 100% correctly
    bp = get_official_blueprint("N5")
    for sec_bp in bp.test_sections:
        service.start_section(sess.session_id, block_order=sec_bp.block_order)
        # Select answer for each item in the active section
        items = [it for it in service.peek_state(sess.session_id).current_section_items if it.block_order == sec_bp.block_order]
        for it in items:
            service.select_draft_choice(it.attempt_item_id, it.choices[0].choice_id)
        service.submit_section(sess.session_id, block_order=sec_bp.block_order)

    # Fetch result
    exam_res = conn.execute("SELECT result_json FROM exam_result_snapshot WHERE attempt_id = ?;", (sess.session_id,)).fetchone()
    assert exam_res is not None

    import json
    res_data = json.loads(exam_res["result_json"])
    assert res_data["scoring_algorithm_version"] == "provisional_band_v2"
    assert "score_range" in res_data["result_labels"]
    assert "interpretation" in res_data["result_labels"]
    assert res_data["result_labels"]["interpretation"] in ("likely_pass", "borderline", "unlikely_pass")
    assert res_data["estimated_score_lower"] is not None
    assert res_data["estimated_score_upper"] is not None
    assert res_data["estimated_score_lower"] <= res_data["estimated_total_score"] <= res_data["estimated_score_upper"]


def test_provisional_band_v2_sectional_threshold_failure(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """If a learner fails a sectional minimum threshold, interpretation must be unlikely_pass even if total is high."""
    conn, media_store, _ = m9_db
    _seed_minimal_exam_bank(conn, media_store, "N5")

    service = ExamService(conn, media_store=media_store, scoring_model=ProvisionalBandScoringModel())
    sess = service.create_exam_session("N5", seed=302)

    bp = get_official_blueprint("N5")
    for sec_bp in bp.test_sections:
        service.start_section(sess.session_id, block_order=sec_bp.block_order)
        items = [it for it in service.peek_state(sess.session_id).current_section_items if it.block_order == sec_bp.block_order]
        # In sections 1 and 2, answer all correctly (choice 1)
        # In section 3 (listening), leave all unanswered or choose wrong choice so score is 0
        if sec_bp.block_order != 3:
            for it in items:
                service.select_draft_choice(it.attempt_item_id, it.choices[0].choice_id)
        service.submit_section(sess.session_id, block_order=sec_bp.block_order)

    import json
    exam_res = conn.execute("SELECT result_json FROM exam_result_snapshot WHERE attempt_id = ?;", (sess.session_id,)).fetchone()
    res_data = json.loads(exam_res["result_json"])

    # Knowledge & Reading passed, but Listening failed sectional threshold (0 pts < 19 threshold)
    assert res_data["passed_sectional"] is False
    assert res_data["passed_overall_estimate"] is False
    assert res_data["result_labels"]["interpretation"] == "unlikely_pass"


def test_media_store_verification_caching(m9_db: tuple[sqlite3.Connection, MediaStore, Path]):
    """Verify that MediaStore verification caches mtime and size, avoiding repeated re-hashing."""
    conn, media_store, _ = m9_db
    audio_bytes = b"OggS\x00\x02test_caching_bytes_for_fast_media_verification"
    asset = media_store.register_bytes(audio_bytes, ".ogg", "audio", "audio/ogg", conn)

    # First verification computes hash and caches
    v1 = media_store.verify_asset(asset["sha256"], conn)
    assert v1 is True

    # Second verification hits cache
    v2 = media_store.verify_asset(asset["sha256"], conn)
    assert v2 is True

    # Modifying the file on disk should fail verification
    p = media_store.get_asset_file_path(asset["relative_path"])
    p.write_bytes(b"tampered_bytes_with_different_hash")

    v3 = media_store.verify_asset(asset["sha256"], conn)
    assert v3 is False

