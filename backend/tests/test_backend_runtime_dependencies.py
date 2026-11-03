"""Regression checks for dependencies required while registering backend routes."""
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS_PATH = REPO_ROOT / "backend" / "requirements.txt"
SPEC_PATH = REPO_ROOT / "packaging" / "kiroku_backend.spec"


def test_multipart_dependency_is_declared_for_file_upload_routes():
    requirements = REQUIREMENTS_PATH.read_text(encoding="utf-8").lower()
    assert "python-multipart" in requirements


def test_multipart_dependency_is_included_in_frozen_backend():
    spec = SPEC_PATH.read_text(encoding="utf-8")
    assert '"multipart"' in spec
