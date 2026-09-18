"""
Unit and integration tests for OcrProcessManager.
-------------------------------------------------
Verifies:
- Executable absent vs present detection
- Installation path resolution
- Subprocess startup (mocked)
- Health check waiting with timeout
- Shutdown and cleanup
- Cooldown and failure threshold preventing restart loops
- Controlled startup on recognition request
"""
from pathlib import Path
import subprocess
import time
from unittest.mock import MagicMock, patch

import pytest

from app.config import DEFAULT_OCR_PORT
from app.services.ocr_process_manager import OcrProcessManager
from app.services.ocr_service import OcrService, OcrStatus


@pytest.fixture(autouse=True)
def reset_ocr_pm():
    """Ensure a clean OcrProcessManager singleton before and after each test."""
    OcrProcessManager.reset_instance()
    yield
    OcrProcessManager.reset_instance()


def test_ocr_process_manager_absent_executable(tmp_path: Path):
    pm = OcrProcessManager()
    env = {"KIROKU_OCR_EXE": str(tmp_path / "non_existent_ocr.exe")}

    assert pm.is_installed(env) is False
    assert pm.get_executable_path(env) is None
    assert pm.is_running() is False

    # Starting when absent should safely return False without error
    started = pm.start(env=env)
    assert started is False
    assert pm.is_running() is False


def test_ocr_process_manager_present_executable(tmp_path: Path):
    fake_exe = tmp_path / "KirokuOCR.exe"
    fake_exe.write_text("fake binary", encoding="utf-8")

    pm = OcrProcessManager()
    env = {"KIROKU_OCR_EXE": str(fake_exe)}

    assert pm.is_installed(env) is True
    assert pm.get_executable_path(env) == fake_exe


def test_ocr_process_manager_start_and_stop_mock(tmp_path: Path):
    fake_exe = tmp_path / "KirokuOCR.exe"
    fake_exe.write_text("fake binary", encoding="utf-8")

    pm = OcrProcessManager()
    env = {"KIROKU_OCR_EXE": str(fake_exe)}

    mock_proc = MagicMock()
    mock_proc.poll.return_value = None  # Process is running
    mock_proc.pid = 12345

    with patch("subprocess.Popen", return_value=mock_proc) as mock_popen:
        started = pm.start(env=env, wait_for_health=False)
        assert started is True
        assert pm.is_running() is True
        assert mock_popen.call_count == 1

        # Check call arguments
        args, kwargs = mock_popen.call_args
        assert args[0] == [str(fake_exe)]
        assert kwargs["env"]["KIROKU_OCR_HOST"] == "127.0.0.1"
        assert kwargs["env"]["KIROKU_OCR_PORT"] == str(DEFAULT_OCR_PORT)

        # Calling start again while running should be a no-op
        started_again = pm.start(env=env, wait_for_health=False)
        assert started_again is True
        assert mock_popen.call_count == 1

        # Stop process
        pm.stop()
        mock_proc.terminate.assert_called_once()
        assert pm.is_running() is False


def test_ocr_process_manager_failure_cooldown(tmp_path: Path):
    fake_exe = tmp_path / "KirokuOCR.exe"
    fake_exe.write_text("fake binary", encoding="utf-8")

    pm = OcrProcessManager()
    env = {"KIROKU_OCR_EXE": str(fake_exe)}

    # Simulate 3 consecutive launch failures
    with patch("subprocess.Popen", side_effect=OSError("Access denied")):
        for _ in range(3):
            assert pm.start(env=env) is False

        assert pm.is_in_cooldown() is True

        # Next start attempt is immediately throttled without calling Popen
        with patch("subprocess.Popen") as mock_popen:
            assert pm.start(env=env) is False
            assert mock_popen.call_count == 0


def test_ocr_process_manager_wait_for_health_success(tmp_path: Path):
    fake_exe = tmp_path / "KirokuOCR.exe"
    fake_exe.write_text("fake binary", encoding="utf-8")

    pm = OcrProcessManager()
    env = {"KIROKU_OCR_EXE": str(fake_exe)}

    mock_proc = MagicMock()
    mock_proc.poll.return_value = None

    with patch("subprocess.Popen", return_value=mock_proc):
        with patch("app.services.ocr_service.OcrService.is_available", side_effect=[False, True]):
            started = pm.start(env=env, wait_for_health=True, timeout_seconds=1.0)
            assert started is True
            assert pm.is_running() is True


def test_ocr_service_status_observational_only(tmp_path: Path):
    """Ensure get_status() does not trigger process startup."""
    mock_pm = MagicMock()
    mock_pm.is_installed.return_value = True

    service = OcrService(process_manager=mock_pm)

    with patch("urllib.request.urlopen", side_effect=ConnectionRefusedError("Connection refused")):
        status = service.get_status()
        assert status.available is False
        assert status.installed is True
        # Process manager start must NOT have been called
        assert mock_pm.start.call_count == 0


def test_ocr_service_recognize_triggers_controlled_startup(tmp_path: Path):
    """Ensure recognize() triggers a single controlled startup attempt if installed but offline."""
    mock_pm = MagicMock()
    mock_pm.is_installed.return_value = True
    mock_pm.is_in_cooldown.return_value = False

    service = OcrService(process_manager=mock_pm)

    # First is_available is False, then after start it becomes True
    mock_response = MagicMock()
    mock_response.read.return_value = b'{"text": "\xe6\xbc\xab\xe7\x94\xbb", "engine": "manga-ocr", "device": "cpu", "duration_ms": 12.5}'
    mock_response.__enter__.return_value = mock_response

    with patch.object(service, "is_available", return_value=False):
        with patch("urllib.request.urlopen", return_value=mock_response):
            res = service.recognize(b"valid_image_bytes")
            assert res.text == "漫画"
            mock_pm.start.assert_called_once_with(wait_for_health=True, timeout_seconds=5.0)
