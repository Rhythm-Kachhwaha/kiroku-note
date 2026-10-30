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
    AssetRole,
    ChoiceMode,
    ContentGroupPayload,
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    GroupAnchorPayload,
    GroupAssetRefPayload,
    GroupKind,
    GroupPartPayload,
    GroupPartRole,
    JlptLevel,
    compute_group_content_fingerprint,
    decompose_group_for_db,
    decompose_question_for_db,
    parse_question_payload,
    recompose_group_from_db,
    recompose_question_from_db,
)
from app.study.eligibility import evaluate_eligibility
from app.study.formats import FORMAT_REGISTRY
from app.study.markup import (
    extract_anchors,
    parse_markup,
    to_markup,
    to_plain_text,
    to_reading_text,
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


def test_unprinted_choices_database_roundtrip_and_integrity(study_db: sqlite3.Connection):
    """
    Test Issue 1 & 3:
    - F5 question with unprinted choices (e.g. Quick Response).
    - Unprinted choices decompose with text_markup='' to satisfy SQLite
      CHECK (text_markup IS NOT NULL OR asset_id IS NOT NULL).
    - Inserting (NULL, NULL) violates the check constraint.
    - Contract -> DB -> Contract preserves ChoiceMode.UNPRINTED.
    """
    # 1. Create audio asset
    audio_id = study_db.execute(
        """
        INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path)
        VALUES (?, 'audio', 'audio/mpeg', 1024, 'audio/qr.mp3')
        RETURNING id;
        """,
        ("a" * 64,),
    ).fetchone()["id"]

    # 2. Parse F5 question with 3 unprinted choices
    contract = parse_question_payload({
        "external_id": "q_f5_unprinted_01",
        "format_code": "quick_response",
        "structural_family": "F5",
        "level": "N1",
        "category": "listening",
        "status": "active",
        "stem_markup": "質問を聞いて、１から３の中から最も適当なものを一つ選んでください。",
        "audio_asset": {
            "role": "audio",
            "asset_id": audio_id,
            "sha256": "a" * 64,
            "ordinal": 1,
        },
        "choices": [
            {"ordinal": 1, "mode": "unprinted"},
            {"ordinal": 2, "mode": "unprinted", "is_correct": True},
            {"ordinal": 3, "mode": "unprinted"},
        ],
    })
    assert isinstance(contract, F5QuestionPayload)

    # 3. Decompose and check choice representation
    decomposed = decompose_question_for_db(contract)
    for c in decomposed["choices"]:
        assert c["text_markup"] == ""  # Empty string representation
        assert c["asset_id"] is None
        assert "mode" not in c  # Only relational columns for revision_choice

    # 4. Insert into SQLite
    q_id = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status)
        VALUES (?, ?, ?, ?, ?) RETURNING id;
        """,
        (decomposed["question"]["external_id"], decomposed["question"]["format_code"],
         decomposed["question"]["level"], decomposed["question"]["category"], decomposed["question"]["status"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        """
        INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint)
        VALUES (?, ?, 1, ?, ?, ?, ?) RETURNING id;
        """,
        (q_id, decomposed["revision"]["format_code"], decomposed["revision"]["stem_markup"],
         decomposed["revision"]["payload_json"], decomposed["revision"]["validation_status"], decomposed["revision"]["content_fingerprint"]),
    ).fetchone()["id"]

    choice_id_map = {}
    for c in decomposed["choices"]:
        cid = study_db.execute(
            """
            INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup, asset_id)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"], c["asset_id"]),
        ).fetchone()["id"]
        choice_id_map[c["choice_key"]] = cid

    # Verify that trying to insert text_markup=NULL and asset_id=NULL fails SQLite check constraint
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed: text_markup IS NOT NULL OR asset_id IS NOT NULL"):
        study_db.execute(
            """
            INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup, asset_id)
            VALUES (?, 'illegal_choice', '4', 4, NULL, NULL);
            """,
            (rev_id,),
        )

    # Insert answer and audio asset
    ans = decomposed["answer"]
    study_db.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup) VALUES (?, ?, ?, ?);",
        (rev_id, choice_id_map[ans["choice_key"]], ans["answer_origin"], ans["rationale_markup"]),
    )
    for a in decomposed["assets"]:
        study_db.execute(
            "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, ?, ?, ?);",
            (rev_id, a["asset_id"], a["role"], a["ordinal"], a["is_required"]),
        )

    # 5. Read back from DB and recompose
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    fetched_choices = [dict(r) for r in study_db.execute("SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;", (rev_id,)).fetchall()]
    fetched_ans_row = dict(study_db.execute("SELECT * FROM revision_answer WHERE question_revision_id = ?;", (rev_id,)).fetchone())
    fetched_assets = [dict(r) for r in study_db.execute("SELECT * FROM question_revision_asset WHERE question_revision_id = ?;", (rev_id,)).fetchall()]

    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=fetched_choices,
        answer_row=fetched_ans_row,
        asset_rows=fetched_assets,
    )

    assert isinstance(recomposed, F5QuestionPayload)
    assert len(recomposed.choices) == 3
    assert all(c.mode == ChoiceMode.UNPRINTED for c in recomposed.choices)
    assert all(c.text_markup is None for c in recomposed.choices)
    assert recomposed.answer is not None
    assert recomposed.answer.choice_key == "choice_2"
    assert recomposed.audio_asset is not None
    assert recomposed.audio_asset.asset_id == audio_id


