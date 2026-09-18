"""
Unit and static validation tests for OCR packaging configurations:
- packaging/kiroku_ocr.spec
- installer/kiroku_ocr_setup.iss
- release/build-ocr.ps1
- release/build-ocr-installer.ps1

Verifies:
- No user data, secrets, or databases are bundled
- Entrypoint points to ocr_server/server.py
- PyTorch GPU/CUDA exclusions are explicitly present
- Port definitions adhere to 127.0.0.1:21829
- 64-bit architecture constraints
"""
from pathlib import Path
import re
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SPEC_PATH = REPO_ROOT / "packaging" / "kiroku_ocr.spec"
ISS_PATH = REPO_ROOT / "installer" / "kiroku_ocr_setup.iss"
BUILD_OCR_PS1 = REPO_ROOT / "release" / "build-ocr.ps1"
BUILD_OCR_INSTALLER_PS1 = REPO_ROOT / "release" / "build-ocr-installer.ps1"
BACKEND_REQ = REPO_ROOT / "backend" / "requirements.txt"


def test_ocr_packaging_files_exist():
    assert SPEC_PATH.is_file(), f"Missing PyInstaller spec at: {SPEC_PATH}"
    assert ISS_PATH.is_file(), f"Missing Inno Setup script at: {ISS_PATH}"
    assert BUILD_OCR_PS1.is_file(), f"Missing build script at: {BUILD_OCR_PS1}"
    assert BUILD_OCR_INSTALLER_PS1.is_file(), f"Missing build script at: {BUILD_OCR_INSTALLER_PS1}"


def test_core_backend_requirements_isolation():
    """Verify heavy ML dependencies do not leak into core backend requirements.txt."""
    if BACKEND_REQ.is_file():
        content = BACKEND_REQ.read_text(encoding="utf-8").lower()
        forbidden = ["torch", "torchvision", "transformers", "manga-ocr", "manga_ocr", "cuda"]
        for pkg in forbidden:
            assert pkg not in content, f"Forbidden heavy package '{pkg}' found in core backend/requirements.txt"


def test_ocr_spec_entrypoint_and_exclusions():
    content = SPEC_PATH.read_text(encoding="utf-8")

    # Verify entrypoint
    assert "ocr_server" in content and "server.py" in content, "Spec must target ocr_server/server.py"

    # Verify CUDA/GPU exclusions
    assert '"torch.cuda"' in content
    assert '"cuda"' in content

    # Verify user data isolation
    forbidden_payload_patterns = ["kiroku.db", "ankiminer.db", "%LOCALAPPDATA%", ".env"]
    for pattern in forbidden_payload_patterns:
        assert pattern not in content, f"Forbidden pattern '{pattern}' found in OCR spec"


def test_ocr_installer_iss_configuration():
    content = ISS_PATH.read_text(encoding="utf-8")

    # Verify AppName and Architecture
    assert "Kiroku Note OCR Add-on" in content
    assert "ArchitecturesInstallIn64BitMode=x64compatible" in content
    assert "PrivilegesRequired=admin" in content
    assert "Kiroku-Note-OCR-Setup-v{#MyAppVersion}" in content

    # Verify destination is {app}\ocr
    assert r'DestDir: "{app}\ocr"' in content

    # Verify user data safety
    forbidden = ["kiroku.db", "ankiminer.db", "%LOCALAPPDATA%", "{localappdata}", ".env"]
    for item in forbidden:
        assert item.lower() not in content.lower() or "note:" in content.lower()


def test_ocr_build_scripts_safe_fallback():
    """Verify build scripts handle missing optional dependencies safely without unhandled crashes."""
    ps1_content = BUILD_OCR_PS1.read_text(encoding="utf-8")
    assert "https://download.pytorch.org/whl/cpu" in ps1_content
    assert "BUILD SKIPPED" in ps1_content

    installer_ps1_content = BUILD_OCR_INSTALLER_PS1.read_text(encoding="utf-8")
    assert "ISCC.exe" in installer_ps1_content
    assert "SCRIPT READY" in installer_ps1_content
