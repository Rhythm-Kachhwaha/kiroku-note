# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Spec for Kiroku Note Standalone OCR Daemon (KirokuOCR)
==================================================================
Bundles the standalone OCR FastAPI daemon (ocr_server.server), Uvicorn server,
and CPU-only manga-ocr/PyTorch machine learning dependencies into a dedicated
standalone package (KirokuOCR.exe).

Architecture & Invariants:
- Targets CPU-only PyTorch (torch+cpu).
- Strict exclusion of CUDA/NVIDIA libraries (cuda, cudnn, cublas, nvjitlink).
- Strict exclusion of user data, SQLite databases, media, logs, and development files.
- Collects necessary Hugging Face and Fugashi/Unidic-lite data files.
"""

import os
from pathlib import Path

block_cipher = None

SPEC_DIR = Path(SPEC).resolve().parent
PROJECT_ROOT = SPEC_DIR.parent
OCR_SERVER_DIR = PROJECT_ROOT / "ocr_server"

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

# Collect all required submodules for OCR server and ML runtime
hidden_imports = (
    collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("starlette")
    + collect_submodules("anyio")
    + collect_submodules("ocr_server")
    + collect_submodules("manga_ocr")
    + collect_submodules("transformers")
    + [
        "manga_ocr",
        "torch",
        "transformers",
        "fugashi",
        "unidic_lite",
        "PIL",
        "PIL.Image",
        "numpy",
        "jaconv",
        "loguru",
        "sniffio",
        "unicodedata",
    ]
)

# Collect required metadata and model configuration assets
datas = []
try:
    datas += collect_data_files("transformers")
    datas += collect_data_files("unidic_lite")
    datas += copy_metadata("transformers")
    datas += copy_metadata("tokenizers")
    datas += copy_metadata("tqdm")
    datas += copy_metadata("regex")
    datas += copy_metadata("requests")
    datas += copy_metadata("packaging")
    datas += copy_metadata("filelock")
    datas += copy_metadata("numpy")
    datas += copy_metadata("manga_ocr")
    datas += copy_metadata("fugashi")
    datas += copy_metadata("unidic_lite")
except Exception:
    pass

# Exclude CUDA, GPU, GUI, testing, and heavy unrelated packages
excludes = [
    # Testing & docs
    "pytest",
    "_pytest",
    "unittest",
    "docutils",
    "sphinx",
    "tkinter",
    "matplotlib",
    "scipy",
    "pandas",
    "xgboost",
    "lightgbm",
    "keras",
    "tensorflow",
    "jupyter",
    "IPython",
    "cv2",
    # CUDA / GPU components (strictly CPU only)
    "caffe2",
    "cuda",
    "triton",
]

a = Analysis(
    [str(PROJECT_ROOT / "ocr_server" / "server.py")],
    pathex=[str(PROJECT_ROOT), str(OCR_SERVER_DIR)],
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
    [],
    exclude_binaries=True,
    name="KirokuOCR",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="KirokuOCR",
)