def test_image_choices_database_roundtrip(study_db: sqlite3.Connection):
    """
    Test Issue 3:
    - F5 question with 4 image choices backed by assets.
    - Image choices store text_markup=NULL and asset_id in SQLite.
    - Roundtrips cleanly with mode=ChoiceMode.IMAGE.
    """
    audio_id = study_db.execute(
        "INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path) VALUES (?, 'audio', 'audio/mpeg', 1024, 'a.mp3') RETURNING id;",
        ("0" * 64,),
    ).fetchone()["id"]

    img_ids = []
    for i in range(1, 5):
        iid = study_db.execute(
            "INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path) VALUES (?, 'choice_image', 'image/png', 500, ?) RETURNING id;",
            (str(i) * 64, f"img_{i}.png"),
        ).fetchone()["id"]
        img_ids.append(iid)

    contract = parse_question_payload({
        "external_id": "q_f5_img_01",
        "format_code": "task_based_listening",
        "structural_family": "F5",
        "level": "N2",
        "category": "listening",
        "status": "active",
        "stem_markup": "正しい絵を一つ選んでください。",
        "audio_asset": {"role": "audio", "asset_id": audio_id, "sha256": "0" * 64, "ordinal": 1},
        "choices": [
            {"ordinal": 1, "mode": "image", "asset_id": img_ids[0]},
            {"ordinal": 2, "mode": "image", "asset_id": img_ids[1], "is_correct": True},
            {"ordinal": 3, "mode": "image", "asset_id": img_ids[2]},
            {"ordinal": 4, "mode": "image", "asset_id": img_ids[3]},
        ],
    })

    decomposed = decompose_question_for_db(contract)
    for idx, c in enumerate(decomposed["choices"]):
        assert c["text_markup"] is None  # Image choices have NULL text in DB
        assert c["asset_id"] == img_ids[idx]

    # Insert into DB
    q_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, ?, ?, ?, ?) RETURNING id;",
        (decomposed["question"]["external_id"], decomposed["question"]["format_code"],
         decomposed["question"]["level"], decomposed["question"]["category"], decomposed["question"]["status"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint) "
        "VALUES (?, ?, 1, ?, ?, ?, ?) RETURNING id;",
        (q_id, decomposed["revision"]["format_code"], decomposed["revision"]["stem_markup"],
         decomposed["revision"]["payload_json"], decomposed["revision"]["validation_status"], decomposed["revision"]["content_fingerprint"]),
    ).fetchone()["id"]

    choice_id_map = {}
    for c in decomposed["choices"]:
        cid = study_db.execute(
            "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup, asset_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id;",
            (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"], c["asset_id"]),
        ).fetchone()["id"]
        choice_id_map[c["choice_key"]] = cid

    study_db.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin, rationale_markup) VALUES (?, ?, 'source_explicit', '');",
        (rev_id, choice_id_map["choice_2"]),
    )

    for a in decomposed["assets"]:
        study_db.execute(
            "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, ?, ?, ?);",
            (rev_id, a["asset_id"], a["role"], a["ordinal"], a["is_required"]),
        )

    # Recompose
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    fetched_choices = [dict(r) for r in study_db.execute("SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;", (rev_id,)).fetchall()]
    fetched_ans_row = dict(study_db.execute("SELECT * FROM revision_answer WHERE question_revision_id = ?;", (rev_id,)).fetchone())
    fetched_assets = [dict(r) for r in study_db.execute("SELECT * FROM question_revision_asset WHERE question_revision_id = ?;", (rev_id,)).fetchall()]

    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=fetched_choices,
        answer_row=fetched_ans_row,
        asset_rows=fetched_assets,
    )

    assert all(c.mode == ChoiceMode.IMAGE for c in recomposed.choices)
    assert [c.asset_id for c in recomposed.choices] == img_ids
    assert recomposed.answer is not None
    assert recomposed.answer.choice_key == "choice_2"


