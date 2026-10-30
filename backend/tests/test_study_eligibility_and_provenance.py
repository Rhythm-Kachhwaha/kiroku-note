"""
Targeted tests for Study Question Eligibility, Provenance, and F1–F6 Relational Fixtures.
----------------------------------------------------------------------------------------
Covers:
- All 9 stable eligibility reason codes reachable in exact specification order:
  1. RETIRED
  2. NO_CURRENT_REVISION
  3. VALIDATION_FAILED
  4. NEEDS_REVIEW
  5. NO_ANSWER
  6. GRADER_UNIMPLEMENTED
  7. REQUIRED_ASSET_MISSING
  8. GROUP_INCONSISTENT
  9. ANSWER_CONFLICT
- SQL view v_question_eligibility and Python evaluate_eligibility parity
- Optional vs required missing assets (optional missing asset does NOT cause ineligibility)
- User-entered answer resolving source answer conflict
- Multiple sources and conflicting claims preserved without auto-merging
- Synthetic relational fixtures representing structural families F1–F6
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.eligibility import (
    REASON_ANSWER_CONFLICT,
    REASON_GRADER_UNIMPLEMENTED,
    REASON_GROUP_INCONSISTENT,
    REASON_NEEDS_REVIEW,
    REASON_NO_ANSWER,
    REASON_NO_CURRENT_REVISION,
    REASON_REQUIRED_ASSET_MISSING,
    REASON_RETIRED,
    REASON_VALIDATION_FAILED,
    evaluate_eligibility,
)
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.provenance import ProvenanceService


@pytest.fixture
def study_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated study database with migrations applied."""
    study_dir = tmp_path / "study_eligibility_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)
    yield conn, study_dir
    conn.close()
    reset_study_db_manager()


def test_reason_code_1_retired(study_db: tuple[sqlite3.Connection, Path]):
    """Test question with status='retired' returns RETIRED."""
    conn, _ = study_db
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_ret', 'kanji_reading', 'N5', 'vocabulary', 'retired');"
    ).lastrowid

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert reasons[0] == REASON_RETIRED


def test_reason_code_2_no_current_revision(study_db: tuple[sqlite3.Connection, Path]):
    """Test question with current_revision_id=NULL returns NO_CURRENT_REVISION."""
    conn, _ = study_db
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status, current_revision_id) VALUES ('q_norev', 'kanji_reading', 'N5', 'vocabulary', 'active', NULL);"
    ).lastrowid

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_NO_CURRENT_REVISION in reasons


def test_reason_code_3_validation_failed(study_db: tuple[sqlite3.Connection, Path]):
    """Test question revision with validation_status='invalid' returns VALIDATION_FAILED."""
    conn, _ = study_db
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_inv', 'kanji_reading', 'N5', 'vocabulary', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 1, 'Stem', 'fp', 'invalid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_VALIDATION_FAILED in reasons


def test_reason_code_4_needs_review(study_db: tuple[sqlite3.Connection, Path]):
    """Test question with status='draft' returns NEEDS_REVIEW."""
    conn, _ = study_db
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_draft', 'kanji_reading', 'N5', 'vocabulary', 'draft');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 1, 'Stem', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_NEEDS_REVIEW in reasons


def test_reason_code_5_no_answer(study_db: tuple[sqlite3.Connection, Path]):
    """Test question without revision_answer returns NO_ANSWER."""
    conn, _ = study_db
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_noans', 'kanji_reading', 'N5', 'vocabulary', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 1, 'Stem', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # Add choice but NO revision_answer
    conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Opt');",
        (rev_id,),
    )

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_NO_ANSWER in reasons


