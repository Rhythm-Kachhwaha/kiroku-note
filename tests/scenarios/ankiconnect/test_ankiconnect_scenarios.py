"""
Hardening scenarios for ankiconnect module.
Tests boundary contracts of AnkiConnectService, AnkiFSRSSyncService, CardService, and ReviewRepository.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone, timedelta
from pathlib import Path
import threading
import time
from unittest.mock import MagicMock, patch
import pytest

from app.db.connection import db_session, init_db
from app.repositories.card_repository import CardRepository, CardDraft
from app.repositories.review_repository import ReviewRepository
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError
from app.services.anki_fsrs_sync import AnkiFSRSSyncService
from app.services.card_service import CardService


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _insert_card(
    db_path: Path,
    expression: str,
    reading: str,
    meaning: str,
    deck_name: str = "Default",
    anki_note_id: int | None = None,
    sync_status: str = "pending",
    tags: str = "",
    audio: str = "",
    image: str = "",
) -> int:
    now = _iso_now()
    with db_session(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO cards (
                expression, reading, meaning, deck_name, anki_note_id,
                sync_status, tags, audio, image, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                expression,
                reading,
                meaning,
                deck_name,
                anki_note_id,
                sync_status,
                tags,
                audio,
                image,
                expression.strip(),
                reading.strip(),
                deck_name.lower().strip(),
                now,
                now,
            ),
        )
        card_id = cur.lastrowid
        conn.commit()
    return int(card_id)


def test_s01_note_creation_online(tmp_path: Path):
    """S01: When AnkiConnect is online, syncing a card creates a note in Anki and marks card synced."""
    db_path = tmp_path / "s01.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "食べる", "たべる", "to eat", deck_name="Japanese::Vocab", tags="jlpt_n5,verb")

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.resolve_deck_name.return_value = "Japanese::Vocab"
    mock_anki.find_existing_note.return_value = None
    mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
    mock_anki.map_card_to_fields.return_value = {"Front": "食べる [たべる]", "Back": "to eat"}
    mock_anki.add_note.return_value = 10001

    card_svc = CardService(card_repository=CardRepository(db_path=db_path), anki_service=mock_anki)
    result = card_svc.sync_card(card_id)

    assert result.sync_status == "synced"
    assert result.anki_note_id == 10001
    mock_anki.add_note.assert_called_once()
    args, kwargs = mock_anki.add_note.call_args
    assert kwargs.get("deck_name") == "Japanese::Vocab" or args[0] == "Japanese::Vocab"

    # Verify persisted in SQLite
    repo = CardRepository(db_path=db_path)
    card = repo.get_by_id(card_id)
    assert card is not None
    assert card.sync_status == "synced"
    assert card.anki_note_id == 10001


def test_s02_offline_handling_preserves_card(tmp_path: Path):
    """S02: When AnkiConnect is offline, syncing a card preserves it as pending without corruption."""
    db_path = tmp_path / "s02.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "飲む", "のむ", "to drink", deck_name="Default")

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (False, "Connection refused: Anki is closed")
    mock_anki.find_existing_note.side_effect = AnkiConnectionError("Connection refused: Anki is closed")

    card_svc = CardService(card_repository=CardRepository(db_path=db_path), anki_service=mock_anki)
    result = card_svc.sync_card(card_id)

    # Card remains pending or failed with connection message, never corrupting expression/reading
    repo = CardRepository(db_path=db_path)
    card = repo.get_by_id(card_id)
    assert card is not None
    assert card.expression == "飲む"
    assert card.anki_note_id is None
    assert "Connection refused" in (card.sync_error or "")


def test_s03_duplicate_note_resolution(tmp_path: Path):
    """S03: If note already exists in Anki across deck hierarchy, links to existing note instead of creating duplicate."""
    db_path = tmp_path / "s03.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "猫", "ねこ", "cat", deck_name="Vocab")

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.resolve_deck_name.return_value = "Japanese::Vocab"
    # Anki already has this note with id 55555
    mock_anki.find_existing_note.return_value = 55555
    mock_anki.note_matches_card.return_value = True
    mock_anki.get_note_deck.return_value = "Japanese::Vocab"
    mock_anki._invoke.return_value = [{"modelName": "Basic"}]
    mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
    mock_anki.map_card_to_fields.return_value = {"Front": "猫", "Back": "cat"}

    card_svc = CardService(card_repository=CardRepository(db_path=db_path), anki_service=mock_anki)
    result = card_svc.sync_card(card_id, force=True)

    assert result.sync_status == "synced"
    assert result.anki_note_id == 55555
    mock_anki.add_note.assert_not_called()
    mock_anki.update_note_fields.assert_called_once()

    repo = CardRepository(db_path=db_path)
    card = repo.get_by_id(card_id)
    assert card.anki_note_id == 55555


def test_s04_media_attachment_storage(tmp_path: Path):
    """S04: Media upload failure logs warning but does not fail the card note creation."""
    db_path = tmp_path / "s04.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "犬", "いぬ", "dog", deck_name="Default", audio="[sound:kiroku_audio_test.webm]")

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.resolve_deck_name.return_value = "Default"
    mock_anki.find_existing_note.return_value = None
    mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
    mock_anki.map_card_to_fields.return_value = {"Front": "犬", "Back": "dog"}
    mock_anki.add_note.return_value = 77777
    # Media upload throws an exception
    mock_anki.store_media_file.side_effect = RuntimeError("Anki media folder locked")

    with patch("app.services.card_service.MediaStorageService") as mock_storage_cls:
        mock_storage = MagicMock()
        mock_storage.get_media_bytes.return_value = b"fake audio bytes"
        mock_storage_cls.return_value = mock_storage

        card_svc = CardService(
            card_repository=CardRepository(db_path=db_path),
            anki_service=mock_anki,
        )
        result = card_svc.sync_card(card_id)

    # Note creation still succeeded despite media store error
    assert result.sync_status == "synced"
    assert result.anki_note_id == 77777


def test_s05_model_field_mapping(tmp_path: Path):
    """S05: Field mapping maps standard card fields to Anki target fields cleanly."""
    service = AnkiConnectService()
    card = {
        "expression": "桜",
        "reading": "さくら",
        "meaning": "cherry blossom",
        "example_sentence": "桜が咲いた。",
        "example_translation": "The cherry blossoms bloomed.",
        "notes": "N5 vocabulary",
        "audio": "audio123.mp3",
    }
    # Test model with Front / Back
    fields_basic = service.map_card_to_fields(card, ["Front", "Back"])
    assert "桜" in fields_basic["Front"]
    assert "cherry blossom" in fields_basic["Back"]

    # Test model with Japanese mining fields: Expression, Meaning, Sentence, Audio
    fields_mining = service.map_card_to_fields(card, ["Expression", "Reading", "Meaning", "Sentence", "Audio"])
    assert fields_mining["Expression"] == "桜"
    assert fields_mining["Reading"] == "さくら"
    assert "cherry blossom" in fields_mining["Meaning"]
    assert "桜が咲いた。" in fields_mining["Sentence"]


def test_s06_japanese_unicode_tags(tmp_path: Path):
    """S06: Multi-byte Japanese characters and emoji in tags round-trip without encoding corruption."""
    service = AnkiConnectService()
    with patch.object(service, "_invoke", return_value=True) as mock_invoke:
        tags = ["JLPT_N3", "日本語", "日常会話", "🌟"]
        ok = service.set_note_tags(12345, tags)
        assert ok is True
        mock_invoke.assert_called_once_with("setNoteTags", notes=[12345], tags="JLPT_N3 日本語 日常会話 🌟")


def test_s07_offline_reviews_preserved_and_flushed(tmp_path: Path):
    """S07: Offline review in Kiroku is preserved in SQLite and flushed to Anki on reconnect."""
    db_path = tmp_path / "s07.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "勉強", "べんきょう", "study", deck_name="Default", anki_note_id=8001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 9001, "sync_state": "pending_anki"})
    log_id = repo.log_review(card_id=card_id, rating=3, state=0, scheduled_days=1, elapsed_days=0)

    # 1. While offline, review stays pending in SQLite
    assert repo.has_pending_anki_reviews() is True
    assert repo.is_review_log_synced(log_id) is False

    # 2. When Anki reconnects, flush pushes review to Anki
    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = True

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    flush_res = sync_service.flush_pending_reviews()

    assert flush_res["flushed_count"] == 1
    assert flush_res["remaining_count"] == 0
    mock_anki.answer_card.assert_called_once_with(9001, 3)
    assert repo.is_review_log_synced(log_id) is True
    assert repo.has_pending_anki_reviews() is False
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "synced"


def test_s08_multi_review_flush_ordering(tmp_path: Path):
    """S08: Multiple reviews for same card answered with latest review; all prior logs marked synced (no inverted re-answering)."""
    db_path = tmp_path / "s08.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "車", "くるま", "car", deck_name="Default", anki_note_id=8002)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 9002, "sync_state": "pending_anki"})
    # Log 1: Again (rating 1)
    log1 = repo.log_review(card_id=card_id, rating=1, state=0, scheduled_days=0, elapsed_days=0)
    # Log 2: Good (rating 3) 10 minutes later
    log2 = repo.log_review(card_id=card_id, rating=3, state=1, scheduled_days=1, elapsed_days=0)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = True

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    flush_res = sync_service.flush_pending_reviews()

    # Answers Anki with the latest review (rating 3)
    mock_anki.answer_card.assert_called_once_with(9002, 3)
    assert flush_res["flushed_count"] == 1
    assert flush_res["remaining_count"] == 0

    # BOTH logs must be marked synced, so log 1 is never replayed later
    assert repo.is_review_log_synced(log1) is True
    assert repo.is_review_log_synced(log2) is True
    assert repo.has_pending_anki_reviews() is False
    assert repo.get_or_create_fsrs(card_id)["sync_state"] == "synced"

    # Second flush is completely idle
    second_flush = sync_service.flush_pending_reviews()
    assert second_flush["flushed_count"] == 0
    assert mock_anki.answer_card.call_count == 1


def test_s09_auto_create_note_on_flush(tmp_path: Path):
    """S09: Flushing offline review on a card not yet in Anki auto-creates note in Anki before answering review."""
    db_path = tmp_path / "s09.db"
    init_db(db_path)
    # Card was created offline and has NO anki_note_id
    card_id = _insert_card(db_path, "電車", "でんしゃ", "train", deck_name="Default", anki_note_id=None)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"sync_state": "pending_anki"})
    log1 = repo.log_review(card_id=card_id, rating=3, state=0, scheduled_days=1, elapsed_days=0)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.resolve_deck_name.return_value = "Default"
    mock_anki.find_existing_note.return_value = None
    mock_anki.resolve_note_model.return_value = ("Basic", ["Front", "Back"])
    mock_anki.map_card_to_fields.return_value = {"Front": "電車", "Back": "train"}
    mock_anki.add_note.return_value = 88888
    # After note is created, find_cards finds the new card id
    mock_anki.find_cards.side_effect = lambda q: [99999] if "nid:88888" in q else []
    mock_anki.answer_card.return_value = True

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    flush_res = sync_service.flush_pending_reviews()

    assert flush_res["flushed_count"] == 1
    assert flush_res["remaining_count"] == 0
    # Note was created and then card was answered
    mock_anki.add_note.assert_called_once()
    mock_anki.answer_card.assert_called_once_with(99999, 3)

    # SQLite card updated with anki_note_id, fsrs updated with anki_card_id and synced state
    card = CardRepository(db_path=db_path).get_by_id(card_id)
    assert card.anki_note_id == 88888
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["anki_card_id"] == 99999
    assert fsrs["sync_state"] == "synced"
    assert repo.is_review_log_synced(log1) is True


def test_s10_pull_anki_protects_pending_local_reviews(tmp_path: Path):
    """S10: Pulling reviews from Anki never overwrites cards that have unsynced Kiroku reviews waiting in queue."""
    db_path = tmp_path / "s10.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "本", "ほん", "book", deck_name="Default", anki_note_id=6001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {
        "anki_card_id": 7001,
        "reps": 5,
        "due_date": "2027-01-01",
        "sync_state": "pending_anki",
    })
    repo.log_review(card_id=card_id, rating=4, state=2, scheduled_days=40, elapsed_days=5)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = []
    # Anki has stale / older info (reps: 2, interval: 10)
    mock_anki.get_cards_info.return_value = [{
        "cardId": 7001,
        "note": 6001,
        "reps": 2,
        "lapses": 0,
        "interval": 10,
        "queue": 2,
        "due": 100,
        "deck_name": "Default",
    }]

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    pull_res = sync_service.pull_anki_reviews("Default")

    # The card was skipped because it is pending sync to Anki
    assert pull_res["pulled_count"] == 0
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["reps"] == 5
    assert fsrs["due_date"] == "2027-01-01"


def test_s11_review_stats_alignment_no_false_sessions(tmp_path: Path):
    """S11: Kiroku review stats strictly reflect local SQLite get_due_cards; never overwritten with external Anki deck stats."""
    db_path = tmp_path / "s11.db"
    init_db(db_path)
    # Insert 2 cards due today in Kiroku
    c1 = _insert_card(db_path, "雨", "あめ", "rain", deck_name="Default")
    c2 = _insert_card(db_path, "雪", "ゆき", "snow", deck_name="Default")

    repo = ReviewRepository(db_path=db_path)
    today = repo._today_utc()
    repo.update_card_fsrs(c1, {"state": 2, "due_date": today, "scheduled_days": 1, "reps": 1})
    repo.update_card_fsrs(c2, {"state": 2, "due_date": today, "scheduled_days": 1, "reps": 1})

    due_cards = repo.get_due_cards("Default")
    assert len(due_cards) == 2

    # Even if AnkiConnect is open and reports 50 cards due in Anki for "Default"
    with patch("app.services.anki_connect.AnkiConnectService.is_available", return_value=True), \
         patch("app.services.anki_connect.AnkiConnectService.get_deck_stats", return_value={"Default": {"name": "Default", "review_count": 50, "new_count": 20, "learn_count": 5, "total_in_deck": 100}}):
        stats = repo.get_review_stats("Default")
        # Kiroku stats MUST match the actual cards due in Kiroku SQLite (2 cards)
        assert stats["reviews_due_count"] == 2
        assert stats["cards_due_today"] == 2
        # Anki's numbers should be accessible under anki_* without corrupting Kiroku's review session
        assert stats.get("anki_total_in_deck") == 100


def test_s12_orphaned_anki_card_dead_lettering(tmp_path: Path):
    """S12: Deleted/orphaned card in Anki is detected and marked orphaned, clearing the pending review queue."""
    db_path = tmp_path / "s12.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "消去", "しょうきょ", "erased", deck_name="Default", anki_note_id=9999)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 8888, "sync_state": "orphaned"})
    log_id = repo.log_review(card_id=card_id, rating=3, state=1, scheduled_days=1, elapsed_days=0)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = False
    # get_cards_info returns empty list because card was deleted in Anki
    mock_anki.get_cards_info.return_value = []

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    flush_res = sync_service.flush_pending_reviews()

    # Dead-lettered: review marked synced, sync_state remains orphaned, not pending
    assert repo.has_pending_anki_reviews() is False
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["sync_state"] == "orphaned"


def test_s13_concurrent_sync_serialization(tmp_path: Path):
    """S13: Concurrent sync calls are serialized under the synchronization lock without double-answering."""
    db_path = tmp_path / "s13.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "光", "ひかり", "light", deck_name="Default", anki_note_id=5001)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 6001, "sync_state": "pending_anki"})
    repo.log_review(card_id=card_id, rating=3, state=0, scheduled_days=1, elapsed_days=0)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)

    # Introduce small delay in answer_card to test thread contention
    def _delayed_answer(cid, rating):
        time.sleep(0.05)
        return True

    mock_anki.answer_card.side_effect = _delayed_answer

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)

    results = []

    def _worker():
        res = sync_service.flush_pending_reviews()
        results.append(res)

    t1 = threading.Thread(target=_worker)
    t2 = threading.Thread(target=_worker)

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # One worker flushed 1 review; other worker found 0 pending reviews
    flushed_total = sum(r.get("flushed_count", 0) for r in results)
    assert flushed_total == 1
    assert mock_anki.answer_card.call_count == 1
    assert repo.has_pending_anki_reviews() is False


def test_s14_deleted_note_dead_lettering(tmp_path: Path):
    """S14: Deleted note in Anki Desktop (cannot resolve card id) dead-letters rather than blocking flush queue."""
    db_path = tmp_path / "s14.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "消去", "しょうきょ", "erased", deck_name="Default", anki_note_id=9999)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": None, "sync_state": "pending_anki"})
    log_id = repo.log_review(card_id=card_id, rating=3, state=1, scheduled_days=1, elapsed_days=0)

    # Note 9999 was deleted in Anki Desktop and cannot be found
    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.find_cards.return_value = []
    mock_anki.find_existing_note.return_value = None
    mock_anki.get_notes_info.return_value = []

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    flush_res = sync_service.flush_pending_reviews()

    assert repo.has_pending_anki_reviews() is False
    assert repo.is_review_log_synced(log_id) is True
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["sync_state"] == "orphaned"
    assert flush_res["remaining_count"] == 0


def test_s15_max_retries_dead_lettering(tmp_path: Path):
    """S15: Repeated answer_card failures after max retries dead-letters without blocking flush queue forever."""
    db_path = tmp_path / "s15.db"
    init_db(db_path)
    card_id = _insert_card(db_path, "頑固", "がんこ", "stubborn", deck_name="Default", anki_note_id=3333)

    repo = ReviewRepository(db_path=db_path)
    repo.update_card_fsrs(card_id, {"anki_card_id": 4444, "sync_state": "pending_anki"})
    log_id = repo.log_review(card_id=card_id, rating=3, state=1, scheduled_days=1, elapsed_days=0)

    mock_anki = MagicMock(spec=AnkiConnectService)
    mock_anki.is_connected.return_value = (True, None)
    mock_anki.answer_card.return_value = False
    # Card exists in Anki but consistently rejects answering
    mock_anki.get_cards_info.return_value = [{"cardId": 4444, "queue": -1}]

    sync_service = AnkiFSRSSyncService(anki_service=mock_anki, review_repo=repo)
    # Perform successive flushes up to retry limit (3)
    for _ in range(3):
        sync_service.flush_pending_reviews()

    # After 3 failed attempts, review log is dead-lettered and queue unblocked
    assert repo.has_pending_anki_reviews() is False
    assert repo.is_review_log_synced(log_id) is True
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["sync_state"] in ("orphaned", "failed", "synced")