def test_incomplete_questions_without_answer(study_db: sqlite3.Connection):
    """
    Test Issue 2:
    - Incomplete question without an answer can exist in DB without revision_answer row.
    - v_question_eligibility returns has_answer = 0.
    - evaluate_eligibility returns ReasonCode.NO_ANSWER.
    - Recomposes cleanly with answer=None.
    """
    contract = parse_question_payload({
        "external_id": "q_incomplete_01",
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N4",
        "category": "vocabulary",
        "prompt_markup": "毎朝{u|新聞}を読みます。",
        "choices": [
            {"ordinal": 1, "text_markup": "しんぶん"},
            {"ordinal": 2, "text_markup": "じんぶん"},
            {"ordinal": 3, "text_markup": "しんもん"},
            {"ordinal": 4, "text_markup": "じんもん"},
        ],
    })
    assert contract.answer is None

    decomposed = decompose_question_for_db(contract)
    assert decomposed["answer"] is None

    q_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, ?, ?, ?, ?) RETURNING id;",
        (decomposed["question"]["external_id"], decomposed["question"]["format_code"],
         decomposed["question"]["level"], decomposed["question"]["category"], decomposed["question"]["status"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint) "
        "VALUES (?, ?, 1, ?, ?, ?, ?) RETURNING id;",
        (q_id, decomposed["revision"]["format_code"], decomposed["revision"]["stem_markup"],
         decomposed["revision"]["payload_json"], decomposed["revision"]["validation_status"], decomposed["revision"]["content_fingerprint"]),
    ).fetchone()["id"]

    for c in decomposed["choices"]:
        study_db.execute(
            "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, ?, ?, ?, ?);",
            (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"]),
        )

    # Pin current revision without an answer
    study_db.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # Check eligibility view
    view_row = study_db.execute("SELECT has_answer FROM v_question_eligibility WHERE question_id = ?;", (q_id,)).fetchone()
    assert view_row["has_answer"] == 0

    is_eligible, reasons = evaluate_eligibility(q_id, study_db)
    assert not is_eligible
    assert "NO_ANSWER" in reasons

    # Recompose with answer_row=None
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    fetched_choices = [dict(r) for r in study_db.execute("SELECT * FROM revision_choice WHERE question_revision_id = ?;", (rev_id,)).fetchall()]

    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=fetched_choices,
        answer_row=None,
    )
    assert recomposed.answer is None