def test_reason_code_6_grader_unimplemented(study_db: tuple[sqlite3.Connection, Path]):
    """Test question with format having an unsupported grader returns GRADER_UNIMPLEMENTED."""
    conn, _ = study_db
    # Register dummy format with unhandled grader
    conn.execute(
        """
        INSERT INTO format (code, structural_family, category, grader_type, label)
        VALUES ('experimental_format', 'F1', 'grammar', 'ai_llm_grader', 'Experimental Format');
        """
    )
    conn.execute("INSERT INTO format_level (format_code, level) VALUES ('experimental_format', 'N1');")

    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_unimp', 'experimental_format', 'N1', 'grammar', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'experimental_format', 1, 'Stem', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    c_id = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Opt');",
        (rev_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c_id),
    )

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_GRADER_UNIMPLEMENTED in reasons


def test_reason_code_7_required_asset_missing_vs_optional(study_db: tuple[sqlite3.Connection, Path]):
    """Test that missing required asset makes question ineligible, but optional missing asset does not."""
    conn, _ = study_db
    sha = "b" * 64
    a_id = conn.execute(
        """
        INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
        VALUES (?, 'audio', 'audio/webm', 2048, 'bb/audio.webm', 'missing');
        """,
        (sha,),
    ).lastrowid

    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_asset_test', 'task_based_listening', 'N4', 'listening', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'task_based_listening', 1, 'Audio question', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    c_id = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Opt');",
        (rev_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c_id),
    )

    # 1. Link as OPTIONAL asset (is_required = 0)
    conn.execute(
        """
        INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required)
        VALUES (?, ?, 'audio', 0);
        """,
        (rev_id, a_id),
    )
    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert eligible is True
    assert REASON_REQUIRED_ASSET_MISSING not in reasons

    # 2. Add as REQUIRED asset (is_required = 1)
    conn.execute(
        """
        INSERT INTO question_revision_asset (question_revision_id, asset_id, role, is_required)
        VALUES (?, ?, 'illustration', 1);
        """,
        (rev_id, a_id),
    )
    eligible2, reasons2 = evaluate_eligibility(q_id, conn)
    assert eligible2 is False
    assert REASON_REQUIRED_ASSET_MISSING in reasons2


def test_reason_code_8_group_inconsistent(study_db: tuple[sqlite3.Connection, Path]):
    """Test missing or retired content group returns GROUP_INCONSISTENT."""
    conn, _ = study_db
    # Group that is retired
    cg_id = conn.execute(
        "INSERT INTO content_group (external_id, kind, level, status) VALUES ('cg_ret', 'passage', 'N2', 'retired');"
    ).lastrowid

    q_id = conn.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal)
        VALUES ('q_grp_inc', 'comprehension_short', 'N2', 'reading', 'active', ?, 1);
        """,
        (cg_id,),
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'comprehension_short', 1, 'Reading question', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    c_id = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Choice');",
        (rev_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c_id),
    )

    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_GROUP_INCONSISTENT in reasons


def test_reason_code_9_answer_conflict_and_user_entered_resolution(study_db: tuple[sqlite3.Connection, Path]):
    """Test source claim conflict causes ANSWER_CONFLICT, resolved by user_entered answer."""
    conn, _ = study_db
    src_id = conn.execute("INSERT INTO source (name, source_type) VALUES ('Book A', 'textbook');").lastrowid

    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_conf', 'kanji_reading', 'N3', 'vocabulary', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 1, 'Stem', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    c1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'A');", (rev_id,)).lastrowid
    c2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c2', '2', 2, 'B');", (rev_id,)).lastrowid

    # Canonical answer is c1 (origin: source_explicit)
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c1),
    )

    # Source claims c2 as correct -> introduces conflict
    ProvenanceService.record_source_answer_claim(
        conn=conn,
        question_revision_id=rev_id,
        source_id=src_id,
        choice_id=c2,
        is_conflict=1,
    )

    # Evaluator must return ANSWER_CONFLICT
    eligible, reasons = evaluate_eligibility(q_id, conn)
    assert not eligible
    assert REASON_ANSWER_CONFLICT in reasons

    # SQL view must also show conflict
    view_row = conn.execute("SELECT has_answer_conflict FROM v_question_eligibility WHERE question_id = ?;", (q_id,)).fetchone()
    assert view_row["has_answer_conflict"] == 1

    # Now simulate user entering answer revision: creating new canonical answer with origin 'user_entered'
    # In SQLite revision_answer is immutable, so we test creating a new revision with user_entered answer
    rev2_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 2, 'Stem', 'fp2', 'valid');
        """,
        (q_id,),
    ).lastrowid
    c1_rev2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'A');", (rev2_id,)).lastrowid
    c2_rev2 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c2', '2', 2, 'B');", (rev2_id,)).lastrowid
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'user_entered');",
        (rev2_id, c1_rev2),
    )
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev2_id, q_id))

    # With user_entered origin, question is now eligible!
    eligible_resolved, reasons_resolved = evaluate_eligibility(q_id, conn)
    assert eligible_resolved is True
    assert REASON_ANSWER_CONFLICT not in reasons_resolved


