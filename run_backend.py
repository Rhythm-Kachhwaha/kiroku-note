"""
Kiroku Note Backend Runner
--------------------------
Convenience script to start the local FastAPI backend server for Kiroku Note.
Runs on http://127.0.0.1:8000.

Environment variables:
  KIROKU_DEBUG=1   Enable development mode: hot-reload + /docs + /redoc.
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

if __name__ == "__main__":
    debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")

    print("=" * 60)
    print("  Kiroku Note Local Backend Server")
    print("  URL:      http://127.0.0.1:8000")
    if debug:
        print("  API Docs: http://127.0.0.1:8000/docs  [DEBUG MODE]")
    else:
        print("  API Docs: disabled  (set KIROKU_DEBUG=1 to enable)")
    print("  Status:   http://127.0.0.1:8000/api/anki/status")
    if debug:
        print("  Mode:     DEBUG — hot-reload enabled")
    print("=" * 60)
    print("Press Ctrl+C to stop the server.\n")

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        app_dir=BACKEND_DIR,
        reload=debug,
    )
