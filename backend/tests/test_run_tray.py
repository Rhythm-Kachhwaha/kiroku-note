"""
Unit tests for run_tray.py -- Windows Tray Host and Single-Instance Lifecycle
"""
import os
from pathlib import Path
import subprocess
import sys

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import run_tray


def test_setup_logging(tmp_path, monkeypatch):
    monkeypatch.setenv("KIROKU_DATA_DIR", str(tmp_path))
    log_file = run_tray._setup_logging()
    assert log_file.is_file() or log_file.parent.is_dir()
    assert log_file.name == "tray_host.log"


def test_cli_version_flag():
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "run_tray.py"), "--version"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert proc.returncode == 0
    assert "Kiroku Note v2.1.0" in proc.stdout


def test_cli_check_flag():
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "run_tray.py"), "--check"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert proc.returncode == 0
    assert "Pre-flight Check" in proc.stdout
    assert "Backend App:  OK" in proc.stdout


def test_single_instance_mutex():
    if sys.platform != "win32":
        pytest.skip("Single-instance mutex is Windows-specific")

    # In current process, mutex acquisition should succeed
    try:
        acquired = run_tray._acquire_single_instance_mutex()
        assert acquired is True

        # Spawning a child process should report another instance already running
        # With --startup, it should exit 0 immediately
        child = subprocess.run(
            [sys.executable, str(REPO_ROOT / "run_tray.py"), "--startup"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        assert child.returncode == 0
    finally:
        run_tray._release_single_instance_mutex()


def test_show_error_dialog_safe():
    # Should not raise any exceptions even when called in test environment
    run_tray._show_error_dialog("Test error message", "Test Title")


def test_handle_already_running_safe():
    code = run_tray._handle_already_running()
    assert code == 0
