"""
test_mirror_reliability.py -- Regression and reliability tests for Workstream B.
Verifies:
  - AnkiConnect typed exceptions and chunk retry with backoff.
  - Reviews chunk failures skip cards rather than overwriting cloud data with bogus reviews=0.
  - Per-batch commit semantics: unconfirmed batches stay dirty in the state file and retry next run.
  - Media failure does not falsely set has_media=True.
  - Incremental sync updates anki_daily for recent reviews.
  - Absolute due_date calculation covers beyond 30 days and learning cards.
  - Reconcile is skipped when sync has errors or is partial.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Any, Optional
import pytest

from anki_mirror import (
    AnkiClient,
    AnkiConnectError,
    AnkiConnectionResetError,
    AnkiTimeoutError,
    AnkiUnreachableError,
    MirrorResult,
    sync_anki_mirror,
    _load_state,
    _save_state,
)


class FlakyAnkiTransport:
    """Configurable fake transport that can fail or drop connections at specific actions or chunks."""

    def __init__(self):
        self.version = 6
        self.active_profile = "User 1"
        self.cards: dict[int, dict[str, Any]] = {}
        self.mods: dict[int, int] = {}
        self.reviews: dict[int, list[dict[str, Any]]] = {}
        self.fail_actions: dict[str, Exception] = {}
        self.drop_review_chunks: set[int] = set()
        self.drop_media_files: set[str] = set()
        self.chunk_call_count = 0

    def add_card(
        self,
        card_id: int,
        expression: str,
        mod: int = 1000,
        interval: int = 10,
        lapses: int = 0,
        reps: int = 5,
        queue: int = 2,
        due: int = 0,
    ):
        note_id = card_id + 50000
        self.cards[card_id] = {
            "cardId": card_id,
            "note": note_id,
            "deckName": "Japanese::Mining",
            "modelName": "Kiroku Note",
            "fields": {
                "Expression": {"value": expression, "order": 0},
                "Reading": {"value": "", "order": 1},
                "Meaning": {"value": f"Meaning of {expression}", "order": 2},
                "Sentence": {"value": "", "order": 3},
            },
            "type": 2 if queue == 2 else queue,
            "queue": queue,
            "interval": interval,
            "lapses": lapses,
            "reps": reps,
            "due": due,
            "mod": mod,
        }
        self.mods[card_id] = mod
        self.reviews.setdefault(card_id, [])

    def add_review(self, card_id: int, rev_id: int, ease: int = 3, ivl: int = 10):
        self.reviews.setdefault(card_id, []).append({
            "id": rev_id,
            "cardId": card_id,
            "type": 1,
            "ease": ease,
            "ivl": ivl,
            "lastIvl": max(1, ivl - 5),
            "time": 2500,
        })

    def __call__(self, action: str, params: dict[str, Any]) -> Any:
        if action in self.fail_actions:
            raise self.fail_actions[action]

        if action == "version":
            return self.version
        if action == "getActiveProfile":
            return self.active_profile
        if action == "findCards":
            query = params.get("query", "")
            if query == "deck:*":
                return list(self.cards.keys())
            if query == "tag:leech":
                return [cid for cid, c in self.cards.items() if c.get("lapses", 0) >= 8]
            if query == "prop:due<0":
                return [cid for cid, c in self.cards.items() if c.get("queue") == 2 and c.get("due", 0) < 0]
            if query.startswith("prop:due="):
                val = int(query.split("=")[1])
                return [cid for cid, c in self.cards.items() if c.get("queue") == 2 and c.get("due", 0) == val]
            if "rated:" in query:
                return [cid for cid, r_list in self.reviews.items() if r_list]
            return list(self.cards.keys())

        if action == "cardsModTime":
            cards = params.get("cards", [])
            return [{"cardId": cid, "mod": self.mods.get(cid, 0)} for cid in cards]

        if action == "cardsInfo":
            cards = params.get("cards", [])
            return [self.cards[cid] for cid in cards if cid in self.cards]

        if action == "notesInfo":
            return []

        if action == "getReviewsOfCards":
            cards = params.get("cards", [])
            self.chunk_call_count += 1
            if self.chunk_call_count in self.drop_review_chunks:
                raise AnkiConnectionResetError(f"Connection reset on chunk {self.chunk_call_count}")
            return {str(cid): self.reviews.get(cid, []) for cid in cards}

        if action == "retrieveMediaFile":
            fname = params.get("filename", "")
            if fname in self.drop_media_files:
                raise AnkiTimeoutError(f"Media download timed out for {fname}")
            return None

        return None


class FlakyQueueAdapter:
    """Mock queue adapter that can fail on specific card batches."""

    def __init__(self):
        self.pushed_cards: list[dict[str, Any]] = []
        self.pushed_daily: list[dict[str, Any]] = []
        self.pushed_reviews: list[dict[str, Any]] = []
        self.meta: dict[str, Any] = {}
        self.fail_batch_indices: set[int] = set()
        self.batch_count = 0
        self.reconcile_called = False

    async def push_anki_cards(self, batch: list[dict[str, Any]]) -> bool:
        self.batch_count += 1
        if self.batch_count in self.fail_batch_indices:
            return False
        self.pushed_cards.extend(batch)
        return True

    async def push_anki_daily(self, batch: list[dict[str, Any]]) -> bool:
        self.pushed_daily.extend(batch)
        return True

    async def push_anki_media(self, batch: list[dict[str, Any]]) -> bool:
        return True

    async def push_anki_reviews(self, batch: list[dict[str, Any]]) -> bool:
        self.pushed_reviews.extend(batch)
        return True

    async def push_anki_meta(self, meta: dict[str, Any]) -> bool:
        self.meta = dict(meta)
        return True

    async def reconcile_anki_cards(self, valid_cids: list[int]) -> int:
        self.reconcile_called = True
        return 0


@pytest.mark.asyncio
async def test_reviews_chunk_failure_skips_cards_and_preserves_state(tmp_path: Path):
    """
    B2: If getReviewsOfCards fails on chunk k, cards in that chunk must NOT be pushed
    with empty reviews, must NOT overwrite good cloud data, and must NOT be marked synced.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    # Add 4 cards
    transport.add_card(101, "食べる", mod=1000)
    transport.add_review(101, 1729000001000, ease=1) # lapsed review
    transport.add_card(102, "飲む", mod=1000)
    transport.add_review(102, 1729000002000, ease=3)

    # First run succeeds
    adapter = FlakyQueueAdapter()
    client = AnkiClient(transport=transport)
    res1 = await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)
    assert res1.status == "ok"
    assert len(adapter.pushed_cards) == 2

    # Now update mod on both cards, but fail review fetch for chunk 1
    transport.mods[101] = 2000
    transport.mods[102] = 2000
    transport.chunk_call_count = 0
    transport.drop_review_chunks.add(1) # drop first review chunk

    adapter2 = FlakyQueueAdapter()
    res2 = await sync_anki_mirror(adapter2, anki_client=client, state_file=state_file)

    # Result must be partial, and card 101/102 must NOT be pushed with missing reviews
    assert res2.status == "partial"
    # State file must NOT advance card_mods for the failed chunk
    state_after = _load_state(state_file)
    assert state_after["card_mods"].get("101") != 2000


