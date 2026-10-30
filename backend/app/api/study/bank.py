"""
Study Bank & Exam Readiness Router.
-----------------------------------
Implements:
- GET /bank/summary?level=
- GET /exam/readiness
- GET /exam/blueprints/{level}
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, Query, status

from app.api.study.converters import (
    _get_group_audio_url,
    _get_question_audio_url,
    _get_question_media_url,
    _get_structural_family,
    _is_question_bookmarked,
)
from app.api.study.deps import get_media_store, get_study_db
from app.api.study.errors import StudyBadRequestError, StudyNotFoundError, map_domain_exception
from app.api.study.idempotency import (
    check_or_start_idempotency,
    clear_failed_idempotency,
    resolve_client_request_id,
    save_idempotency_result,
)
from app.api.study.schemas import (
    AnswerClaimDTO,
    BankSummaryResponse,
    ChoiceDTO,
    CreateQuestionReportRequest,
    FormatSummaryItem,
    GenericStatusResponse,
    GroupContextDTO,
    GroupPartDTO,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportPreviewGroupDTO,
    ImportPreviewItemDTO,
    ImportPreviewRequest,
    ImportPreviewResponse,
    IngestionProvenanceDTO,
    LevelSummaryItem,
    PaginatedResponse,
    QuestionDetailDTO,
    QuestionProvenanceResponse,
    QuestionReportDTO,
    SourceProvenanceDTO,
    UpdateQuestionReportRequest,
    VerificationProvenanceDTO,
)
from app.study.exam.blueprint import get_blueprint_from_db_or_default, get_official_blueprint
from app.study.exam.validator import ExamReadinessValidator
from app.study.formats import FORMAT_REGISTRY, get_format
from app.study.ingestion.enums import IngestAdapterKind, ReviewStatus
from app.study.ingestion.models import IngestInput
from app.study.ingestion.persistence import PersistenceService
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.media import MediaStore
from app.study.tx import unit_of_work
from app.study.ulid import generate_ulid

bank_router = APIRouter(tags=["study-bank"])

_IMPORT_PREVIEWS: Dict[str, Dict[str, Any]] = {}


def _resolve_question_id(conn: sqlite3.Connection, id_or_ext: str) -> int:
    """Resolve an integer ID or ULID external_id to integer primary key."""
    val = str(id_or_ext).strip()
    if val.isdigit():
        q_id = int(val)
        row = conn.execute("SELECT id FROM question WHERE id = ?;", (q_id,)).fetchone()
        if not row:
            raise StudyNotFoundError(f"Question with ID {q_id} not found.", code="QUESTION_NOT_FOUND")
        return q_id
    row = conn.execute("SELECT id FROM question WHERE external_id = ?;", (val,)).fetchone()
    if not row:
        raise StudyNotFoundError(f"Question with external ID '{val}' not found.", code="QUESTION_NOT_FOUND")
    return row["id"]


@bank_router.get("/bank/summary", response_model=BankSummaryResponse)
def get_bank_summary(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$", description="Optional JLPT level filter (N1-N5)"),
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> BankSummaryResponse:
    """
    Retrieve question bank counts, active counts, and eligible question breakdown
    by format and level.
    """
    try:
        # Total questions & active questions
        base_query = "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active FROM question"
        params: List[Any] = []
        if level:
            base_query += " WHERE level = ?"
            params.append(level)

        row = conn.execute(base_query, tuple(params)).fetchone()
        total_questions = row["total"] or 0
        active_questions = row["active"] or 0

        # Query all active questions with eligibility view
        elig_query = """
            SELECT
                vqe.question_id,
                vqe.level,
                vqe.category,
                vqe.format_code,
                vqe.question_status,
                CASE WHEN (
                    vqe.question_status = 'active'
                    AND vqe.has_current_revision = 1
                    AND vqe.validation_status = 'valid'
                    AND vqe.has_answer = 1
                    AND vqe.missing_required_assets_count = 0
                    AND vqe.group_inconsistent = 0
                    AND vqe.has_answer_conflict = 0
                ) THEN 1 ELSE 0 END AS is_eligible
            FROM v_question_eligibility vqe
        """
        if level:
            elig_query += " WHERE vqe.level = ?"

        elig_rows = conn.execute(elig_query, tuple(params)).fetchall()

        eligible_questions = sum(1 for r in elig_rows if r["is_eligible"] == 1)

        # Build nested summary per level and format
        target_levels = [level] if level else ["N5", "N4", "N3", "N2", "N1"]
        levels_dict: Dict[str, LevelSummaryItem] = {}

        for lvl in target_levels:
            lvl_rows = [r for r in elig_rows if r["level"] == lvl]
            lvl_total = len(lvl_rows)
            lvl_eligible = sum(1 for r in lvl_rows if r["is_eligible"] == 1)

            # Group by format
            format_counts: Dict[str, Dict[str, Any]] = {}
            for r in lvl_rows:
                fc = r["format_code"]
                if fc not in format_counts:
                    format_counts[fc] = {
                        "category": r["category"],
                        "total": 0,
                        "eligible": 0,
                    }
                format_counts[fc]["total"] += 1
                if r["is_eligible"] == 1:
                    format_counts[fc]["eligible"] += 1

            format_items = [
                FormatSummaryItem(
                    format_code=fc,
                    category=data["category"],
                    total_count=data["total"],
                    eligible_count=data["eligible"],
                )
                for fc, data in sorted(format_counts.items())
            ]

            levels_dict[lvl] = LevelSummaryItem(
                level=lvl,
                total_count=lvl_total,
                eligible_count=lvl_eligible,
                formats=format_items,
            )

        return BankSummaryResponse(
            total_questions=total_questions,
            active_questions=active_questions,
            eligible_questions=eligible_questions,
            levels=levels_dict,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/exam/readiness")
def get_exam_readiness(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$", description="JLPT Level (N1-N5)"),
    version: Optional[str] = Query(default=None, description="Blueprint version"),
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> Any:
    """
    Evaluate bank readiness against official or saved examination blueprints.
    Returns readiness deficits and format availability.
    """
    try:
        levels_to_check = [level] if level else ["N5", "N4", "N3", "N2", "N1"]
        reports = {}

        for lvl in levels_to_check:
            blueprint = get_blueprint_from_db_or_default(conn, lvl, version=version)
            report = ExamReadinessValidator.validate_readiness(
                conn=conn,
                blueprint=blueprint,
                media_store=media_store,
                verify_files=True,
            )
            reports[lvl] = report.model_dump()

        if level:
            return reports[level]
        return reports
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/exam/blueprints/{level}")
def get_exam_blueprint(
    level: str,
    version: Optional[str] = Query(default=None, description="Optional blueprint version"),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> Dict[str, Any]:
    """
    Retrieve the versioned examination blueprint for a JLPT level.
    """
    clean_level = level.upper().strip()
    if clean_level not in ("N1", "N2", "N3", "N4", "N5"):
        raise StudyBadRequestError(
            message=f"Invalid JLPT level '{level}'. Must be one of N1, N2, N3, N4, N5.",
            code="INVALID_LEVEL",
        )

    try:
        blueprint = get_blueprint_from_db_or_default(conn, clean_level, version=version)
        return blueprint.model_dump()
    except KeyError:
        raise StudyNotFoundError(
            message=f"No official blueprint found for level {clean_level}.",
            code="BLUEPRINT_NOT_FOUND",
        )
    except Exception as exc:
        raise map_domain_exception(exc)


# =============================================================================
# M14 Question Search, Detail & Filtering
# =============================================================================

@bank_router.get("/bank/questions", response_model=PaginatedResponse)
def search_bank_questions(
    level: Optional[str] = Query(default=None, pattern=r"^N[1-5]$"),
    format_code: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    is_bookmarked: Optional[bool] = Query(default=None),
    history_status: Optional[str] = Query(default=None, pattern=r"^(unattempted|correct|incorrect)$"),
    verification_status: Optional[str] = Query(default=None),
    search_query: Optional[str] = Query(default=None),
    eligible_only: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Search and filter questions in the Study Bank across levels, formats, sources,
    bookmark status, and attempt history.
    """
    try:
        where_clauses = ["q.status = 'active'"]
        params: List[Any] = []

        if level:
            where_clauses.append("q.level = ?")
            params.append(level)
        if format_code:
            where_clauses.append("q.format_code = ?")
            params.append(format_code)
        if category:
            where_clauses.append("q.category = ?")
            params.append(category)
        if source:
            where_clauses.append("(s.name LIKE ? OR s.citation LIKE ? OR qs.external_question_ref LIKE ?)")
            s_param = f"%{source}%"
            params.extend([s_param, s_param, s_param])
        if is_bookmarked is not None:
            if is_bookmarked:
                where_clauses.append("qb.id IS NOT NULL")
            else:
                where_clauses.append("qb.id IS NULL")
        if history_status:
            if history_status == "unattempted":
                where_clauses.append("(qas.total_attempts IS NULL OR qas.total_attempts = 0)")
            elif history_status == "correct":
                where_clauses.append("qas.last_is_correct = 1")
            elif history_status == "incorrect":
                where_clauses.append("qas.last_is_correct = 0")
        if verification_status:
            where_clauses.append("vr.status = ?")
            params.append(verification_status)
        if search_query:
            where_clauses.append("qr.stem_markup LIKE ?")
            params.append(f"%{search_query}%")
        if eligible_only:
            where_clauses.append("""(
                vqe.question_status = 'active'
                AND vqe.has_current_revision = 1
                AND vqe.validation_status = 'valid'
                AND vqe.has_answer = 1
                AND vqe.missing_required_assets_count = 0
                AND vqe.group_inconsistent = 0
                AND vqe.has_answer_conflict = 0
            )""")

        where_sql = " WHERE " + " AND ".join(where_clauses)

        count_sql = f"""
            SELECT COUNT(DISTINCT q.id) as c
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN v_question_eligibility vqe ON q.id = vqe.question_id
            LEFT JOIN question_bookmark qb ON q.id = qb.question_id
            LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
            LEFT JOIN question_source qs ON q.id = qs.question_id
            LEFT JOIN source s ON qs.source_id = s.id
            LEFT JOIN verification_run vr ON q.id = vr.question_id AND vr.attempt_number = (
                SELECT MAX(attempt_number) FROM verification_run WHERE question_id = q.id
            )
            {where_sql};
        """
        total = conn.execute(count_sql, tuple(params)).fetchone()["c"] or 0

        query_sql = f"""
            SELECT DISTINCT
                q.id as question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                qr.stem_markup as prompt_markup,
                CASE WHEN qb.id IS NOT NULL THEN 1 ELSE 0 END as is_bookmarked,
                CASE WHEN (
                    vqe.question_status = 'active'
                    AND vqe.has_current_revision = 1
                    AND vqe.validation_status = 'valid'
                    AND vqe.has_answer = 1
                    AND vqe.missing_required_assets_count = 0
                    AND vqe.group_inconsistent = 0
                    AND vqe.has_answer_conflict = 0
                ) THEN 1 ELSE 0 END as is_eligible,
                COALESCE(qas.total_attempts, 0) as attempts_count,
                COALESCE(qas.total_correct, 0) as correct_count,
                vr.status as verification_status
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN v_question_eligibility vqe ON q.id = vqe.question_id
            LEFT JOIN question_bookmark qb ON q.id = qb.question_id
            LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
            LEFT JOIN question_source qs ON q.id = qs.question_id
            LEFT JOIN source s ON qs.source_id = s.id
            LEFT JOIN verification_run vr ON q.id = vr.question_id AND vr.attempt_number = (
                SELECT MAX(attempt_number) FROM verification_run WHERE question_id = q.id
            )
            {where_sql}
            ORDER BY q.id ASC
            LIMIT ? OFFSET ?;
        """
        rows = conn.execute(query_sql, tuple(params + [limit, offset])).fetchall()
        items = [dict(r) for r in rows]

        return PaginatedResponse(total=total, limit=limit, offset=offset, items=items)
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/bank/questions/{id}", response_model=QuestionDetailDTO)
def get_bank_question_detail(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> QuestionDetailDTO:
    """
    Retrieve full question details including prompt, choices, group context, media, and canonical answer.
    """
    try:
        q_id = _resolve_question_id(conn, id)
        q_row = conn.execute(
            """
            SELECT
                q.id as question_id,
                q.external_id,
                q.level,
                q.category,
                q.format_code,
                q.anchor_key,
                q.group_ordinal,
                q.content_group_id,
                q.current_revision_id,
                qr.stem_markup as prompt_markup,
                qr.payload_json,
                CASE WHEN (
                    vqe.question_status = 'active'
                    AND vqe.has_current_revision = 1
                    AND vqe.validation_status = 'valid'
                    AND vqe.has_answer = 1
                    AND vqe.missing_required_assets_count = 0
                    AND vqe.group_inconsistent = 0
                    AND vqe.has_answer_conflict = 0
                ) THEN 1 ELSE 0 END as is_eligible,
                COALESCE(qas.total_attempts, 0) as attempts_count,
                COALESCE(qas.total_correct, 0) as correct_count
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN v_question_eligibility vqe ON q.id = vqe.question_id
            LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
            WHERE q.id = ?;
            """,
            (q_id,),
        ).fetchone()

        if not q_row:
            raise StudyNotFoundError(f"Question '{id}' not found.", code="QUESTION_NOT_FOUND")

        rev_id = q_row["current_revision_id"]

        # Choices
        choices_rows = conn.execute(
            """
            SELECT id, choice_key, label, ordinal, text_markup, asset_id
            FROM revision_choice
            WHERE question_revision_id = ?
            ORDER BY ordinal ASC;
            """,
            (rev_id,),
        ).fetchall()
        choices = [
            ChoiceDTO(
                choice_id=c["id"],
                choice_key=c["choice_key"],
                display_position=c["ordinal"],
                label=c["label"],
                mode="image" if c["asset_id"] else "text",
                text_markup=c["text_markup"],
                image_url=f"/api/study/v1/media/{c['asset_id']}" if c["asset_id"] else None,
                asset_id=c["asset_id"],
            )
            for c in choices_rows
        ]

        # Group context if attached
        group_dto = None
        if q_row["content_group_id"]:
            cg_row = conn.execute(
                "SELECT id, kind FROM content_group WHERE id = ?;",
                (q_row["content_group_id"],),
            ).fetchone()
            if cg_row:
                grp_audio = _get_group_audio_url(conn, cg_row["id"])
                parts_rows = conn.execute(
                    """
                    SELECT grp.ordinal, grp.role, grp.markup
                    FROM content_group cg
                    JOIN group_revision gr ON cg.current_revision_id = gr.id
                    JOIN group_revision_part grp ON gr.id = grp.group_revision_id
                    WHERE cg.id = ?
                    ORDER BY grp.ordinal ASC;
                    """,
                    (cg_row["id"],),
                ).fetchall()
                parts = [
                    GroupPartDTO(
                        ordinal=p["ordinal"],
                        role=p["role"],
                        title="",
                        markup=p["markup"],
                    )
                    for p in parts_rows
                ]
                group_dto = GroupContextDTO(
                    group_id=cg_row["id"],
                    group_kind=cg_row["kind"],
                    title="",
                    parts=parts,
                    audio_url=grp_audio,
                )

        # Media assets
        audio_url = _get_question_audio_url(conn, q_id)
        illustration_url = _get_question_media_url(conn, q_id, "illustration")
        diagram_url = _get_question_media_url(conn, q_id, "diagram")
        is_bookmarked = _is_question_bookmarked(conn, q_id)

        # Canonical answer & explanation
        ans_row = conn.execute(
            """
            SELECT ra.choice_id, rc.choice_key, ra.rationale_markup
            FROM revision_answer ra
            JOIN revision_choice rc ON ra.choice_id = rc.id
            WHERE ra.question_revision_id = ?;
            """,
            (rev_id,),
        ).fetchone()

        canonical_choice_id = ans_row["choice_id"] if ans_row else None
        canonical_choice_key = ans_row["choice_key"] if ans_row else None
        explanation_markup = ans_row["rationale_markup"] if ans_row else ""

        star_position = None
        correct_order = None
        instruction_text = ""
        anchor_key = q_row["anchor_key"]
        group_ordinal = q_row["group_ordinal"]

        if q_row["payload_json"]:
            try:
                payload = json.loads(q_row["payload_json"])
                star_position = payload.get("star_position")
                correct_order = payload.get("correct_order")
                instruction_text = payload.get("instruction_text", "")
                if not explanation_markup:
                    explanation_markup = payload.get("explanation_markup", "")
                if not anchor_key:
                    anchor_key = payload.get("anchor_key")
                if not group_ordinal:
                    group_ordinal = payload.get("group_ordinal")
            except Exception:
                pass

        # Sources
        sources_rows = conn.execute(
            """
            SELECT s.id, s.name, s.source_type, s.citation, s.url, qs.external_question_ref
            FROM question_source qs
            JOIN source s ON qs.source_id = s.id
            WHERE qs.question_id = ?;
            """,
            (q_id,),
        ).fetchall()
        sources = [
            SourceProvenanceDTO(
                source_id=s["id"],
                name=s["name"],
                source_type=s["source_type"],
                citation=s["citation"] or "",
                url=s["url"],
                external_question_ref=s["external_question_ref"],
                paper_year=re.search(r"\b(19\d{2}|20\d{2})\b", f"{s['citation']} {s['name']}")[0]
                if re.search(r"\b(19\d{2}|20\d{2})\b", f"{s['citation']} {s['name']}") else None,
            )
            for s in sources_rows
        ]

        total_att = q_row["attempts_count"] or 0
        tot_corr = q_row["correct_count"] or 0
        last_acc = round((tot_corr * 100.0 / total_att), 2) if total_att > 0 else None

        return QuestionDetailDTO(
            question_id=q_row["question_id"],
            external_id=q_row["external_id"],
            level=q_row["level"],
            category=q_row["category"],
            format_code=q_row["format_code"],
            structural_family=_get_structural_family(q_row["format_code"]),
            instruction_text=instruction_text,
            prompt_markup=q_row["prompt_markup"],
            choices=choices,
            group_context=group_dto,
            audio_url=audio_url,
            illustration_url=illustration_url,
            diagram_url=diagram_url,
            star_position=star_position,
            anchor_key=anchor_key,
            group_ordinal=group_ordinal,
            canonical_choice_id=canonical_choice_id,
            canonical_choice_key=canonical_choice_key,
            correct_order=correct_order,
            explanation_markup=explanation_markup,
            is_bookmarked=is_bookmarked,
            is_eligible=bool(q_row["is_eligible"]),
            attempts_count=total_att,
            correct_count=tot_corr,
            last_accuracy=last_acc,
            sources=sources,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


# =============================================================================
# M14 Question Provenance & Reporting
# =============================================================================

@bank_router.get("/bank/questions/{id}/provenance", response_model=QuestionProvenanceResponse)
def get_question_provenance(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> QuestionProvenanceResponse:
    """
    Retrieve full question provenance, including original paper/year, citation,
    verification status, answer key history, and ingestion metadata.
    """
    try:
        q_id = _resolve_question_id(conn, id)
        q_row = conn.execute(
            "SELECT id, external_id, level, category, format_code, current_revision_id FROM question WHERE id = ?;",
            (q_id,),
        ).fetchone()
        if not q_row:
            raise StudyNotFoundError(f"Question '{id}' not found.", code="QUESTION_NOT_FOUND")

        rev_id = q_row["current_revision_id"]

        # Sources with paper_year
        sources_rows = conn.execute(
            """
            SELECT s.id, s.name, s.source_type, s.citation, s.url, qs.external_question_ref
            FROM question_source qs
            JOIN source s ON qs.source_id = s.id
            WHERE qs.question_id = ?;
            """,
            (q_id,),
        ).fetchall()
        sources = [
            SourceProvenanceDTO(
                source_id=s["id"],
                name=s["name"],
                source_type=s["source_type"],
                citation=s["citation"] or "",
                url=s["url"],
                external_question_ref=s["external_question_ref"],
                paper_year=re.search(r"\b(19\d{2}|20\d{2})\b", f"{s['citation']} {s['name']}")[0]
                if re.search(r"\b(19\d{2}|20\d{2})\b", f"{s['citation']} {s['name']}") else None,
            )
            for s in sources_rows
        ]

        # Verification status
        vr_row = conn.execute(
            """
            SELECT status, comparison_scenario, model_a_choice_key, model_b_choice_key,
                   source_answer_keys_json, is_ambiguous, updated_at
            FROM verification_run
            WHERE question_id = ?
            ORDER BY attempt_number DESC LIMIT 1;
            """,
            (q_id,),
        ).fetchone()

        verif_dto = None
        if vr_row:
            source_keys = []
            if vr_row["source_answer_keys_json"]:
                try:
                    source_keys = json.loads(vr_row["source_answer_keys_json"])
                except Exception:
                    pass

            human_dec = conn.execute(
                """
                SELECT decision, selected_choice_key
                FROM verification_human_decision
                WHERE question_id = ?
                ORDER BY id DESC LIMIT 1;
                """,
                (q_id,),
            ).fetchone()

            verif_dto = VerificationProvenanceDTO(
                status=vr_row["status"],
                comparison_scenario=vr_row["comparison_scenario"],
                model_a_choice_key=vr_row["model_a_choice_key"],
                model_b_choice_key=vr_row["model_b_choice_key"],
                source_answer_keys=source_keys,
                is_ambiguous=bool(vr_row["is_ambiguous"]),
                human_decision=human_dec["decision"] if human_dec else None,
                human_choice_key=human_dec["selected_choice_key"] if human_dec else None,
                verified_at=vr_row["updated_at"],
            )

        # Source answer claims
        claims_rows = conn.execute(
            """
            SELECT s.name as source_name, rc.choice_key, sac.source_label, sac.answer_origin, sac.rationale, sac.is_conflict
            FROM source_answer_claim sac
            JOIN source s ON sac.source_id = s.id
            LEFT JOIN revision_choice rc ON sac.choice_id = rc.id
            WHERE sac.question_revision_id = ?;
            """,
            (rev_id,),
        ).fetchall()
        claims = [
            AnswerClaimDTO(
                source_name=c["source_name"],
                choice_key=c["choice_key"],
                source_label=c["source_label"],
                answer_origin=c["answer_origin"],
                rationale=c["rationale"] or "",
                is_conflict=bool(c["is_conflict"]),
            )
            for c in claims_rows
        ]

        # Ingestion metadata
        ing_row = conn.execute(
            """
            SELECT ib.adapter_name, ii.extraction_confidence, ii.review_status, ii.created_at
            FROM import_item ii
            JOIN import_batch ib ON ii.import_batch_id = ib.id
            WHERE ii.parsed_question_id = ?
            ORDER BY ii.id DESC LIMIT 1;
            """,
            (q_id,),
        ).fetchone()
        ing_dto = None
        if ing_row:
            ing_dto = IngestionProvenanceDTO(
                adapter_name=ing_row["adapter_name"],
                extraction_confidence=ing_row["extraction_confidence"],
                review_status=ing_row["review_status"],
                imported_at=ing_row["created_at"],
            )

        return QuestionProvenanceResponse(
            question_id=q_row["id"],
            external_id=q_row["external_id"],
            level=q_row["level"],
            category=q_row["category"],
            format_code=q_row["format_code"],
            sources=sources,
            verification=verif_dto,
            answer_claims=claims,
            ingestion=ing_dto,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.post("/bank/questions/{id}/reports", response_model=QuestionReportDTO, status_code=status.HTTP_201_CREATED)
def report_question_issue(
    id: str,
    request: CreateQuestionReportRequest,
    x_client_request_id: Optional[str] = Header(None, alias="X-Client-Request-Id"),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> QuestionReportDTO:
    """
    Report an issue on a question (e.g. incorrect answer key, bad explanation, formatting error).
    Stored in a separate reports ledger; does not mutate immutable question records.
    """
    client_request_id = resolve_client_request_id(header_id=x_client_request_id, body_payload=request)
    idemp = check_or_start_idempotency(
        conn=conn,
        client_request_id=client_request_id,
        operation=f"POST:/bank/questions/{id}/reports",
        payload=request,
        resource_id=id,
    )
    if idemp.is_cached:
        return idemp.cached_response

    try:
        q_id = _resolve_question_id(conn, id)
        q_row = conn.execute("SELECT external_id, current_revision_id FROM question WHERE id = ?;", (q_id,)).fetchone()
        rev_id = q_row["current_revision_id"] if q_row else None

        ext_id = generate_ulid()
        now_iso = datetime.now(timezone.utc).isoformat()

        cursor = conn.execute(
            """
            INSERT INTO question_report (
                external_id, question_id, question_revision_id, issue_type,
                details, suggested_correction, status, reported_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
            RETURNING id;
            """,
            (
                ext_id,
                q_id,
                rev_id,
                request.issue_type,
                request.details,
                request.suggested_correction,
                now_iso,
            ),
        )
        report_pk = cursor.fetchone()["id"]
        conn.commit()

        resp = QuestionReportDTO(
            id=report_pk,
            external_id=ext_id,
            question_id=q_id,
            question_external_id=q_row["external_id"],
            question_revision_id=rev_id,
            issue_type=request.issue_type,
            details=request.details,
            suggested_correction=request.suggested_correction,
            status="open",
            resolution_notes=None,
            reported_at=now_iso,
            resolved_at=None,
        )
        save_idempotency_result(
            conn=conn,
            client_request_id=client_request_id,
            status_code=status.HTTP_201_CREATED,
            response_data=resp,
        )
        return resp
    except Exception as exc:
        clear_failed_idempotency(conn, client_request_id)
        raise map_domain_exception(exc)


@bank_router.get("/bank/questions/{id}/reports", response_model=List[QuestionReportDTO])
def list_question_reports(
    id: str,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> List[QuestionReportDTO]:
    """
    Retrieve all reports filed for a specific question.
    """
    try:
        q_id = _resolve_question_id(conn, id)
        rows = conn.execute(
            """
            SELECT qr.id, qr.external_id, qr.question_id, q.external_id as question_external_id,
                   qr.question_revision_id, qr.issue_type, qr.details, qr.suggested_correction,
                   qr.status, qr.resolution_notes, qr.reported_at, qr.resolved_at
            FROM question_report qr
            JOIN question q ON qr.question_id = q.id
            WHERE qr.question_id = ?
            ORDER BY qr.id DESC;
            """,
            (q_id,),
        ).fetchall()
        return [QuestionReportDTO(**dict(r)) for r in rows]
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.get("/bank/reports", response_model=PaginatedResponse)
def list_all_reports(
    status_filter: Optional[str] = Query(default=None, alias="status", pattern=r"^(open|investigating|resolved|dismissed)$"),
    issue_type: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PaginatedResponse:
    """
    Browse and filter all question reports across the system.
    """
    try:
        where_clauses = ["1=1"]
        params: List[Any] = []
        if status_filter:
            where_clauses.append("qr.status = ?")
            params.append(status_filter)
        if issue_type:
            where_clauses.append("qr.issue_type = ?")
            params.append(issue_type)

        where_sql = " AND ".join(where_clauses)
        total = conn.execute(f"SELECT COUNT(*) as c FROM question_report qr WHERE {where_sql};", tuple(params)).fetchone()["c"] or 0

        rows = conn.execute(
            f"""
            SELECT qr.id, qr.external_id, qr.question_id, q.external_id as question_external_id,
                   qr.question_revision_id, qr.issue_type, qr.details, qr.suggested_correction,
                   qr.status, qr.resolution_notes, qr.reported_at, qr.resolved_at
            FROM question_report qr
            JOIN question q ON qr.question_id = q.id
            WHERE {where_sql}
            ORDER BY qr.id DESC
            LIMIT ? OFFSET ?;
            """,
            tuple(params + [limit, offset]),
        ).fetchall()

        items = [QuestionReportDTO(**dict(r)).model_dump() for r in rows]
        return PaginatedResponse(total=total, limit=limit, offset=offset, items=items)
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.patch("/bank/reports/{report_id}", response_model=QuestionReportDTO)
def update_report_status(
    report_id: str,
    request: UpdateQuestionReportRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
) -> QuestionReportDTO:
    """
    Update status or resolution notes for a question report.
    """
    try:
        if report_id.isdigit():
            where_term = "id = ?"
            arg = int(report_id)
        else:
            where_term = "external_id = ?"
            arg = report_id

        row = conn.execute(f"SELECT id FROM question_report WHERE {where_term};", (arg,)).fetchone()
        if not row:
            raise StudyNotFoundError(f"Report '{report_id}' not found.", code="REPORT_NOT_FOUND")

        resolved_at = datetime.now(timezone.utc).isoformat() if request.status in ("resolved", "dismissed") else None

        conn.execute(
            f"""
            UPDATE question_report
            SET status = ?, resolution_notes = COALESCE(?, resolution_notes), resolved_at = ?
            WHERE id = ?;
            """,
            (request.status, request.resolution_notes, resolved_at, row["id"]),
        )
        conn.commit()

        updated = conn.execute(
            """
            SELECT qr.id, qr.external_id, qr.question_id, q.external_id as question_external_id,
                   qr.question_revision_id, qr.issue_type, qr.details, qr.suggested_correction,
                   qr.status, qr.resolution_notes, qr.reported_at, qr.resolved_at
            FROM question_report qr
            JOIN question q ON qr.question_id = q.id
            WHERE qr.id = ?;
            """,
            (row["id"],),
        ).fetchone()
        return QuestionReportDTO(**dict(updated))
    except Exception as exc:
        raise map_domain_exception(exc)


# =============================================================================
# M14 Agent-Assisted Question Import
# =============================================================================

@bank_router.post("/bank/import/preview", response_model=ImportPreviewResponse)
def preview_agent_import(
    request: ImportPreviewRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> ImportPreviewResponse:
    """
    Parse and validate user/agent pasted question content without modifying the question bank.
    Returns preview items, validation errors, warnings, and duplicate detection flags.
    """
    try:
        raw_content = request.content.strip()
        if not raw_content:
            raise StudyBadRequestError("Import content cannot be empty.", code="EMPTY_IMPORT_CONTENT")

        # Determine adapter kind: JSON vs Pasted Text
        kind = IngestAdapterKind.STRUCTURED_JSON if (
            request.format == "json" or (request.format == "auto" and (raw_content.startswith("{") or raw_content.startswith("[")))
        ) else IngestAdapterKind.PASTED_TEXT

        ingest_input = IngestInput(
            content=raw_content,
            adapter_kind=kind,
            source_name=request.source_name or "agent_import",
            source_type=request.source_type or "user_pasted",
            license_or_permission="user_provided",
            citation=request.citation or "",
            url=request.url,
            default_level=request.default_level,  # type: ignore[arg-type]
            auto_approve=False,
        )

        pipeline = IngestionPipeline(media_store=media_store)
        result = pipeline.run(input_data=ingest_input, conn=conn, persist=False)

        preview_id = generate_ulid()
        preview_questions: List[ImportPreviewItemDTO] = []
        dup_count = 0
        valid_count = 0
        invalid_count = 0

        for idx, q_cand in enumerate(result.questions):
            is_valid = bool(q_cand.validation and q_cand.validation.is_valid)
            val_errors = [e.message if hasattr(e, "message") else str(e) for e in q_cand.validation.errors] if q_cand.validation else []
            val_warnings = [w.message if hasattr(w, "message") else str(w) for w in q_cand.validation.warnings] if q_cand.validation else []

            # Check duplicate against existing question revisions in database
            is_dup = False
            if q_cand.payload and hasattr(q_cand.payload, "stem_markup"):
                rev_row = conn.execute(
                    """
                    SELECT qr.question_id
                    FROM question_revision qr
                    JOIN question q ON qr.question_id = q.id
                    WHERE qr.stem_markup = ?;
                    """,
                    (q_cand.payload.stem_markup,),
                ).fetchone()
                if rev_row:
                    is_dup = True
                    dup_count += 1
                    val_warnings.append(f"Question text matches existing bank record (ID: {rev_row['question_id']}).")

            if is_valid and not is_dup:
                valid_count += 1
            elif not is_valid:
                invalid_count += 1

            choices_data = []
            canon_key = None
            explanation_markup = ""
            if q_cand.payload:
                if hasattr(q_cand.payload, "choices"):
                    choices_data = [c.model_dump() for c in q_cand.payload.choices]
                if hasattr(q_cand.payload, "answer") and q_cand.payload.answer:
                    canon_key = getattr(q_cand.payload.answer, "choice_key", None) or getattr(q_cand.payload.answer, "canonical_choice_key", None)
                if hasattr(q_cand.payload, "explanation_markup"):
                    explanation_markup = q_cand.payload.explanation_markup

            lvl_str = (
                str(q_cand.classification.level.value if hasattr(q_cand.classification.level, "value") else q_cand.classification.level)
                if q_cand.classification and q_cand.classification.level
                else (request.default_level or "N5")
            )
            cat_str = (
                str(q_cand.classification.category.value if hasattr(q_cand.classification.category, "value") else q_cand.classification.category)
                if q_cand.classification and q_cand.classification.category
                else "vocabulary"
            )
            fmt_str = (
                q_cand.classification.format_code
                if q_cand.classification and q_cand.classification.format_code
                else "kanji_reading"
            )
            stem_markup = q_cand.payload.stem_markup if q_cand.payload else q_cand.draft.raw_stem

            preview_questions.append(
                ImportPreviewItemDTO(
                    index=idx,
                    level=lvl_str,
                    format_code=fmt_str,
                    category=cat_str,
                    stem_markup=stem_markup,
                    choices=choices_data,
                    canonical_choice_key=canon_key,
                    explanation_markup=explanation_markup,
                    is_valid=is_valid,
                    is_duplicate=is_dup,
                    errors=val_errors,
                    warnings=val_warnings,
                )
            )

        preview_groups: List[ImportPreviewGroupDTO] = []
        for g_idx, g_cand in enumerate(result.groups):
            g_valid = bool(g_cand.validation and g_cand.validation.is_valid)
            g_errors = [e.message if hasattr(e, "message") else str(e) for e in g_cand.validation.errors] if g_cand.validation else []
            g_lvl = str(g_cand.level.value if hasattr(g_cand.level, "value") else g_cand.level) if g_cand.level else (request.default_level or "N5")
            preview_groups.append(
                ImportPreviewGroupDTO(
                    index=g_idx,
                    group_type=g_cand.draft.group_type or "passage",
                    level=g_lvl,
                    parts=[p for p in g_cand.draft.parts],
                    is_valid=g_valid,
                    errors=g_errors,
                )
            )

        status_str = "valid" if (invalid_count == 0 and len(result.errors) == 0) else (
            "needs_review" if valid_count > 0 else "invalid"
        )

        # Cache preview result for commit
        _IMPORT_PREVIEWS[preview_id] = {
            "ingest_input": ingest_input,
            "result": result,
            "created_at": datetime.now(timezone.utc),
        }

        return ImportPreviewResponse(
            preview_id=preview_id,
            status=status_str,
            total_questions=len(preview_questions),
            valid_questions=valid_count,
            invalid_questions=invalid_count,
            duplicate_questions=dup_count,
            questions=preview_questions,
            groups=preview_groups,
            errors=result.errors,
            warnings=result.warnings,
        )
    except Exception as exc:
        raise map_domain_exception(exc)


@bank_router.post("/bank/import/commit", response_model=ImportCommitResponse, status_code=status.HTTP_201_CREATED)
def commit_agent_import(
    request: ImportCommitRequest,
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> ImportCommitResponse:
    """
    Commit explicitly approved import candidates to the Study Bank.
    Atomic transaction: partial modifications on error are completely rolled back.
    """
    if not request.approved:
        raise StudyBadRequestError("Import was not approved for persistence.", code="IMPORT_NOT_APPROVED")

    try:
        cached = _IMPORT_PREVIEWS.get(request.preview_id) if request.preview_id else None

        if cached:
            result = cached["result"]
            doc = cached["ingest_input"]
            # Extract doc from pipeline
            adapter = IngestionPipeline()._adapters.get(doc.adapter_kind)
            extracted_doc = adapter.extract(doc) if adapter else None
            questions_to_persist = [q for q in result.questions if q.payload is not None]
            groups_to_persist = [g for g in result.groups if g.payload is not None]
        else:
            # Parse fresh from request content
            raw_content = (request.content or "").strip()
            if not raw_content:
                raise StudyBadRequestError("Missing preview_id or raw content for import commit.", code="MISSING_CONTENT")

            kind = IngestAdapterKind.STRUCTURED_JSON if (
                request.format == "json" or (request.format == "auto" and (raw_content.startswith("{") or raw_content.startswith("[")))
            ) else IngestAdapterKind.PASTED_TEXT

            ingest_input = IngestInput(
                content=raw_content,
                adapter_kind=kind,
                source_name=request.source_name or "agent_import",
                source_type=request.source_type or "user_pasted",
                license_or_permission="user_provided",
                citation=request.citation or "",
                url=request.url,
                default_level=request.default_level,  # type: ignore[arg-type]
                auto_approve=True,
            )
            pipeline = IngestionPipeline(media_store=media_store)
            result = pipeline.run(input_data=ingest_input, conn=conn, persist=False)
            adapter = pipeline._adapters.get(kind)
            extracted_doc = adapter.extract(ingest_input) if adapter else None
            questions_to_persist = [q for q in result.questions if q.payload is not None]
            groups_to_persist = [g for g in result.groups if g.payload is not None]

        if not questions_to_persist:
            raise StudyBadRequestError("No valid question candidates to import.", code="NO_VALID_CANDIDATES")

        # Approve and persist within atomic unit of work
        for q in questions_to_persist:
            q.review_status = ReviewStatus.APPROVED
        for g in groups_to_persist:
            g.review_status = ReviewStatus.APPROVED

        with unit_of_work(conn):
            persistence = PersistenceService()
            source_id, batch_id = persistence.persist_batch(
                conn=conn,
                doc=extracted_doc,  # type: ignore[arg-type]
                questions=questions_to_persist,
                groups=groups_to_persist,
            )

        persisted_ids = [q.persisted_question_id for q in questions_to_persist if q.persisted_question_id is not None]
        dup_count = len(questions_to_persist) - len(persisted_ids)

        # Clear cached preview
        if request.preview_id and request.preview_id in _IMPORT_PREVIEWS:
            del _IMPORT_PREVIEWS[request.preview_id]

        return ImportCommitResponse(
            status="ok",
            batch_id=batch_id,
            source_id=source_id,
            imported_count=len(persisted_ids),
            duplicate_count=dup_count,
            imported_question_ids=persisted_ids,
            errors=[],
        )
    except Exception as exc:
        raise map_domain_exception(exc)

