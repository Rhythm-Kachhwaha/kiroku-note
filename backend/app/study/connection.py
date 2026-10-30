"""
Study Database Connection Management & Transaction Handling.
------------------------------------------------------------
Dedicated SQLite manager for the Kiroku Study database (`study.db`).
Strictly separate from the vocabulary mining database (`kiroku.db`).

Guarantees:
- `isolation_level=None` (explicit transactions only)
- `row_factory=sqlite3.Row`
- `PRAGMA foreign_keys=ON`
- `PRAGMA journal_mode=WAL` (verifies returned mode is 'wal')
- `PRAGMA busy_timeout=10000`
- `PRAGMA recursive_triggers=ON`
- `read()` context manager
- `write_tx()` context manager with `BEGIN IMMEDIATE`, auto-commit, and rollback on error
- Connection tracking and `close_all()` for WAL-safe backup & restore routines
"""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import threading
from typing import Iterator, Set
import weakref

from app.config import get_study_db_path
from app.study.tx import unit_of_work


class StudyDatabaseError(Exception):
    """Base error for study database operations."""
    pass


class StudyDatabaseManager:
    """Manages SQLite connections and explicit transactions for study.db."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self._db_path = Path(db_path) if db_path is not None else get_study_db_path()
        self._lock = threading.Lock()
        self._open_connections: set[sqlite3.Connection] = set()

    @property
    def db_path(self) -> Path:
        return self._db_path

    def get_connection(self) -> sqlite3.Connection:
        """Create and configure a new SQLite connection satisfying all engine contracts."""
        if str(self._db_path) != ":memory:":
            self._db_path.parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(
            str(self._db_path),
            isolation_level=None,
            timeout=10.0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row

        # Foreign keys MUST be enabled per connection
        conn.execute("PRAGMA foreign_keys = ON;")

        # Enable WAL mode and verify engine confirmation
        wal_row = conn.execute("PRAGMA journal_mode = WAL;").fetchone()
        if wal_row is None:
            conn.close()
            raise StudyDatabaseError("PRAGMA journal_mode = WAL returned no result.")

        current_mode = str(wal_row[0]).strip().lower()
        if str(self._db_path) != ":memory:" and current_mode != "wal":
            conn.close()
            raise StudyDatabaseError(
                f"Failed to activate WAL mode on study database ({self._db_path}). "
                f"Engine returned '{current_mode}'."
            )

        # Busy timeout & recursive triggers
        conn.execute("PRAGMA busy_timeout = 10000;")
        conn.execute("PRAGMA recursive_triggers = ON;")

        with self._lock:
            self._open_connections.add(conn)

        return conn

    @contextmanager
    def read(self, conn: sqlite3.Connection | None = None) -> Iterator[sqlite3.Connection]:
        """
        Provide a connection for read-only operations.

        If an active connection is passed, it is reused without closing.
        Otherwise, a dedicated connection is provided.
        """
        if conn is not None:
            yield conn
            return

        c = self.get_connection()
        try:
            yield c
        finally:
            self._close_one(c)

    @contextmanager
    def write_tx(self, conn: sqlite3.Connection | None = None) -> Iterator[sqlite3.Connection]:
        """
        Provide an explicit transactional context with BEGIN IMMEDIATE.

        Commits on success; rolls back on any exception.
        Never allows deferred read-then-write upgrades.
        """
        managed = False
        if conn is None:
            c = self.get_connection()
            managed = True
        else:
            c = conn

        try:
            with unit_of_work(c):
                yield c
        finally:
            if managed:
                self._close_one(c)

    def _close_one(self, conn: sqlite3.Connection) -> None:
        """Safely close and untrack a single connection."""
        with self._lock:
            self._open_connections.discard(conn)
        try:
            conn.close()
        except Exception:
            pass

    def close_all(self) -> int:
        """
        Close all tracked open connections to study.db.

        Required before executing database restores or file replacements.
        Returns the count of closed connections.
        """
        with self._lock:
            all_conns = list(self._open_connections)
            self._open_connections.clear()

        closed_count = 0
        for conn in all_conns:
            try:
                conn.close()
                closed_count += 1
            except Exception:
                pass
        return closed_count


# Global singleton manager instance (pointing to default study.db path)
_global_study_db_manager: StudyDatabaseManager | None = None
_manager_lock = threading.Lock()


def get_study_db_manager(db_path: Path | str | None = None) -> StudyDatabaseManager:
    """Retrieve or create the study database manager."""
    global _global_study_db_manager
    if db_path is not None:
        return StudyDatabaseManager(db_path)
    with _manager_lock:
        if _global_study_db_manager is None:
            _global_study_db_manager = StudyDatabaseManager()
        return _global_study_db_manager


def reset_study_db_manager() -> None:
    """Reset the global study database manager (primarily for test teardown)."""
    global _global_study_db_manager
    with _manager_lock:
        if _global_study_db_manager is not None:
            _global_study_db_manager.close_all()
            _global_study_db_manager = None

