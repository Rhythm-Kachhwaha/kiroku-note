"""
Provenance, Ingestion Metadata, and Source Conflict Preservation Service.
------------------------------------------------------------------------
Maintains the audit chain for questions, content groups, and answer claims.
Guarantees:
- Multiple sources can contribute to questions and content groups
- External source references are preserved
- Conflicting answers are explicitly tracked (source_answer_claim) and NEVER silently overwritten
- Mapped claims link to revision_choice; unmapped claims preserve raw labels/text
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any
import urllib.parse


# Query parameter keys discarded during URL normalization (tracking, analytics, social)
TRACKING_QUERY_PARAMS = frozenset({
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "_ga",
    "_gl",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
})


def normalize_source_url(url: str) -> str:
    """
    Deterministically normalize a source URL for duplicate detection:
    - Lowercase scheme and hostname
    - Strip URL fragments (#...)
    - Strip tracking / analytics query parameters (utm_*, fbclid, etc.)
    - Sort and preserve meaningful query parameters
    - Normalize path slashes (collapse double slashes, ensure trailing slash for directory paths)
    """
    if not url or not url.strip():
        return ""

    raw = url.strip()
    parsed = urllib.parse.urlsplit(raw)

    scheme = (parsed.scheme or "https").lower()
    netloc = (parsed.netloc or "").lower()

    # Remove standard default port numbers
    if ":" in netloc:
        host, port = netloc.split(":", 1)
        if (scheme == "http" and port == "80") or (scheme == "https" and port == "443"):
            netloc = host

    # Normalize path: collapse duplicate slashes
    path = re.sub(r"/{2,}", "/", parsed.path or "/")

    # Ensure trailing slash for exercise permalinks (no file extension)
    if path and not path.endswith("/") and not re.search(r"\.[a-zA-Z0-9]+$", path):
        path = f"{path}/"

    # Filter query parameters
    query_parts = ""
    if parsed.query:
        query_items = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        filtered_items = [
            (k, v) for k, v in query_items
            if k.lower() not in TRACKING_QUERY_PARAMS
        ]
        # Sort query items alphabetically for stability
        filtered_items.sort(key=lambda item: (item[0], item[1]))
        if filtered_items:
            query_parts = urllib.parse.urlencode(filtered_items)

    return urllib.parse.urlunsplit((scheme, netloc, path, query_parts, ""))


class ProvenanceService:
    """Helper operations for recording provenance and source answer claims."""

    @staticmethod
    def create_source(
        conn: sqlite3.Connection,
        name: str,
        source_type: str,
        license_or_permission: str = "",
        citation: str = "",
        url: str | None = None,
    ) -> sqlite3.Row:
        """Create a new external source entity."""
        cursor = conn.execute(
            """
            INSERT INTO source (name, source_type, license_or_permission, citation, url)
            VALUES (?, ?, ?, ?, ?);
            """,
            (name, source_type, license_or_permission, citation, url),
        )
        return conn.execute("SELECT * FROM source WHERE id = ?;", (cursor.lastrowid,)).fetchone()

    @staticmethod
    def create_import_batch(
        conn: sqlite3.Connection,
        source_id: int,
        adapter_name: str,
        status: str = "completed",
        item_count: int = 0,
    ) -> sqlite3.Row:
        """Create an import batch ledger record."""
        cursor = conn.execute(
            """
            INSERT INTO import_batch (source_id, adapter_name, status, item_count)
            VALUES (?, ?, ?, ?);
            """,
            (source_id, adapter_name, status, item_count),
        )
        return conn.execute("SELECT * FROM import_batch WHERE id = ?;", (cursor.lastrowid,)).fetchone()

    @staticmethod
    def link_question_source(
        conn: sqlite3.Connection,
        question_id: int,
        source_id: int,
        external_question_ref: str | None = None,
    ) -> None:
        """Link a question to a provenance source."""
        conn.execute(
            """
            INSERT OR IGNORE INTO question_source (question_id, source_id, external_question_ref)
            VALUES (?, ?, ?);
            """,
            (question_id, source_id, external_question_ref),
        )

    @staticmethod
    def link_group_source(
        conn: sqlite3.Connection,
        content_group_id: int,
        source_id: int,
        external_group_ref: str | None = None,
    ) -> None:
        """Link a content group to a provenance source."""
        conn.execute(
            """
            INSERT OR IGNORE INTO group_source (content_group_id, source_id, external_group_ref)
            VALUES (?, ?, ?);
            """,
            (content_group_id, source_id, external_group_ref),
        )

    @staticmethod
    def record_source_answer_claim(
        conn: sqlite3.Connection,
        question_revision_id: int,
        source_id: int,
        choice_id: int | None = None,
        source_label: str | None = None,
        source_text: str | None = None,
        answer_origin: str = "source_explicit",
        rationale: str = "",
        is_conflict: int | None = None,
    ) -> sqlite3.Row:
        """
        Record an answer claim from an external source for a question revision.

        If choice_id is provided, checks against revision_answer. If it disagrees
        with the canonical answer, automatically sets is_conflict = 1 unless
        is_conflict was explicitly passed.
        """
        if is_conflict is None:
            # Check canonical answer
            row = conn.execute(
                "SELECT choice_id FROM revision_answer WHERE question_revision_id = ?;",
                (question_revision_id,),
            ).fetchone()
            if row is not None and choice_id is not None and row["choice_id"] != choice_id:
                is_conflict = 1
            else:
                is_conflict = 0

        cursor = conn.execute(
            """
            INSERT INTO source_answer_claim (
                question_revision_id, source_id, choice_id, source_label,
                source_text, answer_origin, rationale, is_conflict
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                question_revision_id,
                source_id,
                choice_id,
                source_label,
                source_text,
                answer_origin,
                rationale,
                is_conflict,
            ),
        )
        return conn.execute("SELECT * FROM source_answer_claim WHERE id = ?;", (cursor.lastrowid,)).fetchone()

