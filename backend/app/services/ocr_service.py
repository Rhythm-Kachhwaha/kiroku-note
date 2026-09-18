"""The sole boundary for the standalone OCR HTTP daemon."""
from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import os
import socket
from typing import Any
import urllib.error
import urllib.request

from app.config import resolve_ocr_url

logger = logging.getLogger(__name__)


class OcrError(Exception):
    """Base exception for OCR operations."""
    pass


class OcrUnavailableError(OcrError):
    """Raised when the standalone OCR service cannot be reached."""
    pass


class OcrTimeoutError(OcrError):
    """Raised when an OCR request times out."""
    pass


class OcrResponseError(OcrError):
    """Raised when the OCR daemon returns invalid or error responses."""
    pass


@dataclass(frozen=True)
class OcrStatus:
    available: bool
    installed: bool = False
    engine: str = "manga-ocr"
    device: str = "cpu"
    model_loaded: bool = False
    error: str | None = None


@dataclass(frozen=True)
class OcrResult:
    text: str
    engine: str = "manga-ocr"
    device: str = "cpu"
    duration_ms: float = 0.0
    error: str | None = None


class OcrService:
    """Encapsulates all communication with the standalone KirokuOCR localhost daemon."""

    def __init__(
        self,
        endpoint: str | None = None,
        timeout_seconds: float = 15.0,
        health_timeout_seconds: float = 2.0,
        process_manager: Any | None = None,
    ) -> None:
        self._endpoint = (endpoint or resolve_ocr_url()).rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._health_timeout_seconds = health_timeout_seconds
        self._process_manager = process_manager

    def _get_process_manager(self) -> Any:
        if self._process_manager is not None:
            return self._process_manager
        from app.services.ocr_process_manager import OcrProcessManager
        return OcrProcessManager.get_instance()

    @property
    def endpoint(self) -> str:
        return self._endpoint

    @property
    def timeout_seconds(self) -> float:
        return self._timeout_seconds

    @property
    def health_timeout_seconds(self) -> float:
        return self._health_timeout_seconds

    def is_available(self) -> bool:
        """Quickly check if the OCR daemon is alive and responsive."""
        status = self.get_status()
        return status.available

    def get_status(self) -> OcrStatus:
        """
        Fetch OCR service status from GET /health.
        Observational only — does NOT spawn processes.
        """
        pm = self._get_process_manager()
        installed = pm.is_installed()

        request = urllib.request.Request(f"{self._endpoint}/health", method="GET")
        try:
            with urllib.request.urlopen(request, timeout=self._health_timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    return OcrStatus(
                        available=False,
                        installed=installed,
                        error="OCR daemon returned invalid response format.",
                    )
                return OcrStatus(
                    available=payload.get("status") == "ok",
                    installed=installed or bool(payload.get("installed", False)),
                    engine=str(payload.get("engine", "manga-ocr")),
                    device=str(payload.get("device", "cpu")),
                    model_loaded=bool(payload.get("model_loaded", False)),
                    error=payload.get("error"),
                )
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionRefusedError, OSError) as exc:
            return OcrStatus(
                available=False,
                installed=installed,
                error=f"OCR service is unavailable: {exc}",
            )
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            return OcrStatus(
                available=False,
                installed=installed,
                error=f"OCR daemon returned unparseable health response: {exc}",
            )

    def recognize(self, image_bytes: bytes) -> OcrResult:
        """
        Send raw image bytes to the OCR daemon for recognition.
        If the daemon is not running but installed, triggers a single bounded startup attempt.

        Raises:
            ValueError: If image_bytes is empty.
            OcrUnavailableError: If OCR daemon is down / unreachable.
            OcrTimeoutError: If OCR request times out.
            OcrResponseError: If OCR daemon returns an error or malformed payload.
        """
        if not image_bytes:
            raise ValueError("Image bytes must not be empty.")

        # If not currently available, try starting the process if installed
        pm = self._get_process_manager()
        if not self.is_available() and pm.is_installed() and not pm.is_in_cooldown():
            logger.info("OCR daemon is offline. Attempting controlled startup for recognition request...")
            pm.start(wait_for_health=True, timeout_seconds=5.0)

        request = urllib.request.Request(
            f"{self._endpoint}/recognize",
            data=image_bytes,
            headers={"Content-Type": "application/octet-stream"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                raw_data = response.read().decode("utf-8")
                payload = json.loads(raw_data)
        except urllib.error.HTTPError as error:
            try:
                err_body = error.read().decode("utf-8")
                err_json = json.loads(err_body)
                err_msg = err_json.get("error") or err_json.get("detail") or f"HTTP {error.code}"
            except Exception:
                err_msg = f"HTTP {error.code}"
            raise OcrResponseError(f"OCR daemon error: {error.code} - {err_msg}") from error
        except (TimeoutError, socket.timeout) as error:
            raise OcrTimeoutError("OCR recognition request timed out.") from error
        except (urllib.error.URLError, ConnectionRefusedError, OSError) as error:
            raise OcrUnavailableError("OCR service is unavailable. Start the OCR service and try again.") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise OcrResponseError("OCR daemon returned an invalid response.") from error

        if not isinstance(payload, dict):
            raise OcrResponseError("OCR daemon returned an invalid response.")

        if payload.get("error"):
            raise OcrResponseError(str(payload["error"]))

        return OcrResult(
            text=str(payload.get("text", "")),
            engine=str(payload.get("engine", "manga-ocr")),
            device=str(payload.get("device", "cpu")),
            duration_ms=float(payload.get("duration_ms", 0.0)),
            error=None,
        )
