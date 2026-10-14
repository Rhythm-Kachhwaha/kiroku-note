"""
test_conditional_enrichment.py -- Test suite verifying conditional enrichment requirements:
1. Meaning supplied: zero dictionary calls.
2. Meaning missing: dictionary enrichment runs.
3. Meaning empty or whitespace-only: dictionary enrichment runs.
4. Meaning supplied with other fields missing: zero dictionary calls (follows explicit rule).
5. Enrichment fills missing supported fields without overwriting supplied values.
6. Enrichment failure is recoverable and never results in a false success (raises EnrichmentError and nacks).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from enrichment import enrich_card, EnrichmentError
from queue_adapter import VocabCard, QueueItem
from worker import process_item


@pytest.mark.asyncio
async def test_meaning_supplied_skips_dictionary_enrichment():
    """Rule 1: If meaning is supplied and non-empty, do NOT run dictionary enrichment."""
    card = VocabCard(
        expression="食べる",
        reading="たべる",
        meaning="to eat (food)",
        sentence="リンゴを食べる。",
        sentence_meaning="I eat an apple.",
    )
    mock_client = AsyncMock()
    mock_client.capture_term = AsyncMock()

    result_card, did_enrich = await enrich_card(card, mock_client)

    assert did_enrich is False
    assert mock_client.capture_term.call_count == 0
    assert result_card.meaning == "to eat (food)"
    assert result_card.expression == "食べる"


@pytest.mark.asyncio
async def test_meaning_missing_invokes_dictionary_enrichment():
    """Rule 2: If meaning is missing or empty, invoke Kiroku dictionary enrichment."""
    card = VocabCard(
        expression="猫",
        reading="",
        meaning="",
        sentence="",
    )
    mock_client = AsyncMock()
    mock_client.capture_term.return_value = {
        "expression": "猫",
        "reading": "ねこ",
        "meaning": "cat; feline",
        "example_sentence": "猫が寝ている。",
        "example_translation": "The cat is sleeping.",
        "jlpt_level": "N5",
        "tags": "jlpt-n5, animal",
    }

    result_card, did_enrich = await enrich_card(card, mock_client)

    assert did_enrich is True
    assert mock_client.capture_term.call_count == 1
    mock_client.capture_term.assert_called_once_with(text="猫", deck_name="N3 vocabs")
    assert result_card.meaning == "cat; feline"
    assert result_card.reading == "ねこ"
    assert result_card.sentence == "猫が寝ている。"
    assert result_card.sentence_meaning == "The cat is sleeping."
    assert result_card.jlpt_level == "N5"
    assert "jlpt-n5" in result_card.tags


@pytest.mark.asyncio
async def test_meaning_whitespace_only_invokes_dictionary_enrichment():
    """Rule 3: Whitespace-only meaning is treated as missing and triggers enrichment."""
    card = VocabCard(
        expression="犬",
        reading="",
        meaning="   \t\n  ",
    )
    mock_client = AsyncMock()
    mock_client.capture_term.return_value = {
        "expression": "犬",
        "reading": "いぬ",
        "meaning": "dog; canine",
        "jlpt_level": "N5",
    }

    result_card, did_enrich = await enrich_card(card, mock_client)

    assert did_enrich is True
    assert mock_client.capture_term.call_count == 1
    assert result_card.meaning == "dog; canine"
    assert result_card.reading == "いぬ"


@pytest.mark.asyncio
async def test_meaning_supplied_with_other_fields_missing_skips_enrichment():
    """Rule 4: Meaning supplied with other fields missing must NOT trigger dictionary calls."""
    card = VocabCard(
        expression="走る",
        reading="",  # missing reading
        meaning="to run",
        sentence="",  # missing sentence
        sentence_meaning="",
        hint="",
    )
    mock_client = AsyncMock()
    mock_client.capture_term = AsyncMock()

    result_card, did_enrich = await enrich_card(card, mock_client)

    assert did_enrich is False
    assert mock_client.capture_term.call_count == 0
    assert result_card.meaning == "to run"
    assert result_card.reading == ""
    assert result_card.sentence == ""


@pytest.mark.asyncio
async def test_enrichment_preserves_supplied_fields_while_filling_missing():
    """Rule 5: Enrichment fills missing supported fields without overwriting supplied values."""
    card = VocabCard(
        expression="勉強",
        reading="べんきょう",  # User supplied reading
        meaning="",  # Needs enrichment
        sentence="毎日日本語を勉強する。",  # User supplied sentence
        sentence_meaning="I study Japanese every day.",  # User supplied translation
        notes="Important for JLPT",  # User supplied note
        tags="custom_tag, my_list",  # User supplied tags
        hint="Study habit",  # User supplied hint
        jlpt_level="",  # Missing JLPT
    )
    mock_client = AsyncMock()
    mock_client.capture_term.return_value = {
        "expression": "勉強",
        "reading": "OVERWRITE_ATTEMPT",
        "meaning": "study; diligence",
        "example_sentence": "OVERWRITE_SENTENCE",
        "example_translation": "OVERWRITE_TRANSLATION",
        "notes": "OVERWRITE_NOTES",
        "hint": "OVERWRITE_HINT",
        "jlpt_level": "N5",
        "tags": "jlpt-n5, common",
        "entries": [{"id": 1}],
    }

    result_card, did_enrich = await enrich_card(card, mock_client)

    assert did_enrich is True
    # Supplied fields must be preserved exactly
    assert result_card.reading == "べんきょう"
    assert result_card.sentence == "毎日日本語を勉強する。"
    assert result_card.sentence_meaning == "I study Japanese every day."
    assert result_card.notes == "Important for JLPT"
    assert result_card.hint == "Study habit"
    # Missing fields filled
    assert result_card.meaning == "study; diligence"
    assert result_card.jlpt_level == "N5"
    # Tags merged
    assert "custom_tag" in result_card.tags
    assert "my_list" in result_card.tags
    assert "jlpt-n5" in result_card.tags
    # Extra data preserved
    assert result_card.extra_data.get("entries") == [{"id": 1}]


@pytest.mark.asyncio
async def test_enrichment_failure_raises_recoverable_error_and_never_falsely_succeeds():
    """Rule 6: Enrichment failure raises EnrichmentError and worker nacks the item."""
    # Case A: Network/service failure during capture_term
    card = VocabCard(expression="難解語", meaning="")
    mock_client = AsyncMock()
    mock_client.capture_term.side_effect = RuntimeError("Yomitan service offline")

    with pytest.raises(EnrichmentError) as exc_info:
        await enrich_card(card, mock_client)
    assert "Dictionary enrichment failed" in str(exc_info.value)

    # Case B: Yomitan returns empty meaning or dictionary error
    mock_client.capture_term.side_effect = None
    mock_client.capture_term.return_value = {
        "expression": "難解語",
        "meaning": "",
        "dictionary_error": "No dictionary definition found",
    }
    with pytest.raises(EnrichmentError) as exc_info2:
        await enrich_card(card, mock_client)
    assert "No dictionary definition found" in str(exc_info2.value)

    # Case C: Worker execution with EnrichmentError results in NACK, never ACK or false success
    mock_queue = AsyncMock()
    item = QueueItem(
        id="item-fail-1",
        card=VocabCard(expression="難解語", meaning=""),
        claim_token="claim-tok-fail",
    )

    with patch("worker.enrich_card", side_effect=EnrichmentError("No definition")):
        result = await process_item(item, mock_queue, auto_sync=False)

    assert result.status == "failed"
    assert "No definition" in result.message
    # Verified: Item is NACKed with clear error message, never ACKed
    mock_queue.nack.assert_called_once()
    pos_args = mock_queue.nack.call_args[0]
    kw_args = mock_queue.nack.call_args[1]
    assert pos_args[0] == "item-fail-1"
    assert kw_args.get("claim_token") == "claim-tok-fail"
    assert "No definition" in kw_args.get("error", "")
    mock_queue.ack.assert_not_called()
