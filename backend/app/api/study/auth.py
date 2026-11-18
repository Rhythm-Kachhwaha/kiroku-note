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
- In-memory rate limiting against brute-force token guessing.
- Structured audit logging without secret token disclosure.
- Safe token sanitization rejecting whitespace/control characters.
"""
from __future__ import annotations

from collections import defaultdict
import hashlib
import logging
import os
import secrets
import time
from typing import Dict, List, Optional

from fastapi import Header, Request, status

from app.api.study.errors import StudyAPIError

logger = logging.getLogger("kiroku.study.auth")

# In-memory runtime token store (ephemeral, not persisted)
_STUDY_API_TOKEN: Optional[str] = None
_REVOKED: bool = False

# Rate limiting for failed authentication attempts: client_ip -> [timestamps]
_FAILED_ATTEMPTS: Dict[str, List[float]] = defaultdict(list)
MAX_FAILED_ATTEMPTS = 30
WINDOW_SECONDS = 60.0


def _hash_token(token: str) -> str:
    """Return truncated SHA-256 hex digest for correlation logs without leaking token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]


def _sanitize_token(token: Optional[str]) -> Optional[str]:
    """Strip whitespace and reject tokens with newlines, tabs, or spaces."""
    if token is None:
        return None
    cleaned = str(token).strip()
    if not cleaned:
        return None
    if any(c in cleaned for c in ("\n", "\r", "\t", " ")):
        logger.warning("Rejected token containing whitespace or newline characters")
        return None
    return cleaned


def _check_rate_limit(client_ip: str) -> bool:
    """Return True if client is within failed attempt rate limits, False if blocked."""
    now = time.time()
    attempts = [t for t in _FAILED_ATTEMPTS[client_ip] if now - t < WINDOW_SECONDS]
    _FAILED_ATTEMPTS[client_ip] = attempts
    return len(attempts) < MAX_FAILED_ATTEMPTS


def _record_failed_attempt(client_ip: str) -> None:
    """Record a failed authentication timestamp for the client IP."""
    _FAILED_ATTEMPTS[client_ip].append(time.time())


def reset_rate_limits() -> None:
    """Reset the failed authentication attempt counters (for testing)."""
    _FAILED_ATTEMPTS.clear()


def generate_study_api_token() -> str:
    """Generate a cryptographically secure, random urlsafe bearer token."""
    return secrets.token_urlsafe(32)


def set_study_api_token(token: Optional[str]) -> None:
    """
    Set the ephemeral runtime bearer token.
    Invoked by desktop supervisor, launcher, or test harness.
    """
    global _STUDY_API_TOKEN, _REVOKED
    _STUDY_API_TOKEN = _sanitize_token(token)
    _REVOKED = False


def get_study_api_token() -> Optional[str]:
    """
    Retrieve the configured runtime bearer token.
    Checks in-memory store first, falling back to KIROKU_STUDY_API_TOKEN env var.
    """
    if _REVOKED:
        return None
    if _STUDY_API_TOKEN is not None:
        return _STUDY_API_TOKEN
    env_token = os.environ.get("KIROKU_STUDY_API_TOKEN")
    if env_token:
        sanitized = _sanitize_token(env_token)
        if sanitized:
            return sanitized
    return None


def clear_study_api_token() -> None:
    """Clear the in-memory bearer token (used for teardown/tests)."""
    global _STUDY_API_TOKEN, _REVOKED
    _STUDY_API_TOKEN = None
    _REVOKED = False


def revoke_study_api_token() -> bool:
    """
    Explicitly revoke the active in-memory bearer token.
    Returns True if an in-memory or env token was cleared.
    """
    global _STUDY_API_TOKEN, _REVOKED
    had_token = _STUDY_API_TOKEN is not None or bool(os.environ.get("KIROKU_STUDY_API_TOKEN"))
    _STUDY_API_TOKEN = None
    _REVOKED = True
    logger.info("Study API bearer token explicitly revoked.")
    return had_token


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
    client_ip = request.client.host if request.client else "127.0.0.1"

    # 1. Check explicit test override
    if is_study_auth_disabled():
        return

    # 2. Brute-force rate limiting check
    if not _check_rate_limit(client_ip):
        logger.warning(
            "Study API auth rate limit exceeded: client=%s path=%s",
            client_ip,
            request.url.path,
        )
        raise StudyAPIError(
            code="TOO_MANY_REQUESTS",
            message="Too many failed authentication attempts. Please try again later.",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # 3. Check header presence
    if not authorization:
        _record_failed_attempt(client_ip)
        logger.warning(
            "Study API auth failed: missing header client=%s path=%s",
            client_ip,
            request.url.path,
        )
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Authorization header missing. Expected 'Authorization: Bearer <token>'.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 4. Check scheme and parse token
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        _record_failed_attempt(client_ip)
        logger.warning(
            "Study API auth failed: malformed header client=%s path=%s",
            client_ip,
            request.url.path,
        )
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Malformed authorization header. Expected 'Bearer <token>'.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    provided_token = parts[1].strip()
    if not provided_token:
        _record_failed_attempt(client_ip)
        logger.warning(
            "Study API auth failed: empty token client=%s path=%s",
            client_ip,
            request.url.path,
        )
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Bearer token is empty.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 5. Resolve configured token
    configured_token = get_study_api_token()
    if not configured_token:
        _record_failed_attempt(client_ip)
        logger.warning(
            "Protected Study API request rejected: runtime bearer token is not configured (client=%s, path=%s).",
            client_ip,
            request.url.path,
        )
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Study API authentication token is unconfigured.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 6. Constant-time comparison
    if not secrets.compare_digest(provided_token.encode("utf-8"), configured_token.encode("utf-8")):
        _record_failed_attempt(client_ip)
        logger.warning(
            "Study API auth failed: invalid token client=%s path=%s token_hash=%s",
            client_ip,
            request.url.path,
            _hash_token(provided_token),
        )
        raise StudyAPIError(
            code="UNAUTHORIZED",
            message="Invalid bearer token.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    # 7. Audit log success
    logger.debug(
        "Study API auth succeeded: client=%s path=%s token_hash=%s",
        client_ip,
        request.url.path,
        _hash_token(provided_token),
    )
