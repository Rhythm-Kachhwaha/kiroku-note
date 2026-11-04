import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_get_kanji_strokes_success():
    response = client.get("/api/kanji/strokes/静")
    assert response.status_code == 200
    assert "image/svg+xml" in response.headers.get("content-type", "")
    assert "<svg" in response.text


def test_get_kanji_strokes_not_found():
    response = client.get("/api/kanji/strokes/XYZ")
    assert response.status_code == 404


def test_get_kanji_details_success():
    response = client.get("/api/kanji/details/静")
    assert response.status_code == 200
    data = response.json()
    assert data["character"] == "静"
    assert data["level"] == "N3"
    assert data["strokes"] == 14
    assert "セイ" in data["onyomi"] or "ジョウ" in data["onyomi"]
    assert "quiet" in data["meanings"]


def test_get_kanji_details_not_found():
    response = client.get("/api/kanji/details/A")
    assert response.status_code == 404


def test_get_kanji_compounds():
    response = client.get("/api/kanji/compounds/静?limit=5")
    assert response.status_code == 200
    data = response.json()
    assert data["character"] == "静"
    assert "compounds" in data
    assert isinstance(data["compounds"], list)
    if data["compounds"]:
        item = data["compounds"][0]
        assert "term" in item
        assert "reading" in item
        assert "静" in item["term"]


def test_browse_kanji_by_level():
    response = client.get("/api/kanji/browse?level=N3&limit=10")
    assert response.status_code == 200
    data = response.json()
    assert data["level"] == "N3"
    assert "kanji" in data
    assert "total" in data
    assert data["total"] > 0
    assert len(data["kanji"]) == 10
    assert "character" in data["kanji"][0]
    assert "level" in data["kanji"][0]


def test_kanji_service_missing_db_explicit_error(tmp_path):
    from app.services.kanji_service import KanjiService
    service = KanjiService(jlpt_db_path=tmp_path / "nonexistent.sqlite")
    res = service.browse("N3")
    assert res["error"] is not None
    assert "missing" in res["error"].lower() or "not found" in res["error"].lower()
    assert res["kanji"] == []


def test_kanji_service_compounds_warm_speed():
    import time
    from app.services.kanji_service import KanjiService
    service = KanjiService()
    # prime cache
    service.get_compounds("日")
    start = time.perf_counter()
    res = service.get_compounds("日", limit=10)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    assert elapsed_ms < 50.0, f"Expected warm compound lookup < 50ms, took {elapsed_ms:.2f}ms"


def test_kanji_service_get_batch():
    from app.services.kanji_service import KanjiService
    service = KanjiService()
    batch = service.get_batch(["日", "本", "語"])
    assert "日" in batch
    assert "本" in batch
    assert "語" in batch
    assert batch["日"]["character"] == "日"
    assert batch["本"]["character"] == "本"
    assert batch["語"]["character"] == "語"

    # String input test
    batch_str = service.get_batch("日本語")
    assert "日" in batch_str
    assert "本" in batch_str
    assert "語" in batch_str


def test_kanji_service_thread_local_connection_reuse():
    from app.services.kanji_service import KanjiService
    service = KanjiService()
    conn1 = service._get_jlpt_conn()
    conn2 = service._get_jlpt_conn()
    assert conn1 is conn2


def test_kanji_service_no_cwd_dict_fallback(monkeypatch, tmp_path):
    from app.services.kanji_service import resolve_kanji_dict_path
    monkeypatch.chdir(tmp_path)
    resolved = resolve_kanji_dict_path()
    assert resolved.parent != tmp_path

