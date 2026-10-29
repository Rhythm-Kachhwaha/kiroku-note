from fastapi.testclient import TestClient

from app.api import grammar
from app.main import app


class Provider:
    def tokenize_with_inflection(self, text):
        return [{"text": char, "headwords": []} for char in text]

    def discover_available_dictionaries(self):
        return ["Grammar Dictionary"]

    def check_availability(self):
        return True


def test_analyze_route_returns_spans(monkeypatch, tmp_path):
    from app.services.grammar_service import GrammarService
    monkeypatch.setattr(grammar, "_service", GrammarService(provider=Provider(), db_path=tmp_path / "db.sqlite"))
    response = TestClient(app).post("/api/grammar/analyze", json={"sentence": "宿題を忘れてしまった。"})
    assert response.status_code == 200
    body = response.json()
    assert any(point["pattern_key"] == "てしまう" for point in body["points"])
    assert body["points"][0]["start"] < body["points"][0]["end"]


def test_setup_check_route(monkeypatch, tmp_path):
    from app.services.grammar_service import GrammarService
    monkeypatch.setattr(grammar, "_service", GrammarService(provider=Provider(), db_path=tmp_path / "db.sqlite"))
    response = TestClient(app).post("/api/grammar/setup-check")
    assert response.status_code == 200
    assert response.json()["index_loaded"] is True
