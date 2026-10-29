"""Tests for Subtitle Annotation & Known Words Backend Routes.

Verifies:
- POST /api/subtitle/annotate
  - Batch annotates cues using SubtitleAnnotatorService.
  - Defaults learner_level to get_learner_jlpt_level() if omitted.
  - Honors custom learner_level and ignore_function_words.
  - Returns { "version": 1, "cues": [...] } with token start/end character offsets.
  - Handles empty cues list gracefully.
- GET /api/known-words
  - Returns { "etag": "...", "mined_words": [...], "marked_known": [...] }.
  - Sets ETag response header.
  - Returns 304 Not Modified when matching If-None-Match header is provided.
  - Returns 200 with updated ETag when known words change.
- POST /api/known-words/mark
  - { "word": "食べる" } -> inserts into known_words table, returns { "ok": true, "word": "食べる" }.
  - Rejects blank word with 422.
  - Updates annotator cache immediately.
- DELETE /api/known-words/mark/{word}
  - Deletes from known_words, returns { "ok": true, "word": "食べる" }.
  - Updates annotator cache immediately.
"""
from __future__ import annotations

import datetime
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.subtitle_annotator import (
    get_subtitle_annotator_service,
    set_subtitle_annotator_service,
)


@pytest.fixture
def test_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a temporary SQLite database, set environment, and initialize schema."""
    db_path = tmp_path / "kiroku_test_routes.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_path))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_path))
    init_db(db_path)
    # Ensure fresh annotator service instance bound to test DB
    set_subtitle_annotator_service(None)
    get_subtitle_annotator_service(db_path=db_path, force_new=True)
    return db_path


@pytest.fixture
def client(test_db: Path) -> TestClient:
    return TestClient(app)


def _insert_card(db_path: Path, expression: str, reading: str = "", deck_name: str = "Default") -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (expression, reading, expression, reading, deck_name.lower(), now, now),
        )
        conn.commit()


# ============================================================================
# 1. POST /api/subtitle/annotate tests
# ============================================================================


def test_post_subtitle_annotate_basic(client: TestClient, test_db: Path):
    """POST /api/subtitle/annotate annotates cues and returns {version: 1, cues: [...]}."""
    payload = {
        "cues": [
            {"id": "1", "text": "本を読む"}
        ],
        "learner_level": "N4",
        "ignore_function_words": True,
    }
    resp = client.post("/api/subtitle/annotate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert "cues" in data
    assert len(data["cues"]) == 1

    cue = data["cues"][0]
    assert cue["id"] == "1"
    tokens = cue["tokens"]
    assert len(tokens) >= 3

    # Verify character offsets on tokens
    surfaces = [t["surface"] for t in tokens]
    assert "本" in surfaces
    assert "を" in surfaces
    assert "読む" in surfaces

    hon_tok = next(t for t in tokens if t["surface"] == "本")
    assert hon_tok["start"] == 0
    assert hon_tok["end"] == 1
    assert hon_tok["lemma"] == "本"
    assert hon_tok["status"] == "should_know"
    assert hon_tok["jlpt_level"] == "N5"

    wo_tok = next(t for t in tokens if t["surface"] == "を")
    assert wo_tok["start"] == 1
    assert wo_tok["end"] == 2
    assert wo_tok["status"] == "unstyled"

    yomu_tok = next(t for t in tokens if t["surface"] == "読む")
    assert yomu_tok["start"] == 2
    assert yomu_tok["end"] == 4
    assert yomu_tok["status"] == "should_know"


def test_post_subtitle_annotate_default_learner_level(client: TestClient, test_db: Path, monkeypatch: pytest.MonkeyPatch):
    """POST /api/subtitle/annotate defaults learner_level to get_learner_jlpt_level() if omitted."""
    monkeypatch.setenv("KIROKU_LEARNER_JLPT_LEVEL", "N5")
    # 美味しい is N1 in OpenJLPT; with N5 learner level, it should be unstyled
    payload = {
        "cues": [{"id": "c1", "text": "美味しい"}]
    }
    resp = client.post("/api/subtitle/annotate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    token = data["cues"][0]["tokens"][0]
    assert token["surface"] == "美味しい"
    assert token["status"] == "unstyled"


def test_post_subtitle_annotate_empty_cues(client: TestClient, test_db: Path):
    """POST /api/subtitle/annotate handles empty cues list."""
    resp = client.post("/api/subtitle/annotate", json={"cues": []})
    assert resp.status_code == 200
    assert resp.json() == {"version": 1, "cues": []}


# ============================================================================
# 2. GET /api/known-words tests
# ============================================================================


def test_get_known_words_empty(client: TestClient, test_db: Path):
    """GET /api/known-words returns empty lists and valid ETag when DB is fresh."""
    resp = client.get("/api/known-words")
    assert resp.status_code == 200
    data = resp.json()
    assert "etag" in data
    assert data["mined_words"] == []
    assert data["marked_known"] == []
    assert resp.headers.get("ETag") == data["etag"]


def test_get_known_words_populated(client: TestClient, test_db: Path):
    """GET /api/known-words returns mined_words from cards and marked_known from known_words."""
    _insert_card(test_db, expression="美味しい", reading="おいしい")
    _insert_card(test_db, expression="勉強", reading="べんきょう")

    # Mark known word via POST endpoint
    mark_resp = client.post("/api/known-words/mark", json={"word": "こんにちは"})
    assert mark_resp.status_code == 200

    resp = client.get("/api/known-words")
    assert resp.status_code == 200
    data = resp.json()
    assert "美味しい" in data["mined_words"]
    assert "勉強" in data["mined_words"]
    assert data["marked_known"] == ["こんにちは"]
    assert "etag" in data
    assert resp.headers.get("ETag") == data["etag"]


def test_get_known_words_etag_if_none_match_304(client: TestClient, test_db: Path):
    """GET /api/known-words returns HTTP 304 if If-None-Match matches current ETag."""
    resp1 = client.get("/api/known-words")
    assert resp1.status_code == 200
    etag = resp1.json()["etag"]

    # Request with matching If-None-Match
    resp2 = client.get("/api/known-words", headers={"If-None-Match": etag})
    assert resp2.status_code == 304

    # Also supports unquoted match if header stripped
    unquoted = etag.strip('"')
    resp3 = client.get("/api/known-words", headers={"If-None-Match": unquoted})
    assert resp3.status_code == 304

    # Modify DB by marking a new word -> ETag changes -> returns 200
    client.post("/api/known-words/mark", json={"word": "ありがとう"})
    resp4 = client.get("/api/known-words", headers={"If-None-Match": etag})
    assert resp4.status_code == 200
    assert resp4.json()["etag"] != etag


# ============================================================================
# 3. POST /api/known-words/mark tests
# ============================================================================


def test_mark_known_word_success_and_updates_cache(client: TestClient, test_db: Path):
    """POST /api/known-words/mark inserts word and updates annotator cache."""
    # Word 'ガチャ' is unlisted (status unstyled by default)
    annotate_before = client.post(
        "/api/subtitle/annotate",
        json={"cues": [{"id": "1", "text": "ガチャ"}]}
    )
    assert annotate_before.json()["cues"][0]["tokens"][0]["status"] == "unstyled"

    # Mark as known
    resp = client.post("/api/known-words/mark", json={"word": "ガチャ"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "word": "ガチャ"}

    # Annotator service cache updated immediately -> now marked as 'mined'
    annotate_after = client.post(
        "/api/subtitle/annotate",
        json={"cues": [{"id": "1", "text": "ガチャ"}]}
    )
    assert annotate_after.json()["cues"][0]["tokens"][0]["status"] == "mined"

    # Verify persisted in DB
    get_known = client.get("/api/known-words")
    assert "ガチャ" in get_known.json()["marked_known"]


def test_mark_known_word_validation(client: TestClient, test_db: Path):
    """POST /api/known-words/mark rejects blank or missing word with 422."""
    assert client.post("/api/known-words/mark", json={"word": ""}).status_code == 422
    assert client.post("/api/known-words/mark", json={"word": "   "}).status_code == 422
    assert client.post("/api/known-words/mark", json={}).status_code == 422


# ============================================================================
# 4. DELETE /api/known-words/mark/{word} tests
# ============================================================================


def test_delete_known_word_success_and_updates_cache(client: TestClient, test_db: Path):
    """DELETE /api/known-words/mark/{word} removes word and updates annotator cache."""
    # First mark
    client.post("/api/known-words/mark", json={"word": "ガチャ"})
    assert "ガチャ" in client.get("/api/known-words").json()["marked_known"]

    # Delete
    resp = client.delete("/api/known-words/mark/ガチャ")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "word": "ガチャ"}

    # Verify removed from DB
    get_known = client.get("/api/known-words")
    assert "ガチャ" not in get_known.json()["marked_known"]

    # Verify annotator service reflects removal
    annotate_resp = client.post(
        "/api/subtitle/annotate",
        json={"cues": [{"id": "1", "text": "ガチャ"}]}
    )
    assert annotate_resp.json()["cues"][0]["tokens"][0]["status"] == "unstyled"


def test_delete_nonexistent_known_word(client: TestClient, test_db: Path):
    """DELETE on nonexistent word returns {ok: true, word: word} gracefully."""
    resp = client.delete("/api/known-words/mark/nonexistent")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "word": "nonexistent"}


def test_post_subtitle_annotate_spec_example(client: TestClient, test_db: Path):
    """Verify Section 4.2 spec request and response shape with realistic OpenJLPT tokens."""
    payload = {
        "cues": [
            {"id": "1", "text": "お姉ちゃん そろそろ起きないと…"}
        ],
        "learner_level": "N4",
        "ignore_function_words": True,
    }
    resp = client.post("/api/subtitle/annotate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert len(data["cues"]) == 1
    cue = data["cues"][0]
    assert cue["id"] == "1"

    # In OpenJLPT vocab/kanji, 姉 is N5 should_know and ちゃん is N4 should_know
    ane_tok = next((t for t in cue["tokens"] if t["surface"] == "姉"), None)
    assert ane_tok is not None
    assert ane_tok["status"] == "should_know"
    assert ane_tok["jlpt_level"] == "N5"

    sorosoro_tok = next((t for t in cue["tokens"] if t["surface"] == "そろそろ"), None)
    assert sorosoro_tok is not None
    assert sorosoro_tok["status"] == "should_know"
    assert sorosoro_tok["jlpt_level"] == "N4"

    okiru_tok = next((t for t in cue["tokens"] if t["surface"] == "起きない"), None)
    assert okiru_tok is not None
    assert okiru_tok["lemma"] == "起きる"
    assert okiru_tok["status"] == "should_know"
    assert okiru_tok["jlpt_level"] == "N5"


def test_post_subtitle_annotate_function_words_toggle(client: TestClient, test_db: Path):
    """When ignore_function_words=False, function words like より (N3) get learner status."""
    payload_ignored = {
        "cues": [{"id": "1", "text": "より"}],
        "learner_level": "N1",
        "ignore_function_words": True,
    }
    resp1 = client.post("/api/subtitle/annotate", json=payload_ignored)
    assert resp1.json()["cues"][0]["tokens"][0]["status"] == "unstyled"

    payload_active = {
        "cues": [{"id": "1", "text": "より"}],
        "learner_level": "N1",
        "ignore_function_words": False,
    }
    resp2 = client.post("/api/subtitle/annotate", json=payload_active)
    assert resp2.json()["cues"][0]["tokens"][0]["status"] == "should_know"


def test_mark_known_word_idempotent(client: TestClient, test_db: Path):
    """Marking the same word multiple times is idempotent."""
    r1 = client.post("/api/known-words/mark", json={"word": "食べる"})
    assert r1.status_code == 200
    r2 = client.post("/api/known-words/mark", json={"word": "食べる"})
    assert r2.status_code == 200
    get_resp = client.get("/api/known-words")
    assert get_resp.json()["marked_known"].count("食べる") == 1


def test_delete_known_word_url_encoded(client: TestClient, test_db: Path):
    """DELETE supports URL-encoded Japanese characters."""
    import urllib.parse
    client.post("/api/known-words/mark", json={"word": "飲む"})
    assert "飲む" in client.get("/api/known-words").json()["marked_known"]

    encoded = urllib.parse.quote("飲む")
    resp = client.delete(f"/api/known-words/mark/{encoded}")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "word": "飲む"}
    assert "飲む" not in client.get("/api/known-words").json()["marked_known"]
