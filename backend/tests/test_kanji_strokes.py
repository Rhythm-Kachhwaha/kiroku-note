"""Unit and integration tests for KanjiVG stroke order diagram service and API."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.kanji_strokes import KanjiStrokesService, get_kanji_strokes_service


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def service():
    svc = KanjiStrokesService()
    svc.clear_cache()
    return svc


class TestKanjiStrokesService:
    def test_lookup_common_kanji(self, service: KanjiStrokesService):
        """Lookup for common kanji returns cleaned, inline-styled SVG."""
        svg = service.get_stroke_svg("意")
        assert svg is not None
        assert svg.startswith("<svg")
        assert svg.endswith("</svg>")
        assert 'class="stroke-order-svg"' in svg
        assert "viewBox=\"0 0 109 109\"" in svg
        # Ensure DOCTYPE, XML declaration, and comments are stripped
        assert "<?xml" not in svg
        assert "<!DOCTYPE" not in svg
        assert "<!--" not in svg
        # Ensure inline styles for stroke paths and numbers
        assert "fill:none" in svg
        assert "stroke:currentColor" in svg

    def test_lookup_multiple_kanji(self, service: KanjiStrokesService):
        """Verify several Joyo kanji characters lookup successfully."""
        chars = ["味", "日", "本", "書", "食", "学", "校"]
        for ch in chars:
            svg = service.get_stroke_svg(ch)
            assert svg is not None, f"Expected SVG for kanji {ch}"
            assert "<svg" in svg
            assert "</svg>" in svg

    def test_lookup_by_codepoint(self, service: KanjiStrokesService):
        """Lookup by 5-digit hex codepoint string succeeds."""
        # 意 is U+610F -> 0610f
        svg = service.get_stroke_svg("0610f")
        assert svg is not None
        assert "<svg" in svg

    def test_lookup_unknown_character(self, service: KanjiStrokesService):
        """Non-kanji or unlisted characters return None."""
        assert service.get_stroke_svg("a") is None
        assert service.get_stroke_svg("1") is None
        assert service.get_stroke_svg("あ") is None
        assert service.get_stroke_svg("") is None

    def test_lru_caching_behavior(self, service: KanjiStrokesService):
        """Verify repeated queries hit the in-memory LRU cache."""
        service.clear_cache()
        info_start = service.cache_info()
        assert info_start.hits == 0

        # First query: cache miss
        svg1 = service.get_stroke_svg("意")
        assert svg1 is not None
        info_miss = service.cache_info()
        assert info_miss.misses >= 1

        # Second query: cache hit
        svg2 = service.get_stroke_svg("意")
        assert svg2 == svg1
        info_hit = service.cache_info()
        assert info_hit.hits >= 1


class TestKanjiStrokesApi:
    def test_api_get_strokes_success(self, client: TestClient):
        """GET /api/kanji/strokes/{character} returns SVG with image/svg+xml."""
        response = client.get("/api/kanji/strokes/意")
        assert response.status_code == 200
        assert "image/svg+xml" in response.headers["content-type"]
        svg = response.text
        assert svg.startswith("<svg")
        assert "</svg>" in svg
        assert "stroke-order-svg" in svg

    def test_api_get_strokes_not_found(self, client: TestClient):
        """GET /api/kanji/strokes/{character} returns 404 for unknown characters."""
        response = client.get("/api/kanji/strokes/xyz123")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
