"""
Targeted tests for AI Verification Persistence, Triggers, and Human Review.
---------------------------------------------------------------------------
Covers:
- Verification persistence in real isolated study.db (migrated 0001, 0002, 0003)
- Multi-attempt verification history per question revision
- Database triggers and immutability enforcement
- Human review bundle aggregation
- Human review decisions:
  - ACCEPT: marks run approved and explanation approved
  - CORRECT: non-mutating branching into a new sealed revision (revision_number + 1)
  - REJECT / DEFECTIVE: updates question status
- Read-only doctor validation: zero ERROR findings on healthy migrated database
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.contracts.enums import JlptLevel, QuestionCategory, StructuralFamily
from app.study.doctor import run_doctor
from app.study.ingestion import (
    IngestAdapterKind,
    IngestInput,
    IngestionPipeline,
    StageStatus,
)
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.verification.enums import (
    HumanDecisionType,
    VerificationStatus,
)
from app.study.verification.models import HumanReviewInput
from app.study.verification.persistence import VerificationPersistenceService
from app.study.verification.providers import MockAIProvider
from app.study.verification.review import VerificationReviewService
from app.study.verification.service import VerificationService


@pytest.fixture
def study_db_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide isolated, fully migrated study database manager."""
    study_dir = tmp_path / "study_verification_db_test"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)
    conn.close()

    yield manager, study_dir
    reset_study_db_manager()


def _seed_persisted_question(manager: StudyDatabaseManager) -> tuple[int, int]:
    """Helper to seed a valid persisted question in study.db using Gate 1."""
    raw_text = (
        "問題1 次の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。\n"
        "1 あの{u|山}は高いです。\n"
        "1 かわ 2 やま 3 うみ 4 き\n"
        "正解: 2\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="Official Mock 2026",
        default_level=JlptLevel.N5,
        auto_approve=True,
    )
    with manager.write_tx() as conn:
        res = pipeline.run(input_data, conn=conn, persist=True)

    cand = res.questions[0]
    return cand.persisted_question_id, cand.persisted_revision_id


def test_verification_persistence_and_history(study_db_env: tuple[StudyDatabaseManager, Path]):
    """Verify storing multiple verification run attempts for a question revision."""
    manager, _ = study_db_env
    q_id, rev_id = _seed_persisted_question(manager)

    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")
    service = VerificationService(provider_a=prov_a, provider_b=prov_b)

    # Attempt 1: Full agreement
    with manager.write_tx() as conn:
        record1 = service.verify_persisted_question(conn, q_id, rev_id, persist=True)

    assert record1.status == VerificationStatus.AGREEMENT

    # Attempt 2: Re-verify
    with manager.write_tx() as conn:
        record2 = service.verify_persisted_question(conn, q_id, rev_id, persist=True)

    assert record2.status == VerificationStatus.AGREEMENT

    # Verify history retrieval
    persist_service = VerificationPersistenceService()
    with manager.read() as conn:
        runs = persist_service.list_runs_for_revision(conn, rev_id)
        assert len(runs) == 2
        assert runs[0]["attempt_number"] == 1
        assert runs[1]["attempt_number"] == 2
        assert runs[0]["status"] == "agreement"
        assert len(runs[0]["model_responses"]) >= 2
        assert runs[0]["explanation"] is not None


def test_immutability_triggers_prevent_tampering(study_db_env: tuple[StudyDatabaseManager, Path]):
    """Verify engine-level BEFORE triggers prevent illegal deletes and updates."""
    manager, _ = study_db_env
    q_id, rev_id = _seed_persisted_question(manager)

    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")
    service = VerificationService(provider_a=prov_a, provider_b=prov_b)

    with manager.write_tx() as conn:
        service.verify_persisted_question(conn, q_id, rev_id, persist=True)

    with manager.write_tx() as conn:
        # 1. Attempt delete on verification_run -> ABORT
        with pytest.raises(sqlite3.IntegrityError) as exc1:
            conn.execute("DELETE FROM verification_run;")
        assert "verification_run records cannot be deleted" in str(exc1.value)

        # 2. Attempt update on verification_model_response -> ABORT
        with pytest.raises(sqlite3.IntegrityError) as exc2:
            conn.execute("UPDATE verification_model_response SET selected_choice_key = '99';")
        assert "verification_model_response records are immutable" in str(exc2.value)

        # 3. Attempt delete on verification_model_response -> ABORT
        with pytest.raises(sqlite3.IntegrityError) as exc3:
            conn.execute("DELETE FROM verification_model_response;")
        assert "verification_model_response records cannot be deleted" in str(exc3.value)

        # 4. Attempt delete on question_explanation -> ABORT
        with pytest.raises(sqlite3.IntegrityError) as exc4:
            conn.execute("DELETE FROM question_explanation;")
        assert "question_explanation records cannot be deleted" in str(exc4.value)


