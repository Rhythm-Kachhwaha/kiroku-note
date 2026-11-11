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
    assert "tokens" in body
    assert isinstance(body["tokens"], list)


def test_setup_check_route(monkeypatch, tmp_path):
    from app.services.grammar_service import GrammarService
    monkeypatch.setattr(grammar, "_service", GrammarService(provider=Provider(), db_path=tmp_path / "db.sqlite"))
    response = TestClient(app).post("/api/grammar/setup-check")
    assert response.status_code == 200
    data = response.json()
    assert data["index_loaded"] is True
    assert "yomitan_available" in data
    assert isinstance(data["yomitan_available"], bool)


def test_grammar_syllabus_route(tmp_path, monkeypatch):
    from app.services.grammar_tracker import GrammarTrackerService
    fake_tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    monkeypatch.setattr(grammar, "_tracker", fake_tracker)

    client = TestClient(app)
    response = client.get("/api/grammar/syllabus?level=N4&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "points" in data
    assert "total" in data
    assert data["total"] > 0
    assert len(data["points"]) <= 5
    point = data["points"][0]
    assert point["level"] == "N4"
    assert point["status"] == "new"


def test_grammar_update_point_status_upsert(tmp_path, monkeypatch):
    from app.services.grammar_tracker import GrammarTrackerService
    fake_tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    monkeypatch.setattr(grammar, "_tracker", fake_tracker)

    client = TestClient(app)
    response = client.patch("/api/grammar/points/hou-ga-ii", json={"status": "learning"})
    assert response.status_code == 200
    data = response.json()
    assert data["pattern_key"] == "hou-ga-ii"
    assert data["status"] == "learning"


def test_grammar_explain_route(monkeypatch, tmp_path):
    from app.services.grammar_service import GrammarService
    monkeypatch.setattr(grammar, "_service", GrammarService(provider=Provider(), db_path=tmp_path / "db.sqlite"))
    response = TestClient(app).post("/api/grammar/explain", json={"text": "宿題を忘れてしまった。"})
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "宿題を忘れてしまった。"
    assert "points" in data
    assert "analysis" in data


def test_grammar_drills_and_dual_track_routes(tmp_path, monkeypatch):
    from app.services.grammar_tracker import GrammarTrackerService
    fake_tracker = GrammarTrackerService(tmp_path / "user.sqlite")
    monkeypatch.setattr(grammar, "_tracker", fake_tracker)

    client = TestClient(app)

    # 1. Record encounter
    enc_res = client.post(
        "/api/grammar/encounters",
        json={
            "pattern_key": "てしまう",
            "display": "〜てしまう",
            "sentence": "忘れてしまった。",
            "source": "video",
        },
    )
    assert enc_res.status_code == 200
    assert enc_res.json()["pipeline_status"] == "encountered"

    # 2. Record drill
    drill_res = client.post(
        "/api/grammar/drills",
        json={
            "pattern_key": "てしまう",
            "modality": "conjugation_cloze",
            "is_correct": True,
            "user_answer": "忘れてしまった",
            "expected_answer": "忘れてしまった",
            "context_sentence": "宿題を[忘れてしまった]。",
        },
    )
    assert drill_res.status_code == 200
    assert drill_res.json()["pipeline_status"] == "practicing"
    assert drill_res.json()["mastery_score"] > 0

    # 3. Get single status
    status_res = client.get("/api/grammar/points/てしまう/status")
    assert status_res.status_code == 200
    st_data = status_res.json()
    assert st_data["pattern_key"] == "てしまう"
    assert st_data["pipeline_status"] == "practicing"
    assert len(st_data["exposure"]["encounters"]) == 1
    assert len(st_data["mastery"]["drills"]) == 1

    # 4. Batch status
    batch_res = client.post("/api/grammar/batch-status", json={"pattern_keys": ["てしまう", "未知"]})
    assert batch_res.status_code == 200
    b_data = batch_res.json()["results"]
    assert len(b_data) == 2
    assert b_data[0]["pipeline_status"] == "practicing"
    assert b_data[1]["pipeline_status"] == "unseen"


