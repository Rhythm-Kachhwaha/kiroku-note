"""
enrichment.py -- Conditional dictionary enrichment for Kiroku Cloud Queue cards.

Rule:
  - If the submitted card contains a valid, non-empty `meaning`, do NOT run dictionary enrichment.
    The LLM has already supplied the meaning; preserve it and avoid unnecessary Yomitan calls.
  - If `meaning` is missing, empty, or whitespace-only, invoke Kiroku's existing enrichment pipeline
    (via Yomitan / POST /api/capture) to complete the card.
  - Populate missing fields (reading, glossary, JLPT, tags, etc.) without overwriting valid values
    already supplied.
  - If enrichment fails or cannot obtain a usable meaning, raise EnrichmentError so the card is
    never silently saved in an incomplete state or falsely marked completed.
"""
from __future__ import annotations

import logging
from typing import Any

from queue_adapter import VocabCard

log = logging.getLogger("kiroku_cloud_enrichment")


class EnrichmentError(Exception):
    """Raised when dictionary enrichment fails or yields no usable meaning."""


async def enrich_card(
    card: VocabCard,
    client: Any,
) -> tuple[VocabCard, bool]:
    """
    Conditionally enrich a VocabCard using Kiroku's Yomitan enrichment pipeline.

    Returns:
        tuple[VocabCard, bool]: (resulting_card, did_enrich)
    """
    meaning_text = (card.meaning or "").strip()

    # Rule 1: If meaning is supplied and non-empty, do NOT run dictionary enrichment.
    # Base decision purely on the card's fields; do not automatically call Yomitan for missing reading/sentence.
    if meaning_text:
        log.debug("Card '%s' has meaning supplied ('%s'); skipping dictionary enrichment.", card.expression, meaning_text)
        return card, False

    # Rule 2: Meaning is missing, empty, or whitespace-only -> run dictionary enrichment.
    expr = (card.expression or "").strip()
    if not expr:
        raise EnrichmentError("Cannot enrich card with empty expression.")

    log.info("Card '%s' missing meaning; invoking Kiroku dictionary enrichment pipeline.", expr)

    try:
        if hasattr(client, "capture_term"):
            capture_resp = await client.capture_term(text=expr, deck_name=card.deck_name)
        else:
            raise EnrichmentError("Kiroku client does not support capture_term.")
    except EnrichmentError:
        raise
    except Exception as exc:
        log.error("Kiroku enrichment failed for '%s': %s", expr, exc)
        raise EnrichmentError(f"Dictionary enrichment failed for '{expr}': {exc}") from exc

    if not isinstance(capture_resp, dict):
        raise EnrichmentError(f"Unexpected response type from Kiroku capture: {type(capture_resp)}")

    dict_error = capture_resp.get("dictionary_error")
    enriched_meaning = (capture_resp.get("meaning") or "").strip()

    # If enrichment cannot obtain a usable meaning, fail safely
    if not enriched_meaning:
        err_msg = dict_error or f"No usable meaning found in dictionary for '{expr}'."
        log.warning("Enrichment incomplete for '%s': %s", expr, err_msg)
        raise EnrichmentError(err_msg)

    # Populate missing supported fields WITHOUT overwriting supplied values
    new_reading = card.reading.strip() if card.reading.strip() else (capture_resp.get("reading") or "").strip()
    new_sentence = card.sentence.strip() if card.sentence.strip() else (capture_resp.get("example_sentence") or "").strip()
    new_sentence_meaning = (
        card.sentence_meaning.strip()
        if card.sentence_meaning.strip()
        else (capture_resp.get("example_translation") or "").strip()
    )
    new_hint = card.hint.strip() if card.hint.strip() else (capture_resp.get("hint") or "").strip()
    new_notes = card.notes.strip() if card.notes.strip() else (capture_resp.get("notes") or "").strip()
    new_jlpt = card.jlpt_level.strip() if card.jlpt_level.strip() else (capture_resp.get("jlpt_level") or "").strip()

    # Preserve tags or append enriched tags
    supplied_tags = [t.strip() for t in card.tags.split(",") if t.strip()] if card.tags else []
    enriched_tags_raw = capture_resp.get("tags") or ""
    enriched_tags = [t.strip() for t in str(enriched_tags_raw).split(",") if t.strip()]
    merged_tags = list(dict.fromkeys(supplied_tags + enriched_tags))

    # Preserve extra data and retain dictionary entries/kanji entries if available
    extra_data = dict(card.extra_data)
    if "entries" not in extra_data and capture_resp.get("entries"):
        extra_data["entries"] = capture_resp["entries"]
    if "kanji_entries" not in extra_data and capture_resp.get("kanji_entries"):
        extra_data["kanji_entries"] = capture_resp["kanji_entries"]
    if "verb_metadata" not in extra_data and capture_resp.get("verb_metadata"):
        extra_data["verb_metadata"] = capture_resp["verb_metadata"]

    enriched_card = VocabCard(
        expression=expr,
        reading=new_reading,
        meaning=enriched_meaning,
        sentence=new_sentence,
        sentence_meaning=new_sentence_meaning,
        notes=new_notes,
        hint=new_hint,
        context=card.context,
        jlpt_level=new_jlpt,
        tags=", ".join(merged_tags),
        deck_name=card.deck_name,
        model_name=card.model_name,
        extra_data=extra_data,
    )

    log.info(
        "Successfully enriched card '%s': meaning='%s', reading='%s', jlpt='%s'",
        expr, enriched_meaning, new_reading, new_jlpt
    )
    return enriched_card, True
