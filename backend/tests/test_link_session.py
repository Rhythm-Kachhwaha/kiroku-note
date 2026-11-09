"""
Tests for Link Session Stat additive schema and position tracking (Group 5).
"""
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import get_db_connection
from app.link.session import init_session_stat_db, list_session_stats, save_session_stat
from app.link.episode import init_link_episode_db, save_episode_position, get_episode_record
from app.main import app


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    """Isolated temporary SQLite database for testing."""
    db_file = tmp_path / "test_session_stat.sqlite"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_file))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_file))
    conn = sqlite3.connect(str(db_file))
    init_session_stat_db(conn)
    init_link_episode_db(conn)
    conn.close()
    return db_file


@pytest.fixture
def client():
    return TestClient(app)


def test_session_stat_additive_columns_migration(test_db):
    """Verify that series and episode_key columns are present and migration handles existing tables."""
    conn = sqlite3.connect(str(test_db))
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(link_session_stat)")
    cols = [r[1] for r in cur.fetchall()]
    assert "series" in cols
    assert "episode_key" in cols
    conn.close()

    # Save stat with additive fields
    stat = save_session_stat(
        session_id="ses_test_01",
        site="crunchyroll",
        title="Frieren: Beyond Journey's End - Episode 1",
        watch_seconds=120.5,
        lines_seen=15,
        words_mined=3,
        gap_words_seen=5,
        series="Frieren: Beyond Journey's End",
        episode_key="crunchyroll/frieren/ep1",
    )
    assert stat["series"] == "Frieren: Beyond Journey's End"
    assert stat["episode_key"] == "crunchyroll/frieren/ep1"

    # List stats includes additive fields
    stats = list_session_stats(limit=5)
    assert len(stats) >= 1
    found = [s for s in stats if s["session_id"] == "ses_test_01"][0]
    assert found["series"] == "Frieren: Beyond Journey's End"
    assert found["episode_key"] == "crunchyroll/frieren/ep1"


def test_api_link_sessions_endpoint(client: TestClient, test_db):
    """Test POST /api/link/sessions and GET /api/link/sessions with additive fields."""
    payload = {
        "session_id": "ses_api_test",
        "site": "youtube",
        "title": "Japanese Comprehensible Input Ep 4",
        "watch_seconds": 300.0,
        "lines_seen": 25,
        "words_mined": 4,
        "gap_words_seen": 6,
        "series": "Japanese Comprehensible Input",
        "episode_key": "youtube/dQw4w9WgXcQ/ep4",
    }
    resp = client.post("/api/link/sessions", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == "ses_api_test"
    assert data["series"] == "Japanese Comprehensible Input"
    assert data["episode_key"] == "youtube/dQw4w9WgXcQ/ep4"

    get_resp = client.get("/api/link/sessions?limit=10")
    assert get_resp.status_code == 200
    records = get_resp.json()
    assert any(r["session_id"] == "ses_api_test" for r in records)


def test_api_episode_position_with_episode_key(client: TestClient, test_db):
    """Test POST /api/link/episodes/{hash}/position records episode_key."""
    cue_hash = "hash_anime_001"
    pos_payload = {
        "last_position_ms": 75000,
        "title": "Delicious in Dungeon Ep 2",
        "site": "netflix",
        "series": "Delicious in Dungeon",
        "episode_key": "netflix/80000000/s1e2",
    }
    resp = client.post(f"/api/link/episodes/{cue_hash}/position", json=pos_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["hash"] == cue_hash
    assert data["last_position_ms"] == 75000
    assert data["episode_key"] == "netflix/80000000/s1e2"
