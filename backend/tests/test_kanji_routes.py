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
    assert data.get("radical") is not None
    assert "あお" in data["radical"]

    # Also verify radical for 長
    res_naga = client.get("/api/kanji/details/長")
    assert res_naga.status_code == 200
    data_naga = res_naga.json()
    assert data_naga.get("radical") is not None
    assert "ながい" in data_naga["radical"]


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


def test_get_kanji_study_list_endpoint():
    response = client.get("/api/kanji/study-list?level=N5&limit=5&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert data["level"] == "N5"
    assert "items" in data
    assert len(data["items"]) == 5
    first = data["items"][0]
    assert first["index"] == 1
    assert "character" in first
    assert "strokes" in first
    assert "onyomi" in first
    assert "kunyomi" in first
    assert "compounds" in first
    assert "custom_compounds" in first
    assert isinstance(first["compounds"], list)
    assert isinstance(first["custom_compounds"], list)


def test_custom_compounds_crud_endpoints():
    # 1. Add custom compound
    payload = {
        "character": "語",
        "term": "言語学",
        "reading": "げんごがく",
        "meaning": "linguistics",
    }
    create_res = client.post("/api/kanji/compounds/custom", json=payload)
    assert create_res.status_code == 200
    created = create_res.json()
    assert created["id"] > 0
    assert created["character"] == "語"
    assert created["term"] == "言語学"
    assert created["reading"] == "げんごがく"
    assert created["meaning"] == "linguistics"
    compound_id = created["id"]

    # 2. Verify appears in study list
    study_res = client.get("/api/kanji/study-list?level=N5&limit=100")
    assert study_res.status_code == 200
    items = study_res.json()["items"]
    go_item = next((it for it in items if it["character"] == "語"), None)
    if go_item:
        custom_terms = [c["term"] for c in go_item["custom_compounds"]]
        assert "言語学" in custom_terms

    # 3. Delete custom compound
    del_res = client.delete(f"/api/kanji/compounds/custom/{compound_id}")
    assert del_res.status_code == 200
    assert del_res.json()["success"] is True

    # 4. Verify 404 on deleting non-existent compound
    del_res_again = client.delete(f"/api/kanji/compounds/custom/{compound_id}")
    assert del_res_again.status_code == 404


