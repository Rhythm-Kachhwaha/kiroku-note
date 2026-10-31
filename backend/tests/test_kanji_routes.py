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
