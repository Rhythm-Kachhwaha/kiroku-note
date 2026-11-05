"""Tests for GET /api/setup/checklist endpoint."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_setup_checklist_structure(client: TestClient) -> None:
    """Checklist endpoint must return 200 and a list of checklist items."""
    response = client.get("/api/setup/checklist")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 8

    expected_ids = {
        "dictionary_db",
        "tokenizer_dict",
        "extension_pairing",
        "anki",
        "pdf_dependency",
        "data_dir_writable",
        "yomitan",
        "ocr",
    }
    found_ids = {item["id"] for item in data}
    assert expected_ids.issubset(found_ids)

    for item in data:
        assert "id" in item
        assert "ok" in item
        assert isinstance(item["ok"], bool)
        assert "detail" in item
        assert isinstance(item["detail"], str)
        assert "fix_action" in item
        assert item["fix_action"] is None or isinstance(item["fix_action"], str)
        assert "required" in item
        assert isinstance(item["required"], bool)
        assert "informational" in item
        assert isinstance(item["informational"], bool)


def test_setup_checklist_informational_items(client: TestClient) -> None:
    """Optional items like Yomitan and OCR must be flagged informational."""
    response = client.get("/api/setup/checklist")
    assert response.status_code == 200
    data = {item["id"]: item for item in response.json()}

    assert data["yomitan"]["informational"] is True
    assert data["yomitan"]["required"] is False

    assert data["ocr"]["informational"] is True
    assert data["ocr"]["required"] is False

    assert data["dictionary_db"]["required"] is True
    assert data["dictionary_db"]["informational"] is False


def test_setup_checklist_missing_dict_reports_action(client: TestClient) -> None:
    """When dictionary DB is missing, item must report not ok with provision_dictionary action."""
    with patch(
        "app.api.system.get_dictionary_db_info",
        return_value={"db_present": False, "db_path": None, "jitendex": False, "kanjidic": False},
    ):
        response = client.get("/api/setup/checklist")
        assert response.status_code == 200
        data = {item["id"]: item for item in response.json()}
        dict_item = data["dictionary_db"]
        assert dict_item["ok"] is False
        assert dict_item["fix_action"] == "provision_dictionary"


def test_setup_checklist_unpaired_extension_reports_action(client: TestClient) -> None:
    """When extension pairing is disabled, item reports copy_pairing_code action."""
    with patch("app.api.system.is_extension_pairing_enabled", return_value=False):
        response = client.get("/api/setup/checklist")
        assert response.status_code == 200
        data = {item["id"]: item for item in response.json()}
        ext_item = data["extension_pairing"]
        assert ext_item["ok"] is False
        assert ext_item["fix_action"] == "copy_pairing_code"
