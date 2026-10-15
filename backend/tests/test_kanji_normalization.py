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


def test_yomitan_service_lookup_kanji_direct(monkeypatch):
    service = YomitanService()

    def mock_post_json(path, payload):
        assert path == "/kanjiEntries"
        assert payload["character"] == "約束"
        return [
            {
                "type": "kanji",
                "character": "約",
                "dictionary": "KANJIDIC",
                "onyomi": ["ヤク"],
                "kunyomi": ["つづ.まる"],
                "definitions": ["promise", "approximate"],
                "stats": {"misc": [{"name": "jlpt", "value": "3"}]},
            },
            {
                "type": "kanji",
                "character": "束",
                "dictionary": "KANJIDIC",
                "onyomi": ["ソク"],
                "kunyomi": ["たば"],
                "definitions": ["bundle", "sheaf"],
                "stats": {"misc": [{"name": "jlpt", "value": "3"}]},
            },
        ]

    monkeypatch.setattr(service, "_post_json", mock_post_json)
    entries = service.lookup_kanji("約束")
    assert len(entries) == 2
    assert entries[0].character == "約"
    assert entries[0].onyomi == ["ヤク"]
    assert entries[0].meanings == ["promise", "approximate"]
    assert entries[0].stats.get("jlpt") == "N3"
    assert entries[1].character == "束"
    assert entries[1].onyomi == ["ソク"]


def test_yomitan_service_lookup_kanji_offline_fallback(monkeypatch):
    service = YomitanService()

    def mock_post_json(path, payload):
        from app.services.yomitan import YomitanUnavailableError
        raise YomitanUnavailableError("Yomitan offline")

    monkeypatch.setattr(service, "_post_json", mock_post_json)
    # Even if Yomitan is offline, fallback extracts kanji characters and queries JLPT db
    entries = service.lookup_kanji("約束")
    assert len(entries) == 2
    chars = [e.character for e in entries]
    assert "約" in chars
    assert "束" in chars
    for e in entries:
        assert e.dictionary == "JLPT Reference"
        assert e.stats.get("jlpt") == "N3"


def test_card_repository_update_kanji_entries(tmp_path):
    from app.repositories.card_repository import CardRepository, CardDraft

    db_path = tmp_path / "test_kiroku.db"
    repo = CardRepository(db_path=db_path)
    draft = CardDraft(
        expression="約束",
        reading="やくそく",
        meaning="promise",
        source_type="cloud",
    )
    saved, _, _, _ = repo.save_or_update(draft)
    assert saved.id is not None
    assert saved.kanji_entries == []

    # Update kanji entries
    repo.update_kanji_entries(
        saved.id,
        [
            {
                "character": "約",
                "dictionary": "KANJIDIC",
                "onyomi": ["ヤク"],
                "meanings": ["promise"],
            }
        ],
    )

    reloaded = repo.get_by_id(saved.id)
    assert reloaded is not None
    assert len(reloaded.kanji_entries) == 1
    assert reloaded.kanji_entries[0]["character"] == "約"
    assert reloaded.meaning == "promise"  # Meaning untouched!

