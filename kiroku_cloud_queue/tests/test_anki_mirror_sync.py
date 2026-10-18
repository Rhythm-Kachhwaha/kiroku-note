"""
test_anki_mirror_sync.py -- Integration tests for Anki mirror synchronization.
Verifies full reconcile, incremental sync, deletion handling, offline fail-soft,
lock contention, and worker isolation with a deterministic fake Anki transport.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from anki_mirror import (
    AnkiClient,
    _SYNC_LOCK,
    sync_anki_mirror,
)
from queue_adapter import LocalDevQueueAdapter
import worker


class FakeAnkiTransport:
    """Deterministic in-memory AnkiConnect simulator."""

    def __init__(self):
        self.version = 6
        self.cards: dict[int, dict] = {}
        self.mods: dict[int, int] = {}
        self.reviews: dict[int, list[dict]] = {}
        self.leeches: set[int] = set()
        self.due_overdue: set[int] = set()
        self.due_map: dict[int, set[int]] = {}  # day -> set(card_ids)
        self.active_profile = "User 1"
        self.is_offline = False
        self.fail_actions: set[str] = set()

    def add_card(
        self,
        card_id: int,
        expression: str,
        reading: str = "",
        meaning: str = "",
        sentence: str = "",
        mod: int = 1000,
        interval: int = 10,
        lapses: int = 0,
        reps: int = 5,
        state_type: int = 2,
        queue: int = 2,
    ):
        self.cards[card_id] = {
            "cardId": card_id,
            "note": card_id + 100000,
            "deckName": "Japanese::Mining",
            "modelName": "Kiroku Note",
            "fields": {
                "Expression": {"value": expression, "order": 0},
                "Reading": {"value": reading, "order": 1},
                "Meaning": {"value": meaning, "order": 2},
                "Sentence": {"value": sentence, "order": 3},
                "SentenceMeaning": {"value": "", "order": 4},
            },
            "type": state_type,
            "queue": queue,
            "interval": interval,
            "lapses": lapses,
            "reps": reps,
            "mod": mod,
        }
        self.mods[card_id] = mod
        self.reviews.setdefault(card_id, [])

    def add_review(
        self,
        card_id: int,
        review_id: int,
        review_type: int = 1,
        ease: int = 3,
        ivl: int = 10,
        last_ivl: int = 5,
        time_ms: int = 2000,
    ):
        self.reviews.setdefault(card_id, []).append({
            "id": review_id,
            "cardId": card_id,
            "type": review_type,
            "ease": ease,
            "ivl": ivl,
            "lastIvl": last_ivl,
            "time": time_ms,
        })

    def invoke(self, action: str, params: dict) -> any:
        if self.is_offline:
            raise ConnectionRefusedError("Connection refused: AnkiConnect offline")

        if action in self.fail_actions:
            raise ValueError(f"Simulated failure for action '{action}'")

        if action == "version":
            return self.version

        if action == "getActiveProfile":
            return self.active_profile

        if action == "findCards":
            query = params.get("query", "")
            if query == "deck:*":
                return list(self.cards.keys())
            if query == "tag:leech":
                return list(self.leeches)
            if query == "prop:due<0":
                return list(self.due_overdue)
            if query.startswith("prop:due="):
                day = int(query.split("=")[1])
                return list(self.due_map.get(day, set()))
            return []

        if action == "cardsModTime":
            card_ids = params.get("cards", [])
            return [{"cardId": cid, "mod": self.mods.get(cid, 0)} for cid in card_ids]

        if action == "cardsInfo":
            card_ids = params.get("cards", [])
            return [self.cards[cid] for cid in card_ids if cid in self.cards]

        if action == "getReviewsOfCards":
            card_ids = params.get("cards", [])
            return {str(cid): self.reviews.get(cid, []) for cid in card_ids}

        raise NotImplementedError(f"Action '{action}' not implemented in FakeAnkiTransport")


@pytest.fixture()
def fake_anki() -> FakeAnkiTransport:
    transport = FakeAnkiTransport()
    # Add 3 initial cards
    t1 = int(datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc).timestamp() * 1000)
    t2 = int(datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc).timestamp() * 1000)
    t3 = int(datetime(2026, 1, 3, 10, 0, tzinfo=timezone.utc).timestamp() * 1000)

    transport.add_card(t1, "勉強", "べんきょう", "study", mod=100)
    transport.add_card(t2, "漢字", "かんじ", "kanji", mod=200)
    transport.add_card(t3, "読書", "どくしょ", "reading books", mod=300)

    transport.add_review(t1, t1 + 10000, review_type=1, ease=3, ivl=5)
    transport.add_review(t2, t2 + 10000, review_type=1, ease=1, ivl=-60)  # Lapse/again

    return transport


@pytest.fixture()
def local_adapter(tmp_path: Path) -> LocalDevQueueAdapter:
    db_file = tmp_path / "mirror_test.db"
    return LocalDevQueueAdapter(db_path=db_file)


@pytest.mark.asyncio
async def test_first_full_sync(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    result = await sync_anki_mirror(
        local_adapter,
        full=True,
        anki_client=client,
        state_file=state_file,
    )

    assert result.status == "ok"
    assert result.mode == "full"
    assert result.cards_seen == 3
    assert result.cards_changed == 3
    assert result.cards_pushed == 3
    assert result.daily_rows_pushed > 0
    assert result.deleted_on_reconcile == 0

    # Verify rows in storage
    store = local_adapter._store
    items, total = store.query_anki_cards(limit=10)
    assert total == 3

    # Verify state file was written
    assert state_file.is_file()
    with open(state_file, "r", encoding="utf-8") as f:
        saved = json.load(f)
    assert len(saved["card_mods"]) == 3
    assert saved["last_full_reconcile_at"] is not None


@pytest.mark.asyncio
async def test_incremental_sync_with_no_changes(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Run first sync
    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    # Run incremental sync right after (no cards modified)
    result = await sync_anki_mirror(local_adapter, full=False, anki_client=client, state_file=state_file)

    assert result.status == "ok"
    assert result.mode == "incremental"
    assert result.cards_seen == 3
    assert result.cards_changed == 0
    assert result.cards_pushed == 0


@pytest.mark.asyncio
async def test_incremental_sync_with_one_changed_card(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # First sync
    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    # Modify card 2 (漢字)
    cid_list = list(fake_anki.cards.keys())
    c2_id = cid_list[1]
    fake_anki.mods[c2_id] = 999  # New mod timestamp
    fake_anki.cards[c2_id]["mod"] = 999
    fake_anki.cards[c2_id]["interval"] = 45  # Interval increased

    result = await sync_anki_mirror(local_adapter, full=False, anki_client=client, state_file=state_file)

    assert result.status == "ok"
    assert result.mode == "incremental"
    assert result.cards_seen == 3
    assert result.cards_changed == 1
    assert result.cards_pushed == 1

    # Check that card 2 in database now has interval 45
    store = local_adapter._store
    c2_db = store.get_anki_card(c2_id)
    assert c2_db is not None
    assert c2_db["interval_days"] == 45


@pytest.mark.asyncio
async def test_reconcile_deletes_missing_cards(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # First sync has 3 cards
    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
    store = local_adapter._store
    _, total = store.query_anki_cards()
    assert total == 3

    # Delete card 3 from Anki
    cid_list = list(fake_anki.cards.keys())
    del_cid = cid_list[2]
    del fake_anki.cards[del_cid]
    del fake_anki.mods[del_cid]

    # Full reconcile run
    result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    assert result.status == "ok"
    assert result.deleted_on_reconcile == 1

    # Verify storage now has 2 cards
    _, total_after = store.query_anki_cards()
    assert total_after == 2
    assert store.get_anki_card(del_cid) is None


@pytest.mark.asyncio
async def test_anki_offline_fails_soft(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    fake_anki.is_offline = True
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Should not raise exception
    result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    assert result.status == "offline"
    assert "offline" in result.message.lower() or "unreachable" in result.message.lower()
    # State file should NOT be created
    assert not state_file.exists()


@pytest.mark.asyncio
async def test_missing_anki_action_degrades_gracefully(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    # Simulate tag:leech action failure
    fake_anki.fail_actions.add("tag:leech")
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    # Mirror should still succeed gracefully
    assert result.status == "ok"
    assert result.cards_pushed == 3


@pytest.mark.asyncio
async def test_corrupt_state_file_triggers_full_sync(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "corrupt_state.json"
    with open(state_file, "w", encoding="utf-8") as f:
        f.write("{ INVALID JSON CONTENT :::")

    result = await sync_anki_mirror(local_adapter, full=False, anki_client=client, state_file=state_file)

    # Because state file was corrupt, it fell back to full sync
    assert result.status == "ok"
    assert result.mode == "full"
    assert result.cards_pushed == 3

    # Now state file is repaired and valid JSON
    with open(state_file, "r", encoding="utf-8") as f:
        repaired = json.load(f)
    assert len(repaired["card_mods"]) == 3


@pytest.mark.asyncio
async def test_lock_contention_returns_locked(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Acquire lock externally
    async with _SYNC_LOCK:
        result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
        assert result.status == "locked"
        assert result.cards_pushed == 0


@pytest.mark.asyncio
async def test_worker_stats_sync_isolated_from_mirror_failure(local_adapter: LocalDevQueueAdapter):
    fake_stats = {
        "today_reviewed": 15,
        "current_streak": 12,
        "best_streak": 20,
        "total_reviews": 500,
        "days_studied_past_year": 120,
        "cards_reviewed_by_day": {"2026-01-01": 15},
        "decks": [{"name": "Japanese", "due": 5, "total": 100}],
        "summary": {
            "total_cards": 100,
            "total_due_today": 5,
            "total_new_due": 0,
            "total_review_due": 5,
            "total_learn_due": 0,
        },
    }

    with patch("worker.fetch_anki_connect_stats", return_value=fake_stats), \
         patch("worker.sync_anki_mirror", new=AsyncMock(side_effect=RuntimeError("Simulated mirror explosion"))):

        # Should NOT raise, stats sync should succeed
        success = await worker.sync_anki_stats_to_cloud(local_adapter)
        assert success is True

        # Verify stats are pushed despite mirror failure
        store = local_adapter._store
        stored_stats = store.get_anki_stats()
        assert stored_stats is not None
        assert stored_stats["today_reviewed"] == 15


def test_anki_client_read_only_whitelist_guard():
    client = AnkiClient()
    # Calling a write/forbidden action raises PermissionError before network call
    with pytest.raises(PermissionError) as exc_info:
        client.invoke("addNote", note={"deckName": "test"})
    assert "Forbidden AnkiConnect action 'addNote'" in str(exc_info.value)
    assert "strictly read-only" in str(exc_info.value)

    with pytest.raises(PermissionError):
        client.invoke("deleteNotes", notes=[1, 2, 3])

    with pytest.raises(PermissionError):
        client.invoke("guiAddCards")


@pytest.mark.asyncio
async def test_reconcile_zero_cards_safety_guard(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Initial sync with 3 cards
    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
    store = local_adapter._store
    _, count = store.query_anki_cards()
    assert count == 3

    # Anki returns 0 cards (e.g., Anki closed or temporary anomaly)
    fake_anki.cards.clear()
    fake_anki.mods.clear()

    result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
    assert result.status == "ok"
    assert result.deleted_on_reconcile == 0

    # Safety guard: cards should NOT have been wiped from DB
    _, count_after = store.query_anki_cards()
    assert count_after == 3

    status = store.get_anki_status()
    assert "0 cards" in (status.get("reconcile_skipped_reason") or "")


@pytest.mark.asyncio
async def test_reconcile_shrink_safety_guard_skips_without_flag(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Add 10 cards
    for i in range(10, 20):
        fake_anki.add_card(i, f"word{i}")

    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
    store = local_adapter._store
    _, count = store.query_anki_cards()
    assert count == 13

    # Now drop to 4 cards (< 50% of 13)
    cids = list(fake_anki.cards.keys())
    for cid in cids[4:]:
        del fake_anki.cards[cid]
        del fake_anki.mods[cid]
    assert len(fake_anki.cards) == 4

    # Full reconcile without allow_shrink flag
    result = await sync_anki_mirror(local_adapter, full=True, allow_shrink=False, anki_client=client, state_file=state_file)
    assert result.status == "ok"
    assert result.deleted_on_reconcile == 0

    # Ensure DB was not deleted
    _, count_after = store.query_anki_cards()
    assert count_after == 13
    status = store.get_anki_status()
    assert "less than 50%" in (status.get("reconcile_skipped_reason") or "")


@pytest.mark.asyncio
async def test_reconcile_shrink_safety_guard_proceeds_with_flag(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    for i in range(10, 20):
        fake_anki.add_card(i, f"word{i}")

    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)
    store = local_adapter._store

    cids = list(fake_anki.cards.keys())
    for cid in cids[4:]:
        del fake_anki.cards[cid]
        del fake_anki.mods[cid]
    assert len(fake_anki.cards) == 4

    # Full reconcile WITH allow_shrink=True
    result = await sync_anki_mirror(local_adapter, full=True, allow_shrink=True, anki_client=client, state_file=state_file)
    assert result.status == "ok"
    assert result.deleted_on_reconcile == 9

    _, count_after = store.query_anki_cards()
    assert count_after == 4


@pytest.mark.asyncio
async def test_profile_mismatch_guard(fake_anki: FakeAnkiTransport, local_adapter: LocalDevQueueAdapter, tmp_path: Path):
    client = AnkiClient(transport=fake_anki.invoke)
    state_file = tmp_path / "state.json"

    # Initial sync with "User 1"
    fake_anki.active_profile = "User 1"
    await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    # Anki switches profile to "User 2"
    fake_anki.active_profile = "User 2"
    result = await sync_anki_mirror(local_adapter, full=True, anki_client=client, state_file=state_file)

    assert result.status == "skipped"
    assert result.mode == "profile_mismatch"
    assert "Profile mismatch" in result.message
    assert result.cards_pushed == 0

