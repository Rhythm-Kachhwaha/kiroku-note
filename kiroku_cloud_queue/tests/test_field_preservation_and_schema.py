"""
test_field_preservation_and_schema.py -- Test suite verifying:
1. All supported existing Kiroku fields survive cloud queue submission, storage, and retrieval.
2. Japanese text and Unicode characters are preserved verbatim.
3. Unsupported / extra fields follow the documented schema policy (stored in extra_data).
4. Image and audio media functionality is strictly excluded from the cloud pipeline.
"""
import json
import pytest
from fastapi.testclient import TestClient

from server import app
from queue_adapter import VocabCard, LocalDevQueueAdapter
from queue_store import SqliteQueueStore


import server

SUBMIT_TOKEN = "test-submit-token-xyz"

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SUBMIT_TOKEN", SUBMIT_TOKEN)
    test_db = tmp_path / "test_schema_queue.db"
    store = SqliteQueueStore(db_path=str(test_db))
    server.store = store
    return TestClient(server.app)


def test_vocab_card_all_fields_roundtrip():
    """Verify VocabCard serializes and deserializes all supported textual and metadata fields."""
    card = VocabCard(
        expression="一期一会",
        reading="いちごいちえ",
        meaning="once-in-a-lifetime encounter",
        sentence="人生は一期一会だ。",
        sentence_meaning="Life is a once-in-a-lifetime encounter.",
        notes="Yojijukugo proverb from tea ceremony.",
        hint="Tea ceremony proverb",
        context="Read in a traditional Japanese novel",
        jlpt_level="N1",
        tags="proverb, yojijukugo, jlpt-n1",
        deck_name="Advanced Vocab",
        model_name="Japanese Mining Model",
        extra_data={"custom_meta": 42, "unrecognized_source": "shortcut_v3"},
    )

    data = card.to_dict()
    restored = VocabCard.from_dict(data)

    assert restored.expression == "一期一会"
    assert restored.reading == "いちごいちえ"
    assert restored.meaning == "once-in-a-lifetime encounter"
    assert restored.sentence == "人生は一期一会だ。"
    assert restored.sentence_meaning == "Life is a once-in-a-lifetime encounter."
    assert restored.notes == "Yojijukugo proverb from tea ceremony."
    assert restored.hint == "Tea ceremony proverb"
    assert restored.context == "Read in a traditional Japanese novel"
    assert restored.jlpt_level == "N1"
    assert restored.tags == "proverb, yojijukugo, jlpt-n1"
    assert restored.deck_name == "Advanced Vocab"
    assert restored.model_name == "Japanese Mining Model"
    assert restored.extra_data.get("custom_meta") == 42
    assert restored.extra_data.get("unrecognized_source") == "shortcut_v3"


def test_japanese_unicode_preservation():
    """Verify Japanese characters, full-width punctuation, and kanji are preserved without corruption."""
    complex_text = "珈琲☕と抹茶🍵（美味しい！〜「テスト」）𠮷野家"
    card = VocabCard(
        expression=complex_text,
        reading="コーヒーとまっちゃ",
        meaning="Coffee and matcha (delicious! ~ 'test') Yoshinoya",
        sentence="ここで珈琲☕を注文した。",
        sentence_meaning="I ordered coffee here.",
    )

    d = card.to_dict()
    json_str = json.dumps(d, ensure_ascii=False)
    loaded = json.loads(json_str)
    restored = VocabCard.from_dict(loaded)

    assert restored.expression == complex_text
    assert "☕" in restored.expression
    assert "🍵" in restored.expression
    assert "〜" in restored.expression


def test_media_fields_strictly_excluded():
    """Verify image and audio fields are stripped from cloud cards."""
    incoming_data = {
        "expression": "写真",
        "reading": "しゃしん",
        "meaning": "photograph",
        "image": "https://example.com/photo.jpg",
        "audio": "https://example.com/audio.mp3",
        "image_data": "base64data...",
        "audio_data": "base64audiodata...",
    }

    card = VocabCard.from_dict(incoming_data)
    # VocabCard does not even define image or audio fields
    assert not hasattr(card, "image")
    assert not hasattr(card, "audio")
    # And they are excluded from extra_data as well
    assert "image" not in card.extra_data
    assert "audio" not in card.extra_data
    assert "image_data" not in card.extra_data
    assert "audio_data" not in card.extra_data


def test_unknown_fields_policy():
    """Documented policy: unknown fields from LLMs or Shortcuts are preserved in extra_data."""
    incoming = {
        "expression": "青空",
        "reading": "あおぞら",
        "meaning": "blue sky",
        "unknown_llm_flag": True,
        "temperature_used": 0.7,
        "provider": "ChatGPT-4o",
    }

    card = VocabCard.from_dict(incoming)
    assert card.expression == "青空"
    assert card.extra_data.get("unknown_llm_flag") is True
    assert card.extra_data.get("temperature_used") == 0.7
    assert card.extra_data.get("provider") == "ChatGPT-4o"


def test_queue_store_lossless_persistence(tmp_path):
    """Verify queue database preserves all fields and extra_data across claim and fetch."""
    db_file = tmp_path / "test_store.db"
    store = SqliteQueueStore(db_path=str(db_file))
    store.init_schema()

    card = VocabCard(
        expression="狐",
        reading="きつね",
        meaning="fox",
        sentence="狐が走る。",
        sentence_meaning="The fox runs.",
        notes="Folklore animal",
        hint="Animal",
        context="Manga chapter 12",
        jlpt_level="N2",
        tags="animals, nature",
        deck_name="Custom Deck",
        model_name="Custom Model",
        extra_data={"story_arc": "Kyoto Arc"},
    )

    item_id, is_dup = store.enqueue(card)
    assert item_id is not None
    assert is_dup is False

    claimed = store.claim_pending(limit=10, lease_seconds=60)
    assert len(claimed) == 1
    item = claimed[0]

    assert item.card.expression == "狐"
    assert item.card.reading == "きつね"
    assert item.card.meaning == "fox"
    assert item.card.sentence == "狐が走る。"
    assert item.card.sentence_meaning == "The fox runs."
    assert item.card.notes == "Folklore animal"
    assert item.card.hint == "Animal"
    assert item.card.context == "Manga chapter 12"
    assert item.card.jlpt_level == "N2"
    assert item.card.tags == "animals, nature"
    assert item.card.deck_name == "Custom Deck"
    assert item.card.model_name == "Custom Model"
    assert item.card.extra_data.get("story_arc") == "Kyoto Arc"


def test_api_submit_accepts_all_supported_fields(client):
    """Verify POST /submit endpoint parses all supported fields and preserves them."""
    payload = {
        "expression": "桜",
        "reading": "さくら",
        "meaning": "cherry blossom",
        "sentence": "桜が咲いた。",
        "sentence_meaning": "The cherry blossoms bloomed.",
        "notes": "Spring motif",
        "hint": "Flower",
        "context": "Hanami party",
        "jlpt_level": "N4",
        "tags": "nature, flora",
        "deck_name": "N3 vocabs",
        "model_name": "Kaishi",
        "llm_confidence": 0.99,
    }

    res = client.post("/submit", json=payload, headers={"Authorization": f"Bearer {SUBMIT_TOKEN}"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ("queued", "duplicate")
    assert "id" in data
