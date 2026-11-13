"""
Tests for Episode Primer & Recap (Slice 44).
"""
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import get_db_connection
from app.link.episode import (
    EpisodeService,
    get_episode_record,
    init_link_episode_db,
    list_episode_records,
    save_episode_record,
)
from app.main import app


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    """Isolated temporary SQLite database for testing."""
    db_file = tmp_path / "test_episode.sqlite"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_file))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_file))
    conn = sqlite3.connect(str(db_file))
    init_link_episode_db(conn)
    conn.close()
    return db_file


@pytest.fixture
def client():
    return TestClient(app)


def test_link_episode_persistence(test_db):
    """Test saving, retrieving, and listing episode records."""
    rec = save_episode_record(
        hash_val="ep_001",
        title="Test Episode 1",
        site="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        known_pct=85.5,
        mined=4,
        minutes=12.0,
    )
    assert rec["hash"] == "ep_001"
    assert rec["known_pct"] == 85.5
    assert rec["mined"] == 4
    assert rec["media_type"] == "youtube"

    fetched = get_episode_record("ep_001")
    assert fetched is not None
    assert fetched["title"] == "Test Episode 1"
    assert fetched["site"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert fetched["known_pct"] == 85.5
    assert fetched["mined"] == 4
    assert fetched["minutes"] == 12.0
    assert fetched["media_type"] == "youtube"

    # Upsert test
    save_episode_record(
        hash_val="ep_001",
        title="Updated Title",
        site="youtube",
        known_pct=92.0,
        mined=7,
        minutes=15.0,
    )
    updated = get_episode_record("ep_001")
    assert updated["title"] == "Updated Title"
    assert updated["known_pct"] == 92.0
    assert updated["mined"] == 7

    records = list_episode_records()
    assert len(records) >= 1
    assert any(r["hash"] == "ep_001" for r in records)


def test_generate_primer_logic(test_db):
    """Test gap word identification, level filter, and quiz generation."""
    service = EpisodeService()
    cues = [
        {
            "i": 0,
            "text": "猫が好きです。",
            "tokens": [
                {"surface": "猫", "lemma": "猫", "reading": "ねこ", "known": False, "jlpt_level": "N5", "status": "gap"},
                {"surface": "が", "lemma": "が", "reading": "が", "known": True, "jlpt_level": "N5", "status": "known"},
                {"surface": "好き", "lemma": "好き", "reading": "すき", "known": False, "jlpt_level": "N5", "status": "gap"},
                {"surface": "です", "lemma": "です", "reading": "です", "known": True, "jlpt_level": "N5", "status": "known"},
            ]
        },
        {
            "i": 1,
            "text": "猫はとても可愛いです。",
            "tokens": [
                {"surface": "猫", "lemma": "猫", "reading": "ねこ", "known": False, "jlpt_level": "N5", "status": "gap"},
                {"surface": "は", "lemma": "は", "reading": "は", "known": True, "jlpt_level": "N5", "status": "known"},
                {"surface": "可愛い", "lemma": "可愛い", "reading": "かわいい", "known": False, "jlpt_level": "N4", "status": "gap"},
            ]
        }
    ]

    primer = service.generate_primer(cues=cues, cue_hash="h123", learner_level="N4")
    assert primer["hash"] == "h123"
    assert len(primer["gap_words"]) > 0

    # 猫 appeared twice, should be highest frequency
    gap_lemmas = [gw["word"] for gw in primer["gap_words"]]
    assert "猫" in gap_lemmas
    neko = next(gw for gw in primer["gap_words"] if gw["word"] == "猫")
    assert neko["frequency"] == 2

    # Quiz should be generated
    quiz = primer["quiz"]
    assert len(quiz) > 0
    q1 = quiz[0]
    assert "options" in q1
    assert len(q1["options"]) == 4
    assert 0 <= q1["correct_index"] < 4


def test_generate_recap_and_persistence(test_db):
    """Test recap metrics calculation and episode table persistence."""
    service = EpisodeService()
    cues = [
        {
            "i": 0,
            "text": "猫が好きです。",
            "tokens": [
                {"surface": "猫", "lemma": "猫", "known": False, "status": "gap"},
                {"surface": "が", "lemma": "が", "known": True, "status": "known"},
                {"surface": "好き", "lemma": "好き", "known": False, "status": "gap"},
                {"surface": "です", "lemma": "です", "known": True, "status": "known"},
            ]
        }
    ]

    recap = service.generate_recap(
        cue_hash="recap_ep",
        cues=cues,
        mined_words=["猫"],
        minutes=10.5,
        title="Anime Ep 1",
        site="local",
    )

    assert recap["hash"] == "recap_ep"
    assert recap["lines_watched"] == 1
    assert recap["known_pct_after"] > recap["known_pct_before"]
    assert "猫" in recap["words_mined"]
    assert "好き" in recap["gap_words_unseen"]
    assert "猫" not in recap["gap_words_unseen"]
    assert "#/study" in recap["review_link"]

    # Verify persisted in DB
    persisted = get_episode_record("recap_ep")
    assert persisted is not None
    assert persisted["title"] == "Anime Ep 1"
    assert persisted["mined"] == 1
    assert persisted["minutes"] == 10.5


def test_api_endpoints(test_db, client):
    """Test FastAPI /api/link/primer and /api/link/recap endpoints."""
    # 1. Primer endpoint
    primer_resp = client.post("/api/link/primer", json={
        "hash": "api_ep_1",
        "cues": [
            {
                "i": 0,
                "text": "犬が走る。",
                "tokens": [
                    {"surface": "犬", "lemma": "犬", "reading": "いぬ", "known": False, "jlpt_level": "N5", "status": "gap"},
                    {"surface": "が", "lemma": "が", "reading": "が", "known": True, "jlpt_level": "N5", "status": "known"},
                    {"surface": "走る", "lemma": "走る", "reading": "はしる", "known": True, "jlpt_level": "N5", "status": "known"}
                ]
            }
        ],
        "learner_level": "N4"
    })
    assert primer_resp.status_code == 200
    primer_data = primer_resp.json()
    assert primer_data["hash"] == "api_ep_1"
    assert len(primer_data["gap_words"]) >= 1
    assert primer_data["gap_words"][0]["word"] == "犬"

    # 2. Recap endpoint
    recap_resp = client.post("/api/link/recap", json={
        "hash": "api_ep_1",
        "title": "Dog Running",
        "site": "local",
        "mined_words": ["犬"],
        "minutes": 5.0,
        "cues": [
            {
                "i": 0,
                "text": "犬が走る。",
                "tokens": [
                    {"surface": "犬", "lemma": "犬", "known": False, "status": "gap"},
                    {"surface": "が", "lemma": "が", "known": True, "status": "known"},
                    {"surface": "走る", "lemma": "走る", "known": True, "status": "known"}
                ]
            }
        ]
    })
    assert recap_resp.status_code == 200
    recap_data = recap_resp.json()
    assert recap_data["words_mined"] == ["犬"]
    assert recap_data["known_pct_after"] == 100.0

    # 3. Get episode record
    ep_resp = client.get("/api/link/episodes/api_ep_1")
    assert ep_resp.status_code == 200
    ep_data = ep_resp.json()
    assert ep_data["title"] == "Dog Running"
    assert ep_data["mined"] == 1


def test_episode_position_and_series_grouping(test_db, client):
    """Test last_position_ms persistence, series extraction, and grouped series endpoint."""
    from app.link.episode import extract_series_title, save_episode_position

    # 1. Test series extraction
    assert extract_series_title("Frieren: Beyond Journey's End - Episode 04") == "Frieren: Beyond Journey's End"
    assert extract_series_title("One Piece - 1085 [1080p]") == "One Piece"
    assert extract_series_title("Spy x Family S01E03") == "Spy x Family"

    # 2. Save position via helper
    rec = save_episode_position("pos_ep_1", 760000, title="Sousou no Frieren Ep. 01", site="crunchyroll")
    assert rec["last_position_ms"] == 760000
    assert rec["series"] == "Sousou no Frieren"

    # 3. Save position via API
    resp = client.post("/api/link/episodes/pos_ep_2/position", json={
        "last_position_ms": 320000,
        "title": "Sousou no Frieren Ep. 02",
        "site": "crunchyroll"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["last_position_ms"] == 320000
    assert data["series"] == "Sousou no Frieren"

    # 4. Check get single episode
    single_resp = client.get("/api/link/episodes/pos_ep_2")
    assert single_resp.status_code == 200
    assert single_resp.json()["last_position_ms"] == 320000

    # 5. Check series grouping endpoint
    series_resp = client.get("/api/link/series")
    assert series_resp.status_code == 200
    series_groups = series_resp.json()
    assert len(series_groups) >= 1
    frieren_group = next((g for g in series_groups if g["series"] == "Sousou no Frieren"), None)
    assert frieren_group is not None
    assert len(frieren_group["episodes"]) == 2

