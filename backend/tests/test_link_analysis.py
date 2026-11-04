"""
Unit and integration tests for Kiroku Link Live Analysis Pipeline (Slice 40).
"""
import time
import pytest
from fastapi.testclient import TestClient

from app.api.link_analysis import router
from app.link.analysis import LiveAnalysisPipeline, analysis_pipeline, install_link_hub_hook
from app.main import app


@pytest.fixture
def test_pipeline():
    pipeline = LiveAnalysisPipeline(max_entries=10)
    return pipeline


@pytest.fixture
def client():
    return TestClient(app)


def test_pipeline_schedule_and_chunked_processing(test_pipeline):
    sample_cues = [
        {"i": 0, "s": 0.0, "e": 3.0, "text": "猫が好きです。"},
        {"i": 1, "s": 3.5, "e": 6.0, "text": "日本語を勉強しています。"},
    ]
    cue_hash = "testhash1234"
    payload = {"hash": cue_hash, "cues": sample_cues}

    returned_hash = test_pipeline.schedule_analysis(payload)
    assert returned_hash == cue_hash

    # Wait briefly for threadpool execution
    timeout = 5.0
    start_time = time.time()
    while time.time() - start_time < timeout:
        cues_res = test_pipeline.get_cues(cue_hash)
        if cues_res and cues_res.get("status") == "ready":
            break
        time.sleep(0.05)

    res = test_pipeline.get_cues(cue_hash)
    assert res is not None
    assert res["status"] == "ready"
    assert res["total"] == 2
    assert len(res["cues"]) == 2

    # Verify first cue annotations
    c0 = res["cues"][0]
    assert c0["i"] == 0
    assert c0["text"] == "猫が好きです。"
    assert len(c0["tokens"]) > 0
    assert "known_pct" in c0
    assert isinstance(c0["gap_words"], list)

    # Test slicing with from_idx and to_idx
    slice_res = test_pipeline.get_cues(cue_hash, from_idx=1, to_idx=2)
    assert slice_res is not None
    assert len(slice_res["cues"]) == 1
    assert slice_res["cues"][0]["i"] == 1


def test_pipeline_cue_grammar_caching(test_pipeline):
    sample_cues = [
        {"i": 0, "s": 1.0, "e": 4.0, "text": "猫が好きです。"},
    ]
    cue_hash = "grammarhash456"
    test_pipeline.schedule_analysis({"hash": cue_hash, "cues": sample_cues})

    timeout = 5.0
    start_time = time.time()
    while time.time() - start_time < timeout:
        if test_pipeline.get_cues(cue_hash, 0, 1):
            break
        time.sleep(0.05)

    grammar_res = test_pipeline.get_cue_grammar(cue_hash, 0)
    assert grammar_res is not None
    assert grammar_res["hash"] == cue_hash
    assert grammar_res["i"] == 0
    assert grammar_res["sentence"] == "猫が好きです。"
    assert isinstance(grammar_res["points"], list)

    # Calling again returns cached points
    second_res = test_pipeline.get_cue_grammar(cue_hash, 0)
    assert second_res == grammar_res


def test_api_get_cues_and_grammar(client):
    # Register test payload in process-wide pipeline
    cue_hash = "apihash789"
    cues = [
        {"i": 0, "s": 0.5, "e": 2.0, "text": "こんにちは世界"},
        {"i": 1, "s": 2.5, "e": 4.0, "text": "美味しいご飯を食べる"},
    ]
    analysis_pipeline.schedule_analysis({"hash": cue_hash, "cues": cues})

    # Wait for completion
    timeout = 5.0
    start_time = time.time()
    while time.time() - start_time < timeout:
        res = client.get(f"/api/link/cues/{cue_hash}")
        if res.status_code == 200 and res.json().get("status") == "ready":
            break
        time.sleep(0.05)

    # GET /api/link/cues/{hash}?from=0&to=1
    response = client.get(f"/api/link/cues/{cue_hash}?from=0&to=1")
    assert response.status_code == 200
    data = response.json()
    assert data["hash"] == cue_hash
    assert len(data["cues"]) == 1
    assert data["cues"][0]["i"] == 0

    # GET /api/link/cue-grammar
    g_response = client.get(f"/api/link/cue-grammar?hash={cue_hash}&i=1")
    assert g_response.status_code == 200
    g_data = g_response.json()
    assert g_data["hash"] == cue_hash
    assert g_data["i"] == 1
    assert "points" in g_data

    # 404 for unknown hash
    nf_response = client.get("/api/link/cues/nonexistenthash")
    assert nf_response.status_code == 404

    # 404 for unknown cue index
    nf_grammar = client.get(f"/api/link/cue-grammar?hash={cue_hash}&i=999")
    assert nf_grammar.status_code == 404


def test_hub_cue_list_hook_triggers_analysis():
    install_link_hub_hook()
    from app.link.hub import link_hub

    assert getattr(link_hub, "_analysis_hook_installed", False) is True
