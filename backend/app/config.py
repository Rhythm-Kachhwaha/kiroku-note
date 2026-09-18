"""
Kiroku Note Backend Configuration
---------------------------------
Centralized host, port, and user-data settings for the local FastAPI backend.
"""
from __future__ import annotations

import os
from pathlib import Path
import sys

APP_NAME = "KirokuNote"
APP_VERSION = "1.0.0"

DEFAULT_KIROKU_HOST = "127.0.0.1"
DEFAULT_KIROKU_PORT = 21828

DEFAULT_OCR_HOST = "127.0.0.1"
DEFAULT_OCR_PORT = 21829
DEFAULT_OCR_URL = f"http://{DEFAULT_OCR_HOST}:{DEFAULT_OCR_PORT}"


def get_app_data_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the base user-data directory for Kiroku Note.

    Resolution order:
      1. KIROKU_DATA_DIR (explicit override)
      2. If frozen / packaged executable:
         - Windows: %LOCALAPPDATA%\\KirokuNote (fallback: ~/AppData/Local/KirokuNote)
         - Non-Windows: ~/.kirokunote
      3. Development / source mode:
         - Root backend directory (parent of app package)
    """
    env_dict = os.environ if env is None else env
    custom_dir = env_dict.get("KIROKU_DATA_DIR")
    if custom_dir and str(custom_dir).strip():
        return Path(str(custom_dir).strip())

    if getattr(sys, "frozen", False):
        if sys.platform == "win32" or os.name == "nt":
            local_appdata = env_dict.get("LOCALAPPDATA")
            if local_appdata and str(local_appdata).strip():
                return Path(str(local_appdata).strip()) / APP_NAME
            return Path.home() / "AppData" / "Local" / APP_NAME
        return Path.home() / f".{APP_NAME.lower()}"

    # Development / source repository mode
    return Path(__file__).resolve().parent.parent


def get_data_dir(env: dict[str, str] | None = None) -> Path:
    """Resolve data directory (for SQLite database)."""
    return get_app_data_dir(env) / "data"


def get_media_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve media directory for image and audio storage.

    Precedence:
      1. KIROKU_MEDIA_DIR / ANKIMINER_MEDIA_DIR
      2. When frozen or KIROKU_DATA_DIR set: <app_data_dir>/media
      3. In development default: <app_data_dir>/data/media (preserves backend/data/media)
    """
    env_dict = os.environ if env is None else env
    custom_dir = env_dict.get("KIROKU_MEDIA_DIR") or env_dict.get("ANKIMINER_MEDIA_DIR")
    if custom_dir and str(custom_dir).strip():
        return Path(str(custom_dir).strip())

    if getattr(sys, "frozen", False) or env_dict.get("KIROKU_DATA_DIR"):
        return get_app_data_dir(env) / "media"

    return get_app_data_dir(env) / "data" / "media"


def get_logs_dir(env: dict[str, str] | None = None) -> Path:
    """Resolve logs directory."""
    return get_app_data_dir(env) / "logs"


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


def resolve_ocr_port(env: dict[str, str] | None = None) -> int:
    """
    Resolve the standalone OCR daemon listening port.

    Resolution order:
      1. KIROKU_OCR_PORT
      2. DEFAULT_OCR_PORT (21829)

    Validates that the resulting port is an integer in the valid TCP range 1-65535.
    """
    env_dict = os.environ if env is None else env
    raw = env_dict.get("KIROKU_OCR_PORT")
    if raw is None or not str(raw).strip():
        return DEFAULT_OCR_PORT

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


def resolve_ocr_url(env: dict[str, str] | None = None) -> str:
    """
    Resolve the standalone OCR daemon URL.

    Resolution order:
      1. KIROKU_OCR_URL (e.g. 'http://127.0.0.1:21829')
      2. Derived from resolve_ocr_port(): 'http://127.0.0.1:<port>'
    """
    env_dict = os.environ if env is None else env
    custom_url = env_dict.get("KIROKU_OCR_URL")
    if custom_url and str(custom_url).strip():
        return str(custom_url).strip().rstrip("/")

    port = resolve_ocr_port(env_dict)
    return f"http://{DEFAULT_OCR_HOST}:{port}"


def resolve_ocr_exe_path(env: dict[str, str] | None = None) -> Path | None:
    """
    Resolve the path to the KirokuOCR.exe standalone executable if installed.

    Candidate discovery locations:
      1. KIROKU_OCR_EXE environment variable (explicit override)
      2. In frozen / packaged mode:
         - <app_dir>/ocr/KirokuOCR.exe (Standard Inno Setup {app}/ocr layout)
         - <app_dir>/KirokuOCR.exe
         - %LOCALAPPDATA%/KirokuNote/ocr/KirokuOCR.exe
      3. In development / source repository mode:
         - <repo_root>/dist/ocr/KirokuOCR.exe
         - <repo_root>/dist/ocr/KirokuOCR/KirokuOCR.exe (onedir build)
         - %LOCALAPPDATA%/KirokuNote/ocr/KirokuOCR.exe
    """
    env_dict = os.environ if env is None else env
    custom_exe = env_dict.get("KIROKU_OCR_EXE")
    if custom_exe and str(custom_exe).strip():
        custom_path = Path(str(custom_exe).strip())
        return custom_path if custom_path.is_file() else None

    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.append(exe_dir / "ocr" / "KirokuOCR.exe")
        candidates.append(exe_dir / "ocr" / "KirokuOCR" / "KirokuOCR.exe")
        candidates.append(exe_dir / "KirokuOCR.exe")
    else:
        repo_root = Path(__file__).resolve().parent.parent.parent
        candidates.append(repo_root / "dist" / "ocr" / "KirokuOCR.exe")
        candidates.append(repo_root / "dist" / "ocr" / "KirokuOCR" / "KirokuOCR.exe")

    # Common local appdata location
    if sys.platform == "win32" or os.name == "nt":
        local_appdata = env_dict.get("LOCALAPPDATA")
        if local_appdata and str(local_appdata).strip():
            base_appdata = Path(str(local_appdata).strip()) / APP_NAME
        else:
            base_appdata = Path.home() / "AppData" / "Local" / APP_NAME
        candidates.append(base_appdata / "ocr" / "KirokuOCR.exe")

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    return None


def get_ocr_model_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the directory for offline manga-ocr model weights.

    Precedence:
      1. KIROKU_OCR_MODEL_PATH environment variable
      2. In frozen mode: <app_dir>/ocr/models/manga-ocr-base (if exists) or %LOCALAPPDATA%/KirokuNote/models/manga-ocr-base
      3. In dev mode: <repo_root>/dist/ocr/models/manga-ocr-base or %LOCALAPPDATA%/KirokuNote/models/manga-ocr-base
    """
    env_dict = os.environ if env is None else env
    custom_path = env_dict.get("KIROKU_OCR_MODEL_PATH")
    if custom_path and str(custom_path).strip():
        return Path(str(custom_path).strip())

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        addon_models = exe_dir / "ocr" / "models" / "manga-ocr-base"
        if addon_models.is_dir():
            return addon_models

    return get_app_data_dir(env) / "models" / "manga-ocr-base"


