"""Tests for deck-scoped duplicate detection across backend repository, service, and API."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.card_normalizer import get_duplicate_identity, normalize_deck, normalize_expression, normalize_reading
from app.services.card_service import CardService
from app.services.yomitan import EnrichedTerm, IdentifiedTerm, YomitanService


@pytest.fixture
def temp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    db_path = Path(path)
    init_db(db_path)
    yield db_path
    if db_path.exists():
        try:
            db_path.unlink()
        except PermissionError:
            pass


class TestDeckDuplicates:
    def test_same_expression_and_reading_different_decks_both_saved(self, temp_db):
        """Card in Deck A must not prevent same word/reading in Deck B."""
        repo = CardRepository(temp_db)
        service = CardService(card_repository=repo)

        # 1. Save to Japanese N3 deck
        res1 = service.save_card(
            SaveCardRequest(
                expression="食べる",
                reading="たべる",
                meaning="to eat",
                deck_name="Japanese N3",
            )
        )
        assert res1.is_new is True
        assert res1.is_duplicate is False
        assert res1.deck_name == "Japanese N3"

        # 2. Save to Anime Vocabulary deck
        res2 = service.save_card(
            SaveCardRequest(
                expression="食べる",
                reading="たべる",
                meaning="to eat; to feast",
                deck_name="Anime Vocabulary",
            )
        )
        assert res2.is_new is True
        assert res2.is_duplicate is False
        assert res2.deck_name == "Anime Vocabulary"
        assert res2.id != res1.id

        # Total cards in DB is 2
        assert repo.count() == 2

    def test_same_expression_and_reading_same_deck_is_duplicate(self, temp_db):
        """Saving same word/reading in the same deck returns existing card with is_duplicate=True."""
        repo = CardRepository(temp_db)
        service = CardService(card_repository=repo)

        res1 = service.save_card(
            SaveCardRequest(
                expression="食べる",
                reading="たべる",
                meaning="to eat",
                deck_name="Japanese N3",
            )
        )
        assert res1.is_new is True

        res2 = service.save_card(
            SaveCardRequest(
                expression="食べる",
                reading="たべる",
                meaning="to consume",
                deck_name="Japanese N3",
            )
        )
        assert res2.is_new is False
        assert res2.is_duplicate is True
        assert res2.id == res1.id
        assert repo.count() == 1

    def test_different_readings_same_deck_are_distinct(self, temp_db):
        """Different readings for same expression in same deck are distinct cards."""
        repo = CardRepository(temp_db)
        service = CardService(card_repository=repo)

        res1 = service.save_card(
            SaveCardRequest(
                expression="行く",
                reading="いく",
                meaning="to go (iku)",
                deck_name="Default",
            )
        )
        res2 = service.save_card(
            SaveCardRequest(
                expression="行く",
                reading="ゆく",
                meaning="to go (yuku)",
                deck_name="Default",
            )
        )

        assert res1.is_new is True
        assert res2.is_new is True
        assert res1.id != res2.id
        assert repo.count() == 2

    def test_deck_name_normalization_prevents_whitespace_duplicates(self, temp_db):
        """Deck name with whitespace variations normalizes consistently."""
        repo = CardRepository(temp_db)
        service = CardService(card_repository=repo)

        res1 = service.save_card(
            SaveCardRequest(
                expression="同じ",
                reading="おなじ",
                meaning="same",
                deck_name="  Japanese Core  ",
            )
        )
        assert res1.is_new is True
        assert res1.deck_name == "Japanese Core"

        res2 = service.save_card(
            SaveCardRequest(
                expression="同じ",
                reading="おなじ",
                meaning="identical",
                deck_name="Japanese Core",
            )
        )
        assert res2.is_new is False
        assert res2.is_duplicate is True
        assert res2.id == res1.id

    def test_capture_term_checks_specified_deck(self, temp_db):
        """capture_term checks duplicate against requested deck_name."""
        repo = CardRepository(temp_db)
        mock_yomitan = MagicMock(spec=YomitanService)
        mock_yomitan.identify.return_value = IdentifiedTerm(
            expression="映画",
            reading="えいが",
            source_text="映画",
            deinflected_text="映画",
        )
        mock_yomitan.enrich.return_value = EnrichedTerm(
            expression="映画",
            reading="えいが",
            source_text="映画",
            deinflected_text="映画",
            entries=[],
            kanji_entries=[],
        )

        service = CardService(card_repository=repo, yomitan_service=mock_yomitan)

        # 1. Save card in Deck A
        saved = service.save_card(
            SaveCardRequest(expression="映画", reading="えいが", meaning="movie", deck_name="Deck A")
        )

        # 2. Capture targeting Deck A -> should be detected as already saved
        cap_a = service.capture_term("映画", deck_name="Deck A")
        assert cap_a.is_duplicate is True
        assert cap_a.id == saved.id
        assert cap_a.deck_name == "Deck A"

        # 3. Capture targeting Deck B -> should NOT be duplicate
        cap_b = service.capture_term("映画", deck_name="Deck B")
        assert cap_b.is_duplicate is False
        assert cap_b.id is None
        assert cap_b.deck_name == "Deck B"

    def test_api_capture_and_save_per_deck(self, temp_db):
        """Test capture & save API routes handle deck scoping end-to-end."""
        client = TestClient(app)

        with patch("app.main.init_db"):
            with patch.dict(os.environ, {"ANKIMINER_DB_PATH": str(temp_db)}):
                # Save to Deck1
                res1 = client.post(
                    "/api/cards/save",
                    json={"expression": "水", "reading": "みず", "meaning": "water", "deck_name": "Deck1"},
                )
                assert res1.status_code == 200
                assert res1.json()["is_new"] is True

                # Save to Deck2
                res2 = client.post(
                    "/api/cards/save",
                    json={"expression": "水", "reading": "みず", "meaning": "water", "deck_name": "Deck2"},
                )
                assert res2.status_code == 200
                assert res2.json()["is_new"] is True
                assert res2.json()["id"] != res1.json()["id"]

                # Save duplicate to Deck1
                res3 = client.post(
                    "/api/cards/save",
                    json={"expression": "水", "reading": "みず", "meaning": "water", "deck_name": "Deck1"},
                )
                assert res3.status_code == 200
                assert res3.json()["is_new"] is False
                assert res3.json()["is_duplicate"] is True
                assert res3.json()["id"] == res1.json()["id"]

    def test_deck_switch_roundtrip_duplicate_checks(self, temp_db):
        """End-to-end regression: Save in Deck A -> Save in Deck B -> check both recognized as duplicates in their respective decks."""
        repo = CardRepository(temp_db)
        service = CardService(card_repository=repo)

        # 1. Save in Deck A
        card_a = service.save_card(
            SaveCardRequest(expression="食べる", reading="たべる", meaning="to eat", deck_name="Deck A")
        )
        assert card_a.is_new is True
        assert card_a.id is not None

        # 2. Check Deck A -> duplicate
        dup_a1 = repo.find_by_identity("食べる", "たべる", "Deck A")
        assert dup_a1 is not None
        assert dup_a1.id == card_a.id

        # 3. Check Deck B -> not duplicate yet
        dup_b1 = repo.find_by_identity("食べる", "たべる", "Deck B")
        assert dup_b1 is None

        # 4. Save in Deck B
        card_b = service.save_card(
            SaveCardRequest(expression="食べる", reading="たべる", meaning="to eat", deck_name="Deck B")
        )
        assert card_b.is_new is True
        assert card_b.id != card_a.id

        # 5. Check Deck B -> now duplicate with card_b ID
        dup_b2 = repo.find_by_identity("食べる", "たべる", "Deck B")
        assert dup_b2 is not None
        assert dup_b2.id == card_b.id

        # 6. Switch back check Deck A -> still duplicate with card_a ID
        dup_a2 = repo.find_by_identity("食べる", "たべる", "Deck A")
        assert dup_a2 is not None
        assert dup_a2.id == card_a.id

        # 7. Total cards stored is 2
        assert repo.count() == 2

