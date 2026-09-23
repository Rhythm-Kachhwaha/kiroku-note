"""
OcrProcessManager: Non-blocking lifecycle management for the standalone KirokuOCR daemon.
----------------------------------------------------------------------------------------
Responsibilities:
- Detect presence of KirokuOCR.exe binary
- Safe non-blocking process startup
- Health checking with bounded timeout
- Process tracking and graceful shutdown
- Failure threshold & cooldown to prevent restart loops
- Safe fail-soft isolation if absent or crashed
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from typing import Any

from app.config import (
    get_ocr_model_dir,
    resolve_ocr_dev_command,
    resolve_ocr_exe_path,
    resolve_ocr_port,
    resolve_ocr_url,
)

logger = logging.getLogger(__name__)


class OcrProcessManager:
    """
    Manages the lifecycle of the optional KirokuOCR daemon (packaged or dev runner).
    Thread-safe singleton pattern.
    """

    _instance: OcrProcessManager | None = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._process: subprocess.Popen[Any] | None = None
        self._last_spawn_attempt: float = 0.0
        self._spawn_failure_count: int = 0
        self._cooldown_seconds: float = 10.0
        self._max_consecutive_failures: int = 3
        self._state_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> OcrProcessManager:
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Helper for unit tests to reset singleton state."""
        with cls._lock:
            if cls._instance is not None:
                cls._instance.stop()
                cls._instance = None

    def is_installed(self, env: dict[str, str] | None = None) -> bool:
        """Check if KirokuOCR.exe or dev run_ocr.py exists in candidate locations."""
        return resolve_ocr_exe_path(env) is not None or resolve_ocr_dev_command(env) is not None

    def get_executable_path(self, env: dict[str, str] | None = None) -> Path | None:
        """Return the resolved path to KirokuOCR.exe if installed."""
        return resolve_ocr_exe_path(env)

    def is_running(self) -> bool:
        """Check if the child process spawned by this manager is currently alive."""
        with self._state_lock:
            if self._process is None:
                return False
            poll_result = self._process.poll()
            if poll_result is None:
                return True
            # Process has terminated
            self._process = None
            return False

    def is_in_cooldown(self) -> bool:
        """Check if process startup is temporarily throttled due to recent failures."""
        with self._state_lock:
            if self._spawn_failure_count < self._max_consecutive_failures:
                return False
            elapsed = time.time() - self._last_spawn_attempt
            return elapsed < self._cooldown_seconds

    def start(self, env: dict[str, str] | None = None, wait_for_health: bool = False, timeout_seconds: float = 5.0) -> bool:
        """
        Start the KirokuOCR.exe daemon non-blockingly if installed and not already running.

        Args:
            env: Optional environment dictionary override.
            wait_for_health: If True, blocks up to timeout_seconds waiting for HTTP /health.
            timeout_seconds: Maximum time to wait if wait_for_health is True.

        Returns:
            bool: True if process was successfully started or already running, False otherwise.
        """
        with self._state_lock:
            if self._process is not None and self._process.poll() is None:
                # Already running
                return True

            if self._spawn_failure_count >= self._max_consecutive_failures:
                elapsed = time.time() - self._last_spawn_attempt
                if elapsed < self._cooldown_seconds:
                    logger.warning(
                        "KirokuOCR start throttled: %d consecutive failures. Cooldown remaining: %.1fs",
                        self._spawn_failure_count,
                        self._cooldown_seconds - elapsed,
                    )
                    return False
                # Cooldown expired, reset failure count to allow fresh attempt
                self._spawn_failure_count = 0

            exe_path = resolve_ocr_exe_path(env)
            dev_cmd = resolve_ocr_dev_command(env) if exe_path is None else None

            if exe_path is None and dev_cmd is None:
                logger.info("KirokuOCR is not installed. Subprocess start skipped.")
                return False

            self._last_spawn_attempt = time.time()

            # Prepare process environment
            proc_env = os.environ.copy() if env is None else env.copy()
            port = resolve_ocr_port(proc_env)
            proc_env["KIROKU_OCR_HOST"] = "127.0.0.1"
            proc_env["KIROKU_OCR_PORT"] = str(port)
            proc_env.setdefault("HF_HUB_OFFLINE", "1")
            proc_env.setdefault("TRANSFORMERS_OFFLINE", "1")

            model_dir = get_ocr_model_dir(proc_env)
            if model_dir.is_dir() and "KIROKU_OCR_MODEL_PATH" not in proc_env:
                proc_env["KIROKU_OCR_MODEL_PATH"] = str(model_dir)

            try:
                creationflags = 0
                if sys.platform == "win32":
                    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

                if exe_path is not None:
                    spawn_cmd = [str(exe_path)]
                    spawn_cwd = str(exe_path.parent)
                    logger.info("Spawning KirokuOCR daemon from %s on port %d", exe_path, port)
                else:
                    assert dev_cmd is not None
                    spawn_cmd = dev_cmd
                    spawn_cwd = str(Path(__file__).resolve().parent.parent.parent.parent)
                    logger.info("Spawning KirokuOCR dev runner from %s on port %d", dev_cmd, port)

                self._process = subprocess.Popen(
                    spawn_cmd,
                    env=proc_env,
                    cwd=spawn_cwd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=creationflags,
                )
            except Exception as exc:
                self._spawn_failure_count += 1
                target = exe_path or dev_cmd
                logger.error("Failed to spawn KirokuOCR at %s: %s", target, exc)
                return False

        if wait_for_health:
            from app.services.ocr_service import OcrService

            svc = OcrService(health_timeout_seconds=0.5)
            deadline = time.time() + timeout_seconds
            while time.time() < deadline:
                if svc.is_available():
                    with self._state_lock:
                        self._spawn_failure_count = 0
                    return True
                with self._state_lock:
                    if self._process is not None and self._process.poll() is not None:
                        # Process died early
                        self._spawn_failure_count += 1
                        self._process = None
                        logger.error("KirokuOCR process exited prematurely.")
                        return False
                time.sleep(0.1)

            with self._state_lock:
                self._spawn_failure_count += 1
            logger.warning("KirokuOCR daemon did not become healthy within %.1fs", timeout_seconds)
            return False

        return True

    def stop(self, timeout_seconds: float = 3.0) -> None:
        """Gracefully terminate the child process if running."""
        with self._state_lock:
            if self._process is None:
                return

            proc = self._process
            self._process = None

            if proc.poll() is not None:
                return

            logger.info("Stopping KirokuOCR daemon (PID: %s)...", proc.pid)
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=timeout_seconds)
                except subprocess.TimeoutExpired:
                    logger.warning("KirokuOCR daemon did not terminate in time. Killing...")
                    proc.kill()
                    proc.wait(timeout=1.0)
            except Exception as exc:
                logger.warning("Error while stopping KirokuOCR daemon: %s", exc)
