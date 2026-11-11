"""Tests for Phase 2 word_states lifecycle, word_encounters logging, Anki FSRS hydration, and routes."""
from __future__ import annotations

from pathlib import Path
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import get_anki_known_min_interval, get_anki_max_lapses
from app.db.connection import db_session, ensure_vocab_state_tables, init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.repositories.word_state_repository import (
    VALID_WORD_STATES,
    WordStateRepository,
)
from app.services.anki_connect import AnkiConnectionError, AnkiError
from app.services.card_service import CardService
from app.services.subtitle_annotator import (
    get_subtitle_annotator_service,
    set_subtitle_annotator_service,
)
from app.services.word_state_service import (
    WordStateService,
    aggregate_note_cards_mastery,
    evaluate_anki_card_mastery,
)


@pytest.fixture
def test_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "kiroku_word_states_test.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_path))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_path))
    init_db(db_path)
    set_subtitle_annotator_service(None)
    yield db_path
    set_subtitle_annotator_service(None)


def test_word_states_schema_and_partial_unique_indexes(test_db: Path):
    """word_states and word_encounters tables and partial unique indexes are created cleanly."""
    with db_session(test_db) as conn:
        ensure_vocab_state_tables(conn)
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "word_states" in tables
        assert "word_encounters" in tables

        indexes = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
        assert "idx_word_states_seq_reading" in indexes
        assert "idx_word_states_expr_reading" in indexes
        assert "idx_word_encounters_seq_reading" in indexes
        assert "idx_word_encounters_expr_reading" in indexes


def test_word_states_7_state_lifecycle_and_homograph_isolation(test_db: Path):
    """All 7 states persist cleanly and homographs with distinct (sequence_id, reading) stay isolated."""
    repo = WordStateRepository(db_path=test_db)

    assert VALID_WORD_STATES == (
        "unseen",
        "seen",
        "tracking",
        "learning",
        "known",
        "ignored",
        "blacklisted",
    )

    with pytest.raises(ValueError):
        repo.set_user_word_state(state="invalid_state", expression="生", reading="なま")

    # Two JMdict entries sharing kanji '生' do not collide
    nama = repo.upsert_word_state(
        sequence_id=1378450,
        reading="なま",
        expression="生",
        state="known",
        anki_interval=30,
        anki_lapses=0,
        anki_status="active",
    )
    sei = repo.upsert_word_state(
        sequence_id=2088240,
        reading="せい",
        expression="生",
        state="seen",
    )
    assert nama.id != sei.id
    assert nama.state == "known"
    assert sei.state == "seen"

    # Upserting same (sequence_id, reading) updates in place rather than creating duplicate
    nama_updated = repo.upsert_word_state(
        sequence_id=1378450,
        reading="なま",
        expression="生",
        state="learning",
        anki_interval=10,
        anki_lapses=2,
        anki_status="active",
    )
    assert nama_updated.id == nama.id
    assert nama_updated.state == "learning"

    # Fallback entries with sequence_id=None are isolated by (expression, reading)
    custom_a = repo.set_user_word_state(
        state="tracking",
        expression="独自語",
        reading="どくじご",
        sequence_id=None,
    )
    custom_b = repo.set_user_word_state(
        state="ignored",
        expression="独自語",
        reading="ひとりご",
        sequence_id=None,
    )
    assert custom_a.id != custom_b.id
    assert repo.get_word_state(expression="独自語", reading="どくじご").state == "tracking"
    assert repo.get_word_state(expression="独自語", reading="ひとりご").state == "ignored"

    # Verify DB-level partial unique indexes enforce uniqueness
    with db_session(test_db) as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO word_states (sequence_id, reading, expression, state, updated_at) VALUES (1378450, 'なま', '生', 'known', '2026-01-01T00:00:00Z')"
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO word_states (sequence_id, reading, expression, state, updated_at) VALUES (NULL, 'どくじご', '独自語', 'seen', '2026-01-01T00:00:00Z')"
            )


