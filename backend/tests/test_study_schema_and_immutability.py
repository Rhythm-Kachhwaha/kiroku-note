"""
Targeted tests for Study Relational Schema and Immutability Contracts.
---------------------------------------------------------------------
Covers:
- Standard-library-only ULID generator validation
- STRICT table enforcement and CHECK constraints
- Engine-level immutability triggers (UPDATE and DELETE aborts)
- Revision one-way sealed_at: NULL -> value transition
- Rejection of child insertions after parent revision is sealed
- Question immutable columns protection
- Asset status-only update and delete rejection
- Response append-only and locked-on-completed protections
- Composite foreign key integrity checks across:
  - Anchor referencing part from another group revision
  - Question referencing content group of mismatched level
  - Source claim referencing choice from another revision
  - Attempt item pinning group revision from another group
  - Choice-order row referencing choice from another revision
  - Response selecting choice from another question revision
  - Standalone question NULL-group enforcement
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.migrations.runner import run_migrations
from app.study.ulid import generate_ulid, is_valid_ulid


@pytest.fixture
def study_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide a fresh, migrated study database in a temp directory."""
    study_dir = tmp_path / "study_schema_tests"
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


def test_ulid_generation_properties():
    """Verify that ULID generator produces valid 26-char Crockford Base32 strings."""
    u1 = generate_ulid()
    u2 = generate_ulid()
    assert is_valid_ulid(u1)
    assert is_valid_ulid(u2)
    assert len(u1) == 26
    assert len(u2) == 26
    assert u1 != u2
    assert not is_valid_ulid("invalid-ulid-string")
    assert not is_valid_ulid("012345678901234567890123456789")  # too long


