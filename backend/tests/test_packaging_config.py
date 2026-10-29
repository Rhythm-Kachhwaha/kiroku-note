"""
Unit tests for packaging configuration, user-data path resolution, and platform-aware defaults.
"""
from pathlib import Path
import sys
from unittest.mock import patch

import pytest

from app.config import (
    APP_NAME,
    APP_VERSION,
    get_app_data_dir,
    get_data_dir,
    get_db_path as config_get_db_path,
    get_logs_dir,
    get_media_dir,
    resolve_port,
)
from app.db.connection import get_db_path



def test_app_metadata():
    assert APP_NAME == "KirokuNote"
    assert APP_VERSION in ("1.0.0", "1.0.1", "2.0.0", "2.1.0")


def test_packaging_includes_grammar_reference_database():
    spec = Path(__file__).resolve().parents[2] / "packaging" / "kiroku_backend.spec"
    text = spec.read_text(encoding="utf-8")
    assert "grammar_reference.sqlite" in text
    assert 'os.path.join("app", "data")' in text


def test_dev_mode_data_dir_resolution():
    with patch.object(sys, "frozen", False, create=True):
        app_data = get_app_data_dir({})
        assert app_data.is_dir() or app_data.name == "backend"
        
        data_dir = get_data_dir({})
        assert data_dir == app_data / "data"
        
        logs_dir = get_logs_dir({})
        assert logs_dir == app_data / "logs"
        
        media_dir = get_media_dir({})
        assert media_dir == app_data / "data" / "media"


