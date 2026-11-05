import base64
import hashlib
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_EXTENSION_IDS, get_allowed_origin_regex
from app.main import app
from app.services.yomitan import DictionaryEntry, EnrichedTerm, Example, IdentifiedTerm, Sense


@pytest.fixture
def client():
    return TestClient(app)


def test_manifest_contains_key_matching_pinned_id():
    manifest_path = Path(__file__).resolve().parents[2] / "extension" / "manifest.json"
    assert manifest_path.exists(), f"manifest.json missing at {manifest_path}"

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    manifest_key = manifest.get("key")
    assert manifest_key, "manifest.json must contain 'key'"

    der = base64.b64decode(manifest_key)
    digest = hashlib.sha256(der).digest()[:16].hex()
    derived_id = "".join(chr(ord("a") + int(c, 16)) for c in digest)

    assert derived_id in DEFAULT_EXTENSION_IDS
    assert derived_id == DEFAULT_EXTENSION_IDS[0]


def test_pinned_extension_id_post_capture_is_trusted(client):
    pinned_id = DEFAULT_EXTENSION_IDS[0]
    origin = f"chrome-extension://{pinned_id}"

    mock_service = MagicMock()
    mock_service.identify.return_value = IdentifiedTerm("本", "ほん", "本", "本")
    mock_service.enrich.return_value = EnrichedTerm(
        expression="本",
        reading="ほん",
        source_text="本",
        deinflected_text="本",
        entries=[
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                term="本",
                reading="ほん",
                parts_of_speech=["noun"],
                tags=["common"],
                senses=[Sense(glosses=["book"], examples=[Example("本を読む", "to read a book")])],
            )
        ],
        dictionary_error=None,
    )

    with patch("app.main.YomitanService", return_value=mock_service):
        response = client.post(
            "/api/capture",
            json={"text": "本", "deck_name": "Default"},
            headers={"Origin": origin},
        )
        assert response.status_code != 403, f"Pinned extension ID was unexpectedly forbidden: {response.text}"
        assert response.status_code == 200
        data = response.json()
        assert data.get("expression") == "本"


def test_random_extension_id_post_is_forbidden(client):
    random_origin = "chrome-extension://untrustedfakeextensionid12345678"
    response = client.post(
        "/api/capture",
        json={"text": "本"},
        headers={"Origin": random_origin},
    )
    assert response.status_code == 403
    assert "Untrusted Origin" in response.text


def test_get_allowed_regardless_of_origin(client):
    random_origin = "chrome-extension://untrustedfakeextensionid12345678"
    response = client.get(
        "/api/health",
        headers={"Origin": random_origin},
    )
    assert response.status_code == 200


def test_cors_preflight_for_pinned_extension_id(client):
    pinned_id = DEFAULT_EXTENSION_IDS[0]
    origin = f"chrome-extension://{pinned_id}"

    response = client.options(
        "/api/capture",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