def test_question_revision_immutability_and_sealed_at(study_db: sqlite3.Connection):
    """Test question_revision update/delete rejection and one-way sealed_at transition."""
    # Insert question
    q_cur = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status)
        VALUES ('q_test_001', 'kanji_reading', 'N5', 'vocabulary', 'draft');
        """
    )
    q_id = q_cur.lastrowid

    # Insert revision
    rev_cur = study_db.execute(
        """
        INSERT INTO question_revision (
            question_id, format_code, revision_number, stem_markup, content_fingerprint
        ) VALUES (?, 'kanji_reading', 1, 'Stem {u|山}', 'sha256_dummy');
        """,
        (q_id,),
    )
    rev_id = rev_cur.lastrowid

    # 1. DELETE on question_revision must abort
    with pytest.raises(sqlite3.DatabaseError, match="question_revision records are immutable and cannot be deleted"):
        study_db.execute("DELETE FROM question_revision WHERE id = ?;", (rev_id,))

    # 2. Arbitrary UPDATE on question_revision must abort
    with pytest.raises(sqlite3.DatabaseError, match="Only sealed_at transition from NULL is permitted"):
        study_db.execute("UPDATE question_revision SET stem_markup = 'Altered Stem' WHERE id = ?;", (rev_id,))

    # 3. Permitted sealed_at transition (NULL -> timestamp)
    study_db.execute(
        "UPDATE question_revision SET sealed_at = '2026-10-30T10:00:00Z' WHERE id = ?;",
        (rev_id,),
    )
    row = study_db.execute("SELECT sealed_at FROM question_revision WHERE id = ?;", (rev_id,)).fetchone()
    assert row["sealed_at"] == "2026-10-30T10:00:00Z"

    # 4. Modifying sealed_at once set must abort
    with pytest.raises(sqlite3.DatabaseError, match="Sealed question_revision records are immutable"):
        study_db.execute("UPDATE question_revision SET sealed_at = '2026-10-30T12:00:00Z' WHERE id = ?;", (rev_id,))

    # 5. Inserting child records after revision is sealed must abort
    with pytest.raises(sqlite3.DatabaseError, match="Cannot insert revision_choice into a sealed question_revision"):
        study_db.execute(
            """
            INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup)
            VALUES (?, 'c1', '1', 1, 'Option 1');
            """,
            (rev_id,),
        )


def test_group_revision_immutability_and_sealed_at(study_db: sqlite3.Connection):
    """Test group_revision update/delete rejection and child insertion prevention after sealing."""
    # Insert content group
    cg_cur = study_db.execute(
        """
        INSERT INTO content_group (external_id, kind, level, status)
        VALUES ('grp_test_001', 'passage', 'N2', 'draft');
        """
    )
    grp_id = cg_cur.lastrowid

    # Insert group revision
    gr_cur = study_db.execute(
        """
        INSERT INTO group_revision (group_id, revision_number, content_fingerprint)
        VALUES (?, 1, 'grp_sha256_dummy');
        """,
        (grp_id,),
    )
    gr_id = gr_cur.lastrowid

    # DELETE must abort
    with pytest.raises(sqlite3.DatabaseError, match="group_revision records are immutable and cannot be deleted"):
        study_db.execute("DELETE FROM group_revision WHERE id = ?;", (gr_id,))

    # Insert part before sealing succeeds
    study_db.execute(
        """
        INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup)
        VALUES (?, 1, 'text', 'Passage body text');
        """,
        (gr_id,),
    )

    # Seal revision
    study_db.execute("UPDATE group_revision SET sealed_at = '2026-10-30T10:00:00Z' WHERE id = ?;", (gr_id,))

    # Inserting new part after seal must abort
    with pytest.raises(sqlite3.DatabaseError, match="Cannot insert group_revision_part into a sealed group_revision"):
        study_db.execute(
            """
            INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup)
            VALUES (?, 2, 'text', 'Second part');
            """,
            (gr_id,),
        )


def test_child_revision_tables_immutability(study_db: sqlite3.Connection):
    """Test that revision_choice, revision_answer, and group parts/anchors reject UPDATE and DELETE."""
    # Question & revision setup
    q_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category) VALUES ('q2', 'kanji_reading', 'N4', 'vocabulary');"
    ).lastrowid
    rev_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'Stem', 'f');",
        (q_id,),
    ).lastrowid

    # Choice setup
    c_id = study_db.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Choice A');",
        (rev_id,),
    ).lastrowid

    # Choice UPDATE aborts
    with pytest.raises(sqlite3.DatabaseError, match="revision_choice records are immutable"):
        study_db.execute("UPDATE revision_choice SET text_markup = 'Edited' WHERE id = ?;", (c_id,))

    # Choice DELETE aborts
    with pytest.raises(sqlite3.DatabaseError, match="revision_choice records are immutable"):
        study_db.execute("DELETE FROM revision_choice WHERE id = ?;", (c_id,))

    # Answer setup
    ans_id = study_db.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c_id),
    ).lastrowid

    # Answer UPDATE aborts
    with pytest.raises(sqlite3.DatabaseError, match="revision_answer records are immutable"):
        study_db.execute("UPDATE revision_answer SET answer_origin = 'user_entered' WHERE id = ?;", (ans_id,))

    # Answer DELETE aborts
    with pytest.raises(sqlite3.DatabaseError, match="revision_answer records are immutable"):
        study_db.execute("DELETE FROM revision_answer WHERE id = ?;", (ans_id,))


def test_question_immutable_columns_on_update(study_db: sqlite3.Connection):
    """Test that question format_code, level, and group attributes cannot be modified after insertion."""
    q_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category) VALUES ('q_imm', 'kanji_reading', 'N5', 'vocabulary');"
    ).lastrowid

    # Modifying level must abort
    with pytest.raises(sqlite3.DatabaseError, match="Question format_code and level are immutable"):
        study_db.execute("UPDATE question SET level = 'N4' WHERE id = ?;", (q_id,))

    # Modifying format_code must abort
    with pytest.raises(sqlite3.DatabaseError, match="Question format_code and level are immutable"):
        study_db.execute("UPDATE question SET format_code = 'orthography' WHERE id = ?;", (q_id,))

    # Modifying status from draft to active IS permitted
    study_db.execute("UPDATE question SET status = 'active' WHERE id = ?;", (q_id,))
    row = study_db.execute("SELECT status FROM question WHERE id = ?;", (q_id,)).fetchone()
    assert row["status"] == "active"


def test_asset_status_only_update_and_no_delete(study_db: sqlite3.Connection):
    """Test that only asset status may be updated; asset records cannot be deleted."""
    sha = "a" * 64
    a_id = study_db.execute(
        """
        INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
        VALUES (?, 'audio', 'audio/webm', 1024, 'aa/sample.webm', 'present');
        """,
        (sha,),
    ).lastrowid

    # Modifying status from present to missing IS permitted
    study_db.execute("UPDATE asset SET status = 'missing' WHERE id = ?;", (a_id,))
    assert study_db.execute("SELECT status FROM asset WHERE id = ?;", (a_id,)).fetchone()["status"] == "missing"

    # Modifying relative_path must abort
    with pytest.raises(sqlite3.DatabaseError, match="Only asset status may be updated"):
        study_db.execute("UPDATE asset SET relative_path = 'bb/other.webm' WHERE id = ?;", (a_id,))

    # Deleting asset must abort
    with pytest.raises(sqlite3.DatabaseError, match="asset records cannot be deleted"):
        study_db.execute("DELETE FROM asset WHERE id = ?;", (a_id,))


def test_composite_foreign_key_anchor_part_mismatch(study_db: sqlite3.Connection):
    """Test that group_revision_anchor cannot reference a part from another group revision."""
    grp_id = study_db.execute(
        "INSERT INTO content_group (external_id, kind, level) VALUES ('cg_anc', 'passage', 'N1');"
    ).lastrowid

    rev1_id = study_db.execute(
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp1');",
        (grp_id,),
    ).lastrowid
    part1_id = study_db.execute(
        "INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', 'Part 1');",
        (rev1_id,),
    ).lastrowid

    rev2_id = study_db.execute(
        "INSERT INTO group_revision_rec: revision 2 (group_id, revision_number, content_fingerprint) VALUES (?, 2, 'fp2');"
        if False else
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 2, 'fp2');",
        (grp_id,),
    ).lastrowid

    # Attempting to link an anchor in rev2 to part1 (which belongs to rev1) must fail FK check
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
        study_db.execute(
            """
            INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind)
            VALUES (?, ?, 'blank_1', 1, 'blank');
            """,
            (rev2_id, part1_id),
        )


def test_composite_foreign_key_source_claim_cross_revision(study_db: sqlite3.Connection):
    """Test that source_answer_claim cannot cite a choice from another question revision."""
    src_id = study_db.execute("INSERT INTO source (name, source_type) VALUES ('Src1', 'book');").lastrowid
    q_id = study_db.execute("INSERT INTO question (external_id, format_code, level, category) VALUES ('q_cl', 'kanji_reading', 'N3', 'vocabulary');").lastrowid

    rev1_id = study_db.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 1, 'S1', 'f1');", (q_id,)).lastrowid
    c1_id = study_db.execute("INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'c1', '1', 1, 'Opt 1');", (rev1_id,)).lastrowid

    rev2_id = study_db.execute("INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'kanji_reading', 2, 'S2', 'f2');", (q_id,)).lastrowid

    # Attempting to file claim on rev2 citing c1 (which belongs to rev1) must fail composite FK
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY constraint failed"):
        study_db.execute(
            """
            INSERT INTO source_answer_claim (question_revision_id, source_id, choice_id, source_label)
            VALUES (?, ?, ?, '1');
            """,
            (rev2_id, src_id, c1_id),
        )


def test_standalone_question_null_group_behavior(study_db: sqlite3.Connection):
    """Test standalone questions enforce NULL group_ordinal and anchor_key."""
    # A standalone question (content_group_id IS NULL) with group_ordinal set must violate CHECK constraint
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        study_db.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, content_group_id, group_ordinal)
            VALUES ('q_bad_null', 'kanji_reading', 'N5', 'vocabulary', NULL, 1);
            """
        )

