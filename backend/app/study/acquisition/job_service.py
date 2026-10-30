"""
Acquisition Job Persistence and Lifecycle Service.
--------------------------------------------------
Manages relational job tracking in study.db using Migration 0004 schema:
- Creates acquisition jobs and records discovered items
- Tracks item-level status (queued -> fetched -> parsed -> ingested -> failed)
- Tracks retries, errors, and cache locations
- Enables seamless job resumption after application restart
"""
from __future__ import annotations

from datetime import datetime, timezone
import sqlite3
from typing import Sequence

from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
)
from app.study.acquisition.models import (
    AcquisitionItemRecord,
    AcquisitionJobRecord,
    DiscoveredExercise,
    JobProgress,
)
from app.study.ulid import generate_ulid


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AcquisitionJobService:
    """Service managing acquisition job and item persistence in SQLite study.db."""

    @staticmethod
    def create_job(
        conn: sqlite3.Connection,
        source_name: str,
        target_category_url: str,
        jlpt_level: str,
        section_category: str,
    ) -> AcquisitionJobRecord:
        """Create a new acquisition job record."""
        job_id = generate_ulid()
        now = _utc_now()

        conn.execute(
            """
            INSERT INTO acquisition_job (
                id, source_name, target_category_url, jlpt_level, section_category,
                status, total_discovered, total_acquired, total_failed,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?);
            """,
            (
                job_id,
                source_name,
                target_category_url,
                jlpt_level.upper(),
                section_category.lower(),
                AcquisitionJobStatus.PENDING.value,
                now,
                now,
            ),
        )

        return AcquisitionJobRecord(
            id=job_id,
            source_name=source_name,
            target_category_url=target_category_url,
            jlpt_level=jlpt_level.upper(),
            section_category=section_category.lower(),
            status=AcquisitionJobStatus.PENDING,
            total_discovered=0,
            total_acquired=0,
            total_failed=0,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def add_job_items(
        conn: sqlite3.Connection,
        job_id: str,
        discovered: Sequence[DiscoveredExercise],
    ) -> int:
        """
        Record discovered exercise URLs for a job.
        Skips URLs already attached to the same job.
        Updates job's total_discovered count.
        """
        now = _utc_now()
        added_count = 0

        for item in discovered:
            item_id = generate_ulid()
            try:
                conn.execute(
                    """
                    INSERT INTO acquisition_job_item (
                        id, job_id, exercise_url, exercise_title, ordinal,
                        status, retry_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?);
                    """,
                    (
                        item_id,
                        job_id,
                        item.url,
                        item.title,
                        item.ordinal,
                        AcquisitionItemStatus.QUEUED.value,
                        now,
                    ),
                )
                added_count += 1
            except sqlite3.IntegrityError:
                # URL already exists for this job
                continue

        # Update total_discovered
        conn.execute(
            """
            UPDATE acquisition_job
            SET total_discovered = (SELECT COUNT(*) FROM acquisition_job_item WHERE job_id = ?),
                updated_at = ?
            WHERE id = ?;
            """,
            (job_id, now, job_id),
        )

        return added_count

    @staticmethod
    def update_job_status(
        conn: sqlite3.Connection,
        job_id: str,
        status: AcquisitionJobStatus,
        error_summary: str | None = None,
    ) -> None:
        """Update overall status of an acquisition job."""
        now = _utc_now()
        conn.execute(
            """
            UPDATE acquisition_job
            SET status = ?, error_summary = coalesce(?, error_summary), updated_at = ?
            WHERE id = ?;
            """,
            (status.value, error_summary, now, job_id),
        )

    @staticmethod
    def record_item_success(
        conn: sqlite3.Connection,
        item_id: str,
        status: AcquisitionItemStatus = AcquisitionItemStatus.INGESTED,
        cache_path: str | None = None,
    ) -> None:
        """Record successful processing of an individual exercise item."""
        now = _utc_now()
        conn.execute(
            """
            UPDATE acquisition_job_item
            SET status = ?, cache_path = coalesce(?, cache_path), error_message = NULL
            WHERE id = ?;
            """,
            (status.value, cache_path, item_id),
        )

        # Update parent job counts
        cursor = conn.execute("SELECT job_id FROM acquisition_job_item WHERE id = ?;", (item_id,))
        row = cursor.fetchone()
        if row:
            job_id = row["job_id"] if isinstance(row, sqlite3.Row) else row[0]
            conn.execute(
                """
                UPDATE acquisition_job
                SET total_acquired = (
                    SELECT COUNT(*) FROM acquisition_job_item
                    WHERE job_id = ? AND status IN ('fetched', 'parsed', 'ingested')
                ),
                updated_at = ?
                WHERE id = ?;
                """,
                (job_id, now, job_id),
            )

    @staticmethod
    def record_item_failure(
        conn: sqlite3.Connection,
        item_id: str,
        error_message: str,
    ) -> None:
        """Record failure of an individual exercise item, incrementing retry count."""
        now = _utc_now()
        conn.execute(
            """
            UPDATE acquisition_job_item
            SET status = ?, error_message = ?, retry_count = retry_count + 1
            WHERE id = ?;
            """,
            (AcquisitionItemStatus.FAILED.value, error_message, item_id),
        )

        cursor = conn.execute("SELECT job_id FROM acquisition_job_item WHERE id = ?;", (item_id,))
        row = cursor.fetchone()
        if row:
            job_id = row["job_id"] if isinstance(row, sqlite3.Row) else row[0]
            conn.execute(
                """
                UPDATE acquisition_job
                SET total_failed = (
                    SELECT COUNT(*) FROM acquisition_job_item
                    WHERE job_id = ? AND status = 'failed'
                ),
                updated_at = ?
                WHERE id = ?;
                """,
                (job_id, now, job_id),
            )

    @staticmethod
    def get_job(conn: sqlite3.Connection, job_id: str) -> AcquisitionJobRecord | None:
        """Fetch job record by ID."""
        cursor = conn.execute("SELECT * FROM acquisition_job WHERE id = ?;", (job_id,))
        row = cursor.fetchone()
        if not row:
            return None

        return AcquisitionJobRecord(
            id=row["id"],
            source_name=row["source_name"],
            target_category_url=row["target_category_url"],
            jlpt_level=row["jlpt_level"],
            section_category=row["section_category"],
            status=AcquisitionJobStatus(row["status"]),
            total_discovered=row["total_discovered"],
            total_acquired=row["total_acquired"],
            total_failed=row["total_failed"],
            error_summary=row["error_summary"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def get_job_items(
        conn: sqlite3.Connection,
        job_id: str,
        status: AcquisitionItemStatus | None = None,
    ) -> list[AcquisitionItemRecord]:
        """Fetch item records for a job, optionally filtered by status."""
        if status is not None:
            cursor = conn.execute(
                "SELECT * FROM acquisition_job_item WHERE job_id = ? AND status = ? ORDER BY ordinal ASC;",
                (job_id, status.value),
            )
        else:
            cursor = conn.execute(
                "SELECT * FROM acquisition_job_item WHERE job_id = ? ORDER BY ordinal ASC;",
                (job_id,),
            )

        items: list[AcquisitionItemRecord] = []
        for r in cursor.fetchall():
            items.append(
                AcquisitionItemRecord(
                    id=r["id"],
                    job_id=r["job_id"],
                    exercise_url=r["exercise_url"],
                    exercise_title=r["exercise_title"],
                    ordinal=r["ordinal"],
                    status=AcquisitionItemStatus(r["status"]),
                    cache_path=r["cache_path"],
                    retry_count=r["retry_count"],
                    error_message=r["error_message"],
                    created_at=r["created_at"],
                )
            )
        return items

    @staticmethod
    def get_job_progress(conn: sqlite3.Connection, job_id: str) -> JobProgress | None:
        """Get aggregate progress and item details for a job."""
        job = AcquisitionJobService.get_job(conn, job_id)
        if not job:
            return None

        items = AcquisitionJobService.get_job_items(conn, job_id)
        return JobProgress(
            job_id=job.id,
            status=job.status,
            total_discovered=job.total_discovered,
            total_acquired=job.total_acquired,
            total_failed=job.total_failed,
            items=items,
        )

    @staticmethod
    def reset_failed_items_for_retry(conn: sqlite3.Connection, job_id: str) -> int:
        """Reset failed items back to 'queued' so they can be retried."""
        now = _utc_now()
        cursor = conn.execute(
            """
            UPDATE acquisition_job_item
            SET status = 'queued', error_message = NULL
            WHERE job_id = ? AND status = 'failed';
            """,
            (job_id,),
        )
        reset_count = cursor.rowcount

        conn.execute(
            """
            UPDATE acquisition_job
            SET status = 'crawling',
                total_failed = (SELECT COUNT(*) FROM acquisition_job_item WHERE job_id = ? AND status = 'failed'),
                updated_at = ?
            WHERE id = ?;
            """,
            (job_id, now, job_id),
        )

        return reset_count

