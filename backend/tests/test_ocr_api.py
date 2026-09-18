import base64
from unittest.mock import patch

from fastapi import status
from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services.ocr_service import (
    OcrResponseError,
    OcrResult,
    OcrStatus,
    OcrTimeoutError,
    OcrUnavailableError,
)

client = TestClient(app)


def test_get_ocr_status_when_available():
    mock_status = OcrStatus(
        available=True,
        installed=True,
        engine="manga-ocr",
        device="cpu",
        model_loaded=False,
        error=None,
    )
    with patch("app.main.OcrService.get_status", return_value=mock_status):
        response = client.get("/api/ocr/status")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["available"] is True
        assert data["installed"] is True
        assert data["engine"] == "manga-ocr"
        assert data["device"] == "cpu"
        assert data["model_loaded"] is False
        assert data["error"] is None


def test_get_ocr_status_when_unavailable():
    mock_status = OcrStatus(
        available=False,
        installed=False,
        engine="manga-ocr",
        device="cpu",
        model_loaded=False,
        error="OCR service is unavailable: Connection refused",
    )
    with patch("app.main.OcrService.get_status", return_value=mock_status):
        response = client.get("/api/ocr/status")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["available"] is False
        assert data["installed"] is False
        assert "unavailable" in data["error"].lower()


def test_post_ocr_recognize_success_with_raw_base64():
    mock_result = OcrResult(
        text="日本語テキスト",
        engine="manga-ocr",
        device="cpu",
        duration_ms=180.2,
        error=None,
    )
    raw_bytes = b"fake_png_image_binary"
    b64_str = base64.b64encode(raw_bytes).decode("utf-8")

    with patch("app.main.OcrService.recognize", return_value=mock_result) as mock_rec:
        response = client.post("/api/ocr/recognize", json={"image": b64_str})
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["text"] == "日本語テキスト"
        assert data["engine"] == "manga-ocr"
        assert data["device"] == "cpu"
        assert data["duration_ms"] == 180.2
        assert data["error"] is None
        mock_rec.assert_called_once_with(raw_bytes)


def test_post_ocr_recognize_success_with_data_url():
    mock_result = OcrResult(
        text="スパイファミリー",
        engine="manga-ocr",
        device="cpu",
        duration_ms=210.0,
        error=None,
    )
    raw_bytes = b"another_image_bytes"
    b64_str = base64.b64encode(raw_bytes).decode("utf-8")
    data_url = f"data:image/png;base64,{b64_str}"

    with patch("app.main.OcrService.recognize", return_value=mock_result) as mock_rec:
        response = client.post("/api/ocr/recognize", json={"image": data_url})
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["text"] == "スパイファミリー"
        mock_rec.assert_called_once_with(raw_bytes)


def test_post_ocr_recognize_empty_image():
    response = client.post("/api/ocr/recognize", json={"image": "   "})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_post_ocr_recognize_invalid_base64():
    response = client.post("/api/ocr/recognize", json={"image": "!!!not_valid_base64!!!"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "base64" in response.json()["detail"].lower()


def test_post_ocr_recognize_unavailable():
    raw_bytes = b"sample_bytes"
    b64_str = base64.b64encode(raw_bytes).decode("utf-8")

    with patch("app.main.OcrService.recognize", side_effect=OcrUnavailableError("OCR service is unavailable.")):
        response = client.post("/api/ocr/recognize", json={"image": b64_str})
        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert "unavailable" in response.json()["detail"].lower()


def test_post_ocr_recognize_timeout():
    raw_bytes = b"sample_bytes"
    b64_str = base64.b64encode(raw_bytes).decode("utf-8")

    with patch("app.main.OcrService.recognize", side_effect=OcrTimeoutError("OCR recognition request timed out.")):
        response = client.post("/api/ocr/recognize", json={"image": b64_str})
        assert response.status_code == status.HTTP_504_GATEWAY_TIMEOUT
        assert "timed out" in response.json()["detail"].lower()


def test_post_ocr_recognize_daemon_error():
    raw_bytes = b"sample_bytes"
    b64_str = base64.b64encode(raw_bytes).decode("utf-8")

    with patch("app.main.OcrService.recognize", side_effect=OcrResponseError("Inference failed")):
        response = client.post("/api/ocr/recognize", json={"image": b64_str})
        assert response.status_code == status.HTTP_502_BAD_GATEWAY
        assert "Inference failed" in response.json()["detail"]
