"""
Structured Error Handling & Status Codes for Study HTTP API.
-------------------------------------------------------------
All errors under `/api/study/v1` strictly adhere to the contract:
{"error": {"code": "...", "message": "...", "details": {}}}
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Any, Dict, Optional

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.study.exam.service import (
    ExamReadinessError,
    ExamSectionClosedError,
    ExamSectionSequenceError,
    ExamServiceError,
)
from app.study.media import MediaStorageError, PathTraversalError
from app.study.session.service import (
    AlreadyAnsweredError,
    NoEligibleQuestionsError,
    SessionLifecycleError,
    SessionNotFoundError,
    SessionServiceError,
)

logger = logging.getLogger("kiroku.study.api")


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorDetail


class StudyAPIError(Exception):
    """Base exception for all Study HTTP API errors with structured payloads."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class StudyNotFoundError(StudyAPIError):
    def __init__(self, message: str, code: str = "RESOURCE_NOT_FOUND", details: Optional[Dict[str, Any]] = None):
        super().__init__(code=code, message=message, status_code=status.HTTP_404_NOT_FOUND, details=details)


class StudyConflictError(StudyAPIError):
    def __init__(self, message: str, code: str = "CONFLICT", details: Optional[Dict[str, Any]] = None):
        super().__init__(code=code, message=message, status_code=status.HTTP_409_CONFLICT, details=details)


class StudyBadRequestError(StudyAPIError):
    def __init__(self, message: str, code: str = "BAD_REQUEST", details: Optional[Dict[str, Any]] = None):
        super().__init__(code=code, message=message, status_code=status.HTTP_400_BAD_REQUEST, details=details)


class StudyMediaError(StudyAPIError):
    def __init__(self, message: str, code: str = "MEDIA_ERROR", status_code: int = status.HTTP_410_GONE, details: Optional[Dict[str, Any]] = None):
        super().__init__(code=code, message=message, status_code=status_code, details=details)


class StudyUnavailableError(StudyAPIError):
    def __init__(self, message: str = "Database or service temporarily unavailable.", code: str = "SERVICE_UNAVAILABLE"):
        super().__init__(code=code, message=message, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


def map_domain_exception(exc: Exception) -> StudyAPIError:
    """Map domain exceptions to StudyAPIError with appropriate HTTP status codes and codes."""
    if isinstance(exc, StudyAPIError):
        return exc

    if isinstance(exc, SessionNotFoundError):
        return StudyNotFoundError(message=str(exc), code="SESSION_NOT_FOUND")

    if isinstance(exc, AlreadyAnsweredError):
        return StudyConflictError(message=str(exc), code="ALREADY_ANSWERED")

    if isinstance(exc, SessionLifecycleError):
        return StudyConflictError(message=str(exc), code="INVALID_STATE_TRANSITION")

    if isinstance(exc, NoEligibleQuestionsError):
        return StudyConflictError(message=str(exc), code="NO_ELIGIBLE_QUESTIONS")

    if isinstance(exc, ExamReadinessError):
        report_details = exc.report.model_dump() if hasattr(exc, "report") and exc.report else {}
        return StudyConflictError(
            message=str(exc),
            code="READINESS_FAILED",
            details=report_details,
        )

    if isinstance(exc, ExamSectionClosedError):
        return StudyConflictError(message=str(exc), code="SECTION_CLOSED")

    if isinstance(exc, ExamSectionSequenceError):
        return StudyConflictError(message=str(exc), code="INVALID_SECTION_SEQUENCE")

    if isinstance(exc, (ExamServiceError, SessionServiceError)):
        return StudyBadRequestError(message=str(exc), code="STUDY_SERVICE_ERROR")

    if isinstance(exc, PathTraversalError):
        return StudyBadRequestError(message="Path traversal detected.", code="PATH_TRAVERSAL")

    if isinstance(exc, MediaStorageError):
        return StudyMediaError(message=str(exc), code="MEDIA_MISSING", status_code=status.HTTP_410_GONE)

    if isinstance(exc, sqlite3.OperationalError):
        msg = str(exc).lower()
        if "locked" in msg or "busy" in msg:
            return StudyUnavailableError("Database is busy or temporarily locked.", code="DATABASE_BUSY")
        return StudyAPIError("DATABASE_ERROR", "A database operational error occurred.", status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    if isinstance(exc, ValueError):
        return StudyBadRequestError(message=str(exc), code="INVALID_REQUEST")

    logger.error("Uncaught exception in study API", exc_info=exc)
    return StudyAPIError(
        code="INTERNAL_SERVER_ERROR",
        message="An unexpected error occurred while processing the request.",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


async def study_api_error_handler(request: Request, exc: StudyAPIError) -> JSONResponse:
    """Format StudyAPIError into the structured JSON error contract."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


async def study_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Format 422 RequestValidationError for Study API routes."""
    # Convert error objects to serializable formats
    serialized_errors = []
    for err in exc.errors():
        clean_err = {
            "type": err.get("type", "value_error"),
            "loc": [str(x) for x in err.get("loc", [])],
            "msg": err.get("msg", ""),
        }
        serialized_errors.append(clean_err)

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "The request body or parameters failed validation.",
                "details": {"validation_errors": serialized_errors},
            }
        },
    )


async def study_http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Format Starlette/FastAPI HTTPException for Study API routes."""
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        410: "GONE",
        422: "VALIDATION_ERROR",
        500: "INTERNAL_SERVER_ERROR",
        503: "SERVICE_UNAVAILABLE",
    }
    code = code_map.get(exc.status_code, f"HTTP_{exc.status_code}")
    msg = exc.detail if isinstance(exc.detail, str) else "An HTTP error occurred."
    details = exc.detail if isinstance(exc.detail, dict) else {}
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": code,
                "message": msg,
                "details": details,
            }
        },
    )
