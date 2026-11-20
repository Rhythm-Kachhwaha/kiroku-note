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


@pytest.fixture(autouse=True)
def guard_live_anki(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Ensure backend tests never connect to or mutate the user's live Anki instance."""
    from app.services.anki_connect import AnkiConnectService
    monkeypatch.setattr(AnkiConnectService, "is_available", lambda self: False)
    monkeypatch.setattr(AnkiConnectService, "is_connected", lambda self: (False, "Live Anki disabled during tests"))
    if not request.node.name.startswith("test_create_deck") and "anki_sync" not in request.node.name and not request.node.name.startswith("test_bug_a") and not request.node.name.startswith("test_kiroku_to_anki"):
        monkeypatch.setattr(AnkiConnectService, "create_deck", lambda self, deck_name: None)