def test_sql_and_python_eligibility_parity(study_db: tuple[sqlite3.Connection, Path]):
    """Test SQL view v_question_eligibility flags strictly match Python evaluator results."""
    conn, _ = study_db

    # Create fully eligible question
    q_id = conn.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_parity', 'kanji_reading', 'N5', 'vocabulary', 'active');"
    ).lastrowid
    rev_id = conn.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint, validation_status)
        VALUES (?, 'kanji_reading', 1, 'Stem', 'fp', 'valid');
        """,
        (q_id,),
    ).lastrowid
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))
    c_id = conn.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Choice');",
        (rev_id,),
    ).lastrowid
    conn.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c_id),
    )

    py_eligible, py_reasons = evaluate_eligibility(q_id, conn)
    assert py_eligible is True
    assert len(py_reasons) == 0

    view_row = conn.execute("SELECT * FROM v_question_eligibility WHERE question_id = ?;", (q_id,)).fetchone()
    assert view_row["question_status"] == "active"
    assert view_row["has_current_revision"] == 1
    assert view_row["validation_status"] == "valid"
    assert view_row["has_answer"] == 1
    assert view_row["missing_required_assets_count"] == 0
    assert view_row["group_inconsistent"] == 0
    assert view_row["has_answer_conflict"] == 0


def test_synthetic_fixtures_f1_to_f6(study_db: tuple[sqlite3.Connection, Path], tmp_path: Path):
    """
    Construct synthetic database-level fixtures for all six families (F1–F6):
    - F1: Inline target multiple choice (Kanji Reading)
    - F2: Sentence composition (Star) with 4 permutation fragments
    - F3: Multi-question reading passage (Comprehension Short)
    - F4: Anchored text grammar passage
    - F5: Individual audio listening with required audio asset
    - F6: Shared audio listening group with multiple questions
    """
    conn, study_dir = study_db
    store = MediaStore(study_dir / "media")

    # 1. F1: Inline target MCQ
    q_f1 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status) VALUES ('f1_q', 'kanji_reading', 'N5', 'vocabulary', 'active');").lastrowid
    r_f1 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, '{u|山}は高い。', 'fp_f1');", (q_f1,)).lastrowid
    c_f1_1 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '1', '1', 1, 'やま');", (r_f1,)).lastrowid
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '2', '2', 2, 'かわ');", (r_f1,))
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '3', '3', 3, 'うみ');", (r_f1,))
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '4', '4', 4, 'き');", (r_f1,))
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_f1, c_f1_1))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f1, q_f1))
    assert evaluate_eligibility(q_f1, conn)[0] is True

    # 2. F2: Sentence composition (Star item)
    q_f2 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status) VALUES ('f2_q', 'sentence_composition', 'N3', 'grammar', 'active');").lastrowid
    r_f2 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'sentence_composition', 1, '彼は __ __ {star} __ 来なかった。', 'fp_f2');", (q_f2,)).lastrowid
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, '忙しかった');", (r_f2,))
    c_f2_star = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c2', '2', 2, 'ものの');", (r_f2,)).lastrowid
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c3', '3', 3, '連絡を');", (r_f2,))
    conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c4', '4', 4, 'くれた');", (r_f2,))
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_derived');", (r_f2, c_f2_star))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f2, q_f2))
    assert evaluate_eligibility(q_f2, conn)[0] is True

    # 3. F3: Passage-based question
    g_f3 = conn.execute("INSERT INTO content_group (external_id, kind, level, status) VALUES ('grp_f3', 'passage', 'N2', 'active');").lastrowid
    gr_f3 = conn.execute("INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp_gf3');", (g_f3,)).lastrowid
    conn.execute("INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', 'Passage body text');", (gr_f3,))
    conn.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (gr_f3, g_f3))

    q_f3 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal) VALUES ('f3_q', 'comprehension_short', 'N2', 'reading', 'active', ?, 1);", (g_f3,)).lastrowid
    r_f3 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'comprehension_short', 1, '筆者の考えは何か。', 'fp_f3');", (q_f3,)).lastrowid
    c_f3 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, '正解');", (r_f3,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_f3, c_f3))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f3, q_f3))
    assert evaluate_eligibility(q_f3, conn)[0] is True

    # 4. F4: Anchored text grammar
    g_f4 = conn.execute("INSERT INTO content_group (external_id, kind, level, status) VALUES ('grp_f4', 'passage', 'N1', 'active');").lastrowid
    gr_f4 = conn.execute("INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp_gf4');", (g_f4,)).lastrowid
    gp_f4 = conn.execute("INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', '社会の発展に伴い {blank|blank_35}。');", (gr_f4,)).lastrowid
    conn.execute("INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind) VALUES (?, ?, 'blank_35', 1, 'blank');", (gr_f4, gp_f4))
    conn.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (gr_f4, g_f4))

    q_f4 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal, anchor_key) VALUES ('f4_q', 'text_grammar', 'N1', 'grammar', 'active', ?, 1, 'blank_35');", (g_f4,)).lastrowid
    r_f4 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'text_grammar', 1, '【35】に入るもの。', 'fp_f4');", (q_f4,)).lastrowid
    c_f4 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, '求められる');", (r_f4,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_f4, c_f4))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f4, q_f4))
    assert evaluate_eligibility(q_f4, conn)[0] is True

    # 5. F5: Individual audio listening with present media
    audio_f = tmp_path / "f5_audio.webm"
    audio_f.write_bytes(b"F5_AUDIO_BYTES_TEST")
    a_f5 = store.register_file(audio_f, "audio", "audio/webm", conn)

    q_f5 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status) VALUES ('f5_q', 'task_based_listening', 'N4', 'listening', 'active');").lastrowid
    r_f5 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'task_based_listening', 1, '男の人は何をしますか。', 'fp_f5');", (q_f5,)).lastrowid
    conn.execute("INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, 'audio', 1, 1);", (r_f5, a_f5["id"]))
    c_f5 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, '電話する');", (r_f5,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_f5, c_f5))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f5, q_f5))
    assert evaluate_eligibility(q_f5, conn, verify_files=True, media_store=store)[0] is True

    # 6. F6: Shared audio listening group
    g_f6 = conn.execute("INSERT INTO content_group (external_id, kind, level, status) VALUES ('grp_f6', 'audio_context', 'N1', 'active');").lastrowid
    gr_f6 = conn.execute("INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp_gf6');", (g_f6,)).lastrowid
    conn.execute("INSERT INTO group_revision_asset (group_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, 'audio', 1, 1);", (gr_f6, a_f5["id"]))
    conn.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (gr_f6, g_f6))

    q_f6 = conn.execute("INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal) VALUES ('f6_q1', 'listening_integrated', 'N1', 'listening', 'active', ?, 1);", (g_f6,)).lastrowid
    r_f6 = conn.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'listening_integrated', 1, '質問1: 男の人の意見は。', 'fp_f6');", (q_f6,)).lastrowid
    c_f6 = conn.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, '賛成');", (r_f6,)).lastrowid
    conn.execute("INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');", (r_f6, c_f6))
    conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (r_f6, q_f6))
    assert evaluate_eligibility(q_f6, conn, verify_files=True, media_store=store)[0] is True

