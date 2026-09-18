"""
Kiroku Note Standalone OCR Daemon
---------------------------------
Lightweight local HTTP micro-service running on loopback (127.0.0.1:21829).
Loads manga-ocr lazily on first recognition request using CPU only.
"""
from __future__ import annotations

import base64
from io import BytesIO
import json
import logging
import os
import sys
import threading
import time
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

logger = logging.getLogger("kiroku_ocr_server")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 21829


class OcrRecognizeJsonInput(BaseModel):
    image: str = Field(..., description="Base64 encoded image or data URL")


class OcrEngineHolder:
    """Manages lazy CPU-only initialization and inference for the OCR model."""

    def __init__(
        self,
        model_factory: Callable[[], Any] | None = None,
        model_path: str | None = None,
    ) -> None:
        self._model_factory = model_factory
        self._model_path = model_path or os.getenv("KIROKU_OCR_MODEL_PATH")
        self._model: Any | None = None
        self._lock = threading.Lock()

    def is_loaded(self) -> bool:
        """Check if the OCR model is currently resident in RAM."""
        return self._model is not None

    def is_available(self) -> bool:
        """Check if manga_ocr is installed and importable."""
        if self._model is not None:
            return True
        if self._model_factory is not None:
            return True
        try:
            import manga_ocr  # noqa: F401
            return True
        except ImportError:
            return False

    def get_model(self) -> Any:
        """
        Lazily initialize and return the OCR model instance.
        Thread-safe singleton.
        """
        if self._model is not None:
            return self._model

        with self._lock:
            if self._model is not None:
                return self._model

            if self._model_factory is not None:
                self._model = self._model_factory()
                return self._model

            # Default production path: import manga_ocr lazily
            try:
                from manga_ocr import MangaOcr  # type: ignore
            except Exception as exc:
                logger.exception("Failed to import MangaOcr: %s", exc)
                raise ImportError(
                    f"manga-ocr import error: {exc}"
                ) from exc

            # Instantiate model strictly with force_cpu=True
            if self._model_path and os.path.exists(self._model_path):
                self._model = MangaOcr(pretrained_model_name_or_path=self._model_path, force_cpu=True)
            else:
                self._model = MangaOcr(force_cpu=True)

            return self._model

    def recognize_image_bytes(self, image_bytes: bytes) -> str:
        """
        Perform OCR on raw image bytes.
        Loads model lazily if not yet initialized.
        """
        if not image_bytes:
            raise ValueError("Image bytes must not be empty.")

        model = self.get_model()

        # Convert image bytes to PIL Image if PIL is available
        try:
            from PIL import Image  # type: ignore
            img = Image.open(BytesIO(image_bytes))
        except ImportError:
            # If PIL is not directly installed, pass BytesIO or raw image if model handles it
            img = BytesIO(image_bytes)
        except Exception as exc:
            raise ValueError(f"Failed to decode image bytes: {exc}") from exc

        # manga-ocr callable: model(img) -> str
        if callable(model):
            return str(model(img))
        elif hasattr(model, "predict"):
            return str(model.predict(img))
        elif hasattr(model, "recognize"):
            return str(model.recognize(img))
        else:
            raise RuntimeError(f"Loaded OCR model object {type(model)} is not callable.")


def create_ocr_app(engine_holder: OcrEngineHolder | None = None) -> FastAPI:
    """Create and configure the FastAPI application for the OCR daemon."""
    holder = engine_holder or OcrEngineHolder()

    app = FastAPI(
        title="Kiroku Note Standalone OCR Daemon",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health_check() -> dict[str, Any]:
        """Health check endpoint exposing service state and engine info."""
        return {
            "status": "ok",
            "engine": "manga-ocr",
            "device": "cpu",
            "model_loaded": holder.is_loaded(),
            "installed": holder.is_available(),
            "error": None,
        }

    @app.post("/recognize")
    async def recognize(request: Request) -> dict[str, Any]:
        """
        Perform optical character recognition on provided image.
        Accepts raw bytes (octet-stream) or JSON base64.
        """
        content_type = request.headers.get("content-type", "").lower()
        image_bytes: bytes = b""

        if "application/json" in content_type:
            try:
                body_json = await request.json()
                raw_image = str(body_json.get("image", "")).strip()
                if "," in raw_image and raw_image.startswith("data:"):
                    _, b64_part = raw_image.split(",", 1)
                else:
                    b64_part = raw_image
                image_bytes = base64.b64decode(b64_part, validate=True)
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid JSON image payload or base64 decoding error: {exc}",
                ) from exc
        else:
            image_bytes = await request.body()

        if not image_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty image data provided in request body.",
            )

        # Lazy model loading happens outside inference timing
        try:
            holder.get_model()
        except ImportError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to load OCR model: {exc}",
            ) from exc

        # Timed recognition inference
        start_time = time.perf_counter()
        try:
            recognized_text = holder.recognize_image_bytes(image_bytes)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"OCR recognition failed during inference: {exc}",
            ) from exc

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        return {
            "text": recognized_text,
            "engine": "manga-ocr",
            "device": "cpu",
            "duration_ms": round(duration_ms, 2),
            "error": None,
        }

    return app


def main() -> None:
    """Run the OCR server bound strictly to loopback 127.0.0.1."""
    host = os.getenv("KIROKU_OCR_HOST", DEFAULT_HOST).strip()
    if host in ("0.0.0.0", "::"):
        # Enforce loopback security constraint
        logger.warning("Binding to %s is prohibited. Reverting to loopback %s", host, DEFAULT_HOST)
        host = DEFAULT_HOST

    raw_port = os.getenv("KIROKU_OCR_PORT") or os.getenv("PORT") or str(DEFAULT_PORT)
    try:
        port = int(str(raw_port).strip())
    except ValueError:
        port = DEFAULT_PORT

    print(f"Starting Kiroku Note OCR Daemon on http://{host}:{port} (CPU-only, lazy loading)")
    app = create_ocr_app()
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
