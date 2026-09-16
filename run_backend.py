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

import os
import sys
import uvicorn

# Ensure the backend directory is on sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.config import DEFAULT_KIROKU_HOST, DEFAULT_KIROKU_PORT, resolve_port  # noqa: E402


def start_server() -> None:
    debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")

    try:
        port = resolve_port()
    except ValueError as err:
        print(f"\n[ERROR] Port configuration error: {err}", file=sys.stderr)
        sys.exit(1)

    host = DEFAULT_KIROKU_HOST
    url = f"http://{host}:{port}"

    print("=" * 60)
    print("  Kiroku Note Local Backend Server")
    print(f"  URL:      {url}")
    if debug:
        print(f"  API Docs: {url}/docs  [DEBUG MODE]")
    else:
        print("  API Docs: disabled  (set KIROKU_DEBUG=1 to enable)")
    print(f"  Status:   {url}/api/anki/status")
    if debug:
        print("  Mode:     DEBUG — hot-reload enabled")
    print("=" * 60)
    print("Press Ctrl+C to stop the server.\n")

    try:
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
    start_server()
