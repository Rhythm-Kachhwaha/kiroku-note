"""
Request Idempotency Manager for Study HTTP API.
-----------------------------------------------
Guarantees safe, duplicate-free request retries for mutating Study endpoints.

Mechanisms:
- Extracts optional client_request_id from `X-Client-Request-Id` header or request body.
- Validates that client_request_id is a valid UUID.
- Hashes canonical operation payloads to detect conflicting key reuse.
- Uses SQLite transactions and `api_mutation_idempotency` table.
- Concurrent identical requests resolve safely without duplicate resource generation.
- Reusing an ID with a different operation or payload raises 409 IDEMPOTENCY_CONFLICT.
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import time
from typing import Any, Dict, Optional, Tuple
import uuid

from fastapi import Header, Request, status
from pydantic import BaseModel

from app.api.study.errors import StudyBadRequestError, StudyConflictError

logger = logging.getLogger("kiroku.study.idempotency")


def validate_client_request_id(raw_id: Optional[str]) -> Optional[str]:
    """
    Validate that client_request_id is a valid UUID string if provided.
    Returns canonical lowercase string representation.
    """
    if raw_id is None:
        return None
    val = str(raw_id).strip()
    if not val:
        return None
    try:
        parsed = uuid.UUID(val)
        return str(parsed).lower()
    except (ValueError, AttributeError, TypeError):
        raise StudyBadRequestError(
            code="INVALID_REQUEST_ID",
            message=f"client_request_id '{raw_id}' must be a valid UUID.",
        )


def compute_payload_hash(payload: Any) -> str:
    """
    Compute deterministic SHA-256 digest of request payload.
    Omits client_request_id so header vs body placement produces identical hashes.
    """
    if payload is None:
        raw_dict = {}
    elif isinstance(payload, BaseModel):
        raw_dict = payload.model_dump()
    elif isinstance(payload, dict):
        raw_dict = dict(payload)
    else:
        raw_dict = {"data": str(payload)}

    # Remove client_request_id from hash calculation
    clean_dict = {k: v for k, v in raw_dict.items() if k != "client_request_id"}
    serialized = json.dumps(clean_dict, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def resolve_client_request_id(
    header_id: Optional[str] = None,
    body_payload: Optional[Any] = None,
) -> Optional[str]:
    """
    Extract and validate client_request_id from HTTP header or request body.
    If both are supplied, verifies they match.
    """
    body_id = None
    if body_payload is not None:
        if isinstance(body_payload, BaseModel) and hasattr(body_payload, "client_request_id"):
            body_id = getattr(body_payload, "client_request_id")
        elif isinstance(body_payload, dict) and "client_request_id" in body_payload:
            body_id = body_payload.get("client_request_id")

    v_header = validate_client_request_id(header_id)
    v_body = validate_client_request_id(body_id)

    if v_header and v_body and v_header != v_body:
        raise StudyBadRequestError(
            code="INVALID_REQUEST_ID",
            message="X-Client-Request-Id header does not match client_request_id in request body.",
        )

    return v_header or v_body


class IdempotencyRecord:
    """Represents an idempotency check outcome."""

    def __init__(
        self,
        is_cached: bool,
        status_code: Optional[int] = None,
        cached_response: Optional[Any] = None,
    ):
        self.is_cached = is_cached
        self.status_code = status_code
        self.cached_response = cached_response


def check_or_start_idempotency(
    conn: sqlite3.Connection,
    client_request_id: Optional[str],
    operation: str,
    payload: Any,
    resource_id: Optional[str] = None,
    poll_timeout_seconds: float = 2.5,
) -> IdempotencyRecord:
    """
    Inspect idempotency table for client_request_id:
    - If None, no-op (is_cached=False).
    - If already completed for identical operation & payload, returns cached result.
    - If client_request_id was reused for different operation or payload, raises 409 Conflict.
    - If in-progress concurrently, waits up to poll_timeout_seconds for completion.
    - Otherwise marks 'processing' and allows execution.
    """
    if not client_request_id:
        return IdempotencyRecord(is_cached=False)

    payload_hash = compute_payload_hash(payload)

    start_time = time.monotonic()
    while True:
        row = conn.execute(
            "SELECT operation, payload_hash, status, status_code, response_body FROM api_mutation_idempotency WHERE client_request_id = ?;",
            (client_request_id,),
        ).fetchone()

        if row:
            if row["operation"] != operation or row["payload_hash"] != payload_hash:
                raise StudyConflictError(
                    code="IDEMPOTENCY_CONFLICT",
                    message="client_request_id has already been used for a different operation or payload.",
                )

            if row["status"] == "completed":
                resp_data = json.loads(row["response_body"]) if row["response_body"] else {}
                return IdempotencyRecord(
                    is_cached=True,
                    status_code=row["status_code"] or 200,
                    cached_response=resp_data,
                )

            # In progress by concurrent identical request: wait briefly
            if time.monotonic() - start_time > poll_timeout_seconds:
                # Concurrent request took too long; report conflict or retry
                raise StudyConflictError(
                    code="CONCURRENT_REQUEST_IN_PROGRESS",
                    message="An identical request with this client_request_id is currently processing.",
                )
            time.sleep(0.05)
            continue

        # No row exists yet; attempt to insert 'processing'
        try:
            conn.execute(
                """
                INSERT INTO api_mutation_idempotency (client_request_id, operation, resource_id, payload_hash, status)
                VALUES (?, ?, ?, ?, 'processing');
                """,
                (client_request_id, operation, resource_id, payload_hash),
            )
            conn.commit()
            return IdempotencyRecord(is_cached=False)
        except sqlite3.IntegrityError:
            # Another concurrent request inserted first, loop to inspect
            time.sleep(0.05)


def save_idempotency_result(
    conn: sqlite3.Connection,
    client_request_id: Optional[str],
    status_code: int,
    response_data: Any,
) -> None:
    """Save the final response payload and status code for client_request_id."""
    if not client_request_id:
        return

    if hasattr(response_data, "model_dump"):
        data_to_store = response_data.model_dump()
    elif isinstance(response_data, dict):
        data_to_store = response_data
    else:
        data_to_store = {"data": response_data}

    body_json = json.dumps(data_to_store, default=str)

    conn.execute(
        """
        UPDATE api_mutation_idempotency
        SET status = 'completed',
            status_code = ?,
            response_body = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE client_request_id = ?;
        """,
        (status_code, body_json, client_request_id),
    )
    conn.commit()


def clear_failed_idempotency(conn: sqlite3.Connection, client_request_id: Optional[str]) -> None:
    """Clear 'processing' state if request failed with an exception so retries are permitted."""
    if not client_request_id:
        return
    try:
        conn.execute(
            "DELETE FROM api_mutation_idempotency WHERE client_request_id = ? AND status = 'processing';",
            (client_request_id,),
        )
        conn.commit()
    except Exception as exc:
        logger.debug("Failed to clean up processing idempotency key %s: %s", client_request_id, exc)

