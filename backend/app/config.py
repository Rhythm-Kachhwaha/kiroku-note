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
APP_VERSION = "1.0.1"

DEFAULT_KIROKU_HOST = "127.0.0.1"
DEFAULT_KIROKU_PORT = 21828

DEFAULT_OCR_HOST = "127.0.0.1"
DEFAULT_OCR_PORT = 21829
DEFAULT_OCR_URL = f"http://{DEFAULT_OCR_HOST}:{DEFAULT_OCR_PORT}"


def get_app_data_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the base user-data directory for Kiroku Note.

    Resolution order:
      1. KIROKU_DATA_DIR environment variable (explicit override)
      2. In frozen / packaged mode: %LOCALAPPDATA%/KirokuNote (Windows) or ~/.local/share/KirokuNote
      3. In development mode: <repo_root>/backend/data (project-local for safety)
    """
    env_dict = os.environ if env is None else env
    custom = env_dict.get("KIROKU_DATA_DIR") or env_dict.get("ANKIMINER_DATA_DIR")
    if custom and str(custom).strip():
        return Path(str(custom).strip())

    if getattr(sys, "frozen", False):
        if sys.platform == "win32" or os.name == "nt":
            local_appdata = env_dict.get("LOCALAPPDATA")
            if local_appdata and str(local_appdata).strip():
                return Path(str(local_appdata).strip()) / APP_NAME
            return Path.home() / "AppData" / "Local" / APP_NAME
        return Path.home() / ".local" / "share" / APP_NAME

    return Path(__file__).resolve().parent.parent


def get_data_dir(env: dict[str, str] | None = None) -> Path:
    """Resolve data directory."""
    app_dir = get_app_data_dir(env)
    return app_dir / "data"


def get_logs_dir(env: dict[str, str] | None = None) -> Path:
    """Resolve logs directory."""
    app_dir = get_app_data_dir(env)
    return app_dir / "logs"


def get_db_path(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the SQLite database file path.

    Resolution order:
      1. KIROKU_DB_PATH environment variable (explicit override)
      2. <app_data_dir>/data/kiroku.db
    """
    env_dict = os.environ if env is None else env
    custom = env_dict.get("KIROKU_DB_PATH") or env_dict.get("ANKIMINER_DB_PATH")
    if custom and str(custom).strip():
        return Path(str(custom).strip())

    return get_data_dir(env_dict) / "kiroku.db"


