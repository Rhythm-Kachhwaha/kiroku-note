"""
Dynamic Question Eligibility Evaluator.
--------------------------------------
Evaluates whether a question is ready and eligible for practice drills and examinations.
No mutable 'gradeable' boolean is ever stored in the database.

Evaluation uses a two-tier strategy:
1. Fast SQL pre-filtering view: `v_question_eligibility`
2. Deterministic Python evaluator: `evaluate_eligibility()`

Reason codes are returned in strict priority order:
1. RETIRED
2. NO_CURRENT_REVISION
3. VALIDATION_FAILED
4. NEEDS_REVIEW
5. NO_ANSWER
6. GRADER_UNIMPLEMENTED
7. REQUIRED_ASSET_MISSING
8. GROUP_INCONSISTENT
9. ANSWER_CONFLICT
"""
from __future__ import annotations

import sqlite3
from typing import Any

from app.study.media import MediaStore

IMPLEMENTED_GRADERS = frozenset({"single_choice"})

REASON_RETIRED = "RETIRED"
REASON_NO_CURRENT_REVISION = "NO_CURRENT_REVISION"
REASON_VALIDATION_FAILED = "VALIDATION_FAILED"
REASON_NEEDS_REVIEW = "NEEDS_REVIEW"
REASON_NO_ANSWER = "NO_ANSWER"
REASON_GRADER_UNIMPLEMENTED = "GRADER_UNIMPLEMENTED"
REASON_REQUIRED_ASSET_MISSING = "REQUIRED_ASSET_MISSING"
REASON_GROUP_INCONSISTENT = "GROUP_INCONSISTENT"
REASON_ANSWER_CONFLICT = "ANSWER_CONFLICT"

ORDERED_REASON_CODES = [
    REASON_RETIRED,
    REASON_NO_CURRENT_REVISION,
    REASON_VALIDATION_FAILED,
    REASON_NEEDS_REVIEW,
    REASON_NO_ANSWER,
    REASON_GRADER_UNIMPLEMENTED,
    REASON_REQUIRED_ASSET_MISSING,
    REASON_GROUP_INCONSISTENT,
    REASON_ANSWER_CONFLICT,
]


def evaluate_eligibility(
    question_or_id: int | str | sqlite3.Row | dict[str, Any],
    conn: sqlite3.Connection,
    verify_files: bool = False,
    media_store: MediaStore | None = None,
) -> tuple[bool, list[str]]:
    """
    Deterministically evaluate eligibility for a question.

    Returns:
        (is_eligible: bool, reason_codes: list[str])

    When verify_files is True, also verifies physical disk presence and SHA-256 integrity
    for all required media assets.
    """
    # 1. Resolve question record
    if isinstance(question_or_id, (int, str)):
        q_id = question_or_id
        cursor = conn.execute(
            """
            SELECT q.*, f.grader_type
            FROM question q
            LEFT JOIN format f ON q.format_code = f.code
            WHERE q.id = ? OR q.external_id = ?;
            """,
            (q_id, str(q_id)),
        )
        row = cursor.fetchone()
        if not row:
            return False, [REASON_RETIRED]
        q = dict(row)
    else:
        # dict or Row
        q = dict(question_or_id)
        if "grader_type" not in q:
            fmt_row = conn.execute("SELECT grader_type FROM format WHERE code = ?;", (q["format_code"],)).fetchone()
            grader_type = fmt_row["grader_type"] if fmt_row else None
            q["grader_type"] = grader_type

    reasons: list[str] = []

    # Reason 1: RETIRED
    if q["status"] == "retired":
        reasons.append(REASON_RETIRED)

    # Reason 2: NO_CURRENT_REVISION
    current_rev_id = q.get("current_revision_id")
    if current_rev_id is None:
        reasons.append(REASON_NO_CURRENT_REVISION)
        # Without a revision, we cannot evaluate revision-dependent attributes
        return False, _sort_reasons(reasons)

    # Fetch current revision details
    rev_row = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (current_rev_id,)).fetchone()
    if not rev_row:
        reasons.append(REASON_NO_CURRENT_REVISION)
        return False, _sort_reasons(reasons)

    # Reason 3: VALIDATION_FAILED
    if rev_row["validation_status"] == "invalid":
        reasons.append(REASON_VALIDATION_FAILED)

    # Reason 4: NEEDS_REVIEW
    if q["status"] in ("draft", "in_review"):
        reasons.append(REASON_NEEDS_REVIEW)
    elif rev_row["validation_status"] == "needs_review":
        # If question is active but revision was recorded with needs_review,
        # check if it has a successful verification run
        has_approved_run = False
        try:
            row = conn.execute(
                """
                SELECT COUNT(*) as c FROM verification_run
                WHERE question_revision_id = ?
                  AND status IN ('agreement', 'ai_agreement_unconfirmed')
                  AND comparison_scenario IN (
                      'scenario_a_agreement', 'scenario_b_ai_agreement_unconfirmed',
                      'A_AGREEMENT', 'B_AI_AGREEMENT_UNCONFIRMED'
                  );
                """,
                (current_rev_id,),
            ).fetchone()
            has_approved_run = bool(row and row["c"] > 0)
        except Exception:
            pass

        if not has_approved_run:
            reasons.append(REASON_NEEDS_REVIEW)

    # Reason 5: NO_ANSWER
    ans_row = conn.execute(
        "SELECT * FROM revision_answer WHERE question_revision_id = ?;",
        (current_rev_id,),
    ).fetchone()
    if not ans_row:
        reasons.append(REASON_NO_ANSWER)

    # Reason 6: GRADER_UNIMPLEMENTED
    q_grader = q.get("grader_type")
    if q_grader is None:
        fmt_row = conn.execute("SELECT grader_type FROM format WHERE code = ?;", (q["format_code"],)).fetchone()
        q_grader = fmt_row["grader_type"] if fmt_row else None
    if q_grader not in IMPLEMENTED_GRADERS:
        reasons.append(REASON_GRADER_UNIMPLEMENTED)

    # Reason 7: REQUIRED_ASSET_MISSING
    has_missing_asset = _check_required_assets_missing(
        conn=conn,
        question_revision_id=current_rev_id,
        content_group_id=q.get("content_group_id"),
        verify_files=verify_files,
        media_store=media_store,
    )
    if has_missing_asset:
        reasons.append(REASON_REQUIRED_ASSET_MISSING)

    # Reason 8: GROUP_INCONSISTENT
    if q.get("content_group_id") is not None:
        group_id = q["content_group_id"]
        group_row = conn.execute("SELECT * FROM content_group WHERE id = ?;", (group_id,)).fetchone()
        if not group_row or group_row["status"] == "retired" or group_row["current_revision_id"] is None:
            reasons.append(REASON_GROUP_INCONSISTENT)
        else:
            # Check anchor key if required
            anchor_key = q.get("anchor_key")
            if anchor_key is not None:
                grp_rev_id = group_row["current_revision_id"]
                anchor_exists = conn.execute(
                    "SELECT 1 FROM group_revision_anchor WHERE group_revision_id = ? AND anchor_key = ?;",
                    (grp_rev_id, anchor_key),
                ).fetchone()
                if not anchor_exists:
                    reasons.append(REASON_GROUP_INCONSISTENT)

    # Reason 9: ANSWER_CONFLICT
    # An answer conflict exists when a source claim disagrees with the canonical answer
    # and the canonical answer origin is NOT user_entered.
    if ans_row and ans_row["answer_origin"] != "user_entered":
        canonical_choice = ans_row["choice_id"]
        conflict_exists = conn.execute(
            """
            SELECT 1 FROM source_answer_claim
            WHERE question_revision_id = ?
              AND (is_conflict = 1 OR (choice_id IS NOT NULL AND choice_id != ?));
            """,
            (current_rev_id, canonical_choice),
        ).fetchone()
        if conflict_exists:
            reasons.append(REASON_ANSWER_CONFLICT)

    sorted_reasons = _sort_reasons(reasons)
    return len(sorted_reasons) == 0, sorted_reasons


