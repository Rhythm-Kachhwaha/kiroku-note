import pytest
from app.config import (
    DEFAULT_OCR_HOST,
    DEFAULT_OCR_PORT,
    DEFAULT_OCR_URL,
    resolve_ocr_port,
    resolve_ocr_url,
)
from app.schemas import (
    OcrRecognizeRequest,
    OcrRecognizeResponse,
    OcrStatusResponse,
)


def test_ocr_config_defaults():
    assert DEFAULT_OCR_HOST == "127.0.0.1"
    assert DEFAULT_OCR_PORT == 21829
    assert DEFAULT_OCR_URL == "http://127.0.0.1:21829"
    assert resolve_ocr_port({}) == 21829
    assert resolve_ocr_url({}) == "http://127.0.0.1:21829"


def test_ocr_config_custom_port_and_url():
    assert resolve_ocr_port({"KIROKU_OCR_PORT": "21830"}) == 21830
    assert resolve_ocr_url({"KIROKU_OCR_URL": "http://127.0.0.1:29999"}) == "http://127.0.0.1:29999"
    # When KIROKU_OCR_URL is not set but KIROKU_OCR_PORT is set
    assert resolve_ocr_url({"KIROKU_OCR_PORT": "21835"}) == "http://127.0.0.1:21835"


def test_ocr_config_invalid_ports():
    with pytest.raises(ValueError, match="Invalid port value"):
        resolve_ocr_port({"KIROKU_OCR_PORT": "not-a-number"})

    with pytest.raises(ValueError, match="Port out of range"):
        resolve_ocr_port({"KIROKU_OCR_PORT": "70000"})

    with pytest.raises(ValueError, match="Port out of range"):
        resolve_ocr_port({"KIROKU_OCR_PORT": "0"})


def test_ocr_status_response_schema():
    status = OcrStatusResponse(
        available=True,
        installed=True,
        engine="manga-ocr",
        device="cpu",
        model_loaded=False,
        error=None,
    )
    assert status.available is True
    assert status.installed is True
    assert status.engine == "manga-ocr"
    assert status.device == "cpu"
    assert status.model_loaded is False
    assert status.error is None


def test_ocr_recognize_request_validation():
    req = OcrRecognizeRequest(image="data:image/png;base64,iVBORw0KGgo=")
    assert req.image == "data:image/png;base64,iVBORw0KGgo="

    with pytest.raises(ValueError, match="Image data must not be empty"):
        OcrRecognizeRequest(image="")

    with pytest.raises(ValueError, match="Image data must not be empty"):
        OcrRecognizeRequest(image="   ")


def test_ocr_recognize_response_schema():
    resp = OcrRecognizeResponse(
        text="こんにちは",
        engine="manga-ocr",
        device="cpu",
        duration_ms=250.5,
        error=None,
    )
    assert resp.text == "こんにちは"
    assert resp.engine == "manga-ocr"
    assert resp.device == "cpu"
    assert resp.duration_ms == 250.5
    assert resp.error is None
