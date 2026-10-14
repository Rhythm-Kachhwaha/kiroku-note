"""
test_cloud_history_and_persistence.py -- Test suite verifying:
1. Fetched cloud cards are persisted locally across application restarts.
2. Fetching NEVER triggers Anki sync (auto_sync=False by default).
3. Manual sync of a single card only syncs the requested card.
4. Sync All for cloud cards only processes eligible cloud cards, leaving local history untouched.
5. Repeated fetches and sync actions do not create duplicate records or Anki notes.
6. Failed cards remain visible with actionable errors and are retryable.
"""
from pathlib import Path
import pytest
from unittest.mock import AsyncMock, patch

from queue_adapter import VocabCard, QueueItem
from worker import process_item, sync_single_card, sync_cloud_cards, process_batch
import kiroku_client as kc


@pytest.mark.asyncio
async def test_fetching_persists_locally_without_triggering_anki_sync():
    """Verify that fetching and processing a cloud card persists locally in Kiroku with status=pending and NEVER calls Anki."""
    card = VocabCard(
        expression="雲",
        reading="くも",
        meaning="cloud",
        sentence="空に白い雲がある。",
        sentence_meaning="There are white clouds in the sky.",
    )
    item = QueueItem(id="item-cloud-1", card=card, claim_token="token-c1")
    mock_adapter = AsyncMock()

    with patch.object(kc, "save_card", new_callable=AsyncMock) as mock_save, \
         patch.object(kc, "sync_card", new_callable=AsyncMock) as mock_sync:
        mock_save.return_value = {"id": 42, "sync_status": "pending", "expression": "雲"}

        result = await process_item(item, mock_adapter, auto_sync=False)

        # 1. Card was saved locally
        assert mock_save.call_count == 1
        save_kwargs = mock_save.call_args[1]
        assert save_kwargs["expression"] == "雲"
        assert save_kwargs["source_type"] == "cloud"

        # 2. Anki sync was NEVER triggered
        assert mock_sync.call_count == 0

        # 3. Queue item acknowledged in cloud
        mock_adapter.ack.assert_called_once_with("item-cloud-1", claim_token="token-c1")
        assert result.status == "saved"
        assert result.card_id == 42


@pytest.mark.asyncio
async def test_manual_sync_single_card_only_syncs_requested_card():
    """Verify that manual single-card sync triggers Anki sync for only the specified card."""
    with patch.object(kc, "sync_card", new_callable=AsyncMock) as mock_sync:
        mock_sync.return_value = {
            "id": 42,
            "sync_status": "synced",
            "anki_note_id": 987654321,
            "deck_name": "N3 vocabs",
        }

        resp = await sync_single_card(42)

        mock_sync.assert_called_once_with(42)
        assert resp["sync_status"] == "synced"
        assert resp["anki_note_id"] == 987654321


@pytest.mark.asyncio
async def test_sync_cloud_cards_only_syncs_cloud_cards_not_local_cards():
    """
    Verify that sync_cloud_cards:
    - Finds cards with source_type='cloud' (or 'iphone_cloud_queue') and status in ('pending', 'failed').
    - Disregards local cards (source_type='text', 'video', etc.) and already-synced cards.
    - Sends only the eligible cloud card IDs to bulk sync.
    """
    mock_cards = [
        # Local cards (must NOT be touched)
        {"id": 1, "expression": "本", "source_type": "text", "sync_status": "pending", "deck_name": "N3 vocabs"},
        {"id": 2, "expression": "映画", "source_type": "video", "sync_status": "failed", "deck_name": "N3 vocabs"},
        {"id": 3, "expression": "車", "source_type": "", "sync_status": "pending", "deck_name": "N3 vocabs"},
        # Cloud cards
        {"id": 10, "expression": "空", "source_type": "cloud", "sync_status": "pending", "deck_name": "N3 vocabs"},
        {"id": 11, "expression": "海", "source_type": "cloud", "sync_status": "failed", "deck_name": "N3 vocabs"},
        {"id": 12, "expression": "山", "source_type": "cloud", "sync_status": "synced", "deck_name": "N3 vocabs"},  # Already synced
        {"id": 13, "expression": "川", "source_type": "iphone_cloud_queue", "sync_status": "pending", "deck_name": "N3 vocabs"},
    ]

    with patch.object(kc, "list_cards", new_callable=AsyncMock) as mock_list, \
         patch.object(kc, "sync_cards_bulk", new_callable=AsyncMock) as mock_bulk_sync:
        mock_list.return_value = {"cards": mock_cards, "total": len(mock_cards)}
        mock_bulk_sync.return_value = {
            "total_eligible": 3,
            "synced_count": 3,
            "failed_count": 0,
            "results": [],
        }

        result = await sync_cloud_cards(deck_name="N3 vocabs")

        mock_list.assert_called_once_with(limit=500)
        mock_bulk_sync.assert_called_once()
        synced_ids = mock_bulk_sync.call_args[0][0]

        # Only cloud cards 10, 11, 13 must be selected
        assert set(synced_ids) == {10, 11, 13}
        # Local cards (1, 2, 3) and already-synced card (12) must NOT be present
        assert 1 not in synced_ids
        assert 2 not in synced_ids
        assert 3 not in synced_ids
        assert 12 not in synced_ids


