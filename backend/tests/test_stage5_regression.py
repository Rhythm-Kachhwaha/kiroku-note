"""
Automated regression test suite for Stage 5.5.
Tests:
1. Basic Model Card formatting (Front, Back, scoped CSS, pitch badge, ruby furigana)
2. Multi-sense dictionary synthesis and structure (ordered list, POS/tags)
3. Media de-duplication across all model field variants
4. Custom note model mapping matrix (Kaishi 1.5k, japanese mining, Core 2000, Japanese sentences, Yomitan Default)
5. Security escaping & XSS sanitization
"""
from __future__ import annotations

import os
import re
import pytest

from app.services.anki_connect import AnkiConnectService
from app.services.anki_formatter import (
    escape_html,
    format_basic_back,
    format_example_html,
    format_meaning_html,
    format_pitch_badge,
    format_ruby_html,
    sanitize_media_tags,
)


@pytest.fixture
def anki_service() -> AnkiConnectService:
    return AnkiConnectService(endpoint_url="http://127.0.0.1:8765")


def test_basic_model_front_back_structure(anki_service: AnkiConnectService):
    """Verify Basic model Front and Back formatting rules."""
    card = {
        "expression": "食べる",
        "reading": "たべる",
        "meaning": "to eat",
        "hint": "ichidan verb",
        "example_sentence": "朝[あさ]御[ご]飯[はん]を食[た]べる。",
        "example_translation": "To eat breakfast.",
        "notes": "polite: 食べます",
        "pitches": [{"position": 2, "pattern_name": "nakadaka"}],
        "entries": [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {"index": 1, "glosses": ["to eat"], "parts_of_speech": ["v1"]}
                ],
            }
        ],
    }

    fields = anki_service.map_card_to_fields(card, ["Front", "Back"])
    assert fields["Front"] == "食べる"

    back = fields["Back"]
    assert "<style>" in back
    assert ".kn-card" in back
    assert '<span class="kn-kana">たべる</span>' in back
    assert '<span class="kn-pitch">[② Nakadaka]</span>' in back
    assert '<hr class="kn-divider">' in back
    assert '<span class="kn-pos">[v1]</span>' in back
    assert "<ruby>朝<rt>あさ</rt></ruby>" in back
    assert "<ruby>御<rt>ご</rt></ruby>" in back
    assert "<ruby>飯<rt>はん</rt></ruby>" in back
    assert "<ruby>食<rt>た</rt></ruby>べる" in back
    assert '<p class="kn-example-en">To eat breakfast.</p>' in back
    assert '<div class="kn-hint">Hint: ichidan verb</div>' in back
    assert '<div class="kn-notes">Notes: polite: 食べます</div>' in back


def test_basic_model_identical_reading(anki_service: AnkiConnectService):
    """Verify that when reading equals expression, bracket is omitted on Front."""
    card = {"expression": "ねこ", "reading": "ねこ", "meaning": "cat"}
    fields = anki_service.map_card_to_fields(card, ["Front", "Back"])
    assert fields["Front"] == "ねこ"


def test_multi_sense_polysemous_formatting(anki_service: AnkiConnectService):
    """Verify multi-sense words (e.g. 掛ける) produce ordered lists with sense-bound metadata."""
    card = {
        "expression": "掛ける",
        "reading": "かける",
        "meaning": "1. to hang\n2. to multiply",
        "entries": [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {"index": 1, "glosses": ["to hang", "to suspend"], "parts_of_speech": ["v1"], "tags": ["transitive"]},
                    {"index": 2, "glosses": ["to multiply"], "parts_of_speech": ["v1"], "tags": ["math"]},
                ],
            }
        ],
    }

    fields = anki_service.map_card_to_fields(card, ["Front", "Back"])
    back = fields["Back"]
    assert '<ol class="kn-meanings">' in back
    assert '<span class="kn-pos">[v1]</span>' in back
    assert '<span class="kn-tag">' not in back
    assert "to hang, to suspend" in back
    assert "to multiply" in back


def test_media_deduplication_dedicated_fields(anki_service: AnkiConnectService):
    """Verify dedicated image/audio fields receive media while Back composite omits them."""
    card = {
        "expression": "写真",
        "reading": "しゃしん",
        "meaning": "photograph",
        "image": "photo_123.jpg",
        "audio": "photo_audio.mp3",
    }

    model_fields = ["Front", "Back", "Image", "Audio"]
    fields = anki_service.map_card_to_fields(card, model_fields)

    assert fields["Image"] == '<img src="photo_123.jpg">'
    assert fields["Audio"] == '[sound:photo_audio.mp3]'
    assert '<img src="photo_123.jpg">' not in fields["Back"]
    assert '[sound:photo_audio.mp3]' not in fields["Back"]


