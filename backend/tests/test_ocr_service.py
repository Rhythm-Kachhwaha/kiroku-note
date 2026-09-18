from io import BytesIO
import json
import socket
from urllib.error import HTTPError, URLError
from unittest.mock import MagicMock, patch

import pytest

from app.services.ocr_service import (
    OcrError,
    OcrResponseError,
    OcrResult,
    OcrService,
    OcrStatus,
    OcrTimeoutError,
    OcrUnavailableError,
)


def test_ocr_service_init_defaults():
    service = OcrService()
    assert service.endpoint == "http://127.0.0.1:21829"
    assert service.timeout_seconds == 15.0
    assert service.health_timeout_seconds == 2.0


def test_ocr_service_custom_endpoint():
    service = OcrService(endpoint="http://127.0.0.1:30000", timeout_seconds=5.0, health_timeout_seconds=1.0)
    assert service.endpoint == "http://127.0.0.1:30000"
    assert service.timeout_seconds == 5.0
    assert service.health_timeout_seconds == 1.0


def test_is_available_true_when_health_ok():
    service = OcrService()
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({
        "status": "ok",
        "engine": "manga-ocr",
        "device": "cpu",
        "model_loaded": False,
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert service.is_available() is True


def test_is_available_false_on_connection_error():
    service = OcrService()
    with patch("urllib.request.urlopen", side_effect=URLError(ConnectionRefusedError("Connection refused"))):
        assert service.is_available() is False


def test_is_available_false_on_timeout():
    service = OcrService()
    with patch("urllib.request.urlopen", side_effect=TimeoutError("Timed out")):
        assert service.is_available() is False


def test_get_status_success():
    service = OcrService()
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({
        "status": "ok",
        "engine": "manga-ocr",
        "device": "cpu",
        "model_loaded": True,
        "installed": True,
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        status = service.get_status()
        assert status.available is True
        assert status.installed is True
        assert status.engine == "manga-ocr"
        assert status.device == "cpu"
        assert status.model_loaded is True
        assert status.error is None


def test_get_status_when_daemon_unavailable():
    service = OcrService()
    with patch("urllib.request.urlopen", side_effect=URLError(ConnectionRefusedError("Connection refused"))):
        status = service.get_status()
        assert status.available is False
        assert status.installed is False
        assert status.engine == "manga-ocr"
        assert status.device == "cpu"
        assert status.model_loaded is False
        assert "unavailable" in (status.error or "").lower()


def test_recognize_success():
    service = OcrService()
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({
        "text": "魔法少女",
        "engine": "manga-ocr",
        "device": "cpu",
        "duration_ms": 320.5,
        "error": None,
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    dummy_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR..."
    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        result = service.recognize(dummy_png)
        assert isinstance(result, OcrResult)
        assert result.text == "魔法少女"
        assert result.engine == "manga-ocr"
        assert result.device == "cpu"
        assert result.duration_ms == 320.5
        assert result.error is None

        req = mock_urlopen.call_args[0][0]
        assert req.get_full_url() == "http://127.0.0.1:21829/recognize"
        assert req.get_method() == "POST"
        assert req.data == dummy_png
        assert req.get_header("Content-type") == "application/octet-stream"


def test_recognize_empty_bytes_raises_value_error():
    service = OcrService()
    with pytest.raises(ValueError, match="Image bytes must not be empty"):
        service.recognize(b"")


def test_recognize_daemon_unavailable():
    service = OcrService()
    with patch("urllib.request.urlopen", side_effect=URLError(ConnectionRefusedError("Connection refused"))):
        with pytest.raises(OcrUnavailableError, match="OCR service is unavailable"):
            service.recognize(b"fake-image-bytes")


def test_recognize_timeout():
    service = OcrService()
    with patch("urllib.request.urlopen", side_effect=TimeoutError("Request timed out")):
        with pytest.raises(OcrTimeoutError, match="timed out"):
            service.recognize(b"fake-image-bytes")


def test_recognize_malformed_json_response():
    service = OcrService()
    mock_resp = MagicMock()
    mock_resp.read.return_value = b"Not JSON at all"
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        with pytest.raises(OcrResponseError, match="invalid response"):
            service.recognize(b"fake-image-bytes")


def test_recognize_daemon_error_payload():
    service = OcrService()
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({
        "text": "",
        "engine": "manga-ocr",
        "device": "cpu",
        "duration_ms": 0.0,
        "error": "Failed to decode image",
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        with pytest.raises(OcrResponseError, match="Failed to decode image"):
            service.recognize(b"corrupt-image-bytes")


def test_recognize_http_error():
    service = OcrService()
    err = HTTPError(
        url="http://127.0.0.1:21829/recognize",
        code=500,
        msg="Internal Server Error",
        hdrs={},
        fp=BytesIO(b'{"detail": "Internal inference error"}'),
    )
    with patch("urllib.request.urlopen", side_effect=err):
        with pytest.raises(OcrResponseError, match="OCR daemon error: 500"):
            service.recognize(b"fake-image-bytes")
