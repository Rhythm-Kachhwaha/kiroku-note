"""
Dependency Injection for Study HTTP API.
-----------------------------------------
Ensures each request safely acquires and releases its own SQLite connection,
and provides properly configured domain services.
"""
from __future__ import annotations

import sqlite3
from typing import Generator

from fastapi import Depends

from app.study.connection import StudyDatabaseManager, get_study_db_manager
from app.study.exam.analytics import ExamAnalyticsService
from app.study.exam.service import ExamSessionService
from app.study.media import MediaStore
from app.study.session.analytics import PracticeAnalyticsService
from app.study.session.service import PracticeSessionService


def get_study_db() -> Generator[sqlite3.Connection, None, None]:
    """
    FastAPI dependency yielding an isolated SQLite connection per request.
    Guarantees connection cleanup in finally block.
    """
    manager: StudyDatabaseManager = get_study_db_manager()
    conn = manager.get_connection()
    try:
        yield conn
    finally:
        manager._close_one(conn)


def get_media_store() -> MediaStore:
    """FastAPI dependency providing MediaStore."""
    return MediaStore()


def get_practice_service(
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> PracticeSessionService:
    """Dependency providing initialized PracticeSessionService."""
    return PracticeSessionService(conn=conn, media_store=media_store)


def get_practice_analytics_service(
    conn: sqlite3.Connection = Depends(get_study_db),
) -> PracticeAnalyticsService:
    """Dependency providing initialized PracticeAnalyticsService."""
    return PracticeAnalyticsService(conn=conn)


def get_exam_service(
    conn: sqlite3.Connection = Depends(get_study_db),
    media_store: MediaStore = Depends(get_media_store),
) -> ExamSessionService:
    """Dependency providing initialized ExamSessionService."""
    return ExamSessionService(conn=conn, media_store=media_store)


def get_exam_analytics_service(
    conn: sqlite3.Connection = Depends(get_study_db),
) -> ExamAnalyticsService:
    """Dependency providing initialized ExamAnalyticsService."""
    return ExamAnalyticsService(conn=conn)

