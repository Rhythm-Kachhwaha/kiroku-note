"""
test_worker_leases_and_meaning.py -- Tests for worker lease tokens and sentence_meaning propagation.
"""
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest

from queue_adapter import LocalDevQueueAdapter, QueueItem, VocabCard
import worker
import kiroku_client as kc


@pytest.fixture()
def local_adapter(tmp_path: Path) -> LocalDevQueueAdapter:
    db_file = tmp_path / "test_worker_ext.db"
    return LocalDevQueueAdapter(db_path=db_file)


@pytest.mark.asyncio
async def test_worker_propagates_sentence_meaning_and_claim_token(local_adapter: LocalDevQueueAdapter):
    card = VocabCard(
        expression="映画",
        reading="えいが",
        meaning="movie; film",
        sentence="昨日、映画を見た。",
        sentence_meaning="I watched a movie yesterday.",
        deck_name="N3 vocabs",
    )
    item = QueueItem(
        id="item-777",
        card=card,
        status="claimed",
        claim_token="claim-token-xyz",
    )

    save_resp = {"id": 201, "is_duplicate": False, "sync_status": "synced"}
    mock_adapter = AsyncMock()

    with patch("kiroku_client.is_kiroku_alive", new=AsyncMock(return_value=True)), \
         patch("kiroku_client.save_card", new=AsyncMock(return_value=save_resp)) as mock_save, \
         patch("kiroku_client.sync_card", new=AsyncMock(return_value={"id": 201, "sync_status": "synced"})):
        result = await worker.process_item(item, mock_adapter, auto_sync=True)

    assert result.status == "synced"
    assert mock_save.call_count == 1
    call_kwargs = mock_save.call_args.kwargs
    assert call_kwargs["expression"] == "映画"
    assert call_kwargs["reading"] == "えいが"
    assert call_kwargs["meaning"] == "movie; film"
    assert call_kwargs["sentence"] == "昨日、映画を見た。"
    assert call_kwargs["sentence_meaning"] == "I watched a movie yesterday."
    assert call_kwargs["deck_name"] == "N3 vocabs"
    assert call_kwargs["source_type"] == "cloud"
    mock_adapter.ack.assert_called_once_with("item-777", claim_token="claim-token-xyz")
