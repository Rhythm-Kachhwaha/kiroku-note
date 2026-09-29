"""Tests for T3-I Capture Provenance Tracking (source_type, source_url)."""
import pytest
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.card_service import CardService


def test_card_repository_provenance(tmp_path):
    db_file = tmp_path / "test_kiroku.db"
    repo = CardRepository(db_path=db_file)

    draft = CardDraft(
        expression="挑戦",
        reading="ちょうせん",
        meaning="challenge",
        source_type="video",
        source_url="https://youtube.com/watch?v=xyz123",
        deck_name="Default",
    )
    record, is_new = repo.save(draft)
    assert is_new is True
    assert record.source_type == "video"
    assert record.source_url == "https://youtube.com/watch?v=xyz123"

    fetched = repo.get_by_id(record.id)
    assert fetched is not None
    assert fetched.source_type == "video"
    assert fetched.source_url == "https://youtube.com/watch?v=xyz123"

    all_cards = repo.list_cards()
    assert len(all_cards) == 1
    assert all_cards[0].source_type == "video"
    assert all_cards[0].source_url == "https://youtube.com/watch?v=xyz123"


def test_card_service_provenance_roundtrip(tmp_path):
    db_file = tmp_path / "test_service.db"
    repo = CardRepository(db_path=db_file)
    service = CardService(card_repository=repo)

    req = SaveCardRequest(
        expression="一期一会",
        reading="いちごいちえ",
        meaning="once-in-a-lifetime encounter",
        source_type="ocr",
        source_url="https://example.com/manga-ch1",
        deck_name="Default",
    )
    res = service.save_card(req)
    assert res.source_type == "ocr"
    assert res.source_url == "https://example.com/manga-ch1"

    # Verify list_cards lists source metadata
    list_res = service.list_cards()
    assert len(list_res.cards) == 1
    assert list_res.cards[0].source_type == "ocr"
    assert list_res.cards[0].source_url == "https://example.com/manga-ch1"

    # Verify get_card detail returns source metadata
    detail_res = service.get_card(res.id)
    assert detail_res is not None
    assert detail_res.source_type == "ocr"
    assert detail_res.source_url == "https://example.com/manga-ch1"
