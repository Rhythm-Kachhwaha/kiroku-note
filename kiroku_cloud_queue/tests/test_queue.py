"""
test_queue.py -- Unit tests for the SQLite queue (queue_db.py).
No network access. No Kiroku dependency.
"""
import pytest
import tempfile
from pathlib import Path

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import queue_db as qdb


@pytest.fixture()
def db(tmp_path):
    p = tmp_path / "test_mcp.db"
    qdb.init_queue(p)
    return p


def test_enqueue_and_list(db):
    row_id = qdb.enqueue("映画", "えいが", "movie", "映画を見た", "Default", db_path=db)
    assert row_id > 0
    pending = qdb.list_pending(db_path=db)
    assert len(pending) == 1
    assert pending[0]["expression"] == "映画"
    assert pending[0]["reading"] == "えいが"
    assert pending[0]["status"] == "pending"


def test_mark_sent(db):
    row_id = qdb.enqueue("映画", "えいが", "movie", "", "Default", db_path=db)
    qdb.mark_sent(row_id, db_path=db)
    pending = qdb.list_pending(db_path=db)
    assert len(pending) == 0


def test_mark_failed_increments(db):
    row_id = qdb.enqueue("映画", "えいが", "movie", "", "Default", db_path=db)
    qdb.mark_failed(row_id, "connection refused", db_path=db)
    qdb.mark_failed(row_id, "still down", db_path=db)
    pending = qdb.list_pending(db_path=db)
    assert len(pending) == 1
    assert pending[0]["attempts"] == 2
    assert "still down" in pending[0]["error"]


def test_max_attempts_excluded(db):
    row_id = qdb.enqueue("映画", "えいが", "movie", "", "Default", db_path=db)
    # Exhaust attempts
    for _ in range(qdb.MAX_ATTEMPTS):
        qdb.mark_failed(row_id, "err", db_path=db)
    pending = qdb.list_pending(db_path=db)
    assert len(pending) == 0


def test_queue_stats(db):
    r1 = qdb.enqueue("映画", "えいが", "movie", "", "Default", db_path=db)
    r2 = qdb.enqueue("本", "ほん", "book", "", "Default", db_path=db)
    qdb.mark_sent(r1, db_path=db)
    stats = qdb.queue_stats(db_path=db)
    assert stats.get("sent") == 1
    assert stats.get("pending") == 1


def test_multiple_cards_fifo(db):
    ids = []
    for i in range(5):
        ids.append(qdb.enqueue(f"word{i}", f"よみ{i}", f"meaning{i}", "", "Default", db_path=db))
    pending = qdb.list_pending(db_path=db)
    returned_ids = [r["id"] for r in pending]
    assert returned_ids == sorted(returned_ids), "Should be FIFO order"


def test_init_idempotent(db):
    # Calling init_queue twice should not raise
    qdb.init_queue(db)
    qdb.init_queue(db)
    assert qdb.list_pending(db_path=db) == []


def test_mark_failed_sets_status_failed_on_max_attempts(db):
    row_id = qdb.enqueue("映画", "えいが", "movie", "", "Default", db_path=db)
    for _ in range(qdb.MAX_ATTEMPTS):
        qdb.mark_failed(row_id, "terminal error", db_path=db)

    stats = qdb.queue_stats(db_path=db)
    assert stats.get("failed") == 1
    assert stats.get("pending", 0) == 0


def test_enqueue_pending_deduplication(db):
    id1 = qdb.enqueue("約束", "やくそく", "promise", "約束を守る", "Default", db_path=db)
    id2 = qdb.enqueue("約束", "やくそく", "promise", "約束を守る", "Default", db_path=db)
    # When already pending, second enqueue returns the existing ID
    assert id1 == id2
    pending = qdb.list_pending(db_path=db)
    assert len(pending) == 1