@pytest.mark.asyncio
async def test_per_batch_commit_retries_failed_batches_next_run(tmp_path: Path):
    """
    B3: A failed card push batch must NOT advance card_mods in the state file.
    The failed batch must stay dirty and be retried on the next run.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    for i in range(1, 251):
        transport.add_card(200 + i, f"Word_{i}", mod=1000)

    adapter = FlakyQueueAdapter()
    adapter.fail_batch_indices.add(2) # Fail the second batch (cards 201-250)

    client = AnkiClient(transport=transport)
    res = await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)

    # If batch 2 failed, status is partial
    assert res.status == "partial"
    state = _load_state(state_file)
    # Unconfirmed cards must not have their mods saved
    confirmed_count = sum(1 for cid in transport.cards if str(cid) in state.get("card_mods", {}))
    assert confirmed_count == 200


@pytest.mark.asyncio
async def test_reconcile_skipped_when_sync_is_partial(tmp_path: Path):
    """
    B7: reconcile_anki_cards must be skipped if pushes failed or review fetches dropped.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    transport.add_card(301, "行く", mod=1000)
    transport.drop_review_chunks.add(1)

    adapter = FlakyQueueAdapter()
    client = AnkiClient(transport=transport)
    res = await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)

    assert res.status == "partial"
    assert adapter.reconcile_called is False


@pytest.mark.asyncio
async def test_media_failure_does_not_falsely_set_has_media(tmp_path: Path):
    """
    B4: If retrieveMediaFile fails, has_media must be False.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    transport.add_card(401, "猫", mod=1000)
    # Add an img tag to Meaning
    transport.cards[401]["fields"]["Meaning"]["value"] = '<img src="cat.jpg"> Cat'
    transport.drop_media_files.add("cat.jpg")

    adapter = FlakyQueueAdapter()
    client = AnkiClient(transport=transport)
    res = await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)

    assert res.status == "ok"
    assert len(adapter.pushed_cards) == 1
    # has_media must be False because media download failed
    assert adapter.pushed_cards[0]["has_media"] is False


@pytest.mark.asyncio
async def test_daily_series_refreshed_on_incremental_sync(tmp_path: Path):
    """
    B5: Incremental sync should refresh recent daily series rows (last 14 days),
    not just wait for the 24h full sync.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    transport.add_card(501, "犬", mod=1000)
    adapter = FlakyQueueAdapter()
    client = AnkiClient(transport=transport)

    # Initial full sync
    await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)

    # Now simulate incremental sync with new review today
    transport.mods[501] = 1100
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    transport.add_review(501, now_ms, ease=3)

    adapter2 = FlakyQueueAdapter()
    res2 = await sync_anki_mirror(adapter2, anki_client=client, state_file=state_file, full=False)
    assert res2.status == "ok"
    assert res2.mode == "incremental"
    # Daily rows should have been pushed on incremental sync!
    assert res2.daily_rows_pushed > 0
    assert len(adapter2.pushed_daily) > 0


@pytest.mark.asyncio
async def test_due_date_stored_as_absolute_date_and_learning_cards(tmp_path: Path):
    """
    B6: Review cards and learning cards must have absolute due_date calculated (YYYY-MM-DD),
    covering beyond 30 days and learning cards properly.
    """
    state_file = tmp_path / ".mirror_state.json"
    transport = FlakyAnkiTransport()
    # Review card due in 45 days
    transport.add_card(601, "明日", queue=2, due=45, mod=1000)
    # Learning card due today (epoch timestamp)
    learning_ts = int(datetime.now(timezone.utc).timestamp()) + 3600
    transport.add_card(602, "今", queue=1, due=learning_ts, mod=1000)

    adapter = FlakyQueueAdapter()
    client = AnkiClient(transport=transport)
    res = await sync_anki_mirror(adapter, anki_client=client, state_file=state_file, full=True)

    assert res.status == "ok"
    card_map = {c["card_id"]: c for c in adapter.pushed_cards}
    assert 601 in card_map
    assert 602 in card_map
    # Absolute due_date must be populated
    assert card_map[601]["due_date"] is not None
    assert card_map[602]["due_date"] is not None
    # due_in_days for card 601 should not be None
    assert card_map[601]["due_in_days"] is not None

