"""
Study Database Transaction Management & Unit of Work.
----------------------------------------------------
Provides robust, atomic, and nesting-aware transactional boundaries for the
Kiroku Study database (`study.db`).

Guarantees:
- Outer transactions use `BEGIN IMMEDIATE` to acquire write locks early,
  preventing SQLITE_BUSY deadlocks and race conditions.
- Nested transactions use SQLite `SAVEPOINT`s (`SAVEPOINT`, `RELEASE SAVEPOINT`,
  `ROLLBACK TO SAVEPOINT`), allowing granular sub-transactions that roll back
  cleanly on error without aborting outer transactional state unless unhandled.
- Fully compatible with `StudyDatabaseManager` explicit connections and WAL mode.
"""
from __future__ import annotations

from contextlib import contextmanager
import itertools
import logging
import sqlite3
import threading
from typing import Iterator

from app.services.operational_diagnostics import record_operational_failure

_savepoint_counter = itertools.count(1)
_counter_lock = threading.Lock()


def _get_savepoint_name() -> str:
    with _counter_lock:
        return f"uow_sp_{next(_savepoint_counter)}"


@contextmanager
def unit_of_work(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """
    Context manager establishing an atomic unit of work on the provided SQLite connection.

    - If the connection is already in an active transaction, a nested SAVEPOINT is created.
      On clean exit, the savepoint is released.
      On exception, changes within the savepoint are rolled back and the savepoint is released.
    - If the connection is not in a transaction, `BEGIN IMMEDIATE` is executed.
      On clean exit, the transaction is committed.
      On exception, the entire transaction is rolled back.
    """
    if conn.in_transaction:
        sp_name = _get_savepoint_name()
        conn.execute(f"SAVEPOINT {sp_name};")
        try:
            yield conn
            conn.execute(f"RELEASE SAVEPOINT {sp_name};")
        except Exception:
            try:
                conn.execute(f"ROLLBACK TO SAVEPOINT {sp_name};")
            except Exception as rb_exc:
                record_operational_failure("study.tx.savepoint_rollback", rb_exc, level=logging.DEBUG)
            try:
                conn.execute(f"RELEASE SAVEPOINT {sp_name};")
            except Exception as rel_exc:
                record_operational_failure("study.tx.savepoint_release", rel_exc, level=logging.DEBUG)
            raise
    else:
        conn.execute("BEGIN IMMEDIATE;")
        try:
            yield conn
            conn.execute("COMMIT;")
        except Exception:
            try:
                conn.execute("ROLLBACK;")
            except Exception as rb_exc:
                record_operational_failure("study.tx.rollback", rb_exc, level=logging.DEBUG)
            raise

