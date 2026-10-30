"""
Automated tests for Study Data Exclusion from Git, PyInstaller, and Inno Setup.
-------------------------------------------------------------------------------
Ensures that:
- .gitignore excludes study.db, study directories, media, and backups
- packaging/kiroku_backend.spec bundles study migrations while omitting user databases
- installer/kiroku_setup.iss preserves study directories in user data
"""
from __future__ import annotations

from pathlib import Path


def test_gitignore_excludes_study_data():
    """Verify that .gitignore explicitly ignores study databases and user folders."""
    repo_root = Path(__file__).resolve().parents[2]
    gitignore_path = repo_root / ".gitignore"
    assert gitignore_path.is_file()

    text = gitignore_path.read_text(encoding="utf-8")
    assert "study.db*" in text
    assert "backend/study/" in text
    assert "backend/data/study/" in text
    assert "study-v*-to-v*.db*" in text


def test_pyinstaller_spec_bundles_migrations_and_excludes_user_databases():
    """Verify kiroku_backend.spec bundles SQL migrations but not study.db."""
    repo_root = Path(__file__).resolve().parents[2]
    spec_path = repo_root / "packaging" / "kiroku_backend.spec"
    assert spec_path.is_file()

    text = spec_path.read_text(encoding="utf-8")
    # Must bundle migrations
    assert "STUDY_MIGRATIONS_DIR" in text
    assert 'os.path.join("app", "study", "migrations")' in text
    # Must NOT bundle user study databases
    assert "study.db" not in text


def test_inno_setup_preserves_study_user_data_directories():
    """Verify kiroku_setup.iss declares study user data directories."""
    repo_root = Path(__file__).resolve().parents[2]
    iss_path = repo_root / "installer" / "kiroku_setup.iss"
    assert iss_path.is_file()

    text = iss_path.read_text(encoding="utf-8")
    assert '{localappdata}\\KirokuNote\\study"' in text
    assert '{localappdata}\\KirokuNote\\study\\media"' in text
    assert '{localappdata}\\KirokuNote\\study\\backups"' in text

