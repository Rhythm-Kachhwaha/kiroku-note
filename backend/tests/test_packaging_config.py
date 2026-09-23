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
    get_logs_dir,
    get_media_dir,
    resolve_port,
)
from app.db.connection import get_db_path


def test_app_metadata():
    assert APP_NAME == "KirokuNote"
    assert APP_VERSION in ("1.0.0", "1.0.1")


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

    with patch.object(sys, "frozen", True, create=True), patch("sys.platform", "win32"), patch("os.name", "nt"):
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

    with patch.object(sys, "frozen", True, create=True), patch("sys.platform", "win32"), patch("os.name", "nt"):
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
