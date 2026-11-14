import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_tokenize_empty_and_whitespace():
    res = client.post("/api/tokenize", json={"text": "", "mode": "C"})
    assert res.status_code == 200
    assert res.json() == {"tokens": []}

    res_ws = client.post("/api/tokenize", json={"text": "   ", "mode": "C"})
    assert res_ws.status_code == 200
    assert res_ws.json() == {"tokens": []}


def test_tokenize_basic_inflection_and_pos():
    payload = {"text": "食べさせられた", "mode": "A"}
    res = client.post("/api/tokenize", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "tokens" in data
    tokens = data["tokens"]
    assert len(tokens) >= 1

    first = tokens[0]
    assert first["surface"] == "食べ"
    assert first["normalized"] == "食べる"
    assert first["dictionary_form"] == "食べる"
    assert first["reading"] == "タベ"
    assert "動詞" in first["part_of_speech"]
    assert "下一段-バ行" in first["inflection_type"]
    assert "連用形" in first["inflection_form"]


def test_tokenize_split_modes_comparison():
    text = "外国人参政権"

    # Mode A splits into fine-grained units: 外国, 人, 参政, 権
    res_a = client.post("/api/tokenize", json={"text": text, "mode": "A"})
    assert res_a.status_code == 200
    tokens_a = [t["surface"] for t in res_a.json()["tokens"]]
    assert len(tokens_a) > 1
    assert "外国" in tokens_a
    assert "人" in tokens_a

    # Mode C preserves compound units: 外国人参政権
    res_c = client.post("/api/tokenize", json={"text": text, "mode": "C"})
    assert res_c.status_code == 200
    tokens_c = [t["surface"] for t in res_c.json()["tokens"]]
    assert tokens_c == ["外国人参政権"]
    assert tokens_c[0] == text


def test_tokenize_all_required_keys_present():
    res = client.post("/api/tokenize", json={"text": "日本語を勉強する", "mode": "B"})
    assert res.status_code == 200
    tokens = res.json()["tokens"]
    assert len(tokens) > 0

    required_keys = {
        "surface",
        "normalized",
        "dictionary_form",
        "reading",
        "part_of_speech",
        "inflection_type",
        "inflection_form",
    }
    for token in tokens:
        assert required_keys.issubset(token.keys())
        assert isinstance(token["part_of_speech"], list)
        assert isinstance(token["surface"], str)
