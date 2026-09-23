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
    + collect_submodules("pystray")
    + [
        "sqlite3",
        "pydantic",
        "pydantic_core",
        "sniffio",
        "unicodedata",
        "email.mime.multipart",
        "PIL.Image",
        "PIL.ImageDraw",
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
]

ICON_PATH = PROJECT_ROOT / "assets" / "icon.ico"
ICON_PNG = PROJECT_ROOT / "assets" / "icon.png"

datas = []
if ICON_PNG.exists():
    datas.append((str(ICON_PNG), "assets"))

JLPT_DB = BACKEND_DIR / "app" / "data" / "jlpt_reference.sqlite"
JLPT_NOTICE = BACKEND_DIR / "app" / "data" / "JLPT_REFERENCE_NOTICE.md"
if JLPT_DB.exists():
    datas.append((str(JLPT_DB), os.path.join("app", "data")))
if JLPT_NOTICE.exists():
    datas.append((str(JLPT_NOTICE), os.path.join("app", "data")))

a = Analysis(
    [str(PROJECT_ROOT / "run_tray.py")],
    pathex=[str(PROJECT_ROOT), str(BACKEND_DIR)],
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
