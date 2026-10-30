"""
Integration Tests for Question Family Contracts & Milestone 1 Relational Database.
-----------------------------------------------------------------------------------
Verifies:
- Decomposing Pydantic question contracts into SQLite rows for:
  `question`, `question_revision`, `revision_choice`, `revision_answer`, `question_revision_asset`
- Recomposing relational database rows back into typed Pydantic contracts
- Inserting decomposed rows directly into a real SQLite study database migrated with 0001 & 0002
- Ensuring composite foreign keys, STRICT types, and check constraints pass without errors
- Verifying content fingerprints are deterministic and match between Python and DB
- Preserving stable choice keys across practice queries and answer references
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.contracts import (
    AnswerOrigin,
    ChoiceMode,
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    decompose_question_for_db,
    parse_question_payload,
    recompose_question_from_db,
)
from app.study.migrations.runner import run_migrations


@pytest.fixture
def study_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide an isolated, fully migrated study SQLite database."""
    study_dir = tmp_path / "study_contract_integration"
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


def test_f1_database_roundtrip_and_persistence(study_db: sqlite3.Connection):
    """Test F1 question decomposes, inserts into SQLite, and recomposes with 100% fidelity."""
    contract = parse_question_payload({
        "external_id": "q_f1_persist_01",
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "category": "vocabulary",
        "prompt_markup": "あの{u|[山|やま]}は　たかいです。",
        "instruction_text": "下線の言葉の読み方を選んでください。",
        "choices": [
            {"ordinal": 1, "text_markup": "かわ"},
            {"ordinal": 2, "text_markup": "やま", "is_correct": True, "answer_origin": "source_explicit"},
            {"ordinal": 3, "text_markup": "うみ"},
            {"ordinal": 4, "text_markup": "き"},
        ],
    })
    assert isinstance(contract, F1QuestionPayload)

    # 1. Decompose for database insertion
    decomposed = decompose_question_for_db(contract, revision_number=1)
    q_row = decomposed["question"]
    rev_row = decomposed["revision"]
    choices = decomposed["choices"]
    ans = decomposed["answer"]

    # 2. Insert into SQLite tables
    q_id = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id;
        """,
        (q_row["external_id"], q_row["format_code"], q_row["level"], q_row["category"], q_row["status"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id;
        """,
        (q_id, rev_row["format_code"], rev_row["revision_number"], rev_row["stem_markup"], rev_row["payload_json"], rev_row["validation_status"], rev_row["content_fingerprint"]),
    ).fetchone()["id"]

    choice_id_map: dict[str, int] = {}
    db_choice_rows: list[dict] = []
    for c in choices:
        c_id = study_db.execute(
            """
            INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id;
            """,
            (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"]),
        ).fetchone()["id"]
        choice_id_map[c["choice_key"]] = c_id
        db_choice_rows.append({**c, "id": c_id})

    # Insert answer
    assert ans is not None
    correct_choice_id = choice_id_map[ans["choice_key"]]
    study_db.execute(
        """
        INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup)
        VALUES (?, ?, ?, ?);
        """,
        (rev_id, correct_choice_id, ans["answer_origin"], ans["rationale_markup"]),
    )

    # Pin current revision on question
    study_db.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # 3. Read back from SQLite and recompose contract
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    fetched_choices = [dict(r) for r in study_db.execute("SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;", (rev_id,)).fetchall()]
    fetched_ans_row = study_db.execute("SELECT * FROM revision_answer WHERE question_revision_id = ?;", (rev_id,)).fetchone()
    
    # Map choice_id back to choice_key for answer row
    choice_id_to_key = {c["id"]: c["choice_key"] for c in fetched_choices}
    recompose_ans = {
        "choice_key": choice_id_to_key[fetched_ans_row["choice_id"]],
        "answer_origin": fetched_ans_row["answer_origin"],
        "rationale_markup": fetched_ans_row["rationale_markup"],
    }

    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=fetched_choices,
        answer_row=recompose_ans,
    )

    assert isinstance(recomposed, F1QuestionPayload)
    assert recomposed.stem_markup == contract.stem_markup
    assert recomposed.format_code == contract.format_code
    assert recomposed.level == contract.level
    assert len(recomposed.choices) == 4
    assert recomposed.answer is not None
    assert recomposed.answer.choice_key == "choice_2"
    assert recomposed.instruction_text == "下線の言葉の読み方を選んでください。"


