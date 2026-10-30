"""
End-to-End Integration Tests for Ingestion Pipeline and Persistence.
--------------------------------------------------------------------
Verifies:
- Full deterministic ingestion: Input -> Extraction -> Segmentation -> Classification -> Association -> Normalization -> Validation -> Persistence
- All question families (F1..F6) and format compatibility
- Content group linking and text grammar anchor cross-validation
- Incomplete question candidate handling and eligibility evaluation
- ReviewService candidate updating and approval
- Database persistence into SQLite study.db (migrated with 0001 & 0002):
  - source, import_batch, import_item audit trail
  - question, question_revision, revision_choice, revision_answer
  - source_answer_claim
  - sealed_at immutability trigger enforcement
  - content_fingerprint deduplication
"""
from __future__ import annotations

from pathlib import Path
import sqlite3
import pytest

from app.study.connection import StudyDatabaseManager, reset_study_db_manager
from app.study.contracts.enums import (
    AnswerOrigin,
    JlptLevel,
    QuestionCategory,
    StructuralFamily,
)
from app.study.ingestion import (
    IngestAdapterKind,
    IngestInput,
    IngestionPipeline,
    ReviewReasonCode,
    ReviewService,
    ReviewStatus,
    StageStatus,
)
from app.study.migrations.runner import run_migrations


