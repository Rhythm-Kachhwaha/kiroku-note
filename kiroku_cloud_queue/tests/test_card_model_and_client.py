"""
test_card_model_and_client.py -- Tests for VocabCard serialization and KirokuClient payload mapping.
"""
import pytest
from unittest.mock import AsyncMock, patch
import httpx

from queue_adapter import VocabCard
import kiroku_client as kc


def test_vocab_card_sentence_meaning_field():
    card = VocabCard(
        expression="映画",
        reading="えいが",
        meaning="movie",
        sentence="昨日、映画を見た。",
        sentence_meaning="I watched a movie yesterday.",
        deck_name="N3 vocabs",
    )
    assert card.sentence_meaning == "I watched a movie yesterday."
    d = card.to_dict()
    assert d["sentence_meaning"] == "I watched a movie yesterday."

    restored = VocabCard.from_dict(d)
    assert restored.sentence_meaning == "I watched a movie yesterday."
    assert restored.expression == "映画"
    assert restored.deck_name == "N3 vocabs"


@pytest.mark.asyncio
async def test_kiroku_client_passes_sentence_meaning_as_example_translation():
    mock_resp = httpx.Response(200, json={"id": 101, "sync_status": "pending"})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=mock_resp)) as mock_post:
        res = await kc.save_card(
            expression="映画",
            reading="えいが",
            meaning="movie",
            sentence="昨日、映画を見た。",
            sentence_meaning="I watched a movie yesterday.",
            deck_name="N3 vocabs",
        )
        assert res["id"] == 101
        mock_post.assert_called_once()
        sent_payload = mock_post.call_args[1]["json"]
        assert sent_payload["expression"] == "映画"
        assert sent_payload["example_sentence"] == "昨日、映画を見た。"
        assert sent_payload["example_translation"] == "I watched a movie yesterday."
        assert sent_payload["deck_name"] == "N3 vocabs"
