"""
yomitan_payload.py -- Adapter converting kiroku_dictionary results into Yomitan API payload shapes.

Feeds normalize_term_entries_response and normalize_kanji_entries_response without modification.
"""
from __future__ import annotations

from typing import Any

from .lookup import KanjiResult, TermHeadwordGroup


def format_term_entries_payload(
    grouped_terms: list[TermHeadwordGroup],
) -> dict[str, Any]:
    """
    Format grouped term lookup results into the dictionaryEntries dictionary
    consumed by YomitanService.normalize_term_entries_response.
    """
    dictionary_entries: list[dict[str, Any]] = []

    for idx, group in enumerate(grouped_terms):
        is_primary_group = (idx == 0)

        definitions_list: list[dict[str, Any]] = []
        for d in group.definitions:
            tags = [{"name": t} for t in d.def_tags + d.term_tags]
            definitions_list.append(
                {
                    "dictionary": d.dictionary,
                    "dictionaryAlias": None,
                    "isPrimary": is_primary_group,
                    "score": int(d.score),
                    "headwordIndices": [0],
                    "tags": tags,
                    "entries": d.glossary,  # Verbatim structured content list
                    "pitches": [],
                    "frequencies": [],
                }
            )

        dictionary_entries.append(
            {
                "type": "term",
                "isPrimary": is_primary_group,
                "score": int(group.score),
                "headwords": [{"term": group.term, "reading": group.reading}],
                "definitions": definitions_list,
                "pitches": [],
                "pronunciations": [],
                "frequencies": [],
            }
        )

    return {"dictionaryEntries": dictionary_entries}


def format_kanji_entries_payload(
    kanji_results: list[KanjiResult],
) -> list[dict[str, Any]]:
    """
    Format kanji lookup results into the list of kanji dictionaries
    consumed by YomitanService.normalize_kanji_entries_response.
    """
    payload: list[dict[str, Any]] = []

    for k in kanji_results:
        # Convert stats dict into {category: [{"name": k, "value": v}]} format
        stats_items = [{"name": key, "value": str(val)} for key, val in k.stats.items()]
        stats_payload = {"kanji": stats_items}

        tags_payload = [{"name": t} for t in k.tags]

        payload.append(
            {
                "character": k.character,
                "dictionary": k.dictionary,
                "dictionaryAlias": None,
                "onyomi": k.onyomi,
                "kunyomi": k.kunyomi,
                "nanori": k.nanori,
                "definitions": k.meanings,
                "tags": tags_payload,
                "stats": stats_payload,
                "frequencies": [],
            }
        )

    return payload
