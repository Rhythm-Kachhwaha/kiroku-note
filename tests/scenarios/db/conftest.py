"""
Pytest configuration for db module hardening scenarios.
Ensures repository root and backend directory are in sys.path.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add repo root and backend to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

for p in (REPO_ROOT, BACKEND_DIR):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)

