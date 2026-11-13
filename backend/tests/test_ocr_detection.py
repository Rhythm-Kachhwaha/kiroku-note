"""Tests for bubble detection endpoint and service integration."""
import base64
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services.ocr_service import OcrDetectResult, OcrService

client = TestClient(app)


def test_detect_bubbles_endpoint_valid():
    fake_b64 = base64.b64encode(b"fake_image_bytes").decode("ascii")

    mock_result = OcrDetectResult(
        boxes=[{"box": [10, 20, 100, 150], "score": 0.92, "type": "bubble"}],
        count=1,
        width=800,
        height=1200,
        duration_ms=45.0,
    )

    with patch.object(OcrService, "detect_bubbles", return_value=mock_result):
        response = client.post("/api/ocr/detect", json={"image": fake_b64, "conf_threshold": 0.4})
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert len(data["boxes"]) == 1
        assert data["boxes"][0]["score"] == 0.92
        assert data["width"] == 800
        assert data["height"] == 1200


def test_detect_bubbles_endpoint_empty_image():
    response = client.post("/api/ocr/detect", json={"image": ""})
    assert response.status_code == 422