def test_manual_overrides_and_blacklisted_stats_exclusion(test_db: Path):
    """ignored and blacklisted states are protected from routine overwrites and blacklisted is excluded from active stats."""
    repo = WordStateRepository(db_path=test_db)

    repo.set_user_word_state(sequence_id=100, reading="いぬ", expression="犬", state="known")
    repo.set_user_word_state(sequence_id=101, reading="ねこ", expression="猫", state="ignored")
    repo.set_user_word_state(sequence_id=102, reading="とり", expression="鳥", state="blacklisted")
    repo.set_user_word_state(sequence_id=103, reading="さかな", expression="魚", state="unseen")

    # Routine upsert with respect_manual_override=True must NOT clobber ignored or blacklisted
    res_ignored = repo.upsert_word_state(
        sequence_id=101,
        reading="ねこ",
        expression="猫",
        state="known",
        anki_interval=45,
        respect_manual_override=True,
    )
    res_blacklisted = repo.upsert_word_state(
        sequence_id=102,
        reading="とり",
        expression="鳥",
        state="learning",
        anki_interval=5,
        respect_manual_override=True,
    )
    assert res_ignored.state == "ignored"
    assert res_blacklisted.state == "blacklisted"

    # Encounter logging must NOT clobber ignored or blacklisted
    repo.log_encounter(
        sequence_id=101,
        reading="ねこ",
        expression="猫",
        sentence="猫がいる",
        source_media="ep1",
    )
    repo.log_encounter(
        sequence_id=102,
        reading="とり",
        expression="鳥",
        sentence="鳥が飛ぶ",
        source_media="ep1",
    )
    assert repo.get_word_state(sequence_id=101, reading="ねこ").state == "ignored"
    assert repo.get_word_state(sequence_id=102, reading="とり").state == "blacklisted"

    # Stats exclude blacklisted from active_total
    stats = repo.get_stats()
    assert stats["counts"]["known"] == 1
    assert stats["counts"]["ignored"] == 1
    assert stats["counts"]["blacklisted"] == 1
    assert stats["counts"]["unseen"] == 1
    assert stats["active_total"] == 3
    assert stats["blacklisted_excluded"] == 1

    listed_without_blacklist = repo.list_word_states(include_blacklisted=False)
    assert all(item.state != "blacklisted" for item in listed_without_blacklist)


def test_encounter_logger_updates_seen_and_aggregates_episodes(test_db: Path):
    """Encounter logger advances unseen -> seen, tracks timestamps, and summarizes '14 times in 3 episodes'."""
    service = WordStateService(db_path=test_db)

    # Pre-seed an unseen row to test unseen -> seen transition
    service.set_user_word_state(
        sequence_id=1578850,
        reading="いく",
        expression="行く",
        state="unseen",
    )

    episodes = [
        ("ep01.mkv", 5),
        ("ep02.mkv", 4),
        ("ep03.mkv", 5),
    ]
    idx = 0
    for ep_name, count in episodes:
        for n in range(count):
            idx += 1
            service.log_encounter(
                sequence_id=1578850,
                reading="いく",
                expression="行く",
                sentence=f"駅へ行く #{idx}",
                source_media=ep_name,
                timestamp=f"2026-05-01T00:00:{idx:02d}Z",
            )

    ws = service.get_word_state(sequence_id=1578850, reading="いく")
    assert ws is not None
    assert ws.state == "seen"
    assert ws.first_seen_at == "2026-05-01T00:00:01Z"
    assert ws.last_seen_at == "2026-05-01T00:00:14Z"

    summary = service.get_encounter_summary(
        sequence_id=1578850,
        reading="いく",
        recent_limit=3,
    )
    assert summary["total_encounters"] == 14
    assert summary["episode_count"] == 3
    assert len(summary["recent_sentences"]) == 3
    assert summary["recent_sentences"][0]["sentence"] == "駅へ行く #14"
    assert summary["recent_sentences"][0]["source_media"] == "ep03.mkv"

    # Logging encounters for an already-known word updates last_seen_at without downgrading state
    service.set_user_word_state(
        sequence_id=1578850,
        reading="いく",
        expression="行く",
        state="known",
    )
    service.log_encounter(
        sequence_id=1578850,
        reading="いく",
        expression="行く",
        sentence="また行く",
        source_media="ep04.mkv",
        timestamp="2099-05-02T00:00:00Z",
    )
    ws_after = service.get_word_state(sequence_id=1578850, reading="いく")
    assert ws_after.state == "known"
    assert ws_after.last_seen_at == "2099-05-02T00:00:00Z"


