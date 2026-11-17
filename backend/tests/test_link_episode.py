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
    assert extract_series_title("Kiroku_titles_Sousou no Frieren.ass") == "Sousou no Frieren"
    assert extract_series_title("Kiroku titles Attack on Titan - 02.srt") == "Attack on Titan"
    assert extract_series_title("One Piece - 1085.vtt") == "One Piece"

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


def test_poster_proxy_and_caching(client, tmp_path, monkeypatch):
    """Test /api/link/poster caching, security validation, and disk serving."""
    # 1. Invalid domain rejected
    bad_resp = client.get("/api/link/poster", params={"url": "https://malicious.example.com/bad.png"})
    assert bad_resp.status_code == 403

    # 2. Invalid scheme rejected
    scheme_resp = client.get("/api/link/poster", params={"url": "ftp://anilist.co/file.png"})
    assert scheme_resp.status_code == 400

    # 3. Cached file served directly with Cache-Control headers
    from app.config import get_media_dir
    import hashlib
    test_url = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx5680-test.png"
    posters_dir = get_media_dir() / "posters"
    posters_dir.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(test_url.encode("utf-8")).hexdigest()[:24]
    fake_img = posters_dir / f"poster_{h}.png"
    fake_img.write_bytes(b"\x89PNG\r\n\x1a\nfakeimagebytes")

    resp = client.get("/api/link/poster", params={"url": test_url})
    assert resp.status_code == 200
    assert resp.content == b"\x89PNG\r\n\x1a\nfakeimagebytes"
    assert "public" in resp.headers.get("Cache-Control", "")


def test_series_grouping_unification_and_language_titles(test_db, client, monkeypatch):
    """Test that Japanese and English titles for the same anime unify into one series card with language toggle support."""
    from app.link.episode import group_episodes_by_series, save_episode_position

    # Mock AniList query to return identical canonical anilist_id and language titles
    def mock_metadata(series_name, media_type="anime", site="", episode_key=None):
        return {
            "poster_url": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx5680.png",
            "synopsis": "Light Music Club anime synopsis.",
            "title_display": "K-ON!",
            "raw_json": {
                "anilist_id": 5680,
                "episodes": 13,
                "duration": 24,
                "title_english": "K-ON!",
                "title_romaji": "K-ON!",
                "title_native": "けいおん!",
            }
        }

    monkeypatch.setattr("app.services.media_metadata.get_series_metadata", mock_metadata)

    # Save two records: one logged in English, one logged in Japanese for the same episode
    save_episode_position("k_on_ep1", 385520, title="K-ON! Episode 1", site="generic", series="K-ON!")
    save_episode_position("keion_ep1", 400626, title="けいおん! Episode 1", site="generic", series="けいおん!")

    # Verify grouping
    groups = group_episodes_by_series()
    assert len(groups) == 1
    k_on_group = groups[0]
    assert k_on_group["series"] == "K-ON!"
    assert k_on_group["title_english"] == "K-ON!"
    assert k_on_group["title_native"] == "けいおん!"
    assert k_on_group["total_episodes"] == 13
    assert len(k_on_group["episodes"]) == 1
    # Higher last_position_ms preserved
    assert k_on_group["episodes"][0]["last_position_ms"] == 400626


def test_episode_sync_and_inspect_endpoints(test_db, client):
    """Test background subtitle sync and rich episode inspection drawer endpoints."""
    # 1. Sync episode with cues
    sync_resp = client.post("/api/link/episodes/sync", json={
        "hash": "ep_sync_test_001",
        "title": "Sousou no Frieren - 05",
        "series": "Sousou no Frieren",
        "site": "crunchyroll",
        "media_type": "anime",
        "duration_ms": 1420000,
        "mined_words": ["魔法"],
        "cues": [
            {
                "i": 0,
                "s": 1.0,
                "e": 3.5,
                "text": "魔法使いのフリーレンです。",
                "tokens": [
                    {"surface": "魔法使い", "lemma": "魔法使い", "reading": "まほうつかい", "known": False, "jlpt_level": "N3", "status": "gap"},
                    {"surface": "の", "lemma": "の", "reading": "の", "known": True, "jlpt_level": "N5", "status": "known"},
                    {"surface": "フリーレン", "lemma": "フリーレン", "reading": "ふりーれん", "known": True, "jlpt_level": "Unranked", "status": "known"},
                    {"surface": "です", "lemma": "です", "reading": "です", "known": True, "jlpt_level": "N5", "status": "known"}
                ]
            },
            {
                "i": 1,
                "s": 4.0,
                "e": 7.0,
                "text": "冒険を続けましょう。",
                "tokens": [
                    {"surface": "冒険", "lemma": "冒険", "reading": "ぼうけん", "known": False, "jlpt_level": "N3", "status": "gap"},
                    {"surface": "を", "lemma": "を", "reading": "を", "known": True, "jlpt_level": "N5", "status": "known"},
                    {"surface": "続け", "lemma": "続ける", "reading": "つづける", "known": True, "jlpt_level": "N4", "status": "known"},
                    {"surface": "ましょう", "lemma": "ます", "reading": "ます", "known": True, "jlpt_level": "N5", "status": "known"}
                ]
            }
        ]
    })
    assert sync_resp.status_code == 200
    sync_data = sync_resp.json()
    assert sync_data["hash"] == "ep_sync_test_001"
    assert sync_data["series"] == "Sousou no Frieren"
    assert sync_data["mined"] == 1

    # 2. Inspect episode
    inspect_resp = client.get("/api/link/episodes/ep_sync_test_001/inspect")
    assert inspect_resp.status_code == 200
    inspect_data = inspect_resp.json()

    assert "difficulty" in inspect_data
    assert "overall_level" in inspect_data["difficulty"]
    assert "n3_pct" in inspect_data["difficulty"]
    assert inspect_data["difficulty"]["unique_words_count"] >= 2

    assert "missed_words" in inspect_data
    missed_lemmas = [mw["word"] for mw in inspect_data["missed_words"]]
    assert "魔法使い" in missed_lemmas or "冒険" in missed_lemmas

    assert "episode_record" in inspect_data
    assert inspect_data["episode_record"]["hash"] == "ep_sync_test_001"

    # 3. Delete episode
    del_resp = client.delete("/api/link/episodes/ep_sync_test_001")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"hash": "ep_sync_test_001", "deleted": True}

    # Verify no longer exists
    assert get_episode_record("ep_sync_test_001") is None
    get_after = client.get("/api/link/episodes/ep_sync_test_001")
    assert get_after.status_code == 404