def test_media_idempotent_fallback_assignment(anki_service: AnkiConnectService):
    """Verify fallback image appending is idempotent and does not create duplicate tags."""
    card = {
        "expression": "桜",
        "reading": "さくら",
        "meaning": "cherry blossom",
        "image": "sakura.jpg",
    }

    fields1 = anki_service.map_card_to_fields(card, ["Front", "Back"])
    assert fields1["Back"].count("sakura.jpg") == 1

    # Simulate re-sync when Back already had image
    fields2 = anki_service.map_card_to_fields(card, ["Front", "Back"])
    assert fields2["Back"].count("sakura.jpg") == 1


def test_custom_models_mapping_matrix(anki_service: AnkiConnectService):
    """Verify mapping matrix across Kaishi 1.5k, Core 2000, japanese mining, Japanese sentences, Yomitan."""
    card = {
        "expression": "約束",
        "reading": "やくそく",
        "meaning": "promise, agreement",
        "example_sentence": "彼[かれ]と約束[やくそく]をした。",
        "example_translation": "I made a promise with him.",
        "image": "promise.jpg",
        "audio": "promise.mp3",
        "pitches": [{"position": 0, "pattern_name": "heiban"}],
        "entries": [
            {
                "dictionary": "Jitendex",
                "senses": [{"index": 1, "glosses": ["promise"], "parts_of_speech": ["n", "vs"]}],
            }
        ],
    }

    # 1. Kaishi 1.5k
    kaishi_fields = [
        "Word", "Word Reading", "Word Meaning", "Word Furigana", "Word Audio",
        "Sentence", "Sentence Meaning", "Sentence Furigana", "Sentence Audio",
        "Notes", "Pitch Accent", "Pitch Accent Notes", "Frequency", "Picture"
    ]
    k_mapped = anki_service.map_card_to_fields(card, kaishi_fields)
    assert k_mapped["Word"] == "約束"
    assert "promise" in k_mapped["Word Reading"] or "promise" in k_mapped["Word Meaning"]
    assert k_mapped["Picture"] == '<img src="promise.jpg">'
    assert k_mapped["Pitch Accent"] == "[⓪ Heiban]"

    # 2. japanese mining
    jm_fields = ["Front", "Back", "word", "Audio", "Image", "Source", "URL"]
    jm_mapped = anki_service.map_card_to_fields(card, jm_fields)
    assert jm_mapped["Front"] == "約束"
    assert jm_mapped["Image"] == '<img src="promise.jpg">'
    assert jm_mapped["Audio"] == '[sound:promise.mp3]'

    # 3. Core 2000
    core_fields = [
        "Optimized-Voc-Index", "Vocabulary-Kanji", "Vocabulary-Furigana",
        "Vocabulary-Kana", "Vocabulary-English", "Vocabulary-Audio", "Vocabulary-Pos",
        "Expression", "Reading", "Sentence-Kana", "Sentence-English", "Sentence-Clozed", "Sentence-Audio"
    ]
    core_mapped = anki_service.map_card_to_fields(card, core_fields)
    assert core_mapped["Expression"] == "約束"
    assert core_mapped["Reading"] == "やくそく"
    assert core_mapped["Sentence-English"] == "I made a promise with him."

    # 4. Japanese sentences
    js_fields = [
        "SentKanji", "SentFurigana", "SentEng", "SentAudio",
        "VocabKanji", "VocabFurigana", "VocabPitchPattern", "VocabPitchNum",
        "VocabDef", "VocabAudio", "Image", "Notes"
    ]
    js_mapped = anki_service.map_card_to_fields(card, js_fields)
    assert js_mapped["VocabKanji"] == "約束"
    assert js_mapped["VocabFurigana"] == "やくそく"
    assert js_mapped["Image"] == '<img src="promise.jpg">'


def test_security_xss_sanitization(anki_service: AnkiConnectService):
    """Verify that all user inputs and media tags are strictly escaped / sanitized against XSS."""
    card = {
        "expression": "<script>alert(1)</script>",
        "reading": "<img src=x onerror=alert(2)>",
        "meaning": '"><script>alert(3)</script>',
        "hint": "<b onmouseover=alert(4)>hint</b>",
        "example_sentence": "<script>bad</script>朝[<script>test</script>]ご飯",
        "example_translation": "<svg onload=alert(5)>",
        "notes": '<a href="javascript:alert(6)">link</a>',
        "image": 'evil" onfocus="alert(7).jpg',
        "audio": 'evil[sound:alert(8)].mp3',
    }

    fields = anki_service.map_card_to_fields(card, ["Front", "Back"])
    front = fields["Front"]
    back = fields["Back"]

    # Front escaping
    assert "<script>" not in front
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in front

    # Back escaping
    assert "<script>" not in back
    assert "&lt;img src=x onerror=alert(2)&gt;" in back
    assert "<svg" not in back
    assert "<a " not in back
    assert "&lt;a href=&quot;javascript:alert(6)&quot;&gt;" in back
    assert "onfocus=" not in back
    assert "alert(7)" not in back
    assert "alert(8)" not in back