def test_evaluate_anki_card_mastery_and_automatic_demotion(test_db: Path):
    """FSRS interval/lapses thresholds compute known/learning and demote suspended, flagged, and deleted cards."""
    # Direct mastery evaluator checks
    assert evaluate_anki_card_mastery(
        {"interval": 21, "lapses": 0, "queue": 2, "reps": 6, "flags": 0}
    ) == ("known", "active", 21, 0)
    assert evaluate_anki_card_mastery(
        {"interval": 20, "lapses": 0, "queue": 2, "reps": 6, "flags": 0}
    ) == ("learning", "active", 20, 0)
    assert evaluate_anki_card_mastery(
        {"interval": 35, "lapses": 5, "queue": 2, "reps": 12, "flags": 0}
    ) == ("learning", "active", 35, 5)
    assert evaluate_anki_card_mastery(
        {"interval": 35, "lapses": 5, "queue": 2, "reps": 12, "flags": 0},
        max_lapses=8,
    ) == ("known", "active", 35, 5)
    assert evaluate_anki_card_mastery(
        {"interval": 40, "lapses": 0, "queue": -1, "reps": 10, "flags": 0},
        existing_state="known",
    ) == ("learning", "suspended", 40, 0)
    assert evaluate_anki_card_mastery(
        {"interval": 40, "lapses": 0, "queue": 2, "reps": 10, "flags": 1},
        existing_state="known",
    ) == ("learning", "flagged", 40, 0)

    # Note with two sibling cards stays known if at least one card is active and mature
    assert aggregate_note_cards_mastery(
        [
            {"interval": 40, "lapses": 0, "queue": -1, "reps": 10, "flags": 0},
            {"interval": 25, "lapses": 1, "queue": 2, "reps": 7, "flags": 0},
        ]
    ) == ("known", "active", 25, 1)

    service = WordStateService(db_path=test_db)
    # Protect a blacklisted manual override
    service.set_user_word_state(
        sequence_id=9001,
        reading="だめ",
        expression="駄目",
        state="blacklisted",
    )

    # Initial sync hydrates known and learning cards
    first_summary = service.apply_anki_card_metrics(
        [
            {
                "sequence_id": 1001,
                "expression": "食べる",
                "reading": "たべる",
                "interval": 28,
                "lapses": 1,
                "queue": 2,
                "reps": 8,
                "flags": 0,
            },
            {
                "sequence_id": 1002,
                "expression": "飲む",
                "reading": "のむ",
                "interval": 14,
                "lapses": 0,
                "queue": 2,
                "reps": 4,
                "flags": 0,
            },
            {
                "sequence_id": 1003,
                "expression": "走る",
                "reading": "はしる",
                "interval": 30,
                "lapses": 6,
                "queue": 2,
                "reps": 15,
                "flags": 0,
            },
            {
                "sequence_id": 9001,
                "expression": "駄目",
                "reading": "だめ",
                "interval": 60,
                "lapses": 0,
                "queue": 2,
                "reps": 10,
                "flags": 0,
            },
        ],
        reconcile_deleted=True,
    )
    assert first_summary["known"] == 1
    assert first_summary["learning"] == 2
    assert first_summary["skipped_override"] == 1

    assert service.get_word_state(sequence_id=1001, reading="たべる").state == "known"
    assert service.get_word_state(sequence_id=1002, reading="のむ").state == "learning"
    assert service.get_word_state(sequence_id=1003, reading="はしる").state == "learning"
    assert service.get_word_state(sequence_id=9001, reading="だめ").state == "blacklisted"

    # Next full sync:
    # - 1001 suspended -> demoted to learning with anki_status='suspended'
    # - 1002 flagged -> demoted with anki_status='flagged'
    # - 1003 deleted from Anki -> demoted to seen with anki_status='deleted'
    second_summary = service.apply_anki_card_metrics(
        [
            {
                "sequence_id": 1001,
                "expression": "食べる",
                "reading": "たべる",
                "interval": 28,
                "lapses": 1,
                "queue": -1,
                "reps": 8,
                "flags": 0,
            },
            {
                "sequence_id": 1002,
                "expression": "飲む",
                "reading": "のむ",
                "interval": 25,
                "lapses": 0,
                "queue": 2,
                "reps": 6,
                "flags": 2,
            },
        ],
        reconcile_deleted=True,
    )
    assert second_summary["suspended"] == 1
    assert second_summary["flagged"] == 1
    assert second_summary["deleted"] == 1
    assert second_summary["demoted"] == 3

    s1 = service.get_word_state(sequence_id=1001, reading="たべる")
    s2 = service.get_word_state(sequence_id=1002, reading="のむ")
    s3 = service.get_word_state(sequence_id=1003, reading="はしる")
    assert s1.state == "learning"
    assert s1.anki_status == "suspended"
    assert s2.state == "learning"
    assert s2.anki_status == "flagged"
    assert s3.state == "seen"
    assert s3.anki_status == "deleted"
    assert s3.anki_interval is None
    assert service.get_word_state(sequence_id=9001, reading="だめ").state == "blacklisted"


