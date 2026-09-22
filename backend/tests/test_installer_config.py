"""
Automated unit and static validation tests for the Inno Setup installer configuration (installer/kiroku_setup.iss).
"""
from pathlib import Path
import re
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INSTALLER_DIR = REPO_ROOT / "installer"
ISS_PATH = INSTALLER_DIR / "kiroku_setup.iss"
INSTRUCTIONS_PATH = INSTALLER_DIR / "extension_instructions.txt"
DIST_BACKEND_EXE = REPO_ROOT / "dist" / "backend" / "KirokuNote" / "KirokuNote.exe"
DIST_EXTENSION_UNPACKED = REPO_ROOT / "dist" / "extension" / "unpacked"


def test_installer_files_exist():
    assert INSTALLER_DIR.is_dir(), f"Missing installer directory at: {INSTALLER_DIR}"
    assert ISS_PATH.is_file(), f"Missing Inno Setup script at: {ISS_PATH}"
    assert INSTRUCTIONS_PATH.is_file(), f"Missing extension instructions at: {INSTRUCTIONS_PATH}"


def test_installer_metadata_and_architecture():
    content = ISS_PATH.read_text(encoding="utf-8")

    # Verify AppName and Version definitions
    assert re.search(r'#define\s+MyAppName\s+"Kiroku Note"', content), "MyAppName must be 'Kiroku Note'"
    assert re.search(r'#define\s+MyAppVersion\s+"1\.0\.0"', content), "MyAppVersion must be '1.0.0'"
    assert re.search(r'#define\s+MyAppExeName\s+"KirokuNote\.exe"', content), "MyAppExeName must be 'KirokuNote.exe'"

    # Verify 64-bit architecture settings
    assert "ArchitecturesInstallIn64BitMode=x64compatible" in content or "ArchitecturesInstallIn64BitMode=x64" in content
    assert "ArchitecturesAllowed=x64compatible" in content or "ArchitecturesAllowed=x64" in content

    # Verify admin privileges and output settings
    assert "PrivilegesRequired=lowest" in content
    assert "OutputBaseFilename=Kiroku-Note-Setup-v{#MyAppVersion}" in content


def test_installer_payload_sources_exist():
    content = ISS_PATH.read_text(encoding="utf-8")

    # Verify backend executable exists and is referenced
    assert r'Source: "..\dist\backend\KirokuNote\*"' in content
    if not DIST_BACKEND_EXE.exists():
        pytest.skip("Release backend has not been built")
    assert DIST_BACKEND_EXE.is_file(), f"Expected backend binary at {DIST_BACKEND_EXE}"

    # Verify extension runtime directory exists and is referenced
    assert r'Source: "..\dist\extension\unpacked\*"' in content
    if not DIST_EXTENSION_UNPACKED.exists():
        pytest.skip("Release extension has not been built")
    assert DIST_EXTENSION_UNPACKED.is_dir(), f"Expected unpacked extension at {DIST_EXTENSION_UNPACKED}"
    assert (DIST_EXTENSION_UNPACKED / "manifest.json").is_file(), "Extension unpacked directory missing manifest.json"

    # Verify extension instructions exist and are referenced
    assert r'Source: "extension_instructions.txt"' in content
    assert INSTRUCTIONS_PATH.is_file(), f"Expected instructions file at {INSTRUCTIONS_PATH}"


def test_installer_user_data_isolation():
    """
    Ensure the installer does not bundle user data directories or register
    uninstallation deletions targeting %LOCALAPPDATA% or database files.
    """
    content = ISS_PATH.read_text(encoding="utf-8")

    forbidden_payload_patterns = [
        r"localappdata",
        r"kiroku\.db",
        r"ankiminer\.db",
        r"backend[\\/]data[\\/]media",
        r"%USERPROFILE%",
    ]

    for pattern in forbidden_payload_patterns:
        match = re.search(rf'Source:\s*"[^"]*{pattern}', content, re.IGNORECASE)
        assert not match, f"Forbidden user data source detected in [Files]: {match.group(0) if match else ''}"

    # Verify [UninstallDelete] does not purge localappdata
    if "[UninstallDelete]" in content:
        uninstall_section = content.split("[UninstallDelete]")[1].split("[")[0]
        assert "localappdata" not in uninstall_section.lower(), "UninstallDelete must not touch localappdata"


def test_installer_shortcuts_and_run():
    content = ISS_PATH.read_text(encoding="utf-8")

    # Verify App and Helper Shortcuts
    assert 'Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"' in content
    assert 'Name: "{group}\\Extension Setup Instructions"' in content
    assert 'Name: "{group}\\Open Extension Folder"' in content
    assert 'Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"' in content

    # Verify Post-install Launch
    assert 'Filename: "{app}\\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"' in content
