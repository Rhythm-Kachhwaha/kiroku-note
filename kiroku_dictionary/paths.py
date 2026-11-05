"""
Unified resolution for kiroku_dict.sqlite database path.
Standard library only.
"""
from __future__ import annotations

import os
from pathlib import Path
import sys


def resolve_db_path(custom: str | Path | None = None) -> Path:
    """Resolve the location of the kiroku_dict.sqlite database.

    Priority order:
    1. Explicit custom argument
    2. KIROKU_DICT_SQLITE environment variable
    3. <data_dir>/kiroku_dict.sqlite (via KIROKU_DATA_DIR / ANKIMINER_DATA_DIR)
    4. Frozen executable or sys._MEIPASS directory
    5. Repository root (kiroku_dict.sqlite or backend/data/kiroku_dict.sqlite)
    6. Repository kiroku_cloud_queue directory
    7. %LOCALAPPDATA%/KirokuNote/kiroku_dict.sqlite or ~/.local/share/KirokuNote/kiroku_dict.sqlite
    8. Default fallback (repo root / kiroku_dict.sqlite)
    """
    if custom:
        return Path(custom)

    env_path = os.getenv("KIROKU_DICT_SQLITE")
    if env_path and str(env_path).strip():
        return Path(str(env_path).strip())

    candidates: list[Path] = []

    # 3. <data_dir>/kiroku_dict.sqlite
    data_dir_env = os.getenv("KIROKU_DATA_DIR") or os.getenv("ANKIMINER_DATA_DIR")
    if data_dir_env and str(data_dir_env).strip():
        candidates.append(Path(str(data_dir_env).strip()) / "kiroku_dict.sqlite")
        candidates.append(Path(str(data_dir_env).strip()) / "data" / "kiroku_dict.sqlite")

    # 4. Frozen exe / MEIPASS
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        candidates.append(exe_dir / "kiroku_dict.sqlite")
        candidates.append(exe_dir / "data" / "kiroku_dict.sqlite")
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass) / "kiroku_dict.sqlite")

    # 5. Repo root
    repo_root = Path(__file__).resolve().parent.parent
    candidates.append(repo_root / "kiroku_dict.sqlite")
    candidates.append(repo_root / "backend" / "data" / "kiroku_dict.sqlite")

    # 6. Cloud queue
    candidates.append(repo_root / "kiroku_cloud_queue" / "kiroku_dict.sqlite")

    # 7. %LOCALAPPDATA% / ~/.local/share
    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data and str(local_app_data).strip():
        candidates.append(Path(local_app_data) / "KirokuNote" / "kiroku_dict.sqlite")
        candidates.append(Path(local_app_data) / "KirokuNote" / "data" / "kiroku_dict.sqlite")

    try:
        home = Path.home()
        candidates.append(home / ".local" / "share" / "KirokuNote" / "kiroku_dict.sqlite")
    except Exception:
        pass

    for cand in candidates:
        if cand.is_file():
            return cand

    return repo_root / "kiroku_dict.sqlite"
