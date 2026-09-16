"""Unit and integration tests for Yomitan kanji dictionary normalization and enrichment."""
import pytest
from app.services.yomitan import (
    KanjiEntry,
    YomitanService,
    IdentifiedTerm,
    EnrichedTerm,
    FrequencyRank,
)


def test_normalize_kanji_entries_response_kanjidic_structure():
    payload = [
        {
            "type": "kanji",
            "character": "合",
            "dictionary": "KANJIDIC [2026-253]",
            "dictionaryIndex": 1,
            "dictionaryAlias": "KANJIDIC",
            "onyomi": ["ゴウ", "ガッ", "カッ"],
            "kunyomi": [
                "あ.う",
                "-あ.う",
                "あ.い",
                "あい-",
                "-あ.い",
                "-あい",
                "あ.わす",
                "あ.わせる",
                "-あ.わせる",
            ],
            "tags": [
                {
                    "name": "jouyou",
                    "category": "frequent",
                    "content": ["included in list of regular-use characters"],
                }
            ],
            "stats": {
                "misc": [
                    {"name": "freq", "value": "41"},
                    {"name": "grade", "value": "2"},
                    {"name": "jlpt", "value": "3"},
                    {"name": "strokes", "value": "6"},
                ]
            },
            "definitions": ["fit", "suit", "join", "0.1"],
            "frequencies": [
                {
                    "dictionary": "Innocent Corpus",
                    "frequency": 41,
                    "displayValue": "41",
                    "rank": 41,
                    "isCommon": True,
                }
            ],
        }
    ]

    entries = YomitanService.normalize_kanji_entries_response(payload)
    assert len(entries) == 1
    k = entries[0]
    assert k.character == "合"
    assert k.dictionary == "KANJIDIC [2026-253]"
    assert k.onyomi == ["ゴウ", "ガッ", "カッ"]
    assert k.kunyomi == [
        "あ.う",
        "-あ.う",
        "あ.い",
        "あい-",
        "-あ.い",
        "-あい",
        "あ.わす",
        "あ.わせる",
        "-あ.わせる",
    ]
    assert k.meanings == ["fit", "suit", "join", "0.1"]
    assert k.tags == ["jouyou"]
    assert k.stats.get("strokes") == "6"
    assert k.stats.get("grade") == "2"
    assert k.stats.get("jlpt") == "3"
    assert k.stats.get("freq") == "41"
    assert len(k.frequencies) == 1
    assert k.frequencies[0].rank == 41


def test_normalize_kanji_entries_response_multiple_dictionaries():
    payload = [
        {
            "type": "kanji",
            "character": "食",
            "dictionary": "KANJIDIC",
            "onyomi": ["ショク", "ジキ"],
            "kunyomi": ["く.う", "く.らう", "た.べる", "は.む"],
            "definitions": ["eat", "food"],
            "stats": {"misc": [{"name": "strokes", "value": "9"}]},
        },
        {
            "type": "kanji",
            "character": "食",
            "dictionary": "JPDB Kanji",
            "onyomi": ["ショク"],
            "kunyomi": ["た.べる"],
            "definitions": ["eat"],
            "stats": {"misc": [{"name": "strokes", "value": "9"}]},
        },
    ]

    entries = YomitanService.normalize_kanji_entries_response(payload)
    assert len(entries) == 2
    assert entries[0].dictionary == "KANJIDIC"
    assert entries[0].onyomi == ["ショク", "ジキ"]
    assert entries[1].dictionary == "JPDB Kanji"
    assert entries[1].onyomi == ["ショク"]


def test_normalize_kanji_entries_response_graceful_missing_fields():
    payload = [
        {
            "character": "猫",
            # missing dictionary, onyomi, kunyomi, definitions
        },
        "invalid-item",
        {},
    ]
    entries = YomitanService.normalize_kanji_entries_response(payload)
    assert len(entries) == 1
    assert entries[0].character == "猫"
    assert entries[0].dictionary == "Unknown dictionary"
    assert entries[0].onyomi == []
    assert entries[0].kunyomi == []
    assert entries[0].meanings == []


def test_yomitan_service_enrich_includes_kanji(monkeypatch):
    service = YomitanService()

    def mock_post_json(path, payload):
        if path == "/termEntries":
            return {
                "dictionaryEntries": [
                    {
                        "type": "term",
                        "isPrimary": True,
                        "score": 100,
                        "headwords": [{"term": "合", "reading": "ごう"}],
                        "definitions": [
                            {
                                "dictionary": "Jitendex.org",
                                "entries": [
                                    {
                                        "type": "structured-content",
                                        "content": {
                                            "tag": "ul",
                                            "data": {"content": "glossary"},
                                            "content": [
                                                {"tag": "li", "content": "unit of volume"}
                                            ],
                                        },
                                    }
                                ],
                            }
                        ],
                    }
                ]
            }
        elif path == "/kanjiEntries":
            return [
                {
                    "character": "合",
                    "dictionary": "KANJIDIC",
                    "onyomi": ["ゴウ", "ガッ", "カッ"],
                    "kunyomi": ["あ.う", "あ.わせる"],
                    "definitions": ["fit", "suit", "join"],
                    "stats": {"misc": [{"name": "strokes", "value": "6"}]},
                }
            ]
        raise ValueError(f"Unexpected path {path}")

    monkeypatch.setattr(service, "_post_json", mock_post_json)

    term = IdentifiedTerm(expression="合", reading="ごう", source_text="合", deinflected_text="合")
    enriched = service.enrich(term)

    assert len(enriched.entries) == 1
    assert len(enriched.kanji_entries) == 1
    assert enriched.kanji_entries[0].character == "合"
    assert enriched.kanji_entries[0].onyomi == ["ゴウ", "ガッ", "カッ"]
    assert enriched.kanji_entries[0].kunyomi == ["あ.う", "あ.わせる"]
    assert enriched.kanji_entries[0].meanings == ["fit", "suit", "join"]


def test_yomitan_service_enrich_gracefully_handles_kanji_failure(monkeypatch):
    service = YomitanService()

    def mock_post_json(path, payload):
        if path == "/termEntries":
            return {
                "dictionaryEntries": [
                    {
                        "type": "term",
                        "isPrimary": True,
                        "headwords": [{"term": "食べる", "reading": "たべる"}],
                        "definitions": [
                            {
                                "dictionary": "Jitendex.org",
                                "entries": ["to eat"],
                            }
                        ],
                    }
                ]
            }
        elif path == "/kanjiEntries":
            from app.services.yomitan import YomitanUnavailableError
            raise YomitanUnavailableError("Kanji endpoint failed")
        raise ValueError(f"Unexpected path {path}")

    monkeypatch.setattr(service, "_post_json", mock_post_json)

    term = IdentifiedTerm(expression="食べる", reading="たべる", source_text="食べる", deinflected_text="食べる")
    enriched = service.enrich(term)

    # Term enrichment succeeds despite kanji failure
    assert len(enriched.entries) == 1
    assert enriched.kanji_entries == []
    assert enriched.dictionary_error is None