def test_word_states_api_routes(test_db: Path):
    """API routes manage word states, stats, encounters, and Anki FSRS sync."""
    client = TestClient(app)

    # Set manual state
    resp = client.post(
        "/api/word-states/set",
        json={"expression": "約束", "reading": "やくそく", "sequence_id": 1536850, "state": "tracking"},
    )
    assert resp.status_code == 200
    assert resp.json()["state"] == "tracking"

    # List and filter
    list_resp = client.get("/api/word-states", params={"state": "tracking"})
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1
    assert list_resp.json()["items"][0]["expression"] == "約束"

    # Log encounters via service and inspect endpoint
    WordStateService(db_path=test_db).log_encounter(
        sequence_id=1536850,
        reading="やくそく",
        expression="約束",
        sentence="約束を守る",
        source_media="ep01",
    )
    enc_resp = client.get(
        "/api/word-states/encounters",
        params={"sequence_id": 1536850, "reading": "やくそく"},
    )
    assert enc_resp.status_code == 200
    assert enc_resp.json()["total_encounters"] == 1
    assert enc_resp.json()["episode_count"] == 1

    # Sync from mocked AnkiConnectService
    with patch("app.api.known_words.AnkiConnectService") as mock_anki_cls:
        mock_anki = mock_anki_cls.return_value
        mock_anki.is_connected.return_value = (True, "")
        mock_anki.get_card_metrics.return_value = [
            {
                "note_id": 500,
                "card_id": 600,
                "expression": "約束",
                "reading": "やくそく",
                "sequence_id": 1536850,
                "interval": 30,
                "lapses": 0,
                "queue": 2,
                "reps": 7,
                "flags": 0,
            }
        ]
        sync_resp = client.post("/api/word-states/sync-anki", json={})
        assert sync_resp.status_code == 200
        body = sync_resp.json()
        assert body["ok"] is True
        assert body["known"] == 1

    # Stats check
    stats_resp = client.get("/api/word-states/stats")
    assert stats_resp.status_code == 200
    assert stats_resp.json()["counts"]["known"] == 1


