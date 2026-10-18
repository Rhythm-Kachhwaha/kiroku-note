"""Tests for POST /api/jlpt/batch endpoint."""
import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_batch_jlpt_lookup_list_format(client: TestClient):
    resp = client.post("/api/jlpt/batch", json=["食べる", "見る", "顕著", "xyznonexistent123"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "levels" in data
    levels = data["levels"]
    assert levels["食べる"] == "N5"
    assert levels["見る"] == "N5"
    assert levels["顕著"] == "N1"
    assert levels["xyznonexistent123"] is None


def test_batch_jlpt_lookup_dict_format(client: TestClient):
    resp = client.post("/api/jlpt/batch", json={"expressions": ["食べる", "必要性"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    levels = data["levels"]
    assert levels["食べる"] == "N5"
    assert levels["必要性"] == "N4"


def test_batch_jlpt_lookup_empty(client: TestClient):
    resp = client.post("/api/jlpt/batch", json=[])
    assert resp.status_code == 200
    assert resp.json()["levels"] == {}


def test_batch_jlpt_lookup_invalid_body(client: TestClient):
    resp = client.post("/api/jlpt/batch", json="not a list or dict")
    assert resp.status_code == 422
