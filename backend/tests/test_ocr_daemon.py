import base64
from io import BytesIO
from pathlib import Path
import sys
import time
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi import status
from fastapi.testclient import TestClient
import pytest

from ocr_server.server import OcrEngineHolder, create_ocr_app

# Minimal valid 10x10 PNG bytes
TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\n\x00\x00\x00\n\x08\x02\x00\x00\x00\x02PX\xea"
    b"\x00\x00\x00\rIDATx\x9cc`\x18\x05\xa4\x03\x00\x016\x00\x01V\xd1\x7f\xc8\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_ocr_engine_holder_lazy_loading():
    mock_factory = MagicMock()
    mock_manga_ocr = MagicMock()
    mock_manga_ocr.return_value = "テスト文字列"
    mock_factory.return_value = mock_manga_ocr

    holder = OcrEngineHolder(model_factory=mock_factory)
    assert holder.is_loaded() is False
    assert mock_factory.call_count == 0

    # First access loads the model
    model = holder.get_model()
    assert model is mock_manga_ocr
    assert holder.is_loaded() is True
    assert mock_factory.call_count == 1

    # Subsequent access reuses the loaded model
    model2 = holder.get_model()
    assert model2 is mock_manga_ocr
    assert mock_factory.call_count == 1


def test_ocr_daemon_health_before_and_after_model_load():
    mock_factory = MagicMock()
    mock_manga_ocr = MagicMock(return_value="漫画テキスト")
    mock_factory.return_value = mock_manga_ocr

    holder = OcrEngineHolder(model_factory=mock_factory)
    app = create_ocr_app(engine_holder=holder)
    client = TestClient(app)

    # 1. Before recognition: model_loaded is False
    res = client.get("/health")
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert data["status"] == "ok"
    assert data["engine"] == "manga-ocr"
    assert data["device"] == "cpu"
    assert data["model_loaded"] is False

    # 2. Trigger recognize request
    res_rec = client.post(
        "/recognize",
        content=TINY_PNG_BYTES,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert res_rec.status_code == status.HTTP_200_OK
    data_rec = res_rec.json()
    assert data_rec["text"] == "漫画テキスト"
    assert data_rec["engine"] == "manga-ocr"
    assert data_rec["device"] == "cpu"
    assert "duration_ms" in data_rec
    assert data_rec["error"] is None

    # 3. After recognition: model_loaded is True
    res_after = client.get("/health")
    assert res_after.status_code == status.HTTP_200_OK
    assert res_after.json()["model_loaded"] is True


def test_ocr_daemon_recognize_json_base64():
    mock_factory = MagicMock()
    mock_manga_ocr = MagicMock(return_value="JSON認識成功")
    mock_factory.return_value = mock_manga_ocr

    holder = OcrEngineHolder(model_factory=mock_factory)
    app = create_ocr_app(engine_holder=holder)
    client = TestClient(app)

    b64_str = base64.b64encode(TINY_PNG_BYTES).decode("utf-8")
    res = client.post("/recognize", json={"image": b64_str})
    assert res.status_code == status.HTTP_200_OK
    assert res.json()["text"] == "JSON認識成功"


def test_ocr_daemon_recognize_empty_body():
    holder = OcrEngineHolder(model_factory=MagicMock())
    app = create_ocr_app(engine_holder=holder)
    client = TestClient(app)

    res = client.post("/recognize", content=b"")
    assert res.status_code == status.HTTP_400_BAD_REQUEST
    assert "empty" in res.json()["detail"].lower()


def test_ocr_daemon_missing_manga_ocr_dependency():
    def failing_factory():
        raise ImportError("No module named 'manga_ocr'")

    holder = OcrEngineHolder(model_factory=failing_factory)
    app = create_ocr_app(engine_holder=holder)
    client = TestClient(app)

    # Health endpoint still works, reports model_loaded=False
    res_health = client.get("/health")
    assert res_health.status_code == status.HTTP_200_OK
    assert res_health.json()["status"] == "ok"
    assert res_health.json()["model_loaded"] is False

    # Recognize endpoint returns 503 error without crashing daemon
    res_rec = client.post("/recognize", content=TINY_PNG_BYTES)
    assert res_rec.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "manga_ocr" in res_rec.json()["detail"] or "not installed" in res_rec.json()["detail"].lower()