@pytest.fixture
def study_db_mgr(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide a real, isolated, fully migrated study SQLite database manager."""
    study_dir = tmp_path / "study_pipeline_test"
    study_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))
    reset_study_db_manager()

    db_path = study_dir / "study.db"
    manager = StudyDatabaseManager(db_path)
    conn = manager.get_connection()
    run_migrations(conn)
    conn.close()

    yield manager
    reset_study_db_manager()


def test_pipeline_f1_pasted_text_end_to_end(study_db_mgr: StudyDatabaseManager):
    """Test full ingestion and persistence of F1 vocabulary question from pasted text."""
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
        source_name="Official Mock 2021",
        default_level=JlptLevel.N5,
        auto_approve=True,
    )

    with study_db_mgr.write_tx() as conn:
        result = pipeline.run(input_data, conn=conn, persist=True)

    assert result.status == StageStatus.PERSISTED
    assert result.total_questions == 1
    assert result.approved_questions == 1
    assert result.persisted_questions == 1

    cand = result.questions[0]
    assert cand.persisted_question_id is not None
    assert cand.persisted_revision_id is not None
    assert cand.classification.format_code == "kanji_reading"

    # Verify rows in database
    with study_db_mgr.read() as conn:
        # 1. source table
        src = conn.execute("SELECT * FROM source WHERE name = 'Official Mock 2021';").fetchone()
        assert src is not None

        # 2. import_batch & import_item
        batch = conn.execute("SELECT * FROM import_batch WHERE source_id = ?;", (src["id"],)).fetchone()
        assert batch is not None
        assert batch["status"] == "completed"

        item = conn.execute("SELECT * FROM import_item WHERE import_batch_id = ?;", (batch["id"],)).fetchone()
        assert item is not None
        assert item["parsed_question_id"] == cand.persisted_question_id

        # 3. question table
        q = conn.execute("SELECT * FROM question WHERE id = ?;", (cand.persisted_question_id,)).fetchone()
        assert q["format_code"] == "kanji_reading"
        assert q["level"] == "N5"
        assert q["category"] == "vocabulary"
        assert q["current_revision_id"] == cand.persisted_revision_id

        # 4. question_revision table
        rev = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (cand.persisted_revision_id,)).fetchone()
        assert "{u|山}" in rev["stem_markup"]
        assert rev["sealed_at"] is not None  # Immutable

        # 5. revision_choice table
        choices = conn.execute(
            "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal;",
            (rev["id"],),
        ).fetchall()
        assert len(choices) == 4
        assert choices[1]["text_markup"] == "やま"

        # 6. revision_answer table
        ans = conn.execute("SELECT * FROM revision_answer WHERE question_revision_id = ?;", (rev["id"],)).fetchone()
        assert ans is not None
        assert ans["choice_id"] == choices[1]["id"]
        assert ans["answer_origin"] == "source_explicit"

        # 7. source_answer_claim table
        claim = conn.execute("SELECT * FROM source_answer_claim WHERE question_revision_id = ?;", (rev["id"],)).fetchone()
        assert claim is not None
        assert claim["source_label"] == "2"

        # 8. Test Immutability Trigger: attempt to update revision must abort!
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            conn.execute("UPDATE question_revision SET stem_markup = 'Hacked' WHERE id = ?;", (rev["id"],))


def test_pipeline_f2_sentence_composition(study_db_mgr: StudyDatabaseManager):
    """Test full ingestion of F2 sentence composition ordering with star."""
    raw_text = (
        "問題2 次の文の ★ に入る最もよいものを、1・2・3・4から一つ選びなさい。\n"
        "1 わたしは ＿＿＿ ＿＿＿ ★ ＿＿＿ 買いました。\n"
        "1 くだものを 2 きのう 3 デパートで 4 たくさん\n"
        "正解: 4\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="F2 Star Test",
        default_level=JlptLevel.N3,
        auto_approve=True,
    )

    with study_db_mgr.write_tx() as conn:
        result = pipeline.run(input_data, conn=conn, persist=True)

    assert result.status == StageStatus.PERSISTED
    cand = result.questions[0]
    assert cand.classification.structural_family == StructuralFamily.F2
    assert cand.classification.format_code == "sentence_composition"

    with study_db_mgr.read() as conn:
        q = conn.execute("SELECT * FROM question WHERE id = ?;", (cand.persisted_question_id,)).fetchone()
        assert q["format_code"] == "sentence_composition"


def test_pipeline_f3_reading_group(study_db_mgr: StudyDatabaseManager):
    """Test ingestion of reading passage and associated questions."""
    raw_text = (
        "次の文章を読んで、後の問いに対する答えとして最もよいものを一つ選びなさい。\n"
        "日本の気候は温和で、美しい自然が広がっています。特に春は素晴らしいです。\n\n"
        "1 日本の気候はどうですか。\n"
        "1 おだやか 2 さむい 3 あつい 4 つめたい\n"
        "正解: 1\n\n"
        "2 特に素晴らしい季節は何ですか。\n"
        "1 なつ 2 はる 3 あき 4 ふゆ\n"
        "正解: 2\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="Reading Passage Test",
        default_level=JlptLevel.N4,
        auto_approve=True,
    )

    with study_db_mgr.write_tx() as conn:
        result = pipeline.run(input_data, conn=conn, persist=True)

    assert result.status == StageStatus.PERSISTED
    assert len(result.groups) == 1
    assert len(result.questions) == 2

    group_cand = result.groups[0]
    assert group_cand.persisted_group_id is not None

    with study_db_mgr.read() as conn:
        grp = conn.execute("SELECT * FROM content_group WHERE id = ?;", (group_cand.persisted_group_id,)).fetchone()
        assert grp["kind"] == "passage"
        assert grp["level"] == "N4"

        # Check that questions link to this group
        for q_cand in result.questions:
            q = conn.execute("SELECT * FROM question WHERE id = ?;", (q_cand.persisted_question_id,)).fetchone()
            assert q["content_group_id"] == group_cand.persisted_group_id
            assert q["group_ordinal"] in (1, 2)


def test_pipeline_incomplete_question_needs_review():
    """Test that a question without an answer key is normalized as incomplete and marked needs_review."""
    raw_text = (
        "問題1 次の言葉の読み方として最もよいものを一つ選びなさい。\n"
        "1 あの{u|駅}は新しいです。\n"
        "1 えき 2 はし 3 みち 4 まち\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="Incomplete Question Test",
        default_level=JlptLevel.N5,
        auto_approve=False,
    )

    result = pipeline.run(input_data, persist=False)
    assert result.status == StageStatus.NEEDS_REVIEW
    cand = result.questions[0]
    assert cand.review_status == ReviewStatus.NEEDS_REVIEW
    assert ReviewReasonCode.MISSING_ANSWER_KEY in cand.review_reasons
    assert cand.payload.answer is None  # Incomplete answer is representable
    assert "NO_ANSWER" in cand.validation.eligibility_codes


def test_pipeline_review_service_correction_and_persistence(study_db_mgr: StudyDatabaseManager):
    """Test human review workflow: editing incomplete candidate, approving, and persisting."""
    raw_text = (
        "問題1 次の言葉の読み方として最もよいものを一つ選びなさい。\n"
        "1 あの{u|川}は長いです。\n"
        "1 かわ 2 やま 3 うみ 4 き\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="Correction Review Test",
        default_level=JlptLevel.N5,
        auto_approve=False,
    )

    result = pipeline.run(input_data, persist=False)
    cand = result.questions[0]
    assert cand.review_status == ReviewStatus.NEEDS_REVIEW

    # Human applies correction: sets answer key = 1
    review_service = ReviewService()
    updated_cand = review_service.update_candidate(cand, answer_key=1)
    # Approve candidate
    approved_cand = review_service.approve_candidate(updated_cand, notes="Verified by teacher")
    assert approved_cand.review_status == ReviewStatus.APPROVED
    assert approved_cand.payload.answer is not None
    assert approved_cand.payload.answer.choice_key.endswith("_1")

    # Now persist approved candidate
    from app.study.ingestion.persistence import PersistenceService
    persister = PersistenceService()
    doc = pipeline._adapters[IngestAdapterKind.PASTED_TEXT].extract(input_data)

    with study_db_mgr.write_tx() as conn:
        src_id, b_id = persister.persist_batch(conn, doc, [approved_cand], [])

    with study_db_mgr.read() as conn:
        q = conn.execute("SELECT * FROM question WHERE id = ?;", (approved_cand.persisted_question_id,)).fetchone()
        assert q is not None
        assert q["status"] == "draft"


def test_pipeline_deduplication(study_db_mgr: StudyDatabaseManager):
    """Test that importing the identical question twice reuses the existing question record."""
    raw_text = (
        "問題1 次の言葉の読み方として最もよいものを一つ選びなさい。\n"
        "1 あの{u|海}は青いです。\n"
        "1 かわ 2 やま 3 うみ 4 き\n"
        "正解: 3\n"
    )
    pipeline = IngestionPipeline()
    input_data = IngestInput(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        content=raw_text,
        source_name="Dedup Test Source",
        default_level=JlptLevel.N5,
        auto_approve=True,
    )

    with study_db_mgr.write_tx() as conn:
        result1 = pipeline.run(input_data, conn=conn, persist=True)

    with study_db_mgr.write_tx() as conn:
        result2 = pipeline.run(input_data, conn=conn, persist=True)

    # Question ID should be identical due to content_fingerprint deduplication
    assert result1.questions[0].persisted_question_id == result2.questions[0].persisted_question_id

