"""
Global Pytest Fixtures for Backend Tests.
Ensures that all tests execute against an isolated temporary database,
completely protecting the user's production/live database from test data leakage.
"""
from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import pytest

from app.db.connection import init_db


@pytest.fixture(autouse=True)
def isolate_test_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """
    Autouse fixture that runs before every test.
    Overrides KIROKU_DB_PATH and ANKIMINER_DB_PATH to an isolated tmp_path database
    and creates the standard schema.
    """
    db_file = tmp_path / "kiroku_test.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_file))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_file))
    monkeypatch.setenv("KIROKU_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ANKIMINER_DATA_DIR", str(tmp_path / "data"))
    
    # Initialize standard database tables
    init_db(db_file)
    return db_file