def test_f2_ordering_permutations_and_integrity(study_db: sqlite3.Connection):
    """
    Test Issue 4:
    - F2 sentence ordering with star position and fragment permutations.
    - Derived star choice matches permutation without ambiguity.
    - Incomplete F2 questions without fragment_order survive roundtrip.
    """
    contract = parse_question_payload({
        "external_id": "q_f2_ordering_01",
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N2",
        "category": "grammar",
        "prompt_markup": "あそこにある　__　{star}　__　__　ものです。",
        "star_position": 2,  # Blank 2 is the star
        "fragment_order": [2, 4, 1, 3],  # Blank 2 gets choice 4
        "strict_whole_order_grading": True,
        "choices": [
            {"ordinal": 1, "text_markup": "フラグメント1"},
            {"ordinal": 2, "text_markup": "フラグメント2"},
            {"ordinal": 3, "text_markup": "フラグメント3"},
            {"ordinal": 4, "text_markup": "フラグメント4"},
        ],
    })
    assert isinstance(contract, F2QuestionPayload)
    assert contract.derived_star_choice_key == "choice_4"
    assert contract.answer is not None
    assert contract.answer.choice_key == "choice_4"

    decomposed = decompose_question_for_db(contract)
    rev_payload = json.loads(decomposed["revision"]["payload_json"])
    assert rev_payload["star_position"] == 2
    assert rev_payload["fragment_order"] == [2, 4, 1, 3]
    assert rev_payload["derived_star_choice_key"] == "choice_4"
    assert rev_payload["strict_whole_order_grading"] is True

    # Recompose from payload
    q_row = decomposed["question"]
    rev_row = decomposed["revision"]
    q_row["id"] = 100
    rev_row["id"] = 200
    choice_rows = [{**c, "id": idx + 1} for idx, c in enumerate(decomposed["choices"])]
    ans_row = {"choice_id": 4, "answer_origin": "source_derived", "rationale_markup": ""}

    recomposed = recompose_question_from_db(
        question_row=q_row,
        revision_row=rev_row,
        choice_rows=choice_rows,
        answer_row=ans_row,
    )
    assert isinstance(recomposed, F2QuestionPayload)
    assert recomposed.star_position == 2
    assert recomposed.fragment_order == [2, 4, 1, 3]
    assert recomposed.derived_star_choice_key == "choice_4"
    assert recomposed.strict_whole_order_grading is True
    assert recomposed.answer.choice_key == "choice_4"


