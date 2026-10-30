"""
Ephemeral Per-Launch Bearer Authentication for Study HTTP API.
--------------------------------------------------------------
Provides constant-time bearer token validation for all protected
endpoints under `/api/study/v1`.

Security Guarantees:
- Validates `Authorization: Bearer <token>` using constant-time comparison (`secrets.compare_digest`).
- Token is ephemeral, stored only in-memory or passed via runtime environment (`KIROKU_STUDY_API_TOKEN`).
- Never stored in SQLite database, log messages, persistent config, or error payloads.
- Rejects missing, malformed, or invalid tokens with structured 401 JSON errors.
- Never silently disables authentication when unconfigured in production/desktop mode.
- Explicit dev/test override supported via `KIROKU_STUDY_AUTH_DISABLED=1`.
"""
from __future__ import annotations

import logging
import os
import secrets
from typing import Optional

from fastapi import Header, Request, status

from app.api.study.errors import StudyAPIError

logger = logging.getLogger("kiroku.study.auth")

# In-memory runtime token store (ephemeral, not persisted)
_STUDY_API_TOKEN: Optional[str] = None


def generate_study_api_token() -> str:
    """Generate a cryptographically secure, random urlsafe bearer token."""
    return secrets.token_urlsafe(32)


def set_study_api_token(token: Optional[str]) -> None:
    """
    Set the ephemeral runtime bearer token.
    Invoked by desktop supervisor, launcher, or test harness.
    """
    global _STUDY_API_TOKEN
    _STUDY_API_TOKEN = str(token).strip() if token is not None else None


def get_study_api_token() -> Optional[str]:
    """
    Retrieve the configured runtime bearer token.
    Checks in-memory store first, falling back to KIROKU_STUDY_API_TOKEN env var.
    """
    if _STUDY_API_TOKEN is not None:
        return _STUDY_API_TOKEN
    env_token = os.environ.get("KIROKU_STUDY_API_TOKEN")
    if env_token and env_token.strip():
        return env_token.strip()
    return None


def clear_study_api_token() -> None:
    """Clear the in-memory bearer token (used for teardown/tests)."""
    global _STUDY_API_TOKEN
    _STUDY_API_TOKEN = None


def is_study_auth_disabled() -> bool:
    """
    Check if authentication is explicitly disabled for testing.
    Requires explicit KIROKU_STUDY_AUTH_DISABLED=1.
    """
    val = os.environ.get("KIROKU_STUDY_AUTH_DISABLED", "").strip().lower()
    return val in ("1", "true", "yes")


async def verify_study_auth(
    request: Request,
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> None:
    """
    FastAPI dependency validating Bearer token authentication for Study API endpoints.
    Mounted globally on `/api/study/v1`.
    """
    # 1. Check explicit test override
    if is_study_auth_disabled():
        return

    # 2. Check header presence
    if not authorization:
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Authorization header missing. Expected 'Authorization: Bearer <token>'.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 3. Check scheme and parse token
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Malformed authorization header. Expected 'Bearer <token>'.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    provided_token = parts[1].strip()
    if not provided_token:
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Bearer token is empty.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 4. Resolve configured token
    configured_token = get_study_api_token()
    if not configured_token:
        # Do not silently disable authentication when token is unconfigured in production/desktop
        logger.warning("Protected Study API request rejected: runtime bearer token is not configured.")
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Study API authentication token is unconfigured.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 5. Constant-time comparison
    if not secrets.compare_digest(provided_token.encode("utf-8"), configured_token.encode("utf-8")):
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Invalid bearer token.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

