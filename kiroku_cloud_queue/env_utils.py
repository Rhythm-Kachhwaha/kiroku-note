"""
env_utils.py -- Common environment variable loader for Kiroku Cloud Queue.
"""
from __future__ import annotations

import os
from pathlib import Path


def load_env_file(env_path: Path | str | None = None) -> None:
    """Load key-value pairs from local .env without overwriting existing environment."""
    path = Path(env_path) if env_path else Path(__file__).resolve().parent / ".env"
    if path.is_file():
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass
