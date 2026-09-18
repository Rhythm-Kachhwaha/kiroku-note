"""Comprehensive Phase 6 OCR Code-Level Runtime and Gateway Integration Tests."""
import base64
import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services.ocr_service import (
    OcrResponseError,
    OcrService,
    OcrStatus,
    OcrTimeoutError,
    OcrUnavailableError,
)

client = TestClient(app)

SAMPLE_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
SAMPLE_B64_IMAGE = f"data:image/png;base64,{base64.b64encode(SAMPLE_PNG_BYTES).decode('ascii')}"


class TestOcrStatusGateway:
    """Verify GET /api/ocr/status behaves observationally and accurately."""

    def test_status_when_daemon_offline(self):
        with patch.object(
            OcrService,
            "get_status",
            return_value=OcrStatus(
                available=False,
                installed=False,
                engine="manga-ocr",
                device="cpu",
                model_loaded=False,
                error="Connection refused",
            ),
        ):
            resp = client.get("/api/ocr/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["available"] is False
            assert data["installed"] is False
            assert data["model_loaded"] is False
            assert "Connection refused" in data["error"]

    def test_status_when_daemon_ready_idle(self):
        with patch.object(
            OcrService,
            "get_status",
            return_value=OcrStatus(
                available=True,
                installed=True,
                engine="manga-ocr",
                device="cpu",
                model_loaded=False,
                error=None,
            ),
        ):
            resp = client.get("/api/ocr/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["available"] is True
            assert data["installed"] is True
            assert data["model_loaded"] is False

    def test_status_when_daemon_ready_loaded(self):
        with patch.object(
            OcrService,
            "get_status",
            return_value=OcrStatus(
                available=True,
                installed=True,
                engine="manga-ocr",
                device="cpu",
                model_loaded=True,
                error=None,
            ),
        ):
            resp = client.get("/api/ocr/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["available"] is True
            assert data["installed"] is True
            assert data["model_loaded"] is True


class TestOcrRecognizeGateway:
    """Verify POST /api/ocr/recognize request forwarding, validation, and error states."""

    def test_recognize_success_with_data_url(self):
        mock_result = MagicMock(
            text="日本語の勉強",
            engine="manga-ocr",
            device="cpu",
            duration_ms=215.3,
            error=None,
        )
        with patch.object(OcrService, "recognize", return_value=mock_result) as mock_rec:
            resp = client.post("/api/ocr/recognize", json={"image": SAMPLE_B64_IMAGE})
            assert resp.status_code == 200
            data = resp.json()
            assert data["text"] == "日本語の勉強"
            assert data["engine"] == "manga-ocr"
            assert data["device"] == "cpu"
            assert data["duration_ms"] == pytest.approx(215.3)
            # Verify decoded bytes were forwarded
            mock_rec.assert_called_once_with(SAMPLE_PNG_BYTES)

    def test_recognize_success_with_raw_base64(self):
        raw_b64 = base64.b64encode(SAMPLE_PNG_BYTES).decode("ascii")
        mock_result = MagicMock(
            text="約束のネバーランド",
            engine="manga-ocr",
            device="cpu",
            duration_ms=310.0,
            error=None,
        )
        with patch.object(OcrService, "recognize", return_value=mock_result):
            resp = client.post("/api/ocr/recognize", json={"image": raw_b64})
            assert resp.status_code == 200
            assert resp.json()["text"] == "約束のネバーランド"

    def test_recognize_invalid_corrupt_base64(self):
        resp = client.post("/api/ocr/recognize", json={"image": "not_valid_base64_!!@@##"})
        assert resp.status_code == 400
        assert "Invalid base64 image data" in resp.json()["detail"]

    def test_recognize_empty_image_payload(self):
        resp = client.post("/api/ocr/recognize", json={"image": "   "})
        assert resp.status_code in (400, 422)

    def test_recognize_daemon_unavailable_returns_503(self):
        with patch.object(
            OcrService,
            "recognize",
            side_effect=OcrUnavailableError("OCR service is unavailable on 127.0.0.1:21829"),
        ):
            resp = client.post("/api/ocr/recognize", json={"image": SAMPLE_B64_IMAGE})
            assert resp.status_code == 503
            assert "unavailable" in resp.json()["detail"].lower()

    def test_recognize_daemon_timeout_returns_504(self):
        with patch.object(
            OcrService,
            "recognize",
            side_effect=OcrTimeoutError("OCR recognition request timed out after 15.0s"),
        ):
            resp = client.post("/api/ocr/recognize", json={"image": SAMPLE_B64_IMAGE})
            assert resp.status_code == 504
            assert "timed out" in resp.json()["detail"].lower()

    def test_recognize_daemon_error_returns_502(self):
        with patch.object(
            OcrService,
            "recognize",
            side_effect=OcrResponseError("OCR daemon error: 500 - CUDA out of memory"),
        ):
            resp = client.post("/api/ocr/recognize", json={"image": SAMPLE_B64_IMAGE})
            assert resp.status_code == 502
            assert "OCR daemon error" in resp.json()["detail"]


class TestCoreBackendIsolationWhenOcrOffline:
    """Verify that core cards, capture, and database continue functioning when OCR is offline."""

    def test_cards_api_functional_with_ocr_offline(self):
        # Even if OCR is completely down, standard cards API responds normally
        with patch.object(
            OcrService,
            "get_status",
            return_value=OcrStatus(available=False, installed=False, error="Down"),
        ):
            resp = client.get("/api/cards?limit=10")
            assert resp.status_code == 200
            assert "cards" in resp.json()