def test_frozen_mode_windows_localappdata_resolution(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    fake_localappdata.mkdir(parents=True)
    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", True, create=True), patch("sys.platform", "win32"):
        app_data = get_app_data_dir(env)
        expected_root = fake_localappdata / "KirokuNote"
        assert app_data == expected_root

        data_dir = get_data_dir(env)
        assert data_dir == expected_root / "data"

        logs_dir = get_logs_dir(env)
        assert logs_dir == expected_root / "logs"

        media_dir = get_media_dir(env)
        assert media_dir == expected_root / "media"

        db_path = get_db_path(env)
        assert db_path == expected_root / "data" / "kiroku.db"


def test_frozen_mode_fallback_to_legacy_db_if_exists(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    legacy_db = fake_localappdata / "KirokuNote" / "data" / "ankiminer.db"
    legacy_db.parent.mkdir(parents=True)
    legacy_db.write_text("legacy_marker")

    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", True, create=True), patch("sys.platform", "win32"):
        db_path = get_db_path(env)
        assert db_path == legacy_db


def test_kiroku_data_dir_override(tmp_path: Path):
    custom_root = tmp_path / "custom_kiroku_root"
    custom_root.mkdir()
    env = {"KIROKU_DATA_DIR": str(custom_root)}

    with patch.object(sys, "frozen", True, create=True):
        app_data = get_app_data_dir(env)
        assert app_data == custom_root
        assert get_data_dir(env) == custom_root / "data"
        assert get_media_dir(env) == custom_root / "media"
        assert get_logs_dir(env) == custom_root / "logs"
        assert get_db_path(env) == custom_root / "data" / "kiroku.db"


def test_explicit_env_path_overrides(tmp_path: Path):
    custom_db = tmp_path / "explicit" / "test.db"
    custom_media = tmp_path / "explicit_media"
    env = {
        "KIROKU_DB_PATH": str(custom_db),
        "KIROKU_MEDIA_DIR": str(custom_media),
    }

    with patch.object(sys, "frozen", True, create=True):
        assert get_db_path(env) == custom_db
        assert get_media_dir(env) == custom_media


def test_legacy_ankiminer_env_path_overrides(tmp_path: Path):
    custom_db = tmp_path / "legacy_explicit" / "ankiminer_test.db"
    custom_media = tmp_path / "legacy_media"
    env = {
        "ANKIMINER_DB_PATH": str(custom_db),
        "ANKIMINER_MEDIA_DIR": str(custom_media),
    }

    with patch.object(sys, "frozen", True, create=True):
        assert get_db_path(env) == custom_db
        assert get_media_dir(env) == custom_media


def test_precedence_kiroku_over_ankiminer(tmp_path: Path):
    k_db = tmp_path / "k.db"
    a_db = tmp_path / "a.db"
    k_media = tmp_path / "k_media"
    a_media = tmp_path / "a_media"
    env = {
        "KIROKU_DB_PATH": str(k_db),
        "ANKIMINER_DB_PATH": str(a_db),
        "KIROKU_MEDIA_DIR": str(k_media),
        "ANKIMINER_MEDIA_DIR": str(a_media),
    }

    with patch.object(sys, "frozen", True, create=True):
        assert get_db_path(env) == k_db
        assert get_media_dir(env) == k_media


def test_dev_mode_installed_database_windows_resolution(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    installed_dir = fake_localappdata / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_db = installed_dir / "kiroku.db"
    installed_db.write_text("installed_db_content")

    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        assert get_db_path(env) == installed_db
        assert config_get_db_path(env) == installed_db


def test_dev_mode_installed_database_legacy_ankiminer_resolution(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    installed_dir = fake_localappdata / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_legacy_db = installed_dir / "ankiminer.db"
    installed_legacy_db.write_text("legacy_db_content")

    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        assert get_db_path(env) == installed_legacy_db
        assert config_get_db_path(env) == installed_legacy_db


def test_dev_mode_installed_database_posix_resolution(tmp_path: Path):
    fake_home = tmp_path / "home"
    installed_dir = fake_home / ".local" / "share" / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_db = installed_dir / "kiroku.db"
    installed_db.write_text("installed_posix_db")

    env = {"HOME": str(fake_home)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "linux"), patch("pathlib.Path.home", return_value=fake_home):
        assert get_db_path(env) == installed_db
        assert config_get_db_path(env) == installed_db


def test_installed_database_overridden_by_explicit_db_path(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    installed_dir = fake_localappdata / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_db = installed_dir / "kiroku.db"
    installed_db.write_text("installed_db_content")

    custom_db = tmp_path / "custom" / "my.db"
    env = {
        "LOCALAPPDATA": str(fake_localappdata),
        "KIROKU_DB_PATH": str(custom_db),
    }

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        assert get_db_path(env) == custom_db
        assert config_get_db_path(env) == custom_db


def test_installed_database_overridden_by_custom_data_dir(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    installed_dir = fake_localappdata / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_db = installed_dir / "kiroku.db"
    installed_db.write_text("installed_db_content")

    custom_root = tmp_path / "custom_root"
    custom_root.mkdir()
    env = {
        "LOCALAPPDATA": str(fake_localappdata),
        "KIROKU_DATA_DIR": str(custom_root),
    }

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        assert get_db_path(env) == custom_root / "data" / "kiroku.db"
        assert config_get_db_path(env) == custom_root / "data" / "kiroku.db"


def test_dev_mode_installed_database_posix_legacy_resolution(tmp_path: Path):
    fake_home = tmp_path / "home"
    installed_dir = fake_home / ".local" / "share" / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_legacy_db = installed_dir / "ankiminer.db"
    installed_legacy_db.write_text("installed_posix_legacy_db")

    env = {"HOME": str(fake_home)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "linux"), patch("pathlib.Path.home", return_value=fake_home):
        assert get_db_path(env) == installed_legacy_db
        assert config_get_db_path(env) == installed_legacy_db


def test_dev_mode_installed_database_posix_xdg_resolution(tmp_path: Path):
    fake_xdg = tmp_path / "custom_xdg_data"
    installed_dir = fake_xdg / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    installed_db = installed_dir / "kiroku.db"
    installed_db.write_text("xdg_db")

    env = {"XDG_DATA_HOME": str(fake_xdg)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "linux"):
        assert get_db_path(env) == installed_db
        assert config_get_db_path(env) == installed_db


def test_installed_database_prefers_kiroku_over_legacy(tmp_path: Path):
    fake_localappdata = tmp_path / "AppData" / "Local"
    installed_dir = fake_localappdata / "KirokuNote" / "data"
    installed_dir.mkdir(parents=True)
    kiroku_db = installed_dir / "kiroku.db"
    kiroku_db.write_text("new_kiroku")
    ankiminer_db = installed_dir / "ankiminer.db"
    ankiminer_db.write_text("old_anki")

    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        assert get_db_path(env) == kiroku_db
        assert config_get_db_path(env) == kiroku_db


def test_dev_mode_fallback_when_no_installed_db_exists(tmp_path: Path):
    fake_localappdata = tmp_path / "EmptyAppData" / "Local"
    fake_localappdata.mkdir(parents=True)
    env = {"LOCALAPPDATA": str(fake_localappdata)}

    with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
        expected_dev_path = get_data_dir(env) / "kiroku.db"
        assert get_db_path(env) == expected_dev_path
        assert config_get_db_path(env) == expected_dev_path


def test_dev_mode_resolution_handles_missing_home_dir():
    with patch("pathlib.Path.home", side_effect=RuntimeError("Could not determine home directory.")):
        with patch.object(sys, "frozen", False, create=True), patch("sys.platform", "win32"):
            path = get_db_path({})
            assert path.name == "kiroku.db"
            assert config_get_db_path({}).name == "kiroku.db"


