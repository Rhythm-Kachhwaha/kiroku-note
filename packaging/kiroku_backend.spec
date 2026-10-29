# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec for Kiroku Note Standalone Windows Backend
===========================================================
Bundles the FastAPI backend, Uvicorn server, and application runtime into a
standalone single-file executable (KirokuNote.exe).

User data, media, SQLite databases, tests, and development docs are NOT bundled.
"""

import os
from pathlib import Path

block_cipher = None

SPEC_DIR = Path(SPEC).resolve().parent
PROJECT_ROOT = SPEC_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"

from PyInstaller.utils.hooks import collect_submodules

VERSION_FILE = PROJECT_ROOT / "packaging" / "version-info.txt"

# Collect all submodules for framework and application runtime
hidden_imports = (
    collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("starlette")
    + collect_submodules("anyio")
    + collect_submodules("app")
    + [
        "sqlite3",
        "pydantic",
        "pydantic_core",
        "sniffio",
        "unicodedata",
        "email.mime.multipart",
        "ctypes",
        "ctypes.wintypes",
        "winreg",
    ]
)

# Exclude heavy unrelated packages if present in the Python environment
excludes = [
    "pytest",
    "_pytest",
    "unittest",
    "tkinter",
    "matplotlib",
    "torch",
    "torchvision",
    "torchaudio",
    "scipy",
    "pandas",
    "numpy",
    "xgboost",
    "lightgbm",
    "keras",
    "tensorflow",
    "jupyter",
    "IPython",
    "cv2",
    "docutils",
    "sphinx",
    "websockets",
    "aiohttp",
    "asyncpg",
    "psycopg2",
]

ICON_PATH = PROJECT_ROOT / "assets" / "icon.ico"
ICON_PNG = PROJECT_ROOT / "assets" / "icon.png"

datas = []
if ICON_PNG.exists():
    datas.append((str(ICON_PNG), "assets"))

DATA_DIR = BACKEND_DIR / "app" / "data"
if DATA_DIR.exists():
    for data_file in DATA_DIR.glob("*.*"):
        if not data_file.name.endswith((".py", ".pyc", ".tmp", ".log", ".bak")):
            datas.append((str(data_file), os.path.join("app", "data")))

# Keep the grammar index explicit: it is a required runtime asset.
GRAMMAR_DB = DATA_DIR / "grammar_reference.sqlite"
if GRAMMAR_DB.exists() and (str(GRAMMAR_DB), os.path.join("app", "data")) not in datas:
    datas.append((str(GRAMMAR_DB), os.path.join("app", "data")))

CLOUD_QUEUE_DIR = PROJECT_ROOT / "kiroku_cloud_queue"
if CLOUD_QUEUE_DIR.exists():
    for py_file in CLOUD_QUEUE_DIR.glob("*.py"):
        datas.append((str(py_file), "kiroku_cloud_queue"))
    cq_data = CLOUD_QUEUE_DIR / "data"
    if cq_data.exists():
        for data_file in cq_data.glob("*.*"):
            if not data_file.name.endswith((".py", ".pyc", ".tmp")):
                datas.append((str(data_file), os.path.join("kiroku_cloud_queue", "data")))

hidden_imports.extend([
    "worker",
    "queue_adapter",
    "enrichment",
    "env_utils",
    "kiroku_client",
    "queue_db",
    "queue_store",
    "anki_mirror",
    "anki_stats",
])
hidden_imports.extend(collect_submodules("kiroku_dictionary"))

a = Analysis(
    [str(PROJECT_ROOT / "run_backend.py")],
    pathex=[str(PROJECT_ROOT), str(BACKEND_DIR), str(CLOUD_QUEUE_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(
    a.pure,
    a.zipped_data,
    cipher=block_cipher,
)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="KirokuNote",
    exclude_binaries=True,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=str(VERSION_FILE),
    icon=str(ICON_PATH) if ICON_PATH.exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="KirokuNote",
)