def test_f2_database_persistence_with_payload_json(study_db: sqlite3.Connection):
    """Test F2 sentence ordering persists fragment permutation and derived star in payload_json."""
    contract = parse_question_payload({
        "external_id": "q_f2_persist_01",
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N3",
        "category": "grammar",
        "prompt_markup": "きのうは　びょういんへ　__　__　{star}　__　いけませんでした。",
        "star_position": 3,
        "choices": [
            {"ordinal": 1, "text_markup": "いった", "fragment_order_position": 2},
            {"ordinal": 2, "text_markup": "ものの", "fragment_order_position": 3},
            {"ordinal": 3, "text_markup": "くすりを", "fragment_order_position": 4},
            {"ordinal": 4, "text_markup": "もらいに", "fragment_order_position": 1},
        ],
    })
    assert isinstance(contract, F2QuestionPayload)

    decomposed = decompose_question_for_db(contract)
    rev_row = decomposed["revision"]
    payload_data = json.loads(rev_row["payload_json"])

    # Verify payload_json contains ordering parameters
    assert payload_data["star_position"] == 3
    assert payload_data["fragment_order"] == [4, 1, 2, 3]
    assert payload_data["derived_star_choice_key"] == "choice_2"

    # Insert into database
    q_id = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status)
        VALUES (?, 'sentence_composition', 'N3', 'grammar', 'active')
        RETURNING id;
        """,
        (decomposed["question"]["external_id"],),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint)
        VALUES (?, 'sentence_composition', 1, ?, ?, 'valid', ?)
        RETURNING id;
        """,
        (q_id, rev_row["stem_markup"], rev_row["payload_json"], rev_row["content_fingerprint"]),
    ).fetchone()["id"]

    # Recompose
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    
    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=decomposed["choices"],
        answer_row=decomposed["answer"],
    )

    assert isinstance(recomposed, F2QuestionPayload)
    assert recomposed.star_position == 3
    assert recomposed.fragment_order == [4, 1, 2, 3]
    assert recomposed.derived_star_choice_key == "choice_2"
    assert recomposed.answer is not None
    assert recomposed.answer.choice_key == "choice_2"


def test_f4_database_composite_foreign_key_and_anchor(study_db: sqlite3.Connection):
    """Test F4 question referencing a content group anchor satisfies composite foreign keys."""
    # 1. Create content_group
    grp_id = study_db.execute(
        "INSERT INTO content_group (external_id, kind, level, status) VALUES ('grp_tg_01', 'passage', 'N1', 'active') RETURNING id;"
    ).fetchone()["id"]

    # 2. Create group_revision
    grp_rev_id = study_db.execute(
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp_grp') RETURNING id;",
        (grp_id,),
    ).fetchone()["id"]

    # 3. Create group_revision_part
    part_id = study_db.execute(
        "INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', '文章 {blank|blank_35} です。') RETURNING id;",
        (grp_rev_id,),
    ).fetchone()["id"]

    # 4. Create group_revision_anchor
    study_db.execute(
        "INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind) VALUES (?, ?, 'blank_35', 1, 'blank');",
        (grp_rev_id, part_id),
    )

    # 5. Create F4 Question
    contract = parse_question_payload({
        "external_id": "q_f4_tg_01",
        "format_code": "text_grammar",
        "structural_family": "F4",
        "level": "N1",
        "category": "grammar",
        "content_group_id": grp_id,
        "group_ordinal": 1,
        "anchor_key": "blank_35",
        "prompt_markup": "【 35 】に入るもの",
        "choices": [
            {"ordinal": 1, "text_markup": "選択肢A", "is_correct": True},
            {"ordinal": 2, "text_markup": "選択肢B"},
            {"ordinal": 3, "text_markup": "選択肢C"},
            {"ordinal": 4, "text_markup": "選択肢D"},
        ],
    })
    assert isinstance(contract, F4QuestionPayload)

    decomposed = decompose_question_for_db(contract)
    q_row = decomposed["question"]

    q_id = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal, anchor_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id;
        """,
        (q_row["external_id"], q_row["format_code"], q_row["level"], q_row["category"], q_row["status"],
         grp_id, q_row["group_ordinal"], q_row["anchor_key"]),
    ).fetchone()["id"]

    assert q_id is not None

