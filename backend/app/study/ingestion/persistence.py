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
from app.study.provenance import ProvenanceService


class PersistenceService:
    """Safely persists approved question and group candidates into SQLite study.db."""

    def persist_batch(
        self,
        conn: sqlite3.Connection,
        doc: ExtractedDocument,
        questions: list[CandidateQuestion],
        groups: list[CandidateGroup],
    ) -> tuple[int, int]:
        """
        Persist an entire ingestion batch into the study database.

        Returns:
            (source_id, import_batch_id)
        """
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Resolve or create source record
        cursor = conn.execute("SELECT id FROM source WHERE name = ?;", (doc.source_name,))
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
                url=doc.url,
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
                g_id = self._persist_group(conn, grp, source_id, now_iso)
                group_id_map[grp.candidate_id] = g_id
                grp.persisted_group_id = g_id

        # 4. Persist Questions and Import Items
        persisted_count = 0
        for q in questions:
            # Check deduplication or map group
            group_db_id = None
            if q.draft.group_reference and q.draft.group_reference in group_id_map:
                group_db_id = group_id_map[q.draft.group_reference]

            # 4a. Create import_item record
            item_cursor = conn.execute(
                """
                INSERT INTO import_item (
                    import_batch_id, raw_payload_json, parsed_question_id, parsed_group_id,
                    extraction_confidence, review_status, created_at
                ) VALUES (?, ?, NULL, ?, ?, ?, ?);
                """,
                (
                    batch_id,
                    json.dumps(q.draft.model_dump(), ensure_ascii=False),
                    group_db_id,
                    doc.extraction_confidence,
                    q.review_status.value,
                    now_iso,
                ),
            )
            import_item_id = item_cursor.lastrowid

            # 4b. If approved, persist to question & revision tables
            if q.review_status == ReviewStatus.APPROVED and q.payload is not None:
                q_id, rev_id = self._persist_question(conn, q, group_db_id, source_id, now_iso)
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
    ) -> int:
        """Persist a single content group and its revision snapshot."""
        decomposed = decompose_group_for_db(grp.payload, revision_number=1)
        g_row = decomposed["group"]
        rev_row = decomposed["revision"]
        parts = decomposed["parts"]
        anchors = decomposed["anchors"]
        assets = decomposed["assets"]

        # Check fingerprint deduplication
        cursor = conn.execute(
            "SELECT group_id FROM group_revision WHERE content_fingerprint = ?;",
            (rev_row["content_fingerprint"],),
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
        ProvenanceService.link_group_source(conn, g_id, source_id, external_group_ref=grp.candidate_id)

        grp.persisted_revision_id = rev_id
        return g_id

    def _persist_question(
        self,
        conn: sqlite3.Connection,
        candidate: CandidateQuestion,
        group_db_id: int | None,
        source_id: int,
        now_iso: str,
    ) -> tuple[int, int]:
        """Persist a single approved question candidate."""
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

        # Check deduplication
        cursor = conn.execute(
            "SELECT question_id FROM question_revision WHERE content_fingerprint = ?;",
            (rev_row["content_fingerprint"],),
        )
        existing = cursor.fetchone()
        if existing:
            q_id = existing["question_id"]
            rev_id = conn.execute(
                "SELECT id FROM question_revision WHERE question_id = ? AND content_fingerprint = ?;",
                (q_id, rev_row["content_fingerprint"]),
            ).fetchone()["id"]
            return q_id, rev_id

        # 1. Insert question
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
        ProvenanceService.link_question_source(conn, q_id, source_id, external_question_ref=candidate.candidate_id)

        return q_id, rev_id