def test_inspect_episode_no_persisted_cues_no_crash(client, test_db):
    """B1: Inspecting an episode with no cues must return 200 without NameError or borrowing other episode cues."""
    resp = client.get("/api/link/episodes/nonexistent_hash_123/inspect")
    assert resp.status_code == 200
    data = resp.json()
    assert data["episode_record"]["hash"] == "nonexistent_hash_123"
    assert data["missed_words"] == []
    assert data["grammar_points"] == []


def test_sync_episode_subtitles_preserves_playback_position(client, test_db):
    """B2: Subtitle sync must record duration_ms and minutes, without overwriting last_position_ms with duration_ms."""
    # First record user position at 120,000 ms (2 minutes in)
    pos_resp = client.post("/api/link/episodes/ep_sync_pos_test/position", json={
        "last_position_ms": 120000,
        "title": "Anime Ep 1",
    })
    assert pos_resp.status_code == 200

    # Now extension syncs full 24-minute subtitle duration (1,440,000 ms)
    sync_resp = client.post("/api/link/episodes/sync", json={
        "hash": "ep_sync_pos_test",
        "title": "Anime Ep 1",
        "duration_ms": 1440000,
        "cues": [{"i": 0, "s": 0.0, "e": 2.0, "text": "こんにちは"}]
    })
    assert sync_resp.status_code == 200
    data = sync_resp.json()
    assert data["duration_ms"] == 1440000
    assert data["minutes"] == 24.0
    # last_position_ms must remain 120000, NOT 1440000!
    assert data["last_position_ms"] == 120000


def test_inspect_episode_target_level_and_caching(client, test_db):
    """Test target learner level propagation, all_words breakdown, context sentence, and inspection caching."""
    # 1. Sync episode cues with image snapshot
    sync_resp = client.post("/api/link/episodes/sync", json={
        "hash": "ep_inspect_cache_test",
        "title": "K-ON! Ep 1",
        "duration_ms": 1440000,
        "cues": [
            {
                "i": 0,
                "s": 10.0,
                "e": 14.0,
                "text": "軽音部に入部するよ。",
                "image": "data:image/jpeg;base64,frame_snapshot_data",
                "tokens": [
                    {"surface": "軽音部", "lemma": "軽音部", "jlpt_level": "N2", "known": False, "status": "gap", "reading": "けいおんぶ", "meaning": "light music club"},
                    {"surface": "に", "lemma": "に", "jlpt_level": "N5", "known": True, "status": "known"},
                    {"surface": "入部", "lemma": "入部", "jlpt_level": "N3", "known": False, "status": "gap", "reading": "にゅうぶ", "meaning": "joining a club"},
                    {"surface": "する", "lemma": "する", "jlpt_level": "N5", "known": True, "status": "known"},
                    {"surface": "よ", "lemma": "よ", "jlpt_level": "N5", "known": True, "status": "known"},
                ]
            }
        ]
    })
    assert sync_resp.status_code == 200

    # 2. Inspect with learner_level=N3
    insp_resp = client.get("/api/link/episodes/ep_inspect_cache_test/inspect?learner_level=N3")
    assert insp_resp.status_code == 200
    data = insp_resp.json()
    assert data["target_learner_level"] == "N3"
    assert data["difficulty"]["target_learner_level"] == "N3"
    assert len(data["missed_words"]) > 0
    # Context sentence and image should be preserved
    first_gap = data["missed_words"][0]
    assert first_gap["context_sentence"] == "軽音部に入部するよ。"
    assert first_gap["image"] == "data:image/jpeg;base64,frame_snapshot_data"

    # all_words list exists
    assert "all_words" in data
    assert len(data["all_words"]) >= 2

    # 3. Subsequent inspect should hit cache
    cached_resp = client.get("/api/link/episodes/ep_inspect_cache_test/inspect?learner_level=N3")
    assert cached_resp.status_code == 200
    cached_data = cached_resp.json()
    assert cached_data["target_learner_level"] == "N3"
    assert cached_data["difficulty"]["overall_level"] == data["difficulty"]["overall_level"]