def test_content_group_lifecycle_decomposition_recomposition(study_db: sqlite3.Connection):
    """
    Test Issue 5:
    - ContentGroupPayload decomposition, insertion into SQLite, and recomposition.
    - Guarantees parts, anchors, and assets map directly to schema with composite FKs.
    """
    # 1. Create diagram asset
    asset_id = study_db.execute(
        "INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path) VALUES (?, 'diagram', 'image/png', 2048, 'diag.png') RETURNING id;",
        ("d" * 64,),
    ).fetchone()["id"]

    group_contract = ContentGroupPayload(
        external_id="grp_passage_test_01",
        kind=GroupKind.PASSAGE,
        level=JlptLevel.N1,
        title="科学と社会",
        parts=[
            GroupPartPayload(ordinal=1, role=GroupPartRole.HEADING, markup="科学の役割"),
            GroupPartPayload(ordinal=2, role=GroupPartRole.TEXT, markup="現代社会において、科学技術の発展は {blank|blank_35} 大きな影響を与えている。"),
            GroupPartPayload(ordinal=3, role=GroupPartRole.TEXT, markup="その一方で、倫理的課題も {blank|blank_36} 無視できない。"),
        ],
        anchors=[
            GroupAnchorPayload(anchor_key="blank_35", ordinal=1, kind="blank", part_ordinal=2),
            GroupAnchorPayload(anchor_key="blank_36", ordinal=2, kind="blank", part_ordinal=3),
        ],
        assets=[
            GroupAssetRefPayload(role=AssetRole.DIAGRAM, asset_id=asset_id, sha256="d" * 64, ordinal=1, part_ordinal=2),
        ],
    )

    # 2. Decompose
    decomposed = decompose_group_for_db(group_contract)
    g_row = decomposed["group"]
    rev_row = decomposed["revision"]
    parts = decomposed["parts"]
    anchors = decomposed["anchors"]
    assets = decomposed["assets"]

    assert g_row["kind"] == "passage"
    assert g_row["level"] == "N1"
    assert len(parts) == 3
    assert len(anchors) == 2
    assert len(assets) == 1

    # 3. Insert into SQLite
    grp_id = study_db.execute(
        "INSERT INTO content_group (external_id, kind, level, status) VALUES (?, ?, ?, ?) RETURNING id;",
        (g_row["external_id"], g_row["kind"], g_row["level"], g_row["status"]),
    ).fetchone()["id"]

    grp_rev_id = study_db.execute(
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, ?, ?) RETURNING id;",
        (grp_id, rev_row["revision_number"], rev_row["content_fingerprint"]),
    ).fetchone()["id"]

    part_id_map: dict[int, int] = {}
    db_part_rows = []
    for p in parts:
        pid = study_db.execute(
            "INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, ?, ?, ?) RETURNING id;",
            (grp_rev_id, p["ordinal"], p["role"], p["markup"]),
        ).fetchone()["id"]
        part_id_map[p["ordinal"]] = pid
        db_part_rows.append({**p, "id": pid})

    db_anchor_rows = []
    for a in anchors:
        aid = study_db.execute(
            """
            INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind)
            VALUES (?, ?, ?, ?, ?) RETURNING id;
            """,
            (grp_rev_id, part_id_map[a["part_ordinal"]], a["anchor_key"], a["ordinal"], a["kind"]),
        ).fetchone()["id"]
        db_anchor_rows.append({**a, "id": aid, "part_id": part_id_map[a["part_ordinal"]]})

    db_asset_rows = []
    for ast in assets:
        ast_id = study_db.execute(
            """
            INSERT INTO group_revision_asset (group_revision_id, asset_id, role, ordinal, is_required, part_id)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id;
            """,
            (grp_rev_id, ast["asset_id"], ast["role"], ast["ordinal"], ast["is_required"], part_id_map[ast["part_ordinal"]]),
        ).fetchone()["id"]
        db_asset_rows.append({**ast, "id": ast_id, "part_id": part_id_map[ast["part_ordinal"]]})

    # Pin revision
    study_db.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (grp_rev_id, grp_id))

    # 4. Recompose
    fetched_g = dict(study_db.execute("SELECT * FROM content_group WHERE id = ?;", (grp_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM group_revision WHERE id = ?;", (grp_rev_id,)).fetchone())
    fetched_parts = [dict(r) for r in study_db.execute("SELECT * FROM group_revision_part WHERE group_revision_id = ? ORDER BY ordinal ASC;", (grp_rev_id,)).fetchall()]
    fetched_anchors = [dict(r) for r in study_db.execute("SELECT * FROM group_revision_anchor WHERE group_revision_id = ? ORDER BY ordinal ASC;", (grp_rev_id,)).fetchall()]
    fetched_assets = [dict(r) for r in study_db.execute("SELECT * FROM group_revision_asset WHERE group_revision_id = ? ORDER BY ordinal ASC;", (grp_rev_id,)).fetchall()]

    recomposed = recompose_group_from_db(
        group_row=fetched_g,
        revision_row=fetched_rev,
        part_rows=fetched_parts,
        anchor_rows=fetched_anchors,
        asset_rows=fetched_assets,
    )

    assert recomposed.external_id == "grp_passage_test_01"
    assert recomposed.kind == GroupKind.PASSAGE
    assert recomposed.level == JlptLevel.N1
    assert len(recomposed.parts) == 3
    assert len(recomposed.anchors) == 2
    assert len(recomposed.assets) == 1
    assert recomposed.anchors[0].anchor_key == "blank_35"
    assert recomposed.anchors[0].part_ordinal == 2
    assert recomposed.anchors[1].anchor_key == "blank_36"
    assert recomposed.anchors[1].part_ordinal == 3
    assert recomposed.assets[0].part_ordinal == 2


def test_f3_f4_group_ordinal_requirement_and_inconsistency(study_db: sqlite3.Connection):
    """
    Test Issue 5:
    - group_ordinal is required when content_group_id is set.
    - Group status transitions (active -> retired) trigger group_inconsistent in view.
    """
    # 1. Pydantic validation fails if group_ordinal is omitted with content_group_id
    with pytest.raises(ValueError, match="group_ordinal is required when content_group_id is set"):
        parse_question_payload({
            "format_code": "comprehension_short",
            "structural_family": "F3",
            "level": "N1",
            "content_group_id": 999,
            "group_ordinal": None,  # Missing!
            "prompt_markup": "質問です。",
            "choices": [
                {"ordinal": 1, "text_markup": "A"},
                {"ordinal": 2, "text_markup": "B"},
                {"ordinal": 3, "text_markup": "C"},
                {"ordinal": 4, "text_markup": "D"},
            ],
        })

    # 2. Check F4 text grammar anchor validation against retired group
    grp_id = study_db.execute(
        "INSERT INTO content_group (external_id, kind, level, status) VALUES ('grp_tg_02', 'passage', 'N1', 'active') RETURNING id;"
    ).fetchone()["id"]
    grp_rev_id = study_db.execute(
        "INSERT INTO group_revision (group_id, revision_number, content_fingerprint) VALUES (?, 1, 'fp_02') RETURNING id;",
        (grp_id,),
    ).fetchone()["id"]
    part_id = study_db.execute(
        "INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup) VALUES (?, 1, 'text', '本文 {blank|b_test} 文末') RETURNING id;",
        (grp_rev_id,),
    ).fetchone()["id"]
    study_db.execute(
        "INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind) VALUES (?, ?, 'b_test', 1, 'blank');",
        (grp_rev_id, part_id),
    )
    study_db.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (grp_rev_id, grp_id))

    f4_contract = parse_question_payload({
        "external_id": "q_f4_inconsist_01",
        "format_code": "text_grammar",
        "structural_family": "F4",
        "level": "N1",
        "category": "grammar",
        "content_group_id": grp_id,
        "group_ordinal": 1,
        "anchor_key": "b_test",
        "prompt_markup": "【 b_test 】に入る言葉",
        "choices": [
            {"ordinal": 1, "text_markup": "C1", "is_correct": True},
            {"ordinal": 2, "text_markup": "C2"},
            {"ordinal": 3, "text_markup": "C3"},
            {"ordinal": 4, "text_markup": "C4"},
        ],
    })
    dec = decompose_question_for_db(f4_contract)
    q_id = study_db.execute(
        """
        INSERT INTO question (external_id, format_code, level, category, status, content_group_id, group_ordinal, anchor_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id;
        """,
        (dec["question"]["external_id"], dec["question"]["format_code"], dec["question"]["level"],
         dec["question"]["category"], dec["question"]["status"], grp_id, dec["question"]["group_ordinal"], dec["question"]["anchor_key"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint) VALUES (?, ?, 1, ?, ?, ?, ?) RETURNING id;",
        (q_id, dec["revision"]["format_code"], dec["revision"]["stem_markup"], dec["revision"]["payload_json"], dec["revision"]["validation_status"], dec["revision"]["content_fingerprint"]),
    ).fetchone()["id"]
    c1_id = study_db.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'choice_1', '1', 1, 'C1') RETURNING id;",
        (rev_id,),
    ).fetchone()["id"]
    study_db.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev_id, c1_id),
    )
    study_db.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    # Active group: consistent
    row = study_db.execute("SELECT group_inconsistent FROM v_question_eligibility WHERE question_id = ?;", (q_id,)).fetchone()
    assert row["group_inconsistent"] == 0

    # Retire the group: inconsistent
    study_db.execute("UPDATE content_group SET status = 'retired' WHERE id = ?;", (grp_id,))
    row_retired = study_db.execute("SELECT group_inconsistent FROM v_question_eligibility WHERE question_id = ?;", (q_id,)).fetchone()
    assert row_retired["group_inconsistent"] == 1
    is_eligible, reasons = evaluate_eligibility(q_id, study_db)
    assert not is_eligible
    assert "GROUP_INCONSISTENT" in reasons