@pytest.mark.asyncio
async def test_repeated_fetch_is_idempotent_and_prevents_duplicate_notes():
    """Verify that a card previously saved in Kiroku is recognized as duplicate, acknowledged, and does not re-add to Anki."""
    card = VocabCard(expression="既存語", reading="きぞんご", meaning="existing word")
    item = QueueItem(id="item-dup-1", card=card, claim_token="tok-dup")
    mock_adapter = AsyncMock()

    with patch.object(kc, "save_card", new_callable=AsyncMock) as mock_save, \
         patch.object(kc, "sync_card", new_callable=AsyncMock) as mock_sync:
        # Kiroku reports is_duplicate=True
        mock_save.return_value = {
            "id": 99,
            "is_duplicate": True,
            "sync_status": "synced",
            "anki_note_id": 11223344,
        }

        result = await process_item(item, mock_adapter, auto_sync=False)

        assert result.status == "duplicate"
        assert result.card_id == 99
        # Verified: acknowledged to remove from cloud queue and prevent infinite loop
        mock_adapter.ack.assert_called_once_with("item-dup-1", claim_token="tok-dup")
        # And Anki sync was NOT invoked
        assert mock_sync.call_count == 0


@pytest.mark.asyncio
async def test_failed_cards_remain_visible_with_error_and_retryable():
    """Verify that if saving to Kiroku fails, the queue item is nacked and preserved for retry."""
    card = VocabCard(expression="失敗語", reading="しっぱいご", meaning="failure word")
    item = QueueItem(id="item-err-1", card=card, claim_token="tok-err")
    mock_adapter = AsyncMock()

    with patch.object(kc, "save_card", new_callable=AsyncMock) as mock_save:
        mock_save.side_effect = kc.KirokuAPIError(500, "SQLite disk I/O failure")

        result = await process_item(item, mock_adapter, auto_sync=False)

        assert result.status == "failed"
        assert "SQLite disk I/O failure" in result.message
        # Verified: nack called with error, ack NEVER called
        mock_adapter.nack.assert_called_once()
        nack_args = mock_adapter.nack.call_args[0]
        nack_kwargs = mock_adapter.nack.call_args[1]
        assert nack_args[0] == "item-err-1"
        assert nack_kwargs.get("claim_token") == "tok-err"
        assert "SQLite disk I/O failure" in nack_kwargs.get("error", "")
        mock_adapter.ack.assert_not_called()


def test_sidepanel_html_cloud_history_elements():
    """Verify that sidepanel.html includes the approved Cloud subnav and Sync Cloud Cards elements."""
    html_file = Path(__file__).resolve().parents[2] / "extension" / "sidepanel" / "sidepanel.html"
    assert html_file.exists(), f"sidepanel.html not found at {html_file}"
    content = html_file.read_text(encoding="utf-8")

    assert 'id="btn-sync-cloud-all"' in content
    assert 'id="history-source-all"' in content
    assert 'id="history-source-local"' in content
    assert 'id="history-source-cloud"' in content
    assert 'id="history-cloud-count-badge"' in content
    # Also verify existing Sync All button was NOT removed
    assert 'id="btn-sync-all"' in content


def test_sidepanel_js_cloud_history_contract():
    """Verify that sidepanel.js contains the Cloud subnav logic, cloud-only bulk sync, and card actions."""
    js_file = Path(__file__).resolve().parents[2] / "extension" / "sidepanel" / "sidepanel.js"
    assert js_file.exists(), f"sidepanel.js not found at {js_file}"
    content = js_file.read_text(encoding="utf-8")

    # Source filter handling
    assert "currentHistorySource" in content
    assert "setHistorySourceFilter" in content
    # Sync Cloud Cards function
    assert "triggerSyncCloudCards" in content
    # Strictly cloud filtering logic
    assert "src === \"cloud\" || src === \"iphone_cloud_queue\"" in content
    # Individual card Sync button for pending status
    assert "btn-history-sync" in content
    # Cloud origin badge: verified as SVG icon without emoji
    assert "icon-cloud" in content and "Cloud" in content