def _check_required_assets_missing(
    conn: sqlite3.Connection,
    question_revision_id: int,
    content_group_id: int | None,
    verify_files: bool,
    media_store: MediaStore | None,
) -> bool:
    """Check whether any required asset for the question, its group, or choices is missing."""
    store = media_store or MediaStore()

    # 1. Question revision assets (required only)
    q_assets = conn.execute(
        """
        SELECT a.id, a.sha256, a.relative_path, a.status
        FROM question_revision_asset qra
        JOIN asset a ON qra.asset_id = a.id
        WHERE qra.question_revision_id = ? AND qra.is_required = 1;
        """,
        (question_revision_id,),
    ).fetchall()

    for a in q_assets:
        if a["status"] == "missing":
            return True
        if verify_files and not store.verify_asset(a["sha256"], conn):
            return True

    # 2. Group revision assets (required only)
    if content_group_id is not None:
        grp_row = conn.execute("SELECT current_revision_id FROM content_group WHERE id = ?;", (content_group_id,)).fetchone()
        if grp_row and grp_row["current_revision_id"]:
            g_assets = conn.execute(
                """
                SELECT a.id, a.sha256, a.relative_path, a.status
                FROM group_revision_asset gra
                JOIN asset a ON gra.asset_id = a.id
                WHERE gra.group_revision_id = ? AND gra.is_required = 1;
                """,
                (grp_row["current_revision_id"],),
            ).fetchall()
            for a in g_assets:
                if a["status"] == "missing":
                    return True
                if verify_files and not store.verify_asset(a["sha256"], conn):
                    return True

    # 3. Choice-level assets (choice assets are always required if linked)
    c_assets = conn.execute(
        """
        SELECT a.id, a.sha256, a.relative_path, a.status
        FROM revision_choice rc
        JOIN asset a ON rc.asset_id = a.id
        WHERE rc.question_revision_id = ? AND rc.asset_id IS NOT NULL;
        """,
        (question_revision_id,),
    ).fetchall()

    for a in c_assets:
        if a["status"] == "missing":
            return True
        if verify_files and not store.verify_asset(a["sha256"], conn):
            return True

    return False


def _sort_reasons(reasons: list[str]) -> list[str]:
    """Sort reason codes strictly according to the binding specification."""
    order_map = {code: idx for idx, code in enumerate(ORDERED_REASON_CODES)}
    # Deduplicate while preserving priority order
    unique = set(reasons)
    return sorted(unique, key=lambda code: order_map.get(code, 999))

