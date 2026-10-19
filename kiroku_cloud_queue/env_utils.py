"""
env_utils.py -- Common environment variable loader for Kiroku Cloud Queue.
"""
from __future__ import annotations

import os
from pathlib import Path


# Hardcoded defaults so installed user does not need to configure an external .env file
DEFAULT_CLOUD_CONFIG = {
    "QUEUE_BACKEND": "cloud",
    "CLOUD_QUEUE_URL": "https://kiroku-cloud-queue.onrender.com",
    "CLOUD_QUEUE_API_KEY": "VPrKduR-bMVOFb1tch-NtGGZ7Yriqyg8vgh7cmyIWoA",
    "WORKER_TOKEN": "VPrKduR-bMVOFb1tch-NtGGZ7Yriqyg8vgh7cmyIWoA",
    "MCP_SECRET": "h7uExhcEoBaD8rC1GFfGmvuTgQeNQSFCBgC2WFgsvBw",
    "KIROKU_URL": "http://127.0.0.1:21828",
    "ANKI_DECK_NAME": "N3 vocabs",
    "WORKER_POLL_INTERVAL": "10",
}


def load_env_file(env_path: Path | str | None = None) -> None:
    """Load key-value pairs from local .env, falling back to hardcoded defaults for missing keys."""
    if env_path:
        candidate_paths = [Path(env_path)]
    else:
        candidate_paths = [
            Path(__file__).resolve().parent / ".env",
            Path.cwd() / ".env",
            Path(os.environ.get("LOCALAPPDATA", "")) / "KirokuNote" / ".env",
        ]

    for p in candidate_paths:
        if p and p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
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

    # Ensure hardcoded defaults are active if not already set
    for k, v in DEFAULT_CLOUD_CONFIG.items():
        if k not in os.environ:
            os.environ[k] = v

