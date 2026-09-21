from unittest.mock import patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.yomitan import YomitanError, YomitanService


def test_discover_available_dictionaries_success():
    service = YomitanService()

    mock_term_response = {
        "dictionaryEntries": [
            {
                "definitions": [
                    {"dictionary": "Jitendex.org [2026-08-11]"},
                    {"dictionary": "JMdict (English)"},
                ]
            },
            {
                "definitions": [
                    {"dictionary": "Jitendex.org [2026-08-11]"},  # Duplicate
                    {"dictionary": "Daijirin"},
                ]
            },
        ]
    }

    mock_kanji_response = [
        {"dictionary": "KANJIDIC [2026-253]"},
        {"dictionary": "Daijirin"},  # Duplicate from term
    ]

    def mock_post(path, payload):
        if path == "/termEntries":
            return mock_term_response
        elif path == "/kanjiEntries":
            return mock_kanji_response
        return {}

    with patch.object(service, "_post_json", side_effect=mock_post):
        discovered = service.discover_available_dictionaries()

    assert "Jitendex.org [2026-08-11]" in discovered
    assert "JMdict (English)" in discovered
    assert "Daijirin" in discovered
    assert "KANJIDIC [2026-253]" in discovered
    # Verify deduplication
    assert len(discovered) == 4


def test_discover_available_dictionaries_handles_errors_gracefully():
    service = YomitanService()

    with patch.object(service, "_post_json", side_effect=YomitanError("Yomitan is unavailable")):
        discovered = service.discover_available_dictionaries()

    assert discovered == []


def test_get_available_yomitan_dictionaries_endpoint():
    client = TestClient(app)

    with patch.object(
        YomitanService,
        "discover_available_dictionaries",
        return_value=["Jitendex.org [2026-08-11]", "JMdict (English)"],
    ):
        res = client.get("/api/yomitan/dictionaries")

    assert res.status_code == 200
    data = res.json()
    assert data["available_dictionaries"] == ["Jitendex.org [2026-08-11]", "JMdict (English)"]
    assert data["discovery_source"] == "yomitan_probe"
    assert "Discovered from enabled dictionaries" in data["disclaimer"]