def get_media_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the media storage directory.

    Resolution order:
      1. KIROKU_MEDIA_DIR environment variable (explicit override)
      2. <app_data_dir>/media or <app_data_dir>/data/media (dev)
    """
    env_dict = os.environ if env is None else env
    custom = env_dict.get("KIROKU_MEDIA_DIR") or env_dict.get("ANKIMINER_MEDIA_DIR")
    if custom and str(custom).strip():
        return Path(str(custom).strip())

    if getattr(sys, "frozen", False):
        return get_app_data_dir(env_dict) / "media"
    return get_app_data_dir(env_dict) / "data" / "media"


def get_ocr_model_dir(env: dict[str, str] | None = None) -> Path:
    """
    Resolve the directory for the pinned manga-ocr offline model weights.

    Resolution order:
      1. KIROKU_OCR_MODEL_PATH environment variable (explicit override)
      2. In frozen mode: <app_dir>/ocr/models/manga-ocr-base or <app_dir>/models/manga-ocr-base
      3. %LOCALAPPDATA%/KirokuNote/models/manga-ocr-base
      4. In dev mode: <repo_root>/backend/data/models/manga-ocr-base
    """
    env_dict = os.environ if env is None else env
    custom = env_dict.get("KIROKU_OCR_MODEL_PATH")
    if custom and str(custom).strip():
        return Path(str(custom).strip())

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        for candidate in [
            exe_dir / "ocr" / "models" / "manga-ocr-base",
            exe_dir / "models" / "manga-ocr-base",
            exe_dir / "ocr" / "models",
            exe_dir / "models",
        ]:
            if candidate.is_dir():
                return candidate

    return get_data_dir(env_dict) / "models" / "manga-ocr-base"


def resolve_port(env: dict[str, str] | None = None) -> int:
    """
    Resolve the backend listening port.

    Resolution order:
      1. KIROKU_PORT environment variable (integer)
      2. DEFAULT_KIROKU_PORT (21828)

    Validates that the resulting port is an integer in the valid TCP range 1-65535.
    """
    env_dict = os.environ if env is None else env
    raw = env_dict.get("KIROKU_PORT") or env_dict.get("ANKIMINER_PORT") or env_dict.get("PORT")
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


def _get_registry_install_paths() -> list[Path]:
    """Discover installation directories registered by Inno Setup in Windows Registry."""
    if sys.platform != "win32" and os.name != "nt":
        return []

    discovered: list[Path] = []
    seen: set[str] = set()

    def _add_path(raw_p: str | None) -> None:
        if not raw_p:
            return
        p_str = str(raw_p).strip()
        if not p_str or p_str.lower() in seen:
            return
        seen.add(p_str.lower())
        try:
            discovered.append(Path(p_str))
        except Exception:
            pass

    try:
        import winreg

        uninstall_key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"
        for root_hkey in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(root_hkey, uninstall_key_path) as root_key:
                    num_subkeys = winreg.QueryInfoKey(root_key)[0]
                    for i in range(num_subkeys):
                        try:
                            subkey_name = winreg.EnumKey(root_key, i)
                            with winreg.OpenKey(root_key, subkey_name) as subkey:
                                is_match = (
                                    "8B84B425-4521-4E65-A6FB-1EE08C36A780" in subkey_name
                                    or "C4318E29-22B4-463F-A238-C6207FB8652A" in subkey_name
                                )
                                if not is_match:
                                    try:
                                        display_name, _ = winreg.QueryValueEx(subkey, "DisplayName")
                                        if "Kiroku" in str(display_name):
                                            is_match = True
                                    except OSError:
                                        pass

                                if is_match:
                                    for val_name in ("InstallLocation", "Inno Setup: App Path"):
                                        try:
                                            loc, _ = winreg.QueryValueEx(subkey, val_name)
                                            _add_path(loc)
                                        except OSError:
                                            continue
                        except OSError:
                            continue
            except OSError:
                continue
    except Exception:
        pass

    return discovered


def resolve_ocr_exe_path(env: dict[str, str] | None = None) -> Path | None:
    """
    Resolve the path to the KirokuOCR.exe standalone executable if installed.

    Candidate discovery locations:
      1. KIROKU_OCR_EXE environment variable (explicit override)
      2. Windows Registry InstallLocations (Inno Setup registered paths)
      3. In frozen / packaged mode:
         - <app_dir>/ocr/KirokuOCR.exe (Standard Inno Setup {app}/ocr layout)
         - <app_dir>/ocr/KirokuOCR/KirokuOCR.exe
         - <app_dir>/KirokuOCR.exe
         - Adjacent directories (<app_dir>ocr/ocr/KirokuOCR.exe, <app_dir>ocr/KirokuOCR.exe)
      4. In development / source repository mode:
         - <repo_root>/dist/ocr/KirokuOCR.exe
         - <repo_root>/dist/ocr/KirokuOCR/KirokuOCR.exe (onedir build)
      5. Common local appdata:
         - %LOCALAPPDATA%/KirokuNote/ocr/KirokuOCR.exe
         - %LOCALAPPDATA%/Programs/Kiroku Note/ocr/KirokuOCR.exe
    """
    env_dict = os.environ if env is None else env
    custom_exe = env_dict.get("KIROKU_OCR_EXE")
    if custom_exe and str(custom_exe).strip():
        custom_path = Path(str(custom_exe).strip())
        return custom_path if custom_path.is_file() else None

    candidates: list[Path] = []

    # 1. Registry discovery
    for reg_path in _get_registry_install_paths():
        candidates.append(reg_path / "ocr" / "KirokuOCR.exe")
        candidates.append(reg_path / "ocr" / "KirokuOCR" / "KirokuOCR.exe")
        candidates.append(reg_path / "KirokuOCR.exe")
        candidates.append(reg_path / "Kiroku Note" / "ocr" / "KirokuOCR.exe")

    # 2. Frozen mode discovery
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.append(exe_dir / "ocr" / "KirokuOCR.exe")
        candidates.append(exe_dir / "ocr" / "KirokuOCR" / "KirokuOCR.exe")
        candidates.append(exe_dir / "KirokuOCR.exe")
        parent_dir = exe_dir.parent
        dir_name = exe_dir.name
        candidates.append(parent_dir / f"{dir_name}ocr" / "ocr" / "KirokuOCR.exe")
        candidates.append(parent_dir / f"{dir_name}ocr" / "KirokuOCR.exe")
    else:
        repo_root = Path(__file__).resolve().parent.parent.parent
        candidates.append(repo_root / "dist" / "ocr" / "KirokuOCR.exe")
        candidates.append(repo_root / "dist" / "ocr" / "KirokuOCR" / "KirokuOCR.exe")

    # 3. Common LocalAppData locations
    if sys.platform == "win32" or os.name == "nt":
        local_appdata = env_dict.get("LOCALAPPDATA")
        if local_appdata and str(local_appdata).strip():
            base_local = Path(str(local_appdata).strip())
        else:
            base_local = Path.home() / "AppData" / "Local"
        
        candidates.append(base_local / APP_NAME / "ocr" / "KirokuOCR.exe")
        candidates.append(base_local / "Programs" / "Kiroku Note" / "ocr" / "KirokuOCR.exe")
        candidates.append(base_local / "Programs" / "Kiroku Note" / "ocr" / "KirokuOCR" / "KirokuOCR.exe")

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    return None


def resolve_ocr_dev_command(env: dict[str, str] | None = None) -> list[str] | None:
    """
    Resolve development OCR command using run_ocr.py and .venv-ocr if present.
    Used exclusively in development mode when a packaged binary is not present.
    """
    if getattr(sys, "frozen", False):
        return None

    env_dict = os.environ if env is None else env
    if "KIROKU_OCR_EXE" in env_dict:
        return None

    repo_root = Path(__file__).resolve().parent.parent.parent
    run_ocr_py = repo_root / "run_ocr.py"
    if not run_ocr_py.is_file():
        return None

    if sys.platform == "win32" or os.name == "nt":
        venv_py = repo_root / ".venv-ocr" / "Scripts" / "python.exe"
    else:
        venv_py = repo_root / ".venv-ocr" / "bin" / "python"

    py_bin = str(venv_py) if venv_py.is_file() else sys.executable
    return [py_bin, str(run_ocr_py)]
