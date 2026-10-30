"""
Persistence Service for Study Bank Ingestion.
---------------------------------------------
Persists approved candidates into the separate study.db database.
Guarantees:
- Relational mapping using M2 decompose_question_for_db and decompose_group_for_db
- Atomic transactions with automatic rollback on error
- Audit trail via source, import_batch, import_item, and question_source
- Source answer claims recorded in source_answer_claim
- Revisions sealed immediately upon creation
- Deduplication via content_fingerprint
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import sqlite3
from typing import Any

from app.study.contracts.db_mapping import (
    decompose_group_for_db,
    decompose_question_for_db,
)
from app.study.contracts.enums import AnswerOrigin
from app.study.ingestion.enums import ReviewStatus
from app.study.ingestion.models import (
    CandidateGroup,
    CandidateQuestion,
    ExtractedDocument,
)
from app.study.provenance import ProvenanceService, normalize_source_url


class PersistenceService:
    """Safely persists approved question and group candidates into SQLite study.db."""

    def persist_batch(
        self,
        conn: sqlite3.Connection,
        doc: ExtractedDocument,
        questions: list[CandidateQuestion],
        groups: list[CandidateGroup],
        persist_quarantined: bool = False,
    ) -> tuple[int, int]:
        """
        Persist an entire ingestion batch into the study database.

        Returns:
            (source_id, import_batch_id)
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        norm_url = normalize_source_url(doc.url) if doc.url else None

        # 1. Resolve or create source record
        existing_src = None
        if norm_url:
            cursor = conn.execute("SELECT id FROM source WHERE url = ?;", (norm_url,))
            existing_src = cursor.fetchone()
        if not existing_src:
            cursor = conn.execute("SELECT id FROM source WHERE name = ? AND (url IS NULL OR url = '');", (doc.source_name,))
            existing_src = cursor.fetchone()

        if existing_src:
            source_id = existing_src["id"]
        else:
            src_row = ProvenanceService.create_source(
                conn=conn,
                name=doc.source_name,
                source_type=doc.source_type,
                license_or_permission=doc.license_or_permission,
                citation=doc.citation,
                url=norm_url or doc.url,
            )
            source_id = src_row["id"]

        # 2. Create import_batch record
        batch_row = ProvenanceService.create_import_batch(
            conn=conn,
            source_id=source_id,
            adapter_name=doc.adapter_kind.value,
            status="in_progress",
            item_count=len(questions),
        )
        batch_id = batch_row["id"]

        # 3. Persist Content Groups
        group_id_map: dict[str, int] = {}
        for grp in groups:
            if grp.payload is not None:
                g_id = self._persist_group(conn, grp, source_id, now_iso, norm_url=norm_url)
                group_id_map[grp.candidate_id] = g_id
                grp.persisted_group_id = g_id

        # 4. Persist Questions and Import Items
        persisted_count = 0
        for q in questions:
            # Check deduplication or map group
            group_db_id = None
            if q.draft.group_reference and q.draft.group_reference in group_id_map:
                group_db_id = group_id_map[q.draft.group_reference]

            error_msg = "; ".join(r.value for r in q.review_reasons) if q.review_reasons else None
            if q.review_notes:
                error_msg = f"{error_msg}: {q.review_notes}" if error_msg else q.review_notes

            # 4a. Create import_item record
            item_cursor = conn.execute(
                """
                INSERT INTO import_item (
                    import_batch_id, raw_payload_json, parsed_question_id, parsed_group_id,
                    extraction_confidence, review_status, error_message, created_at
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?);
                """,
                (
                    batch_id,
                    json.dumps(q.draft.model_dump(), ensure_ascii=False),
                    group_db_id,
                    doc.extraction_confidence,
                    q.review_status.value,
                    error_msg,
                    now_iso,
                ),
            )
            import_item_id = item_cursor.lastrowid

            # 4b. If approved (or if persist_quarantined is True), persist to question & revision tables
            should_persist = (
                (q.review_status == ReviewStatus.APPROVED or persist_quarantined)
                and q.payload is not None
            )
            if should_persist:
                q_id, rev_id = self._persist_question(
                    conn, q, group_db_id, source_id, now_iso, norm_url=norm_url
                )
                q.persisted_question_id = q_id
                q.persisted_revision_id = rev_id

                # Link import_item to question
                conn.execute(
                    "UPDATE import_item SET parsed_question_id = ? WHERE id = ?;",
                    (q_id, import_item_id),
                )
                persisted_count += 1

        # 5. Finalize batch
        conn.execute(
            "UPDATE import_batch SET status = 'completed', item_count = ? WHERE id = ?;",
            (len(questions), batch_id),
        )

        return source_id, batch_id

    def _persist_group(
        self,
        conn: sqlite3.Connection,
        grp: CandidateGroup,
        source_id: int,
        now_iso: str,
        norm_url: str | None = None,
    ) -> int:
        """Persist a single content group and its revision snapshot."""
        decomposed = decompose_group_for_db(grp.payload, revision_number=1)
        g_row = decomposed["group"]
        rev_row = decomposed["revision"]
        parts = decomposed["parts"]
        anchors = decomposed["anchors"]
        assets = decomposed["assets"]

        ext_group_ref = f"{norm_url}#{grp.draft.draft_id}" if norm_url else grp.draft.draft_id

        # 1. Check existing by source and external reference
        cursor = conn.execute(
            "SELECT content_group_id FROM group_source WHERE source_id = ? AND external_group_ref = ?;",
            (source_id, ext_group_ref),
        )
        existing_gs = cursor.fetchone()
        if existing_gs:
            return existing_gs["content_group_id"]

        # 2. Check fingerprint deduplication WITHIN SAME SOURCE
        cursor = conn.execute(
            """
            SELECT gr.group_id
            FROM group_revision gr
            JOIN group_source gs ON gs.content_group_id = gr.group_id
            WHERE gr.content_fingerprint = ? AND gs.source_id = ?;
            """,
            (rev_row["content_fingerprint"], source_id),
        )
        existing = cursor.fetchone()
        if existing:
            return existing["group_id"]

        # 1. Insert content_group
        g_id = conn.execute(
            """
            INSERT INTO content_group (external_id, kind, level, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id;
            """,
            (g_row["external_id"], g_row["kind"], g_row["level"], g_row["status"], now_iso, now_iso),
        ).fetchone()["id"]

        # 2. Insert group_revision
        rev_id = conn.execute(
            """
            INSERT INTO group_revision (group_id, revision_number, content_fingerprint, created_at)
            VALUES (?, ?, ?, ?)
            RETURNING id;
            """,
            (g_id, rev_row["revision_number"], rev_row["content_fingerprint"], now_iso),
        ).fetchone()["id"]

        # 3. Insert parts
        part_id_map: dict[int, int] = {}
        for p in parts:
            p_id = conn.execute(
                """
                INSERT INTO group_revision_part (group_revision_id, ordinal, role, markup, created_at)
                VALUES (?, ?, ?, ?, ?)
                RETURNING id;
                """,
                (rev_id, p["ordinal"], p["role"], p["markup"], now_iso),
            ).fetchone()["id"]
            part_id_map[p["ordinal"]] = p_id

        # 4. Insert anchors
        for a in anchors:
            target_part_id = part_id_map.get(a["part_ordinal"], list(part_id_map.values())[0])
            conn.execute(
                """
                INSERT INTO group_revision_anchor (group_revision_id, part_id, anchor_key, ordinal, kind, created_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (rev_id, target_part_id, a["anchor_key"], a["ordinal"], a["kind"], now_iso),
            )

        # 5. Insert assets (if any)
        for asset in assets:
            conn.execute(
                """
                INSERT INTO group_revision_asset (group_revision_id, asset_id, role, ordinal, is_required, created_at)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (rev_id, asset["asset_id"], asset["role"], asset["ordinal"], asset["is_required"], now_iso),
            )

        # 6. Seal group revision
        conn.execute("UPDATE group_revision SET sealed_at = ? WHERE id = ?;", (now_iso, rev_id))

        # 7. Set current revision and provenance
        conn.execute("UPDATE content_group SET current_revision_id = ? WHERE id = ?;", (rev_id, g_id))
        ProvenanceService.link_group_source(conn, g_id, source_id, external_group_ref=ext_group_ref)

        grp.persisted_revision_id = rev_id
        return g_id

    def _persist_question(
        self,
        conn: sqlite3.Connection,
        candidate: CandidateQuestion,
        group_db_id: int | None,
        source_id: int,
        now_iso: str,
        norm_url: str | None = None,
    ) -> tuple[int, int]:
        """Persist a single approved or quarantined question candidate."""
        payload = candidate.payload
        assert payload is not None

        decomposed = decompose_question_for_db(payload, revision_number=1)
        q_row = decomposed["question"]
        rev_row = decomposed["revision"]
        choices = decomposed["choices"]
        ans = decomposed["answer"]
        assets = decomposed["assets"]

        # Override content_group_id with actual database foreign key
        if group_db_id is not None:
            q_row["content_group_id"] = group_db_id
            q_row["group_ordinal"] = candidate.draft.group_ordinal or 1

        # Set status according to payload status or review status
        if candidate.payload and hasattr(candidate.payload, "status") and candidate.payload.status:
            q_row["status"] = candidate.payload.status.value if hasattr(candidate.payload.status, "value") else str(candidate.payload.status)
        else:
            q_row["status"] = "active" if candidate.review_status == ReviewStatus.APPROVED else "draft"

        rev_row["validation_status"] = "valid"

        external_question_ref = f"{norm_url}#{candidate.draft.draft_id}" if norm_url else candidate.draft.draft_id

        # 1. First check question_source tracking by external_question_ref
        cursor = conn.execute(
            """
            SELECT qs.question_id, q.current_revision_id, q.status
            FROM question_source qs
            JOIN question q ON q.id = qs.question_id
            WHERE qs.source_id = ? AND qs.external_question_ref = ?;
            """,
            (source_id, external_question_ref),
        )
        existing_qs = cursor.fetchone()
        if existing_qs:
            q_id = existing_qs["question_id"]
            rev_id = existing_qs["current_revision_id"]
            return q_id, rev_id

        # 2. Check fingerprint deduplication WITHIN SAME SOURCE
        cursor = conn.execute(
            """
            SELECT qr.question_id, qr.id as revision_id
            FROM question_revision qr
            JOIN question_source qs ON qs.question_id = qr.question_id
            WHERE qr.content_fingerprint = ? AND qs.source_id = ?;
            """,
            (rev_row["content_fingerprint"], source_id),
        )
        existing_fp = cursor.fetchone()
        if existing_fp:
            return existing_fp["question_id"], existing_fp["revision_id"]

        # 3. Insert question
        q_id = conn.execute(
            """
            INSERT INTO question (
                external_id, format_code, level, category, status,
                content_group_id, group_ordinal, anchor_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id;
            """,
            (
                q_row["external_id"],
                q_row["format_code"],
                q_row["level"],
                q_row["category"],
                q_row["status"],
                q_row["content_group_id"],
                q_row["group_ordinal"],
                q_row["anchor_key"],
                now_iso,
                now_iso,
            ),
        ).fetchone()["id"]

        # 2. Insert question_revision
        rev_id = conn.execute(
            """
            INSERT INTO question_revision (
                question_id, format_code, revision_number, stem_markup,
                payload_json, validation_status, content_fingerprint, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            RETURNING id;
            """,
            (
                q_id,
                rev_row["format_code"],
                rev_row["revision_number"],
                rev_row["stem_markup"],
                rev_row["payload_json"],
                rev_row["validation_status"],
                rev_row["content_fingerprint"],
                now_iso,
            ),
        ).fetchone()["id"]

        # 3. Insert revision_choice
        choice_id_map: dict[str, int] = {}
        for c in choices:
            c_id = conn.execute(
                """
                INSERT INTO revision_choice (
                    question_revision_id, choice_key, label, ordinal, text_markup, asset_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING id;
                """,
                (rev_id, c["choice_key"], c["label"], c["ordinal"], c["text_markup"], c["asset_id"], now_iso),
            ).fetchone()["id"]
            choice_id_map[c["choice_key"]] = c_id

        # 4. Insert revision_answer (if answer is defined)
        if ans is not None and ans["choice_key"] in choice_id_map:
            correct_choice_id = choice_id_map[ans["choice_key"]]
            conn.execute(
                """
                INSERT INTO revision_answer (
                    question_revision_id, choice_id, answer_origin, rationale_markup, created_at
                ) VALUES (?, ?, ?, ?, ?);
                """,
                (rev_id, correct_choice_id, ans["answer_origin"], ans["rationale_markup"], now_iso),
            )

            # Record in source_answer_claim
            ProvenanceService.record_source_answer_claim(
                conn=conn,
                question_revision_id=rev_id,
                source_id=source_id,
                choice_id=correct_choice_id,
                source_label=str(candidate.draft.source_answer_key),
                answer_origin=ans["answer_origin"],
                rationale=ans["rationale_markup"],
            )

        # 5. Insert assets (if any)
        for a in assets:
            conn.execute(
                """
                INSERT INTO question_revision_asset (
                    question_revision_id, asset_id, role, ordinal, is_required, created_at
                ) VALUES (?, ?, ?, ?, ?, ?);
                """,
                (rev_id, a["asset_id"], a["role"], a["ordinal"], a["is_required"], now_iso),
            )

        # 6. Seal question revision
        conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now_iso, rev_id))

        # 7. Set current revision and provenance
        conn.execute("UPDATE question SET current_revision_id = ? WHERE id = ?;", (rev_id, q_id))
        ProvenanceService.link_question_source(conn, q_id, source_id, external_question_ref=external_question_ref)

        return q_id, rev_id

