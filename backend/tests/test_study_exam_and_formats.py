"""
Targeted tests for Study Exam Configuration and Format Registry.
----------------------------------------------------------------
Covers:
- All 5 JLPT exam profiles seeded (N1–N5)
- N1/N2 combined timed blocks (110m and 105m) with 3 separate scoring sections (60 pts each)
- N3 split timed blocks (Vocab 30m, Grammar/Reading 70m, Listening 40m)
- N4/N5 split timed blocks (Vocab 25m/20m, Grammar/Reading 55m/40m, Listening 35m/30m) and combined scoring (120 pts)
- Category-to-scoring uniqueness per profile enforced by trigger
- Unverified question counts and break durations accepted as NULL
- Format registry completeness: all 20 formats across F1–F6 with level mappings
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.doctor import KNOWN_FORMAT_CODES
from app.study.migrations.runner import run_migrations


@pytest.fixture
def study_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated study database with migrations applied."""
    study_dir = tmp_path / "study_exam_tests"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)
    yield conn
    conn.close()
    reset_study_db_manager()


def test_format_registry_seed_completeness(study_db: sqlite3.Connection):
    """Test that all 20 official formats across F1–F6 are seeded and mapped to levels."""
    rows = study_db.execute("SELECT code, structural_family, category, grader_type FROM format;").fetchall()
    seeded_codes = {r["code"] for r in rows}
    assert seeded_codes == KNOWN_FORMAT_CODES

    # Check that kanji_reading is mapped to N1..N5
    kr_levels = {
        r["level"]
        for r in study_db.execute("SELECT level FROM format_level WHERE format_code = 'kanji_reading';").fetchall()
    }
    assert kr_levels == {"N1", "N2", "N3", "N4", "N5"}

    # Check word_formation is N2 only
    wf_levels = {
        r["level"]
        for r in study_db.execute("SELECT level FROM format_level WHERE format_code = 'word_formation';").fetchall()
    }
    assert wf_levels == {"N2"}

    # Check listening_integrated is N1 and N2
    li_levels = {
        r["level"]
        for r in study_db.execute("SELECT level FROM format_level WHERE format_code = 'listening_integrated';").fetchall()
    }
    assert li_levels == {"N1", "N2"}


def test_exam_profiles_seeded(study_db: sqlite3.Connection):
    """Test all five official profiles N1..N5 exist."""
    profiles = study_db.execute("SELECT id, level, name FROM exam_profile ORDER BY id ASC;").fetchall()
    levels = [p["level"] for p in profiles]
    assert levels == ["N1", "N2", "N3", "N4", "N5"]


def test_n1_and_n2_exam_blocks_and_scoring(study_db: sqlite3.Connection):
    """
    Test N1 & N2 structure:
    - 2 timed blocks: Language Knowledge + Reading (110m / 105m), Listening (55m / 50m)
    - 3 distinct scoring sections: Language Knowledge (60), Reading (60), Listening (60)
    """
    # N1 timed blocks
    n1_blocks = study_db.execute(
        """
        SELECT block_order, code, time_limit_minutes, audio_policy
        FROM exam_section_config
        WHERE exam_profile_id = 1
        ORDER BY block_order ASC;
        """
    ).fetchall()
    assert len(n1_blocks) == 2
    assert n1_blocks[0]["time_limit_minutes"] == 110
    assert n1_blocks[1]["time_limit_minutes"] == 55
    assert n1_blocks[1]["audio_policy"] == "once_strictly"

    # N1 scoring sections
    n1_scoring = study_db.execute(
        """
        SELECT section_order, code, max_score
        FROM scoring_section_config
        WHERE exam_profile_id = 1
        ORDER BY section_order ASC;
        """
    ).fetchall()
    assert len(n1_scoring) == 3
    assert [s["max_score"] for s in n1_scoring] == [60, 60, 60]

    # N2 timed blocks
    n2_blocks = study_db.execute(
        "SELECT block_order, time_limit_minutes FROM exam_section_config WHERE exam_profile_id = 2 ORDER BY block_order ASC;"
    ).fetchall()
    assert len(n2_blocks) == 2
    assert n2_blocks[0]["time_limit_minutes"] == 105
    assert n2_blocks[1]["time_limit_minutes"] == 50


def test_n3_exam_blocks_and_scoring(study_db: sqlite3.Connection):
    """
    Test N3 structure:
    - 3 timed blocks: Vocab (30m), Grammar + Reading (70m), Listening (40m)
    - 3 scoring sections: Language Knowledge (60), Reading (60), Listening (60)
    """
    n3_blocks = study_db.execute(
        "SELECT block_order, code, time_limit_minutes FROM exam_section_config WHERE exam_profile_id = 3 ORDER BY block_order ASC;"
    ).fetchall()
    assert len(n3_blocks) == 3
    assert [b["time_limit_minutes"] for b in n3_blocks] == [30, 70, 40]

    n3_scoring = study_db.execute(
        "SELECT section_order, max_score FROM scoring_section_config WHERE exam_profile_id = 3 ORDER BY section_order ASC;"
    ).fetchall()
    assert len(n3_scoring) == 3
    assert [s["max_score"] for s in n3_scoring] == [60, 60, 60]


def test_n4_and_n5_exam_blocks_and_combined_scoring(study_db: sqlite3.Connection):
    """
    Test N4 & N5 structure:
    - 3 timed blocks: Vocab (25m/20m), Grammar + Reading (55m/40m), Listening (35m/30m)
    - 2 scoring sections: Language Knowledge + Reading (120 pts), Listening (60 pts)
    """
    # N4
    n4_blocks = study_db.execute(
        "SELECT block_order, time_limit_minutes FROM exam_section_config WHERE exam_profile_id = 4 ORDER BY block_order ASC;"
    ).fetchall()
    assert [b["time_limit_minutes"] for b in n4_blocks] == [25, 55, 35]

    n4_scoring = study_db.execute(
        "SELECT section_order, max_score FROM scoring_section_config WHERE exam_profile_id = 4 ORDER BY section_order ASC;"
    ).fetchall()
    assert [s["max_score"] for s in n4_scoring] == [120, 60]

    # N5
    n5_blocks = study_db.execute(
        "SELECT block_order, time_limit_minutes FROM exam_section_config WHERE exam_profile_id = 5 ORDER BY block_order ASC;"
    ).fetchall()
    assert [b["time_limit_minutes"] for b in n5_blocks] == [20, 40, 30]

    n5_scoring = study_db.execute(
        "SELECT section_order, max_score FROM scoring_section_config WHERE exam_profile_id = 5 ORDER BY section_order ASC;"
    ).fetchall()
    assert [s["max_score"] for s in n5_scoring] == [120, 60]


def test_category_to_scoring_uniqueness_enforced_by_trigger(study_db: sqlite3.Connection):
    """Test that a category cannot be mapped to multiple scoring sections within the same exam profile."""
    # In N1 (profile 1), 'vocabulary' is already mapped to scoring section 101.
    # Attempting to map 'vocabulary' to scoring section 102 must abort via trigger.
    with pytest.raises(sqlite3.DatabaseError, match="A category belongs to exactly one scoring section"):
        study_db.execute(
            "INSERT INTO scoring_section_category (scoring_section_id, category) VALUES (102, 'vocabulary');"
        )


def test_unverified_question_counts_and_breaks_null(study_db: sqlite3.Connection):
    """Test unverified question counts and breaks remain NULL as specified."""
    rows = study_db.execute("SELECT break_duration_minutes, verify_counts FROM exam_section_config;").fetchall()
    for r in rows:
        assert r["break_duration_minutes"] is None
        assert r["verify_counts"] == 0

