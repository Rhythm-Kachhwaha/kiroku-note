"""Pytest fixtures for dictionary golden and performance tests."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from kiroku_dictionary.importer import build_database
from tests.fixtures.dict.generate import (
    create_synthetic_jitendex_zip,
    create_synthetic_kanjidic_zip,
)


@pytest.fixture(scope="session")
def synthetic_dict_db_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build a tiny, deterministic dictionary SQLite database from synthetic Yomitan zips."""
    base_dir = tmp_path_factory.mktemp("synthetic_dict_source")
    jitendex_zip = base_dir / "jitendex_synthetic.zip"
    kanjidic_zip = base_dir / "kanjidic_synthetic.zip"
    db_out = base_dir / "kiroku_dict.sqlite"

    create_synthetic_jitendex_zip(jitendex_zip)
    create_synthetic_kanjidic_zip(kanjidic_zip)

    build_database(
        jitendex_path=str(jitendex_zip),
        kanjidic_path=str(kanjidic_zip),
        output_db_path=str(db_out),
    )

    return db_out


@pytest.fixture
def configured_dict_service(synthetic_dict_db_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Configure YomitanService to use the synthetic fixture DB."""
    from app.services.yomitan import (
        YomitanService,
        get_dictionary_service,
        reset_dictionary_service,
    )

    reset_dictionary_service()
    monkeypatch.setenv("KIROKU_DICTIONARY_DB_PATH", str(synthetic_dict_db_path))
    monkeypatch.setenv("DICTIONARY_BACKEND", "local")
    monkeypatch.delenv("KIROKU_YOMITAN_SECONDARY", raising=False)

    service = get_dictionary_service()
    yield service
    reset_dictionary_service()
