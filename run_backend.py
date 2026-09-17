"""
Kiroku Note Backend Runner
--------------------------
Convenience script to start the local FastAPI backend server for Kiroku Note.
Runs on http://127.0.0.1:21828 by default.

Environment variables:
  KIROKU_PORT=<port>   Override default port (21828). Fallback: PORT=<port>.
  KIROKU_DEBUG=1       Enable development mode: hot-reload + /docs + /redoc.
                       Default: off (safe for normal and distributed use).
"""

import multiprocessing
import os
import socket
import sys
import uvicorn

# Ensure the backend directory is on sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.config import (  # noqa: E402
    APP_NAME,
    APP_VERSION,
    DEFAULT_KIROKU_HOST,
    DEFAULT_KIROKU_PORT,
    get_media_dir,
    resolve_port,
)
from app.db.connection import get_db_path  # noqa: E402


def check_port_available(host: str, port: int) -> None:
    """Verify that the host and port are available for socket binding before launching server."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((host, port))
    except OSError as err:
        print("\n" + "!" * 60, file=sys.stderr)
        print(f"[ERROR] Port {port} is already occupied or unavailable on {host}.", file=sys.stderr)
        print("Kiroku Note could not start because another process is using this port.", file=sys.stderr)
        print("To use a different port, set the KIROKU_PORT environment variable (e.g. set KIROKU_PORT=21829).", file=sys.stderr)
        print(f"Original error: {err}", file=sys.stderr)
        print("!" * 60 + "\n", file=sys.stderr)
        sys.exit(1)


def start_server() -> None:
    debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")

    try:
        port = resolve_port()
    except ValueError as err:
        print(f"\n[ERROR] Port configuration error: {err}", file=sys.stderr)
        sys.exit(1)

    host = DEFAULT_KIROKU_HOST
    url = f"http://{host}:{port}"
    db_file = get_db_path()
    media_path = get_media_dir()

    print("=" * 60)
    print(f"  {APP_NAME} Local Backend Server v{APP_VERSION}")
    print(f"  URL:      {url}")
    print(f"  Database: {db_file}")
    print(f"  Media:    {media_path}")
    if debug:
        print(f"  API Docs: {url}/docs  [DEBUG MODE]")
    else:
        print("  API Docs: disabled  (set KIROKU_DEBUG=1 to enable)")
    print(f"  Status:   {url}/api/anki/status")
    if debug:
        print("  Mode:     DEBUG — hot-reload enabled")
    print("=" * 60)
    print("Press Ctrl+C to stop the server.\n")

    check_port_available(host, port)

    try:
        is_frozen = getattr(sys, "frozen", False)
        if is_frozen:
            from app.main import app  # noqa: E402
            uvicorn.run(
                app,
                host=host,
                port=port,
                reload=False,
            )
        else:
            uvicorn.run(
                "app.main:app",
                host=host,
                port=port,
                app_dir=BACKEND_DIR,
                reload=debug,
            )
    except OSError as err:
        print("\n" + "!" * 60, file=sys.stderr)
        print(f"[ERROR] Port {port} is already occupied or unavailable on {host}.", file=sys.stderr)
        print("Kiroku Note could not start because another process is using this port.", file=sys.stderr)
        print("To use a different port, set the KIROKU_PORT environment variable (e.g. set KIROKU_PORT=21829).", file=sys.stderr)
        print(f"Original error: {err}", file=sys.stderr)
        print("!" * 60 + "\n", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    start_server()
