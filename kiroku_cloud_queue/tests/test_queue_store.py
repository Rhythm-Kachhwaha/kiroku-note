"""
test_queue_store.py -- Tests for durable queue persistence, atomic claims, leases, and idempotency.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest

from queue_adapter import VocabCard
from queue_store import SqliteQueueStore, compute_idempotency_key


@pytest.fixture()
def store(tmp_path: Path) -> SqliteQueueStore:
    db_file = tmp_path / "test_store.db"
    return SqliteQueueStore(db_path=db_file)


def test_enqueue_and_deduplication(store: SqliteQueueStore):
    card = VocabCard(
        expression="約束",
        reading="やくそく",
        meaning="promise",
        sentence="約束を守る。",
        sentence_meaning="Keep a promise.",
        deck_name="N3 vocabs",
    )
    item_id1, is_dup1 = store.enqueue(card)
    assert item_id1
    assert is_dup1 is False

    # Second enqueue with identical content -> returns same ID with is_dup=True
    item_id2, is_dup2 = store.enqueue(card)
    assert item_id2 == item_id1
    assert is_dup2 is True

    # Stats show only 1 pending
    stats = store.stats()
    assert stats.get("pending") == 1


def test_atomic_claim_with_lease(store: SqliteQueueStore):
    card = VocabCard(
        expression="映画",
        reading="えいが",
        meaning="movie",
        sentence="映画を見た。",
        sentence_meaning="Watched a movie.",
    )
    store.enqueue(card)

    # Claim with 60 second lease
    claimed = store.claim_pending(limit=10, lease_seconds=60)
    assert len(claimed) == 1
    item = claimed[0]
    assert item.card.expression == "映画"
    assert item.status == "claimed"
    assert item.attempts == 1
    assert item.claim_token != ""

    # Second claim immediately -> should return 0 items because the item is leased
    claimed_again = store.claim_pending(limit=10, lease_seconds=60)
    assert len(claimed_again) == 0


def test_lease_expiration_allows_reclaim(store: SqliteQueueStore):
    card = VocabCard(expression="星", reading="ほし", meaning="star", sentence="星が綺麗だ。", sentence_meaning="The stars are beautiful.")
    store.enqueue(card)

    # Claim with negative lease so it immediately expires
    claimed1 = store.claim_pending(limit=10, lease_seconds=-10)
    assert len(claimed1) == 1
    assert claimed1[0].attempts == 1

    # Now reclaim: should be reclaimed because lease expired
    claimed2 = store.claim_pending(limit=10, lease_seconds=60)
    assert len(claimed2) == 1
    assert claimed2[0].id == claimed1[0].id
    assert claimed2[0].attempts == 2
    assert claimed2[0].claim_token != claimed1[0].claim_token


def test_ack_with_valid_claim_token(store: SqliteQueueStore):
    card = VocabCard(expression="水", reading="みず", meaning="water", sentence="水を飲む。", sentence_meaning="Drink water.")
    store.enqueue(card)

    claimed = store.claim_pending(limit=10, lease_seconds=60)
    item = claimed[0]

    # Ack with correct claim token
    success = store.ack(item.id, claim_token=item.claim_token)
    assert success is True

    # Item is completed
    stats = store.stats()
    assert stats.get("completed") == 1
    assert stats.get("claimed", 0) == 0
    assert stats.get("pending", 0) == 0


def test_ack_with_invalid_claim_token_fails(store: SqliteQueueStore):
    card = VocabCard(expression="火", reading="ひ", meaning="fire", sentence="火を消す。", sentence_meaning="Put out the fire.")
    store.enqueue(card)

    claimed = store.claim_pending(limit=10, lease_seconds=60)
    item = claimed[0]

    # Ack with stale or wrong claim token
    success = store.ack(item.id, claim_token="wrong-token")
    assert success is False

    stats = store.stats()
    assert stats.get("claimed") == 1
    assert stats.get("completed", 0) == 0


def test_nack_requeues_until_max_attempts(store: SqliteQueueStore):
    card = VocabCard(expression="木", reading="き", meaning="tree", sentence="木がある。", sentence_meaning="There is a tree.")
    store.enqueue(card)

    claimed = store.claim_pending(limit=10, lease_seconds=60)
    item = claimed[0]

    # Nack with error
    store.nack(item.id, error="Transient error 1", claim_token=item.claim_token)

    stats = store.stats()
    assert stats.get("pending") == 1
    assert stats.get("claimed", 0) == 0

    # Exhaust retries up to max_attempts (5)
    for i in range(2, 6):
        c = store.claim_pending(limit=10, lease_seconds=60)
        assert len(c) == 1
        store.nack(c[0].id, error=f"Transient error {i}", claim_token=c[0].claim_token)

    # After 5 attempts, item moves to failed status
    stats = store.stats()
    assert stats.get("failed") == 1
    assert stats.get("pending", 0) == 0


def test_get_queue_store_auto_detects_postgres_url(monkeypatch):
    import os
    from queue_store import get_queue_store
    from postgres_store import PostgresQueueStore

    # Test postgresql:// auto-detect without QUEUE_STORAGE
    monkeypatch.delenv("QUEUE_STORAGE", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require")
    store = get_queue_store()
    assert isinstance(store, PostgresQueueStore)
    assert store.connection_url == "postgresql://user:pass@ep-test.neon.tech/neondb?sslmode=require"

    # Test postgres:// prefix normalization
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@ep-test.neon.tech/neondb?sslmode=require")
    store2 = get_queue_store()
    assert isinstance(store2, PostgresQueueStore)
    assert store2.connection_url.startswith("postgresql://")


def test_postgres_store_init_db_contract():
    from postgres_store import PostgresQueueStore
    store = PostgresQueueStore("postgresql://localhost:5432/mockdb")
    assert hasattr(store, "init_db")
    assert callable(store.init_db)