def test_word_states_api_routes_edge_cases_and_cache_reload(test_db: Path):
    """API routes validate inputs, filter/paginate, handle Anki errors, and refresh annotator cache."""
    client = TestClient(app)
    get_subtitle_annotator_service(db_path=test_db, force_new=True)

    # Validation errors on /set, /list, and /encounters
    assert client.post("/api/word-states/set", json={"state": "bogus", "expression": "猫"}).status_code == 422
    assert client.post("/api/word-states/set", json={"state": "known", "expression": ""}).status_code == 422
    assert client.get("/api/word-states", params={"state": "bogus"}).status_code == 422
    assert client.get("/api/word-states/encounters").status_code == 422

    # Set ignored word and verify annotator cache immediately sees ignored state
    set_ignored = client.post(
        "/api/word-states/set",
        json={"expression": "ガチャ", "reading": "がちゃ", "state": "ignored"},
    )
    assert set_ignored.status_code == 200
    ann_resp = client.post("/api/subtitle/annotate", json={"cues": [{"id": "1", "text": "ガチャ"}]})
    assert ann_resp.status_code == 200
    tok = ann_resp.json()["cues"][0]["tokens"][0]
    assert tok["word_state"] == "ignored"
    assert tok["status"] == "unstyled"

    # Set blacklisted + tracking words and verify list filters (include_blacklisted, search, limit/offset)
    assert client.post(
        "/api/word-states/set",
        json={"expression": "駄目", "reading": "だめ", "state": "blacklisted"},
    ).status_code == 200
    assert client.post(
        "/api/word-states/set",
        json={"expression": "約束", "reading": "やくそく", "state": "tracking"},
    ).status_code == 200

    no_black = client.get("/api/word-states", params={"include_blacklisted": False})
    assert no_black.status_code == 200
    assert {item["expression"] for item in no_black.json()["items"]} == {"ガチャ", "約束"}

    searched = client.get("/api/word-states", params={"search": "やくそく"})
    assert searched.status_code == 200
    assert [item["expression"] for item in searched.json()["items"]] == ["約束"]

    paged = client.get("/api/word-states", params={"limit": 1, "offset": 1})
    assert paged.status_code == 200
    assert paged.json()["total"] == 1

    # Encounters lookup by expression+reading without sequence_id
    WordStateService(db_path=test_db).log_encounter(
        expression="約束",
        reading="やくそく",
        sentence="約束した",
        source_media="ep02.mkv",
    )
    enc_by_expr = client.get(
        "/api/word-states/encounters",
        params={"expression": "約束", "reading": "やくそく"},
    )
    assert enc_by_expr.status_code == 200
    assert enc_by_expr.json()["total_encounters"] == 1
    assert enc_by_expr.json()["episode_count"] == 1

    # /sync-anki with empty body when Anki is disconnected returns ok=False, connected=False
    with patch("app.api.known_words.AnkiConnectService") as mock_anki_cls:
        mock_anki = mock_anki_cls.return_value
        mock_anki.is_connected.return_value = (False, "Connection refused")
        offline_resp = client.post("/api/word-states/sync-anki")
        assert offline_resp.status_code == 200
        assert offline_resp.json()["ok"] is False
        assert offline_resp.json()["connected"] is False
        assert "Connection refused" in offline_resp.json()["error"]

    # /sync-anki returns 503 when AnkiError is raised during card fetch
    with patch("app.api.known_words.AnkiConnectService") as mock_anki_cls:
        mock_anki = mock_anki_cls.return_value
        mock_anki.is_connected.return_value = (True, "")
        mock_anki.get_card_metrics.side_effect = AnkiError("AnkiConnect failed")
        err_resp = client.post("/api/word-states/sync-anki", json={})
        assert err_resp.status_code == 503


