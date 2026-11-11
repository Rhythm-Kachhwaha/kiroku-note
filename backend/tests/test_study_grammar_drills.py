"""Tests for Phase G3 (Roadmap endpoints) and Phase G4 (Grammar production drills)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.grammar import grammar_router
from app.db.connection import get_db_path, init_db
from app.main import app
from app.study.grammar_drills import GrammarDrillService
from app.study.grammar_roadmap import GrammarRoadmapService
from app.services.grammar_tracker import GrammarTrackerService


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db = tmp_path / "test_kiroku.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(test_db))
    init_db(test_db)

    # Re-instantiate services in router with test_db
    from app.api import grammar as grammar_module
    test_tracker = GrammarTrackerService(db_path=test_db)
    monkeypatch.setattr(grammar_module, "_tracker", test_tracker)
    monkeypatch.setattr(grammar_module, "_drills", GrammarDrillService(tracker_service=test_tracker))
    monkeypatch.setattr(grammar_module, "_roadmap", GrammarRoadmapService(tracker_service=test_tracker))

    return TestClient(app)


def test_spot_in_wild_drill_generation():
    service = GrammarDrillService()
    drill = service.generate_spot_in_wild_drill(level="N4")
    assert drill["modality"] == "spot_in_wild"
    assert "[" in drill["sentence"] and "]" in drill["sentence"]
    assert len(drill["options"]) >= 2
    assert any(opt["pattern_key"] == drill["pattern_key"] for opt in drill["options"])


def test_conjugation_cloze_drill_generation():
    service = GrammarDrillService()
    drill = service.generate_conjugation_cloze_drill(pattern_key="そうだ(appearance)")
    assert drill["modality"] == "conjugation_cloze"
    assert drill["prompt_root"] in ["降る", "おいしい"]
    assert "[___]" in drill["sentence"]
    assert drill["expected_answer"] != ""


def test_nuance_battle_drill_generation():
    service = GrammarDrillService()
    drill = service.generate_nuance_battle_drill(battle_id="conjecture_souda_vs_hearsay")
    assert drill["modality"] == "nuance_battle"
    assert drill["battle_id"] == "conjecture_souda_vs_hearsay"
    assert len(drill["options"]) == 2
    assert "[___]" in drill["sentence"]
    assert drill["explanation"] != ""


def test_anti_grind_micro_session_generation():
    service = GrammarDrillService()
    session = service.generate_session(count=10)
    assert session["item_count"] == 10
    assert len(session["drills"]) == 10
    modalities = {d["modality"] for d in session["drills"]}
    assert "spot_in_wild" in modalities
    assert "conjugation_cloze" in modalities
    assert "nuance_battle" in modalities


def test_drill_verification_and_mastery_scoring(tmp_path):
    db_path = tmp_path / "drills_verify.db"
    init_db(db_path)
    tracker = GrammarTrackerService(db_path=db_path)
    service = GrammarDrillService(tracker_service=tracker)

    # 1. Correct conjugation cloze verification
    outcome = service.verify_drill_answer(
        modality="conjugation_cloze",
        pattern_key="そうだ(appearance)",
        user_answer="降りそうだ",
        expected_answer="降りそうだ",
        context_sentence="雨が降りそうだ。",
    )
    assert outcome["is_correct"] is True
    assert outcome["tracker_result"]["drill_count"] == 1
    assert outcome["tracker_result"]["mastery_score"] > 0
    assert outcome["tracker_result"]["pipeline_status"] in ("practicing", "mastered")

    # 2. Incorrect answer verification
    outcome_wrong = service.verify_drill_answer(
        modality="conjugation_cloze",
        pattern_key="そうだ(appearance)",
        user_answer="降るそうだ",
        expected_answer="降りそうだ",
        context_sentence="雨が降りそうだ。",
    )
    assert outcome_wrong["is_correct"] is False
    assert outcome_wrong["tracker_result"]["drill_count"] == 2


def test_roadmap_flow_service():
    service = GrammarRoadmapService()
    flow = service.get_roadmap_flow()
    assert "chapters" in flow
    assert len(flow["chapters"]) == 5
    first_ch = flow["chapters"][0]
    assert first_ch["chapter_id"] == "ch1_foundations"
    assert len(first_ch["points"]) > 0
    assert "encountered_badge" in first_ch["points"][0]
    assert "mastery_pct" in first_ch["points"][0]
    assert "pipeline_status" in first_ch["points"][0]


def test_conceptual_hubs_service():
    service = GrammarRoadmapService()
    hubs = service.get_conceptual_hubs()
    assert "hubs" in hubs
    assert len(hubs["hubs"]) >= 6
    hub_ids = [h["hub_id"] for h in hubs["hubs"]]
    assert "hub_particles" in hub_ids
    assert "hub_conjugations" in hub_ids
    assert "hub_conjectures" in hub_ids
    assert "hub_conditionals" in hub_ids
    assert "hub_giving_receiving" in hub_ids
    assert "hub_causative_passive" in hub_ids


def test_point_mastery_card_details():
    service = GrammarRoadmapService()
    card = service.get_point_mastery_card("は")
    assert card is not None
    assert card["pattern_key"] == "は"
    assert card["big_picture_banner"] != ""
    assert len(card["formation_rules"]) > 0
    assert "status_badges" in card
    assert "pipeline_status" in card["status_badges"]
    assert "encounters" in card


def test_api_grammar_drill_session(client):
    res = client.get("/api/grammar/drills/session?count=10")
    assert res.status_code == 200
    data = res.json()
    assert data["item_count"] == 10
    assert len(data["drills"]) == 10


def test_api_grammar_drill_verify(client):
    req_body = {
        "modality": "conjugation_cloze",
        "pattern_key": "そうだ(appearance)",
        "user_answer": "降りそうだ",
        "expected_answer": "降りそうだ",
        "context_sentence": "雨が降りそうだ。",
    }
    res = client.post("/api/grammar/drills/verify", json=req_body)
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is True
    assert data["tracker_result"]["drill_count"] == 1


def test_api_grammar_roadmap_endpoints(client):
    # Flow
    res_flow = client.get("/api/grammar/roadmap/flow")
    assert res_flow.status_code == 200
    assert len(res_flow.json()["chapters"]) == 5

    # Hubs
    res_hubs = client.get("/api/grammar/roadmap/hubs")
    assert res_hubs.status_code == 200
    assert len(res_hubs.json()["hubs"]) >= 6

    # Card
    res_card = client.get("/api/grammar/points/は/card")
    assert res_card.status_code == 200
    data_card = res_card.json()
    assert data_card["pattern_key"] == "は"
    assert "status_badges" in data_card
    assert data_card["status_badges"]["pipeline_status"] in ("unseen", "encountered", "practicing", "mastered")
