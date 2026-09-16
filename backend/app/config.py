"""
Kiroku Note Backend Configuration
---------------------------------
Centralized host and port settings for the local FastAPI backend.
"""
from __future__ import annotations

import os

DEFAULT_KIROKU_HOST = "127.0.0.1"
DEFAULT_KIROKU_PORT = 21828


def resolve_port(env: dict[str, str] | None = None) -> int:
    """
    Resolve the backend listening port.

    Resolution order:
      1. KIROKU_PORT
      2. PORT
      3. DEFAULT_KIROKU_PORT (21828)

    Validates that the resulting port is an integer in the valid TCP range 1-65535.
    Raises ValueError with a clear actionable message if the value is invalid.
    """
    env_dict = os.environ if env is None else env
    raw = env_dict.get("KIROKU_PORT") or env_dict.get("PORT")
    if raw is None or not str(raw).strip():
        return DEFAULT_KIROKU_PORT

    raw_str = str(raw).strip()
    try:
        port = int(raw_str)
    except ValueError:
        raise ValueError(
            f"Invalid port value: '{raw_str}'. Port must be an integer between 1 and 65535."
        )

    if not (1 <= port <= 65535):
        raise ValueError(
            f"Port out of range: {port}. Port must be between 1 and 65535."
        )

    return port
