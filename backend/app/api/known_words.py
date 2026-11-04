"""Known-words API area.

The known-words routes (``GET /api/known-words``,
``POST /api/known-words/mark``,
``DELETE /api/known-words/mark/{word}``) already live in :mod:`app.api.subtitle`.
This module reserves the known-words area for future routes and exposes a
module-level ``router`` so it is discovered by :mod:`app.api.registry`.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["known-words"])
