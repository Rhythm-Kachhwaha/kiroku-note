import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.db.connection import db_session, init_db
from app.main import app
from app.schemas import SaveCardRequest
from app.services.card_service import CardService
from app.services.cloud_sync_service import CloudSyncService


@pytest.fixture
def temp_db(tmp_path):
    db_file = tmp_path / "test_sync.db"
    init_db(db_file)
    return db_file


@pytest.fixture
def client():
    return TestClient(app)


def test_cloud_sync_status_and_tracking(temp_db):
    service = CloudSyncService(db_path=temp_db)
    status_init = service.get_sync_status()
    assert status_init["total_local"] == 0
    assert status_init["pending_push"] == 0

    # Save 2 cards locally
    card_svc = CardService(card_repository=service.card_repo)
    card1 = card_svc.save_card(SaveCardRequest(expression="林檎", reading="りんご", meaning="apple"))
    card2 = card_svc.save_card(SaveCardRequest(expression="蜜柑", reading="みかん", meaning="mandarin"))

    status_after = service.get_sync_status()
    assert status_after["total_local"] == 2
    assert status_after["pending_push"] == 2
    assert status_after["synced_to_cloud"] == 0

    unsynced = service.get_unsynced_cards(limit=10)
    assert len(unsynced) == 2
    assert unsynced[0]["expression"] == "林檎"
    assert unsynced[1]["expression"] == "蜜柑"

    # Mark card1 as pushed
    service.mark_cards_pushed([(unsynced[0]["local_id"], unsynced[0]["id"])])
    status_pushed = service.get_sync_status()
    assert status_pushed["synced_to_cloud"] == 1
    assert status_pushed["pending_push"] == 1

    remaining = service.get_unsynced_cards(limit=10)
    assert len(remaining) == 1
    assert remaining[0]["expression"] == "蜜柑"


def test_import_pulled_card_deduplication(temp_db):
    service = CloudSyncService(db_path=temp_db)

    # 1. Pull new card from cloud
    item_new = {
        "id": "cloud_op_1",
        "payload": {
            "expression": "桜",
            "reading": "さくら",
            "meaning": "cherry blossom",
            "deck_name": "Default"
        }
    }
    card_id, was_new = service.import_pulled_card(item_new)
    assert was_new is True
    assert card_id > 0

    # 2. Pull same card again -> should link without duplicate creation
    card_id2, was_new2 = service.import_pulled_card(item_new)
    assert was_new2 is False
    assert card_id2 == card_id

    # Verify count is still 1
    status = service.get_sync_status()
    assert status["total_local"] == 1


def test_cloud_sync_api_endpoints(client, temp_db):
    with patch("app.services.cloud_sync_service.get_db_path", return_value=temp_db):
        resp = client.get("/api/cloud/sync/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_local" in data
        assert "pending_push" in data


@pytest.mark.asyncio
async def test_bidirectional_sync_flow_resilient(temp_db):
    service = CloudSyncService(db_path=temp_db)
    card_svc = CardService(card_repository=service.card_repo)
    card_svc.save_card(SaveCardRequest(expression="山", reading="やま", meaning="mountain"))

    with patch("httpx.AsyncClient.post") as mock_post, patch("httpx.AsyncClient.get") as mock_get:
        # Mock push response
        mock_post.return_value.is_success = True
        mock_post.return_value.status_code = 200
        mock_post.return_value.json = lambda: {"status": "ok", "ids": ["card_1"], "pushed": 1}

        # Mock pull response
        mock_get.return_value.is_success = True
        mock_get.return_value.status_code = 200
        mock_get.return_value.json = lambda: {
            "items": [{
                "id": "cloud_river",
                "payload": {"expression": "川", "reading": "かわ", "meaning": "river"}
            }],
            "cursor": "2026-11-19|1",
            "has_more": False
        }

        result = await service.execute_bidirectional_sync(worker_url="https://mock.worker", token="test-jwt")
        assert result["ok"] is True
        assert result["pushed"] == 1
        assert result["pulled"] == 1
        assert result["imported_new"] == 1

        # Check local DB now has both cards and 0 pending push
        status = service.get_sync_status()
        assert status["total_local"] == 2
        assert status["pending_push"] == 0


@pytest.mark.asyncio
async def test_pull_batch_skips_oversized_or_invalid_card_op(temp_db):
    service = CloudSyncService(db_path=temp_db)

    with patch("httpx.AsyncClient.get") as mock_get, patch("httpx.AsyncClient.post") as mock_post:
        mock_get.return_value.is_success = True
        mock_get.return_value.status_code = 200
        mock_get.return_value.json = lambda: {
            "items": [
                {
                    "id": "bad_op_oversized",
                    "payload": {"expression": "x" * 250, "reading": "x", "meaning": "invalid"}
                },
                {
                    "id": "good_op_valid",
                    "payload": {"expression": "海", "reading": "うみ", "meaning": "sea"}
                }
            ],
            "cursor": "2026-11-26|2",
            "has_more": False
        }
        mock_post.return_value.is_success = True
        mock_post.return_value.status_code = 200
        mock_post.return_value.json = lambda: {"status": "ok"}

        result = await service.pull_batch(worker_url="https://mock.worker", token="test-jwt")
        assert result["status"] == "ok"
        assert result["pulled"] == 2
        assert result["imported_new"] == 1


@pytest.mark.asyncio
async def test_sync_progress_pushes_jlpt_level_and_counts_only_changed_words(temp_db):
    service = CloudSyncService(db_path=temp_db)

    with patch("app.config.load_stored_llm_config", return_value={
        "learner_jlpt_level": "N3",
        "learner_updated_at": 2000,
    }), patch("httpx.AsyncClient.get") as mock_get, patch("httpx.AsyncClient.put") as mock_put, patch("httpx.AsyncClient.post") as mock_post:
        mock_get.return_value.is_success = True
        mock_get.return_value.status_code = 200
        mock_get.return_value.json = lambda: {
            "known_words": [{"word": "森", "status": "known"}],
            "kanji_practices": [],
            "preferences": {"learner_level": "N4", "updated_at": 1000},
            "grammar_progress": [],
        }
        mock_put.return_value.is_success = True
        mock_put.return_value.status_code = 200
        mock_post.return_value.is_success = True
        mock_post.return_value.status_code = 200

        res1 = await service.sync_progress(worker_url="https://mock.worker", token="test-jwt")
        assert res1["learner_level"] == "N3"
        assert res1["known_words_pulled"] == 1
        assert mock_put.called

        # Second sync with same word state should count 0 changed words
        res2 = await service.sync_progress(worker_url="https://mock.worker", token="test-jwt")
        assert res2["known_words_pulled"] == 0



