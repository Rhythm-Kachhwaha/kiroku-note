"""Shared authentication helper for Link API routers."""
from __future__ import annotations

import os
from typing import Optional


def resolve_link_user(authorization: Optional[str] = None) -> str:
    """Resolve and cryptographically verify user ID from Bearer token."""
    from app.api.cloud import _resolve_user_id

    is_prod = os.environ.get("ENVIRONMENT") == "production" or os.environ.get("RENDER") == "true"
    if is_prod:
        return _resolve_user_id(authorization)
    if authorization and authorization.startswith("Bearer "):
        try:
            return _resolve_user_id(authorization)
        except Exception:
            if is_prod:
                raise
    return os.environ.get("KIROKU_DEV_AUTH_USER", "local_user")