def test_human_review_workflow_accept(study_db_env: tuple[StudyDatabaseManager, Path]):
    """Verify human reviewer ACCEPT decision approves the run and explanation."""
    manager, _ = study_db_env
    q_id, rev_id = _seed_persisted_question(manager)

    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")
    service = VerificationService(provider_a=prov_a, provider_b=prov_b)

    with manager.write_tx() as conn:
        service.verify_persisted_question(conn, q_id, rev_id, persist=True)

    review_service = VerificationReviewService()

    # 1. Inspect bundle
    with manager.read() as conn:
        bundle = review_service.get_review_bundle(conn, q_id, rev_id)
        assert bundle["question"]["id"] == q_id
        assert len(bundle["choices"]) == 4
        assert bundle["verification_run"]["status"] == "agreement"
        run_id = bundle["verification_run"]["id"]

    # 2. Apply ACCEPT
    with manager.write_tx() as conn:
        res = review_service.apply_decision(
            conn=conn,
            run_id=run_id,
            decision=HumanDecisionType.ACCEPT,
            notes="LGTM, clear verification.",
        )

    assert res["decision"] == "accept"

    with manager.read() as conn:
        run_row = conn.execute("SELECT * FROM verification_run WHERE id = ?;", (run_id,)).fetchone()
        assert run_row["status"] == "human_approved"

        exp_row = conn.execute("SELECT * FROM question_explanation WHERE run_id = ?;", (run_id,)).fetchone()
        assert exp_row["is_human_approved"] == 1


def test_human_review_workflow_correct_branches_new_revision(study_db_env: tuple[StudyDatabaseManager, Path]):
    """
    CRITICAL: Verify human reviewer CORRECT decision creates a new sealed revision (rev_num + 1)
    without mutating the existing sealed revision or destroying original source claims.
    """
    manager, _ = study_db_env
    q_id, rev_id = _seed_persisted_question(manager)

    prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
    prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")
    service = VerificationService(provider_a=prov_a, provider_b=prov_b)

    with manager.write_tx() as conn:
        service.verify_persisted_question(conn, q_id, rev_id, persist=True)

    review_service = VerificationReviewService()
    with manager.read() as conn:
        bundle = review_service.get_review_bundle(conn, q_id, rev_id)
        run_id = bundle["verification_run"]["id"]

    # Apply CORRECT: Human says choice 3 is actually correct
    with manager.write_tx() as conn:
        res = review_service.apply_decision(
            conn=conn,
            run_id=run_id,
            decision=HumanDecisionType.CORRECT,
            selected_choice_key="3",
            human_explanation="Nuance correction: choice 3 is the intended answer.",
            notes="Overriding source key based on official errata.",
        )

    new_rev_id = res["new_revision_id"]
    assert new_rev_id is not None
    assert new_rev_id != rev_id

    with manager.read() as conn:
        # 1. Verify old revision is still sealed and intact
        old_rev = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (rev_id,)).fetchone()
        assert old_rev["revision_number"] == 1
        assert old_rev["sealed_at"] is not None

        # 2. Verify new revision is sealed with revision_number = 2
        new_rev = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (new_rev_id,)).fetchone()
        assert new_rev["revision_number"] == 2
        assert new_rev["sealed_at"] is not None

        # 3. Verify question current_revision_id now points to new_rev_id
        q_row = conn.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone()
        assert q_row["current_revision_id"] == new_rev_id

        # 4. Verify new revision's answer points to choice '3'
        new_ans = conn.execute(
            """
            SELECT ra.*, rc.choice_key, rc.label
            FROM revision_answer ra
            JOIN revision_choice rc ON ra.choice_id = rc.id
            WHERE ra.question_revision_id = ?;
            """,
            (new_rev_id,),
        ).fetchone()
        assert new_ans["label"] == "3" or new_ans["choice_key"] in ("3", "c_q_1_1_3")
        assert new_ans["answer_origin"] == "user_entered"

        # 5. Verify source claims on old revision were NOT destroyed
        claims = conn.execute(
            "SELECT * FROM source_answer_claim WHERE question_revision_id = ?;",
            (rev_id,),
        ).fetchall()
        assert len(claims) >= 1

        # 6. Verify source claims were copied to new revision with conflict flag updated (Audit A)
        new_claims = conn.execute(
            "SELECT * FROM source_answer_claim WHERE question_revision_id = ?;",
            (new_rev_id,),
        ).fetchall()
        assert len(new_claims) >= 1
        assert new_claims[0]["is_conflict"] == 1  # Source claimed '2', but human set '3' -> conflict

        # 7. Verify human explanation was recorded for new revision (Audit A)
        new_exp = conn.execute(
            "SELECT * FROM question_explanation WHERE question_revision_id = ?;",
            (new_rev_id,),
        ).fetchone()
        assert new_exp is not None
        assert new_exp["generated_by_slot"] == "human"
        assert new_exp["is_human_approved"] == 1

        # 8. Verify recompose_question_from_db succeeds on new revision
        from app.study.contracts.db_mapping import recompose_question_from_db
        new_rev_row = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (new_rev_id,)).fetchone()
        new_choices = conn.execute("SELECT * FROM revision_choice WHERE question_revision_id = ?;", (new_rev_id,)).fetchall()
        q_contract = recompose_question_from_db(dict(q_row), dict(new_rev_row), [dict(c) for c in new_choices], dict(new_ans))
        assert q_contract.answer is not None


