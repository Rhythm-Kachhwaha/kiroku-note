"""
Read-Only Database Doctor for Kiroku Study Database.
---------------------------------------------------
Performs comprehensive consistency, integrity, schema, and media asset health checks.
Strictly read-only; NEVER modifies or repairs data automatically.

Returns a list of structured DoctorFinding objects.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Literal

from app.study.media import MediaStore, PathTraversalError
from app.study.migrations.runner import discover_migrations, get_current_user_version

REQUIRED_TRIGGERS = frozenset({
    "trg_group_revision_no_delete",
    "trg_group_revision_update",
    "trg_question_revision_no_delete",
    "trg_question_revision_update",
    "trg_revision_choice_no_update",
    "trg_revision_choice_no_delete",
    "trg_revision_choice_insert_sealed",
    "trg_revision_answer_no_update",
    "trg_revision_answer_no_delete",
    "trg_revision_answer_insert_sealed",
    "trg_question_revision_asset_no_update",
    "trg_question_revision_asset_no_delete",
    "trg_question_revision_asset_insert_sealed",
    "trg_group_revision_part_no_update",
    "trg_group_revision_part_no_delete",
    "trg_group_revision_part_insert_sealed",
    "trg_group_revision_anchor_no_update",
    "trg_group_revision_anchor_no_delete",
    "trg_group_revision_anchor_insert_sealed",
    "trg_group_revision_asset_no_update",
    "trg_group_revision_asset_no_delete",
    "trg_group_revision_asset_insert_sealed",
    "trg_source_answer_claim_no_update",
    "trg_source_answer_claim_no_delete",
    "trg_attempt_item_no_update",
    "trg_attempt_item_no_delete",
    "trg_attempt_item_choice_order_no_update",
    "trg_attempt_item_choice_order_no_delete",
    "trg_question_immutable_columns",
    "trg_asset_no_delete",
    "trg_asset_update_status_only",
    "trg_response_insert_check",
    "trg_response_no_update",
    "trg_response_no_delete",
    "trg_attempt_item_validate",
    "trg_attempt_item_choice_order_validate",
    "trg_scoring_category_unique_per_profile",
    "trg_verification_run_no_delete",
    "trg_verification_model_response_no_update",
    "trg_verification_model_response_no_delete",
    "trg_verification_human_decision_no_update",
    "trg_verification_human_decision_no_delete",
    "trg_question_explanation_no_delete",
})

KNOWN_FORMAT_CODES = frozenset({
    "kanji_reading",
    "orthography",
    "word_formation",
    "contextual_expressions",
    "paraphrases",
    "usage",
    "sentential_grammar_1",
    "sentence_composition",
    "comprehension_short",
    "comprehension_mid",
    "comprehension_long",
    "integrated_thematic_reading",
    "information_retrieval",
    "text_grammar",
    "task_based_listening",
    "key_points_listening",
    "general_outline_listening",
    "verbal_expressions",
    "quick_response",
    "listening_integrated",
})


@dataclass(frozen=True)
class DoctorFinding:
    severity: Literal["ERROR", "WARNING", "INFO"]
    code: str
    detail: str


def run_doctor(
    conn: sqlite3.Connection,
    media_store: MediaStore | None = None,
    verify_media_hashes: bool = True,
    migrations_dir: Path | None = None,
) -> list[DoctorFinding]:
    """
    Execute read-only diagnosis of the study database.

    Returns:
        List of DoctorFinding records sorted by severity (ERROR first, then WARNING, then INFO).
    """
    findings: list[DoctorFinding] = []

    # 1. SQLite low-level integrity check
    try:
        integrity_rows = conn.execute("PRAGMA integrity_check;").fetchall()
        integrity_results = [r[0] for r in integrity_rows]
        if integrity_results != ["ok"]:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="SQLITE_INTEGRITY_FAILED",
                    detail=f"PRAGMA integrity_check reported corruption: {integrity_results}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="SQLITE_CHECK_EXCEPTION", detail=str(e)))

    # 2. Foreign-key check
    try:
        fk_violations = conn.execute("PRAGMA foreign_key_check;").fetchall()
        if fk_violations:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="FOREIGN_KEY_VIOLATIONS",
                    detail=f"Found {len(fk_violations)} foreign key violations in tables: "
                           f"{list({r[0] for r in fk_violations})}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="FK_CHECK_EXCEPTION", detail=str(e)))

    # 3. Migration ledger & checksum verification
    try:
        ledger_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration';"
        ).fetchone()
        if not ledger_exists:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="MIGRATION_LEDGER_MISSING",
                    detail="Table schema_migration does not exist.",
                )
            )
        else:
            current_v = get_current_user_version(conn)
            disk_migrations = discover_migrations(migrations_dir)
            disk_by_version = {m.version: m for m in disk_migrations}

            rows = conn.execute("SELECT version, name, checksum FROM schema_migration ORDER BY version ASC;").fetchall()
            max_applied = 0
            for r in rows:
                v = r["version"]
                if v > max_applied:
                    max_applied = v
                if v not in disk_by_version:
                    findings.append(
                        DoctorFinding(
                            severity="ERROR",
                            code="MIGRATION_FILE_MISSING",
                            detail=f"Applied migration version {v} ('{r['name']}') is missing from disk.",
                        )
                    )
                else:
                    disk_m = disk_by_version[v]
                    if disk_m.checksum != r["checksum"]:
                        findings.append(
                            DoctorFinding(
                                severity="ERROR",
                                code="MIGRATION_CHECKSUM_MISMATCH",
                                detail=f"Migration {v} ({disk_m.name}) checksum tampered: "
                                       f"recorded '{r['checksum']}', disk '{disk_m.checksum}'.",
                            )
                        )

            if current_v != max_applied:
                findings.append(
                    DoctorFinding(
                        severity="ERROR",
                        code="USER_VERSION_MISMATCH",
                        detail=f"PRAGMA user_version ({current_v}) does not match ledger max applied ({max_applied}).",
                    )
                )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="MIGRATION_AUDIT_EXCEPTION", detail=str(e)))

    # 4. Required trigger presence
    try:
        existing_triggers = {
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger';").fetchall()
        }
        missing_triggers = REQUIRED_TRIGGERS - existing_triggers
        if missing_triggers:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="MISSING_IMMUTABILITY_TRIGGERS",
                    detail=f"Required database triggers missing: {sorted(missing_triggers)}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="TRIGGER_AUDIT_EXCEPTION", detail=str(e)))

    # 5. Format registry consistency
    try:
        format_rows = conn.execute("SELECT code FROM format;").fetchall()
        db_formats = {r["code"] for r in format_rows}
        missing_formats = KNOWN_FORMAT_CODES - db_formats
        if missing_formats:
            findings.append(
                DoctorFinding(
                    severity="WARNING",
                    code="FORMAT_REGISTRY_INCOMPLETE",
                    detail=f"Expected format codes missing from database: {sorted(missing_formats)}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="WARNING", code="FORMAT_AUDIT_EXCEPTION", detail=str(e)))

    # 6. Asset checks & orphans
    store = media_store or MediaStore()
    try:
        assets = conn.execute("SELECT id, sha256, relative_path, status FROM asset;").fetchall()
        for a in assets:
            try:
                full_path = store.get_asset_file_path(a["relative_path"])
                file_exists = full_path.is_file()
            except PathTraversalError:
                file_exists = False
                findings.append(
                    DoctorFinding(
                        severity="ERROR",
                        code="ASSET_PATH_TRAVERSAL",
                        detail=f"Asset id={a['id']} relative path '{a['relative_path']}' attempts path traversal.",
                    )
                )

            if a["status"] == "present" and not file_exists:
                findings.append(
                    DoctorFinding(
                        severity="ERROR",
                        code="ASSET_FILE_MISSING",
                        detail=f"Asset id={a['id']} (sha256={a['sha256']}) is marked 'present' but missing on disk.",
                    )
                )
            elif file_exists and verify_media_hashes:
                if not store.verify_asset(a["sha256"], conn):
                    findings.append(
                        DoctorFinding(
                            severity="ERROR",
                            code="ASSET_HASH_MISMATCH",
                            detail=f"Asset id={a['id']} content on disk does not match recorded sha256={a['sha256']}.",
                        )
                    )

        # Orphan assets check (assets in DB not referenced by question, group, or choice)
        orphans = conn.execute(
            """
            SELECT a.id, a.sha256
            FROM asset a
            WHERE a.id NOT IN (SELECT asset_id FROM question_revision_asset)
              AND a.id NOT IN (SELECT asset_id FROM group_revision_asset)
              AND a.id NOT IN (SELECT asset_id FROM revision_choice WHERE asset_id IS NOT NULL);
            """
        ).fetchall()
        if orphans:
            findings.append(
                DoctorFinding(
                    severity="INFO",
                    code="ORPHAN_ASSETS_FOUND",
                    detail=f"Found {len(orphans)} unreferenced asset records in asset table.",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="ASSET_AUDIT_EXCEPTION", detail=str(e)))

    # 7. Question, group, and anchor consistency
    try:
        # Questions with missing group
        dangling_group_q = conn.execute(
            """
            SELECT id FROM question
            WHERE content_group_id IS NOT NULL
              AND content_group_id NOT IN (SELECT id FROM content_group);
            """
        ).fetchall()
        if dangling_group_q:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="DANGLING_QUESTION_CONTENT_GROUP",
                    detail=f"Questions referencing non-existent content groups: {[r['id'] for r in dangling_group_q]}",
                )
            )

        # Questions with level mismatch against content group
        level_mismatch_q = conn.execute(
            """
            SELECT q.id, q.level AS q_level, cg.level AS cg_level
            FROM question q
            JOIN content_group cg ON q.content_group_id = cg.id
            WHERE q.level != cg.level;
            """
        ).fetchall()
        if level_mismatch_q:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="QUESTION_GROUP_LEVEL_MISMATCH",
                    detail=f"Questions with level different from linked group: {[r['id'] for r in level_mismatch_q]}",
                )
            )

        # Questions with anchor key missing from current group revision
        anchor_missing_q = conn.execute(
            """
            SELECT q.id, q.anchor_key
            FROM question q
            JOIN content_group cg ON q.content_group_id = cg.id
            WHERE q.anchor_key IS NOT NULL
              AND cg.current_revision_id IS NOT NULL
              AND q.anchor_key NOT IN (
                  SELECT anchor_key FROM group_revision_anchor WHERE group_revision_id = cg.current_revision_id
              );
            """
        ).fetchall()
        if anchor_missing_q:
            findings.append(
                DoctorFinding(
                    severity="WARNING",
                    code="QUESTION_ANCHOR_NOT_IN_GROUP",
                    detail=f"Questions with anchor_key not found in current group revision: "
                           f"{[(r['id'], r['anchor_key']) for r in anchor_missing_q]}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="QUESTION_GROUP_AUDIT_EXCEPTION", detail=str(e)))

    # 8. Current revision pointer validity
    try:
        invalid_rev_pointers = conn.execute(
            """
            SELECT q.id, q.current_revision_id
            FROM question q
            WHERE q.current_revision_id IS NOT NULL
              AND q.current_revision_id NOT IN (
                  SELECT id FROM question_revision WHERE question_id = q.id
              );
            """
        ).fetchall()
        if invalid_rev_pointers:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="INVALID_CURRENT_REVISION_POINTER",
                    detail=f"Questions pointing to invalid or cross-question revisions: "
                           f"{[(r['id'], r['current_revision_id']) for r in invalid_rev_pointers]}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="REVISION_POINTER_AUDIT_EXCEPTION", detail=str(e)))

    # 9. Source claims and canonical answer conflicts
    try:
        conflicts = conn.execute(
            """
            SELECT sac.id, sac.question_revision_id, sac.source_id, ra.choice_id AS canonical_choice, sac.choice_id AS claimed_choice
            FROM source_answer_claim sac
            JOIN revision_answer ra ON sac.question_revision_id = ra.question_revision_id
            WHERE ra.answer_origin != 'user_entered'
              AND (sac.is_conflict = 1 OR (sac.choice_id IS NOT NULL AND sac.choice_id != ra.choice_id));
            """
        ).fetchall()
        if conflicts:
            findings.append(
                DoctorFinding(
                    severity="WARNING",
                    code="UNRESOLVED_ANSWER_CONFLICTS",
                    detail=f"Found {len(conflicts)} unresolved answer conflicts where canonical origin is not user_entered.",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="WARNING", code="CONFLICT_AUDIT_EXCEPTION", detail=str(e)))

    # 10. Attempt item pin consistency
    try:
        attempt_pin_violations = conn.execute(
            """
            SELECT ai.id, ai.attempt_id, ai.question_id, ai.pinned_question_revision_id
            FROM attempt_item ai
            WHERE ai.pinned_question_revision_id NOT IN (
                SELECT id FROM question_revision WHERE question_id = ai.question_id
            );
            """
        ).fetchall()
        if attempt_pin_violations:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="ATTEMPT_ITEM_REVISION_MISMATCH",
                    detail=f"Attempt items with mismatched pinned revisions: {[r['id'] for r in attempt_pin_violations]}",
                )
            )

        resp_choice_violations = conn.execute(
            """
            SELECT r.id, r.attempt_item_id, r.selected_choice_id, r.pinned_question_revision_id
            FROM response r
            WHERE r.selected_choice_id IS NOT NULL
              AND r.selected_choice_id NOT IN (
                  SELECT id FROM revision_choice WHERE question_revision_id = r.pinned_question_revision_id
              );
            """
        ).fetchall()
        if resp_choice_violations:
            findings.append(
                DoctorFinding(
                    severity="ERROR",
                    code="RESPONSE_CHOICE_MISMATCH",
                    detail=f"Responses with choices not belonging to pinned revision: {[r['id'] for r in resp_choice_violations]}",
                )
            )
    except Exception as e:
        findings.append(DoctorFinding(severity="ERROR", code="ATTEMPT_PIN_AUDIT_EXCEPTION", detail=str(e)))

    # Sort findings by severity
    severity_order = {"ERROR": 0, "WARNING": 1, "INFO": 2}
    findings.sort(key=lambda f: (severity_order.get(f.severity, 99), f.code))
    return findings

