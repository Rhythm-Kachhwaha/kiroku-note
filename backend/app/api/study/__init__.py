"""
Versioned Study HTTP API (v1).
------------------------------
Base path: `/api/study/v1`

Modular routers for:
- Study Bank & Blueprint Readiness (/bank/*, /exam/readiness, /exam/blueprints/*)
- Practice Drill Sessions (/practice/*, /history/questions)
- JLPT Examination Simulations (/exam/*)
- Supporting Analytics & Diagnostics (/dashboard/*, /analytics/*, /history/incorrect, /diagnostics)
- Content-Addressed Media Serving (/media/*)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.study.auth import (
    clear_study_api_token,
    generate_study_api_token,
    get_study_api_token,
    set_study_api_token,
    verify_study_auth,
)
from app.api.study.bank import bank_router
from app.api.study.errors import (
    StudyAPIError,
    study_api_error_handler,
    study_http_exception_handler,
    study_validation_error_handler,
)
from app.api.study.exam import exam_router
from app.api.study.media import media_router
from app.api.study.practice import practice_router
from app.api.study.supporting import supporting_router

study_router = APIRouter(
    prefix="/api/study/v1",
    dependencies=[Depends(verify_study_auth)],
)

# Mount sub-routers
study_router.include_router(bank_router)
study_router.include_router(practice_router)
study_router.include_router(exam_router)
study_router.include_router(supporting_router)
study_router.include_router(media_router)

__all__ = [
    "study_router",
    "StudyAPIError",
    "study_api_error_handler",
    "study_http_exception_handler",
    "study_validation_error_handler",
    "verify_study_auth",
    "set_study_api_token",
    "get_study_api_token",
    "clear_study_api_token",
    "generate_study_api_token",
]

