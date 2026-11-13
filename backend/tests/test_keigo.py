"""Tests for Curated Japanese Keigo (Honorifics) Service and API."""
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.vocab_practice.keigo import (
    CANONICAL_KEIGO_TRIOS,
    get_keigo_entries,
    get_keigo_summary,
)


@pytest.fixture
def test_db(tmp_path: Path) -> Path:
    db_file = tmp_path / "test_keigo.sqlite"
    init_db(db_file)
    with sqlite3.connect(str(db_file)) as conn:
        # Insert sample word state: いらっしゃる is known
        conn.execute(
            "INSERT INTO word_states (expression, reading, state, updated_at) VALUES (?, ?, ?, ?)",
            ("いらっしゃる", "いらっしゃる", "known", "2026-11-13T10:00:00Z"),
        )
        # Insert sample card: 参る is mined
        conn.execute(
            """
            INSERT INTO cards (expression, reading, meaning, jlpt_level, source_type, normalized_expression, normalized_reading, normalized_deck_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("参る", "まいる", "to go / come (humble)", "N4", "quick_add", "参る", "まいる", "default", "2026-11-13T10:00:00Z", "2026-11-13T10:00:00Z"),
        )
        conn.commit()
    return db_file


def test_canonical_keigo_structure():
    assert len(CANONICAL_KEIGO_TRIOS) >= 15
    for item in CANONICAL_KEIGO_TRIOS:
        assert "id" in item
        assert "base_verb" in item
        assert "base_reading" in item
        assert "concept" in item
        assert "level" in item
        assert "sonkeigo" in item
        assert "kenjougo" in item
        assert item["sonkeigo"]["expression"]
        assert item["kenjougo"]["expression"]
        assert item["sonkeigo"]["meaning"]
        assert item["kenjougo"]["meaning"]


def test_get_keigo_entries_mastery(test_db: Path):
    entries = get_keigo_entries(db_path=test_db)
    assert len(entries) >= 15
    # First item (keigo-001) has いらっしゃる (known) and 参る (mined) -> learning
    trio_1 = next(e for e in entries if e.id == "keigo-001")
    assert trio_1.sonkeigo.state == "known"
    assert trio_1.kenjougo.is_mined is True
    assert trio_1.mastery_status == "learning"


def test_get_keigo_filters():
    n4_entries = get_keigo_entries(level="N4")
    assert len(n4_entries) > 0
    assert all(e.level == "N4" for e in n4_entries)

    son_filtered = get_keigo_entries(keigo_type="sonkeigo")
    assert len(son_filtered) > 0


def test_get_keigo_summary():
    summary = get_keigo_summary()
    assert summary.total_trios >= 15
    assert summary.sonkeigo_count >= 15
    assert summary.kenjougo_count >= 15


def test_keigo_api_endpoint(monkeypatch: pytest.MonkeyPatch, test_db: Path):
    from app.db import connection

    monkeypatch.setattr(connection, "get_db_path", lambda: test_db)
    client = TestClient(app)

    res = client.get("/api/vocab-practice/keigo")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total" in data
    assert "summary" in data
    assert data["total"] >= 15
    assert len(data["items"]) >= 15