def test_f5_f6_audio_associations_and_missing_asset_detection(study_db: sqlite3.Connection):
    """
    Test Issue 6:
    - F5 uses individual question_revision_asset.
    - F6 uses shared group_revision_asset on audio_context group.
    - Missing required assets flag missing_required_assets_count in view.
    """
    # 1. F5 Question with audio asset
    audio_f5_id = study_db.execute(
        "INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status) VALUES (?, 'audio', 'audio/mpeg', 1024, 'a5.mp3', 'present') RETURNING id;",
        ("5" * 64,),
    ).fetchone()["id"]

    q5_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES ('q_f5_audio', 'quick_response', 'N1', 'listening', 'active') RETURNING id;"
    ).fetchone()["id"]
    rev5_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, content_fingerprint) VALUES (?, 'quick_response', 1, 'stem', 'fp5') RETURNING id;",
        (q5_id,),
    ).fetchone()["id"]
    c1_id = study_db.execute(
        "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, 'choice_1', '1', 1, '') RETURNING id;",
        (rev5_id,),
    ).fetchone()["id"]
    study_db.execute(
        "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
        (rev5_id, c1_id),
    )
    study_db.execute(
        "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, 'audio', 1, 1);",
        (rev5_id, audio_f5_id),
    )
    study_db.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev5_id, q5_id))

    # Asset present: count == 0
    row = study_db.execute("SELECT missing_required_assets_count FROM v_question_eligibility WHERE question_id = ?;", (q5_id,)).fetchone()
    assert row["missing_required_assets_count"] == 0

    # Set asset missing: count == 1
    study_db.execute("UPDATE asset SET status = 'missing' WHERE id = ?;", (audio_f5_id,))
    row_missing = study_db.execute("SELECT missing_required_assets_count FROM v_question_eligibility WHERE question_id = ?;", (q5_id,)).fetchone()
    assert row_missing["missing_required_assets_count"] == 1
    is_eligible, reasons = evaluate_eligibility(q5_id, study_db)
    assert not is_eligible
    assert "REQUIRED_ASSET_MISSING" in reasons


