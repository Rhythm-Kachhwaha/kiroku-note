"""Tests for Yomitan optional secondary wiring and dictionary settings."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.yomitan import (
    DictionaryEntry,
    IdentifiedTerm,
    YomitanService,
    reset_dictionary_service,
)


@pytest.fixture(autouse=True)
def clean_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_dir = tmp_path / "kiroku_data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("KIROKU_DATA_DIR", str(data_dir))
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "localappdata"))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "userprofile"))
    monkeypatch.delenv("KIROKU_YOMITAN_SECONDARY", raising=False)
    monkeypatch.delenv("KIROKU_DICTIONARY_YOMITAN_SECONDARY", raising=False)
    monkeypatch.delenv("DICTIONARY_BACKEND", raising=False)
    monkeypatch.delenv("KIROKU_DICTIONARY_BACKEND", raising=False)

    db_path = data_dir / "kiroku.db"
    init_db(db_path)
    reset_dictionary_service()
    yield
    reset_dictionary_service()


def test_dictionary_settings_api_get_and_put():
    client = TestClient(app)

    # Initial GET
    res = client.get("/api/dictionary/settings")
    assert res.status_code == 200, res.text
    data = res.json()
    assert "yomitan_secondary" in data
    assert "backend" in data

    # PUT update yomitan_secondary to True
    res_put = client.put(
        "/api/dictionary/settings",
        json={"yomitan_secondary": True},
    )
    assert res_put.status_code == 200, res_put.text
    assert res_put.json()["yomitan_secondary"] is True

    # Check status endpoint reflects it
    res_status = client.get("/api/dictionary/status")
    assert res_status.status_code == 200
    assert res_status.json()["yomitan_secondary"] is True

    # PUT update yomitan_secondary to False
    res_put_false = client.put(
        "/api/dictionary/settings",
        json={"yomitan_secondary": False},
    )
    assert res_put_false.status_code == 200
    assert res_put_false.json()["yomitan_secondary"] is False

    # Check status reflects False
    res_status2 = client.get("/api/dictionary/status")
    assert res_status2.json()["yomitan_secondary"] is False


def test_yomitan_secondary_enrich_local_first_dedupe():
    # Mock local provider
    local_mock = MagicMock()
    local_mock.fetch_term_payload.return_value = {
        "dictionaryEntries": [
            {
                "headwords": [{"term": "食べる", "reading": "たべる"}],
                "definitions": [
                    {
                        "dictionary": "Jitendex",
                        "headwordIndices": [0],
                        "entries": ["to eat"],
                    }
                ],
            }
        ]
    }
    local_mock.fetch_kanji_payload.return_value = []
    local_mock.check_availability.return_value = True

    # Mock yomitan provider returning duplicate for 食べる and unique for 飲む
    yomi_mock = MagicMock()
    yomi_mock.fetch_term_payload.return_value = {
        "dictionaryEntries": [
            {
                "headwords": [{"term": "食べる", "reading": "たべる"}],
                "definitions": [
                    {
                        "dictionary": "JMdict",
                        "headwordIndices": [0],
                        "entries": ["to eat (yomitan copy)"],
                    }
                ],
            },
            {
                "headwords": [{"term": "飲む", "reading": "のむ"}],
                "definitions": [
                    {
                        "dictionary": "JMdict",
                        "headwordIndices": [0],
                        "entries": ["to drink"],
                    }
                ],
            },
        ]
    }
    yomi_mock.check_availability.return_value = True

    service = YomitanService(
        backend="local",
        yomitan_secondary=True,
    )
    service._local_provider = local_mock
    service._yomitan_provider = yomi_mock

    term = IdentifiedTerm("食べる", "たべる", "食べる", "食べる")
    enriched = service.enrich(term)

    assert enriched.expression == "食べる"
    assert len(enriched.entries) == 2

    # Entry 1 must be local
    e1 = enriched.entries[0]
    assert e1.term == "食べる"
    assert e1.reading == "たべる"
    assert e1.dictionary == "Jitendex"
    assert getattr(e1, "source", "") == "local"

    # Entry 2 must be the novel Yomitan entry (飲む), since duplicate 食べる was deduped
    e2 = enriched.entries[1]
    assert e2.term == "飲む"
    assert e2.reading == "のむ"
    assert e2.dictionary == "JMdict"
    assert getattr(e2, "source", "") == "yomitan"


def test_yomitan_secondary_failure_degrades_gracefully():
    local_mock = MagicMock()
    local_mock.fetch_term_payload.return_value = {
        "dictionaryEntries": [
            {
                "headwords": [{"term": "本", "reading": "ほん"}],
                "definitions": [
                    {
                        "dictionary": "Jitendex",
                        "headwordIndices": [0],
                        "entries": ["book"],
                    }
                ],
            }
        ]
    }
    local_mock.fetch_kanji_payload.return_value = []
    local_mock.check_availability.return_value = True

    yomi_mock = MagicMock()
    yomi_mock.fetch_term_payload.side_effect = RuntimeError("Connection refused: Yomitan is down")
    yomi_mock.check_availability.return_value = False

    service = YomitanService(
        backend="local",
        yomitan_secondary=True,
    )
    service._local_provider = local_mock
    service._yomitan_provider = yomi_mock

    term = IdentifiedTerm("本", "ほん", "本", "本")
    # Must NOT raise exception despite Yomitan failing
    enriched = service.enrich(term)

    assert enriched.expression == "本"
    assert len(enriched.entries) == 1
    assert enriched.entries[0].dictionary == "Jitendex"
    assert getattr(enriched.entries[0], "source", "") == "local"
    assert enriched.dictionary_error is None
