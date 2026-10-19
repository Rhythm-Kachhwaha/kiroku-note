"""
Unit tests for buildsetup.py -- One-Click Setup Builder
"""
from pathlib import Path
import sys

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import buildsetup


def test_get_version():
    version = buildsetup.get_version()
    assert version is not None
    assert isinstance(version, str)
    assert len(version.split(".")) >= 2
    assert version == "2.1.0"


def test_find_iscc():
    iscc = buildsetup.find_iscc()
    # On this Windows machine, ISCC is installed in %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
    if sys.platform == "win32":
        assert iscc is not None
        assert iscc.is_file()
        assert iscc.name.lower() == "iscc.exe"


def test_audit_manifest_resources_passes():
    errors = buildsetup.audit_manifest_resources()
    assert errors == [], f"Expected zero manifest resource errors, got: {errors}"


def test_collect_extension_files():
    pairs = buildsetup.collect_extension_files()
    assert len(pairs) > 10, "Should collect runtime extension files"

    src_paths = [src for src, _ in pairs]
    # Verify critical runtime files are present
    assert any(p.name == "manifest.json" for p in src_paths)
    assert any(p.name == "background.js" for p in src_paths)
    assert any(p.name == "sidepanel.js" for p in src_paths)
    assert any(p.name == "sidepanel.html" for p in src_paths)
    assert any(p.name == "sidepanel.css" for p in src_paths)

    # Verify excluded files are NOT collected
    for src in src_paths:
        assert not src.name.endswith(".test.js"), f"Test file leaked into runtime payload: {src}"
        assert not src.name.endswith(".spec.js"), f"Spec file leaked into runtime payload: {src}"
        assert not src.name.endswith(".md"), f"Markdown file leaked into runtime payload: {src}"
        assert ".git" not in src.parts, f"Git file leaked into runtime payload: {src}"


def test_compute_sha256(tmp_path):
    sample = tmp_path / "sample.txt"
    sample.write_bytes(b"hello world")
    digest = buildsetup.compute_sha256(sample)
    # sha256 of "hello world"
    assert digest == "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
