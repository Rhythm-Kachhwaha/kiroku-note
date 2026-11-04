"""
Tests for Slice 40: Link Live Analysis Pipeline.
"""
from __future__ import annotations

import time
import pytest
from fastapi.testclient import TestClient

from app.api.registry import discover_routers
from app.link.analysis import LinkAnalysisService, link_analysis_service
from app.link.session import LinkVideoSession
from app.main import app


@pytest.fixture
def client():
    # Ensure discover_routers has picked up link_analysis
    return TestClient(app)


def test_link_analysis_service_processing():
    service = LinkAnalysisService(max_lru=2)
    sample_cues = [
        {"i": 0, "s": 0.0, "e": 2.5, "text": "こんにちは世界"},
        {"i": 1, "s": 3.0, "e": 5.5, "text": "日本語を勉強します"},
        {"i": 2, "s": 6.0, "e": 8.5, "text": "猫が好きです"},
    ]
    cue_hash = "testhash123"

    # Synchronous processing check
    service._process_cues_background(cue_hash, sample_cues, learner_level="N4")

    # Range retrieval
    all_cues = service.get_cues_range(cue_hash)
    assert all_cues is not None
    assert len(all_cues) == 3

    # Check cue 1 structure
    cue1 = all_cues[1]
    assert cue1["i"] == 1
    assert "tokens" in cue1
    assert isinstance(cue1["known_pct"], float)
    assert isinstance(cue1["gap_words"], list)

    # Check slicing with from_idx and to_idx
    sliced = service.get_cues_range(cue_hash, from_idx=1, to_idx=1)
    assert sliced is not None
    assert len(sliced) == 1
    assert sliced[0]["i"] == 1

    # Check grammar extraction & caching
    grammar_pts = service.get_cue_grammar(cue_hash, 2, learner_level="N4")
    assert grammar_pts is not None
    assert isinstance(grammar_pts, list)

    # Re-retrieval should hit cache
    cached_pts = service.get_cue_grammar(cue_hash, 2)
    assert cached_pts == grammar_pts


def test_link_analysis_lru_eviction():
    service = LinkAnalysisService(max_lru=2)

    service._process_cues_background("hash1", [{"i": 0, "s": 0, "e": 1, "text": "a"}], "N4")
    service._process_cues_background("hash2", [{"i": 0, "s": 0, "e": 1, "text": "b"}], "N4")
    assert service.get_cues_range("hash1") is not None
    assert service.get_cues_range("hash2") is not None

    # Third insertion evicts oldest (hash1)
    service._process_cues_background("hash3", [{"i": 0, "s": 0, "e": 1, "text": "c"}], "N4")
    assert service.get_cues_range("hash1") is None
    assert service.get_cues_range("hash2") is not None
    assert service.get_cues_range("hash3") is not None


def test_api_link_cues_endpoints(client: TestClient):
    cue_hash = "apihash456"
    sample_cues = [
        {"i": 0, "s": 1.0, "e": 2.0, "text": "猫"},
        {"i": 1, "s": 2.5, "e": 4.0, "text": "犬"},
    ]
    # Populate service
    link_analysis_service._process_cues_background(cue_hash, sample_cues, "N4")

    # 1. 404 on unknown hash
    res_404 = client.get("/api/link/cues/nonexistent_hash")
    assert res_404.status_code == 404

    # 2. Get full cues
    res = client.get(f"/api/link/cues/{cue_hash}")
    assert res.status_code == 200
    data = res.json()
    assert data["hash"] == cue_hash
    assert data["count"] == 2
    assert len(data["cues"]) == 2
    assert "known_pct" in data["cues"][0]

    # 3. Get sliced cues (from=1&to=1)
    res_slice = client.get(f"/api/link/cues/{cue_hash}?from=1&to=1")
    assert res_slice.status_code == 200
    assert res_slice.json()["count"] == 1
    assert res_slice.json()["cues"][0]["i"] == 1

    # 4. Grammar endpoint
    res_gram = client.get(f"/api/link/cue-grammar?hash={cue_hash}&i=0")
    assert res_gram.status_code == 200
    gram_data = res_gram.json()
    assert gram_data["hash"] == cue_hash
    assert gram_data["i"] == 0
    assert "points" in gram_data

    # 5. Grammar 404 on invalid cue
    res_gram_404 = client.get(f"/api/link/cue-grammar?hash={cue_hash}&i=999")
    assert res_gram_404.status_code == 404


def test_session_update_cues_triggers_analysis():
    # Calling update_cues on a session should trigger background annotation
    session = LinkVideoSession(tab=99, site="youtube", title="Test", duration=100)
    cue_hash = f"sessionhash_{int(time.time())}"
    cues_payload = {
        "hash": cue_hash,
        "cues": [{"i": 0, "s": 0, "e": 2, "text": "テスト"}],
    }

    session.update_cues(cues_payload)

    # Allow threadpool a moment to complete
    for _ in range(20):
        if link_analysis_service.get_cues_range(cue_hash) is not None:
            break
        time.sleep(0.05)

    res = link_analysis_service.get_cues_range(cue_hash)
    assert res is not None
    assert len(res) == 1
    assert res[0]["text"] == "テスト"
