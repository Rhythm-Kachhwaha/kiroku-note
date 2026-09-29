import pytest
from app.services.jlpt_reference import JlptReferenceService
from fastapi.testclient import TestClient
from app.main import app

def test_jlpt_reference_search_english_basic():
    service = JlptReferenceService()
    results = service.search_english("eat", limit=5)
    assert len(results) > 0
    words = [r["term"] for r in results]
    assert "食べる" in words
    top = results[0]
    assert "term" in top
    assert "reading" in top
    assert "senses" in top
    assert len(top["senses"]) > 0
    assert len(top["senses"][0]["glosses"]) > 0

def test_jlpt_reference_search_english_phrase():
    service = JlptReferenceService()
    results = service.search_english("wake up", limit=5)
    assert len(results) > 0
    words = [r["term"] for r in results]
    assert any("覚" in w for w in words)

def test_jlpt_reference_search_english_empty():
    service = JlptReferenceService()
    assert service.search_english("") == []
    assert service.search_english("   ") == []

def test_api_search_english_endpoint():
    client = TestClient(app)
    response = client.get("/api/dictionary/search-english?query=water")
    assert response.status_code == 200
    data = response.json()
    assert "entries" in data
    assert any(e["term"] == "水" for e in data["entries"])

def test_api_search_english_empty_query():
    client = TestClient(app)
    response = client.get("/api/dictionary/search-english?query=")
    assert response.status_code == 200
    data = response.json()
    assert data["entries"] == []
    assert data["count"] == 0
