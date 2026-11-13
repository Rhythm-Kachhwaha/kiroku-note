"""Tests for Curated Transitive <-> Intransitive Verb Pairs Service and Gap Breakdown API."""
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.vocab_practice.transitive_pairs import (
    CANONICAL_TRANSITIVE_PAIRS,
    get_transitive_pairs,
    get_transitive_pairs_summary,
)
from app.services.vocab_practice.categories import get_gap_breakdown_by_category


@pytest.fixture
def test_db(tmp_path: Path) -> Path:
    db_file = tmp_path / "test_transitive.sqlite"
    init_db(db_file)
    with sqlite3.connect(str(db_file)) as conn:
        # Insert sample word state: 開ける is known, 開く is unseen -> half_known
        conn.execute(
            "INSERT INTO word_states (expression, reading, state, updated_at) VALUES (?, ?, ?, ?)",
            ("開ける", "あける", "known", "2026-11-13T10:00:00Z"),
        )
        # Insert sample card: 落とす is mined
        conn.execute(
            """
            INSERT INTO cards (expression, reading, meaning, jlpt_level, source_type, normalized_expression, normalized_reading, normalized_deck_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("落とす", "おとす", "to drop", "N4", "quick_add", "落とす", "おとす", "default", "2026-11-13T10:00:00Z", "2026-11-13T10:00:00Z"),
        )
        conn.commit()
    return db_file


def test_canonical_pairs_structure():
    assert len(CANONICAL_TRANSITIVE_PAIRS) >= 30
    for p in CANONICAL_TRANSITIVE_PAIRS:
        assert "id" in p
        assert "level" in p
        assert "pattern" in p
        assert "concept" in p
        assert "vt" in p
        assert "vi" in p
        assert p["vt"]["particle"] == "を"
        assert p["vi"]["particle"] == "が"
        assert len(p["vt"]["example_hint"]) > 0
        assert len(p["vi"]["example_hint"]) > 0


def test_get_transitive_pairs_mastery_resolution(test_db: Path):
    pairs = get_transitive_pairs(db_path=test_db)
    assert len(pairs) > 0

    # Find pair-001 (開ける / 開く)
    pair_001 = next((p for p in pairs if p.id == "pair-001"), None)
    assert pair_001 is not None
    assert pair_001.transitive.expression == "開ける"
    assert pair_001.transitive.state == "known"
    assert pair_001.intransitive.expression == "開く"
    assert pair_001.intransitive.state == "unseen"
    assert pair_001.pair_mastery == "half_known"

    # Find pair-008 (落とす / 落ちる)
    pair_008 = next((p for p in pairs if p.id == "pair-008"), None)
    assert pair_008 is not None
    assert pair_008.transitive.expression == "落とす"
    assert pair_008.transitive.is_mined is True
    assert pair_008.pair_mastery == "learning"


def test_transitive_pairs_filters(test_db: Path):
    n5_pairs = get_transitive_pairs(level="N5", db_path=test_db)
    assert all(p.level == "N5" for p in n5_pairs)
    assert len(n5_pairs) >= 7

    half_known_pairs = get_transitive_pairs(mastery_filter="half_known", db_path=test_db)
    assert any(p.id == "pair-001" for p in half_known_pairs)


def test_transitive_pairs_summary(test_db: Path):
    summary = get_transitive_pairs_summary(db_path=test_db)
    assert summary.total_pairs >= 30
    assert summary.half_known >= 1
    assert "N5" in summary.level_counts
    assert "N4" in summary.level_counts


def test_transitive_pairs_api_endpoint(monkeypatch, test_db: Path):
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    client = TestClient(app)
    response = client.get("/api/vocab-practice/transitive-pairs")
    assert response.status_code == 200
    data = response.json()
    assert "pairs" in data
    assert "summary" in data
    assert data["total"] == len(data["pairs"])


def test_gap_breakdown_by_category():
    breakdown = get_gap_breakdown_by_category(level="N4", limit_per_category=10)
    assert breakdown["level"] == "N4"
    assert "counts" in breakdown
    assert "breakdown" in breakdown
    for cat in ("adverb", "noun", "katakana_loanword", "verb", "adjective"):
        assert cat in breakdown["breakdown"]


def test_gap_breakdown_api_endpoint():
    client = TestClient(app)
    response = client.get("/api/vocab-practice/gap-breakdown?level=N4&limit_per_category=15")
    assert response.status_code == 200
    data = response.json()
    assert data["level"] == "N4"
    assert "counts" in data
    assert "breakdown" in data
