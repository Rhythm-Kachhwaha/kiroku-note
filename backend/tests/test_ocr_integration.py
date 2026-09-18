import base64
from pathlib import Path
import socket
import sys
import threading
import time
from unittest.mock import MagicMock

from fastapi import status
from fastapi.testclient import TestClient
import pytest
import uvicorn

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.main import app as kiroku_backend_app
from app.services.ocr_service import OcrService
from ocr_server.server import OcrEngineHolder, create_ocr_app

TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\n\x00\x00\x00\n\x08\x02\x00\x00\x00\x02PX\xea"
    b"\x00\x00\x00\rIDATx\x9cc`\x18\x05\xa4\x03\x00\x016\x00\x01V\xd1\x7f\xc8\x00\x00\x00\x00IEND\xaeB`\x82"
)


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LiveServer:
    def __init__(self, app, port: int):
        self.app = app
        self.port = port
        self.server = None
        self.thread = None

    def start(self):
        config = uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="error")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()

        # Wait until server is reachable
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.05)

    def stop(self):
        if self.server:
            self.server.should_exit = True
            if self.thread:
                self.thread.join(timeout=2.0)


def test_end_to_end_ocr_pipeline_with_live_daemon():
    mock_model = MagicMock(return_value="約束のネバーランド")
    holder = OcrEngineHolder(model_factory=lambda: mock_model)
    daemon_app = create_ocr_app(engine_holder=holder)

    test_port = get_free_port()
    daemon_server = LiveServer(daemon_app, port=test_port)
    daemon_server.start()

    try:
        # Configure backend environment to point to test daemon port
        backend_client = TestClient(kiroku_backend_app)
        endpoint = f"http://127.0.0.1:{test_port}"

        # 1. Test status endpoint over HTTP
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("KIROKU_OCR_URL", endpoint)
            status_res = backend_client.get("/api/ocr/status")
            assert status_res.status_code == status.HTTP_200_OK
            status_data = status_res.json()
            assert status_data["available"] is True
            assert status_data["engine"] == "manga-ocr"
            assert status_data["model_loaded"] is False

            # 2. Test recognize endpoint over HTTP
            b64_str = base64.b64encode(TINY_PNG_BYTES).decode("utf-8")
            rec_res = backend_client.post("/api/ocr/recognize", json={"image": f"data:image/png;base64,{b64_str}"})
            assert rec_res.status_code == status.HTTP_200_OK
            rec_data = rec_res.json()
            assert rec_data["text"] == "約束のネバーランド"
            assert rec_data["engine"] == "manga-ocr"
            assert rec_data["device"] == "cpu"
            assert rec_data["duration_ms"] >= 0.0

            # 3. Status now reflects model_loaded = True
            status_res2 = backend_client.get("/api/ocr/status")
            assert status_res2.status_code == status.HTTP_200_OK
            assert status_res2.json()["model_loaded"] is True
    finally:
        daemon_server.stop()

    # 4. After daemon is stopped: backend handles unavailable gracefully
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("KIROKU_OCR_URL", f"http://127.0.0.1:{test_port}")
        offline_status = backend_client.get("/api/ocr/status")
        assert offline_status.status_code == status.HTTP_200_OK
        assert offline_status.json()["available"] is False

        offline_rec = backend_client.post("/api/ocr/recognize", json={"image": b64_str})
        assert offline_rec.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert "unavailable" in offline_rec.json()["detail"].lower()