def test_sync_cards_from_anki_and_card_service_word_state_integration(test_db: Path):
    """sync_cards_from_anki and CardService sync hooks hydrate, demote, and persist word states."""
    ws_service = WordStateService(db_path=test_db, dict_engine=False)

    # 1. sync_cards_from_anki handles cards without note IDs
    no_note_res = ws_service.sync_cards_from_anki([SimpleNamespace(anki_note_id=None, expression="猫", reading="ねこ")])
    assert no_note_res["connected"] is True
    assert no_note_res["synced"] == 0

    # 2. sync_cards_from_anki handles AnkiConnectionError cleanly
    offline_anki = MagicMock()
    offline_anki.get_card_metrics.side_effect = AnkiConnectionError("offline")
    offline_res = ws_service.sync_cards_from_anki(
        [SimpleNamespace(anki_note_id=101, expression="猫", reading="ねこ")],
        anki_service=offline_anki,
    )
    assert offline_res["connected"] is False
    assert offline_res["error"] == "offline"

    # 3. sync_cards_from_anki hydrates note_ids and demotes missing notes
    ws_service.set_user_word_state(expression="鳥", reading="とり", state="known")
    cards_arg = [
        SimpleNamespace(anki_note_id=201, expression="猫", reading="ねこ"),
        SimpleNamespace(anki_note_id=202, expression="鳥", reading="とり"),
    ]
    online_anki = MagicMock()
    online_anki.get_card_metrics.return_value = [
        {
            "card_id": 1201,
            "note_id": 201,
            "interval": 25,
            "lapses": 0,
            "queue": 2,
            "reps": 7,
            "flags": 0,
            "expression": "",
            "reading": "",
        }
    ]
    res = ws_service.sync_cards_from_anki(cards_arg, anki_service=online_anki)
    assert res["known"] == 1
    assert res["deleted"] == 1
    assert res["demoted"] == 1
    assert ws_service.get_word_state(expression="猫", reading="ねこ").state == "known"
    tori_state = ws_service.get_word_state(expression="鳥", reading="とり")
    assert tori_state.state == "seen"
    assert tori_state.anki_status == "deleted"

    # 4. CardService.sync_card promotes synced vocab card to learning/active using _db_path
    repo = CardRepository(db_path=test_db)
    vocab_card, _, _, _ = repo.save_or_update(
        CardDraft(expression="準備", reading="じゅんび", meaning="preparation", card_kind="vocab")
    )
    grammar_card, _, _, _ = repo.save_or_update(
        CardDraft(expression="てしまう", reading="", meaning="regret", card_kind="grammar")
    )
    mock_anki = MagicMock()
    mock_anki.find_existing_note.return_value = None
    mock_anki.add_note.side_effect = [301, 302]
    mock_anki.is_connected.return_value = (True, "")
    mock_anki.get_card_metrics.return_value = [
        {
            "card_id": 1301,
            "note_id": 301,
            "expression": "準備",
            "reading": "じゅんび",
            "interval": 30,
            "lapses": 0,
            "queue": 2,
            "reps": 8,
            "flags": 0,
        }
    ]
    card_svc = CardService(card_repository=repo, anki_service=mock_anki)
    sync_vocab = card_svc.sync_card(vocab_card.id)
    assert sync_vocab.sync_status == "synced"
    ws_junbi = WordStateRepository(db_path=test_db).get_word_state(expression="準備", reading="じゅんび")
    assert ws_junbi is not None
    assert ws_junbi.state == "learning"
    assert ws_junbi.anki_status == "active"

    # Grammar cards are not inserted into vocab word_states
    sync_grammar = card_svc.sync_card(grammar_card.id)
    assert sync_grammar.sync_status == "synced"
    assert WordStateRepository(db_path=test_db).get_word_state(expression="てしまう", reading="") is None

    # CardService.sync_word_states_from_anki uses _db_path and updates word_states to known
    bulk_res = card_svc.sync_word_states_from_anki()
    assert bulk_res["known"] == 1
    assert WordStateRepository(db_path=test_db).get_word_state(expression="準備", reading="じゅんび").state == "known"


def test_anki_threshold_config_overrides_and_fallbacks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """get_anki_known_min_interval and get_anki_max_lapses honor env, app_config.json, and defaults."""
    monkeypatch.setenv("KIROKU_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("KIROKU_ANKI_KNOWN_INTERVAL", raising=False)
    monkeypatch.delenv("KIROKU_ANKI_MAX_LAPSES", raising=False)

    assert get_anki_known_min_interval() == 21
    assert get_anki_max_lapses() == 5

    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "app_config.json").write_text(
        '{"anki": {"known_min_interval": 14, "max_lapses": 3}}',
        encoding="utf-8",
    )
    assert get_anki_known_min_interval() == 14
    assert get_anki_max_lapses() == 3

    monkeypatch.setenv("KIROKU_ANKI_KNOWN_INTERVAL", "30")
    monkeypatch.setenv("KIROKU_ANKI_MAX_LAPSES", "7")
    assert get_anki_known_min_interval() == 30
    assert get_anki_max_lapses() == 7

    # Invalid / non-positive values fall back cleanly
    monkeypatch.setenv("KIROKU_ANKI_KNOWN_INTERVAL", "0")
    monkeypatch.setenv("KIROKU_ANKI_MAX_LAPSES", "invalid")
    assert get_anki_known_min_interval() == 14
    assert get_anki_max_lapses() == 3