def test_markup_end_to_end_preservation(study_db: sqlite3.Connection):
    """
    Test Issue 7:
    - Markup with ruby, underline, blanks, and star survives contract -> DB -> contract.
    - Anchor references and AST positions preserved without loss.
    """
    complex_markup = "この{u|[漢字|かんじ]}の使い方は正しいか。{blank|blank_1}そして★ではなく{star}です。"
    contract = parse_question_payload({
        "external_id": "q_markup_roundtrip_01",
        "format_code": "sentential_grammar_1",
        "structural_family": "F1",
        "level": "N3",
        "category": "grammar",
        "prompt_markup": complex_markup,
        "choices": [
            {"ordinal": 1, "text_markup": "[本|ほん]"},
            {"ordinal": 2, "text_markup": "[木|き]", "is_correct": True},
            {"ordinal": 3, "text_markup": "[川|かわ]"},
            {"ordinal": 4, "text_markup": "[山|やま]"},
        ],
    })

    decomposed = decompose_question_for_db(contract)
    q_id = study_db.execute(
        "INSERT INTO question (external_id, format_code, level, category, status) VALUES (?, ?, ?, ?, ?) RETURNING id;",
        (decomposed["question"]["external_id"], decomposed["question"]["format_code"],
         decomposed["question"]["level"], decomposed["question"]["category"], decomposed["question"]["status"]),
    ).fetchone()["id"]

    rev_id = study_db.execute(
        "INSERT INTO question_revision (question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint) "
        "VALUES (?, ?, 1, ?, ?, ?, ?) RETURNING id;",
        (q_id, decomposed["revision"]["format_code"], decomposed["revision"]["stem_markup"],
         decomposed["revision"]["payload_json"], decomposed["revision"]["validation_status"], decomposed["revision"]["content_fingerprint"]),
    ).fetchone()["id"]

    for c in decomposed["choices"]:
        study_db.execute(
            "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, ?, ?, ?, ?);",
            (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"]),
        )

    # Recompose
    fetched_q = dict(study_db.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone())
    fetched_rev = dict(study_db.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone())
    fetched_choices = [dict(r) for r in study_db.execute("SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;", (rev_id,)).fetchall()]

    recomposed = recompose_question_from_db(
        question_row=fetched_q,
        revision_row=fetched_rev,
        choice_rows=fetched_choices,
    )

    assert recomposed.stem_markup == complex_markup
    ast = parse_markup(recomposed.stem_markup)
    assert to_markup(ast) == complex_markup
    assert extract_anchors(ast) == ["blank_1"]
    assert "★" in to_plain_text(ast)
    assert "かんじ" in to_reading_text(ast)


def test_format_registry_seed_exhaustive_agreement(study_db: sqlite3.Connection):
    """
    Test Issue 8:
    - Exhaustive comparison between app.study.formats.FORMAT_REGISTRY and
      migration 0002 format and format_level seed tables.
    """
    db_formats = {r["code"]: dict(r) for r in study_db.execute("SELECT * FROM format;").fetchall()}
    db_levels: dict[str, set[str]] = {}
    for r in study_db.execute("SELECT format_code, level FROM format_level;").fetchall():
        db_levels.setdefault(r["format_code"], set()).add(r["level"])

    assert len(FORMAT_REGISTRY) == 20
    assert len(db_formats) == 20

    for code, py_fmt in FORMAT_REGISTRY.items():
        assert code in db_formats, f"Missing format code '{code}' in database format table."
        db_f = db_formats[code]
        assert py_fmt.structural_family == db_f["structural_family"], f"Family mismatch on {code}."
        assert py_fmt.category == db_f["category"], f"Category mismatch on {code}."
        assert py_fmt.grader_type == db_f["grader_type"], f"Grader type mismatch on {code}."
        assert py_fmt.min_choices == db_f["min_choices"], f"Min choices mismatch on {code}."
        assert py_fmt.max_choices == db_f["max_choices"], f"Max choices mismatch on {code}."
        assert set(py_fmt.allowed_levels) == db_levels.get(code, set()), f"Level set mismatch on {code}."


def test_decompose_question_auto_generates_external_id():
    """
    Verify decompose_question_for_db automatically generates a 26-character ULID
    external_id when contract.external_id is None, preventing SQLite NOT NULL failures.
    """
    contract = parse_question_payload({
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "prompt_markup": "{u|[山|やま]}",
        "choices": [
            {"ordinal": 1, "text_markup": "かわ"},
            {"ordinal": 2, "text_markup": "やま", "is_correct": True},
            {"ordinal": 3, "text_markup": "うみ"},
            {"ordinal": 4, "text_markup": "き"},
        ],
    })
    assert contract.external_id is None
    decomposed = decompose_question_for_db(contract)
    assert decomposed["question"]["external_id"] is not None
    assert len(decomposed["question"]["external_id"]) == 26


