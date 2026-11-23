import pytest
from app.services.media_metadata import _clean_search_title, fetch_anilist_metadata
from app.api.cloud import _is_test_fixture_series
from app.api.link_episode import get_series

def test_test_fixture_series_detection():
    assert _is_test_fixture_series("frieren-s1") is True
    assert _is_test_fixture_series("frieren") is True
    assert _is_test_fixture_series("test-series") is True
    assert _is_test_fixture_series("mock-anime") is True
    assert _is_test_fixture_series("K-ON!") is False
    assert _is_test_fixture_series("BOCCHI THE ROCK!") is False

def test_anilist_clean_title():
    assert _clean_search_title("[SubsPlease] Sousou no Frieren - 01 (1080p).mkv") == "Sousou no Frieren"
    assert _clean_search_title("K-ON! Season 1 Episode 04") == "K-ON!"
    assert _clean_search_title("Episode 1") == ""

def test_anilist_rejects_unrelated_anime():
    # Searching for generic phrase should not return Frieren or unrelated show
    meta = fetch_anilist_metadata("NonExistentShowXYZ123456789")
    assert meta.get("title_display") == "NonExistentShowXYZ123456789"
    assert meta.get("poster_url") == ""

