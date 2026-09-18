"""
Kiroku Note OCR Daemon Dev Runner
----------------------------------
Convenience script to start the local manga-ocr FastAPI microservice for Kiroku Note.
Runs on http://127.0.0.1:21829 by default (CPU-only, lazy-loading).

Environment variables:
  KIROKU_OCR_PORT=<port>        Override default port (21829). Fallback: PORT=<port>.
  KIROKU_OCR_HOST=<host>        Override default host (127.0.0.1).
  KIROKU_OCR_MODEL_PATH=<path>  Override path to offline manga-ocr model weights.
  KIROKU_DEBUG=1                Enable development mode: hot-reload.
"""

import multiprocessing
import os
from pathlib import Path
import socket
import subprocess
import sys
import uvicorn

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OCR_DIR = os.path.join(BASE_DIR, "ocr_server")

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
if OCR_DIR not in sys.path:
    sys.path.insert(0, OCR_DIR)

DEFAULT_OCR_HOST = "127.0.0.1"
DEFAULT_OCR_PORT = 21829


def get_venv_python() -> str | None:
    """Return path to .venv-ocr python executable if available."""
    if sys.platform == "win32":
        venv_py = os.path.join(BASE_DIR, ".venv-ocr", "Scripts", "python.exe")
    else:
        venv_py = os.path.join(BASE_DIR, ".venv-ocr", "bin", "python")
    if os.path.isfile(venv_py):
        return venv_py
    return None


def maybe_reexec_in_venv() -> None:
    """If running outside .venv-ocr and .venv-ocr exists, re-exec using .venv-ocr python."""
    venv_py = get_venv_python()
    if venv_py and os.path.abspath(sys.executable).lower() != os.path.abspath(venv_py).lower():
        # Avoid infinite recursion if reexec fails
        if os.getenv("_KIROKU_OCR_REEXEC") != "1":
            env = os.environ.copy()
            env["_KIROKU_OCR_REEXEC"] = "1"
            print(f"[INFO] Switching to OCR environment Python: {venv_py}")
            try:
                ret = subprocess.call([venv_py, *sys.argv], env=env)
                sys.exit(ret)
            except Exception as exc:
                print(f"[WARNING] Could not re-exec into venv python: {exc}", file=sys.stderr)


def check_port_available(host: str, port: int) -> None:
    """Verify that the host and port are available for socket binding before launching server."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, port))
    except OSError as err:
        print("\n" + "!" * 60, file=sys.stderr)
        print(f"[ERROR] Port {port} is already occupied or unavailable on {host}.", file=sys.stderr)
        print("Kiroku OCR daemon could not start because another process is using this port.", file=sys.stderr)
        print("If an old OCR process or KirokuOCR.exe is running, stop it first.", file=sys.stderr)
        print(f"Original error: {err}", file=sys.stderr)
        print("!" * 60 + "\n", file=sys.stderr)
        sys.exit(1)


def resolve_port() -> int:
    raw = os.getenv("KIROKU_OCR_PORT") or os.getenv("PORT") or str(DEFAULT_OCR_PORT)
    try:
        port = int(str(raw).strip())
    except ValueError:
        raise ValueError(f"Invalid port value: '{raw}'. Port must be an integer between 1 and 65535.")
    if not (1 <= port <= 65535):
        raise ValueError(f"Port out of range: {port}. Port must be between 1 and 65535.")
    return port


def start_server() -> None:
    maybe_reexec_in_venv()

    debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")

    try:
        port = resolve_port()
    except ValueError as err:
        print(f"\n[ERROR] Port configuration error: {err}", file=sys.stderr)
        sys.exit(1)

    host = os.getenv("KIROKU_OCR_HOST", DEFAULT_OCR_HOST).strip()
    if host in ("0.0.0.0", "::"):
        print(f"[WARNING] Binding to {host} is prohibited. Reverting to loopback {DEFAULT_OCR_HOST}", file=sys.stderr)
        host = DEFAULT_OCR_HOST

    url = f"http://{host}:{port}"

    # Auto-detect local model weights if not specified
    model_path = os.getenv("KIROKU_OCR_MODEL_PATH")
    if not model_path:
        candidate_model_dirs = [
            os.path.join(BASE_DIR, "dist", "ocr", "models", "manga-ocr-base"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "KirokuNote", "models", "manga-ocr-base"),
        ]
        for candidate in candidate_model_dirs:
            if os.path.isdir(candidate):
                model_path = candidate
                os.environ["KIROKU_OCR_MODEL_PATH"] = candidate
                break

    print("=" * 60)
    print(f"  Kiroku Note Standalone OCR Daemon (Development Runner)")
    print(f"  URL:        {url}")
    print(f"  Python:     {sys.executable}")
    print(f"  Engine:     manga-ocr (CPU)")
    print(f"  Model Path: {model_path or 'Default / HuggingFace Hub'}")
    print(f"  Health:     {url}/health")
    print(f"  Recognize:  {url}/recognize")
    print("=" * 60)
    print("Press Ctrl+C to stop the OCR daemon.\n")

    check_port_available(host, port)

    try:
        from ocr_server.server import create_ocr_app

        app = create_ocr_app()
        uvicorn.run(
            app,
            host=host,
            port=port,
            reload=debug,
            log_level="info",
        )
    except OSError as err:
        print("\n" + "!" * 60, file=sys.stderr)
        print(f"[ERROR] Port {port} is already occupied or unavailable on {host}.", file=sys.stderr)
        print(f"Original error: {err}", file=sys.stderr)
        print("!" * 60 + "\n", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    start_server()