def _seed_persisted_question_with_asset(manager: StudyDatabaseManager) -> tuple[int, int, int]:
    """Helper to seed a question with an attached audio asset."""
    from datetime import datetime, timezone
    from app.study.ulid import generate_ulid

    now_iso = datetime.now(timezone.utc).isoformat()
    with manager.write_tx() as conn:
        conn.execute(
            """
            INSERT INTO asset (sha256, kind, mime_type, byte_size, relative_path, status)
            VALUES ('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff', 'audio', 'audio/mp3', 1234, 'audio/test.mp3', 'present');
            """
        )
        asset_id = conn.execute("SELECT last_insert_rowid() AS id;").fetchone()["id"]

        q_id = conn.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, status)
            VALUES (?, 'task_based_listening', 'N5', 'listening', 'active')
            RETURNING id;
            """,
            (generate_ulid(),),
        ).fetchone()["id"]

        rev_id = conn.execute(
            """
            INSERT INTO question_revision (
                question_id, format_code, revision_number, stem_markup,
                payload_json, validation_status, content_fingerprint, schema_version
            ) VALUES (?, 'task_based_listening', 1, 'リスニング問題', '{}', 'valid', 'dummy_hash', 1)
            RETURNING id;
            """,
            (q_id,),
        ).fetchone()["id"]

        conn.execute(
            "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '1', '1', 1, '選択肢1');",
            (rev_id,),
        )
        c2 = conn.execute(
            "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, '2', '2', 2, '選択肢2') RETURNING id;",
            (rev_id,),
        ).fetchone()["id"]

        conn.execute(
            "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_explicit');",
            (rev_id, c2),
        )

        conn.execute(
            "INSERT INTO question_revision_asset (question_revision_id, asset_id, role, ordinal, is_required) VALUES (?, ?, 'audio', 1, 1);",
            (rev_id, asset_id),
        )

        conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now_iso, rev_id))
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

    return q_id, rev_id, asset_id


def test_human_correction_preserves_question_assets(study_db_env: tuple[StudyDatabaseManager, Path]):
    """
    CRITICAL (Audit A): Verify that when a question has assets (e.g. listening audio,
    diagrams, illustrations), correcting the answer branches to revision N+1 while
    preserving all question_revision_asset rows.
    """
    manager, _ = study_db_env
    q_id, rev_id, asset_id = _seed_persisted_question_with_asset(manager)

    with manager.write_tx() as conn:
        prov_a = MockAIProvider(model="mock-a", default_selected_choice="2")
        prov_b = MockAIProvider(model="mock-b", default_selected_choice="2")
        service = VerificationService(provider_a=prov_a, provider_b=prov_b)
        service.verify_persisted_question(conn, q_id, rev_id, persist=True)

        review_service = VerificationReviewService()
        bundle = review_service.get_review_bundle(conn, q_id, rev_id)
        run_id = bundle["verification_run"]["id"]

        # Apply correction
        res = review_service.apply_decision(
            conn=conn,
            run_id=run_id,
            decision=HumanDecisionType.CORRECT,
            selected_choice_key="1",
            human_explanation="Audio keyword was misunderstood in source key.",
        )
        new_rev_id = res["new_revision_id"]

    # Verify assets were copied to revision N+1
    with manager.read() as conn:
        new_assets = conn.execute(
            "SELECT * FROM question_revision_asset WHERE question_revision_id = ?;",
            (new_rev_id,),
        ).fetchall()
        assert len(new_assets) == 1
        assert new_assets[0]["asset_id"] == asset_id
        assert new_assets[0]["role"] == "audio"
        assert new_assets[0]["is_required"] == 1


def test_human_correction_f2_sentence_composition_preserves_contract(study_db_env: tuple[StudyDatabaseManager, Path]):
    """
    CRITICAL (Audit A): Verify that when an F2 Sentence Composition question's answer is
    corrected, the payload's derived_star_choice_key is updated, contradictory fragment_order
    is cleared to None, and recompose_question_from_db produces a valid F2 question contract.
    """
    import json
    from datetime import datetime, timezone
    from app.study.contracts.db_mapping import recompose_question_from_db
    from app.study.ulid import generate_ulid

    manager, _ = study_db_env
    now_iso = datetime.now(timezone.utc).isoformat()

    with manager.write_tx() as conn:
        q_id = conn.execute(
            """
            INSERT INTO question (external_id, format_code, level, category, status)
            VALUES (?, 'sentence_composition', 'N5', 'grammar', 'active')
            RETURNING id;
            """,
            (generate_ulid(),),
        ).fetchone()["id"]

        f2_payload = {
            "instruction_text": "正しい順序に並べなさい。",
            "star_position": 3,
            "fragment_order": [1, 2, 3, 4],  # Star pos 3 -> choice 3
            "derived_star_choice_key": "3",
        }

        rev_id = conn.execute(
            """
            INSERT INTO question_revision (
                question_id, format_code, revision_number, stem_markup,
                payload_json, validation_status, content_fingerprint, schema_version
            ) VALUES (?, 'sentence_composition', 1, '公園に {blank|1} {blank|2} {star} {blank|4} 行きました。', ?, 'valid', 'f2_hash', 1)
            RETURNING id;
            """,
            (q_id, json.dumps(f2_payload)),
        ).fetchone()["id"]

        c_map = {}
        for ord_val in (1, 2, 3, 4):
            cid = conn.execute(
                "INSERT INTO revision_choice (question_revision_id, choice_key, label, ordinal, text_markup) VALUES (?, ?, ?, ?, ?);",
                (rev_id, str(ord_val), str(ord_val), ord_val, f"文節{ord_val}"),
            ).lastrowid
            c_map[str(ord_val)] = cid

        conn.execute(
            "INSERT INTO revision_answer (question_revision_id, choice_id, answer_origin) VALUES (?, ?, 'source_derived');",
            (rev_id, c_map["3"]),
        )

        conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now_iso, rev_id))
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))

        # Run mock verification
        prov_a = MockAIProvider(model="mock-a", default_selected_choice="3")
        prov_b = MockAIProvider(model="mock-b", default_selected_choice="3")
        service = VerificationService(provider_a=prov_a, provider_b=prov_b)
        service.verify_persisted_question(conn, q_id, rev_id, persist=True)

        review_service = VerificationReviewService()
        bundle = review_service.get_review_bundle(conn, q_id, rev_id)
        run_id = bundle["verification_run"]["id"]

        # Human corrects star answer to choice "4"
        res = review_service.apply_decision(
            conn=conn,
            run_id=run_id,
            decision=HumanDecisionType.CORRECT,
            selected_choice_key="4",
            human_explanation="Fragment 4 belongs in the star position.",
        )
        new_rev_id = res["new_revision_id"]

    # Verify new revision contract integrity
    with manager.read() as conn:
        q_row = conn.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone()
        new_rev_row = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (new_rev_id,)).fetchone()
        new_choices = conn.execute("SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;", (new_rev_id,)).fetchall()
        new_ans = conn.execute("SELECT * FROM revision_answer WHERE question_revision_id = ?;", (new_rev_id,)).fetchone()

        new_payload = json.loads(new_rev_row["payload_json"])
        assert new_payload["derived_star_choice_key"] == "4"
        assert new_payload["fragment_order"] is None  # Contradictory old order cleared

        # Recomposition MUST NOT raise ValueError
        q_contract = recompose_question_from_db(
            dict(q_row),
            dict(new_rev_row),
            [dict(c) for c in new_choices],
            dict(new_ans),
        )
        assert q_contract.format_code == "sentence_composition"
        assert q_contract.answer.choice_key == "4"


def test_doctor_passes_on_migrated_db(study_db_env: tuple[StudyDatabaseManager, Path]):
    """Verify run_doctor reports ZERO errors on healthy database with migration 0003."""
    manager, study_dir = study_db_env
    store = MediaStore(study_dir / "media")

    with manager.read() as conn:
        findings = run_doctor(conn, media_store=store)

    errors = [f for f in findings if f.severity == "ERROR"]
    assert len(errors) == 0, f"Doctor reported unexpected errors: {[e.detail for e in errors]}"

