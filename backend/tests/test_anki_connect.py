"""Unit tests for AnkiConnectService."""
import json
from unittest.mock import MagicMock, patch
import urllib.error

import pytest

from app.services.anki_connect import (
    AnkiActionError,
    AnkiConnectionError,
    AnkiConnectService,
    AnkiError,
    AnkiResponseError,
    AnkiTimeoutError,
)
from app.services.yomitan import PitchAccent


def _make_mock_response(status=200, json_data=None, raw_bytes=None):
    mock = MagicMock()
    mock.status = status
    if raw_bytes is not None:
        mock.read.return_value = raw_bytes
    elif json_data is not None:
        mock.read.return_value = json.dumps(json_data).encode("utf-8")
    else:
        mock.read.return_value = b'{"result": null, "error": null}'
    return mock


class TestAnkiConnectService:
    def test_version_request_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": 6, "error": None})
            version = service.get_version()
            assert version == 6

    def test_list_decks_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": ["Default", "Japanese::Mining"], "error": None})
            decks = service.list_decks()
            assert decks == ["Default", "Japanese::Mining"]

    def test_create_deck_success(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": 123456789, "error": None})
            service.create_deck("Japanese")
            assert mock_open.called

    def test_connection_refused_raises_anki_connection_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("[WinError 10061] No connection could be made")):
            with pytest.raises(AnkiConnectionError) as exc_info:
                service.get_version()
            assert "Cannot connect to AnkiConnect" in str(exc_info.value)

    def test_timeout_raises_anki_timeout_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen", side_effect=TimeoutError("The read operation timed out")):
            with pytest.raises(AnkiTimeoutError) as exc_info:
                service.get_version()
            assert "timed out" in str(exc_info.value)

    def test_malformed_json_raises_anki_response_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(raw_bytes=b"invalid json")
            with pytest.raises(AnkiResponseError) as exc_info:
                service.get_version()
            assert "Malformed JSON" in str(exc_info.value)

    def test_anki_error_response_raises_anki_action_error(self):
        service = AnkiConnectService()
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value = _make_mock_response(json_data={"result": None, "error": "deck was not found"})
            with pytest.raises(AnkiActionError) as exc_info:
                service.list_decks()
            assert "deck was not found" in str(exc_info.value)

    def test_find_existing_note_match(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [101, 102]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 101,
                        "fields": {
                            "Front": {"value": "食べる"},
                            "Back": {"value": "to eat"},
                        },
                    },
                    {
                        "noteId": 102,
                        "fields": {
                            "Expression": {"value": "飲む"},
                            "Reading": {"value": "のむ"},
                        },
                    },
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "飲む", "のむ")
            assert found_id == 102

            # Different expression
            not_found = service.find_existing_note("Default", "走る", "はしる")
            assert not_found is None

    def test_find_existing_note_safe_escaping(self):
        service = AnkiConnectService()
        captured_query = []
        def mock_invoke(action, **params):
            if action == "findNotes":
                captured_query.append(params.get("query"))
                return []
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            service.find_existing_note('My "Deck"', '日本"語*')
            assert len(captured_query) == 1
            # Verify quotes are escaped and asterisks stripped
            assert r'deck:"My \"Deck\""' in captured_query[0]
            assert r'"日本\"語"' in captured_query[0]

    def test_find_existing_note_empty_expression_returns_none_without_query(self):
        """Empty expression must return None immediately; must NOT issue a bare deck query
        that would match every note in the deck and create false positives."""
        service = AnkiConnectService()
        invoke_calls = []
        def mock_invoke(action, **params):
            invoke_calls.append(action)
            return []

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            result = service.find_existing_note("Default", "")
            assert result is None
            assert "findNotes" not in invoke_calls, "Must not call findNotes with empty expression"

            # "*'" -> all special chars stripped -> empty safe_term
            result2 = service.find_existing_note("Default", "'*'")
            assert result2 is None
            assert "findNotes" not in invoke_calls, "Must not call findNotes when expression reduces to empty after sanitization"

    def test_deterministic_basic_model_mapping(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "hint": "cinema",
            "example_sentence": "映画を見る",
            "example_translation": "watch a movie",
            "notes": "common word",
        }
        fields = service.map_card_to_fields(card_data, ["Front", "Back"])
        assert "Front" in fields
        assert fields["Front"] == "映画 [えいが]"
        assert "Back" in fields
        assert "movie" in fields["Back"]
        assert "Hint: cinema" in fields["Back"]
        assert "映画を見る" in fields["Back"]
        assert "watch a movie" in fields["Back"]

    def test_deterministic_japanese_model_mapping(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "hint": "cinema",
            "example_sentence": "映画を見る",
            "example_translation": "watch a movie",
        }
        fields = service.map_card_to_fields(
            card_data,
            ["Expression", "Reading", "Meaning", "Hint", "Example Sentence", "Example Translation"],
        )
        assert fields["Expression"] == "映画"
        assert fields["Reading"] == "えいが"
        assert fields["Meaning"] == '<div class="kn-meaning">movie</div>'
        assert fields["Hint"] == "cinema"
        assert fields["Example Sentence"] == '<div class="kn-example-block">\n  <p class="kn-example-ja">映画を見る</p>\n</div>'
        assert fields["Example Translation"] == "watch a movie"

    def test_mapping_yomitan_default_template(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "約束",
            "reading": "やくそく",
            "meaning": "promise; agreement",
            "example_sentence": "約束を守る",
            "audio": "audio.mp3",
        }
        fields = service.map_card_to_fields(card_data, ["Expression", "Reading", "Glossary", "Sentence", "Audio"])
        assert fields["Expression"] == "約束"
        assert fields["Reading"] == "やくそく"
        assert fields["Glossary"] == '<div class="kn-meaning">promise; agreement</div>'
        assert fields["Sentence"] == '<div class="kn-example-block">\n  <p class="kn-example-ja">約束を守る</p>\n</div>'
        assert fields["Audio"] == "[sound:audio.mp3]"

    def test_mapping_core_2k_template(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "桜",
            "reading": "さくら",
            "meaning": "cherry blossom",
            "example_sentence": "桜が咲いた",
            "example_translation": "The cherry blossoms bloomed",
        }
        fields = service.map_card_to_fields(card_data, ["Word", "Kana", "Meaning", "Sentence-Expression", "Sentence-English"])
        assert fields["Word"] == "桜"
        assert fields["Kana"] == "さくら"
        assert fields["Meaning"] == '<div class="kn-meaning">cherry blossom</div>'
        assert fields["Sentence-Expression"] == '<div class="kn-example-block">\n  <p class="kn-example-ja">桜が咲いた</p>\n</div>'
        assert fields["Sentence-English"] == "The cherry blossoms bloomed"

    def test_mapping_kaishi_template(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "猫",
            "reading": "ねこ",
            "meaning": "cat",
            "example_sentence": "猫がいる",
            "example_translation": "There is a cat",
        }
        fields = service.map_card_to_fields(card_data, ["Word", "Reading", "Meaning", "Example Sentence", "Example Sentence Meaning"])
        assert fields["Word"] == "猫"
        assert fields["Reading"] == "ねこ"
        assert fields["Meaning"] == '<div class="kn-meaning">cat</div>'
        assert fields["Example Sentence"] == '<div class="kn-example-block">\n  <p class="kn-example-ja">猫がいる</p>\n</div>'
        assert fields["Example Sentence Meaning"] == "There is a cat"

    def test_mapping_anime_mining_template(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
            "example_sentence": "ご飯を食べる",
            "audio": "taberu.mp3",
            "image": "taberu.jpg",
        }
        fields = service.map_card_to_fields(
            card_data,
            ["VocabKanji", "VocabFurigana", "VocabDef", "Sentence", "SentenceAudio", "SentenceImage"]
        )
        assert fields["VocabKanji"] == "食べる"
        assert fields["VocabFurigana"] == "たべる"
        assert fields["VocabDef"] == '<div class="kn-meaning">to eat</div>'
        assert fields["Sentence"] == '<div class="kn-example-block">\n  <p class="kn-example-ja">ご飯を食べる</p>\n</div>'
        assert fields["SentenceAudio"] == "[sound:taberu.mp3]"
        assert fields["SentenceImage"] == '<img src="taberu.jpg">'

    def test_mapping_japanese_mining_model_variations(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "遅刻",
            "reading": "ちこく",
            "meaning": "lateness, tardiness",
            "image": "ankiminer_img_123.jpg",
            "audio": "ankiminer_audio_456.webm",
        }
        fields = service.map_card_to_fields(
            card_data,
            ["Expression", "Reading", "Meaning", "SentencePicture", "SentenceSound"]
        )
        assert fields["Expression"] == "遅刻"
        assert fields["Reading"] == "ちこく"
        assert fields["Meaning"] == '<div class="kn-meaning">lateness, tardiness</div>'
        assert fields["SentencePicture"] == '<img src="ankiminer_img_123.jpg">'
        assert fields["SentenceSound"] == '[sound:ankiminer_audio_456.webm]'

    def test_mapping_basic_model_with_media_included_in_back(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "遅刻",
            "meaning": "lateness",
            "image": "ankiminer_img_123.jpg",
            "audio": "ankiminer_audio_456.webm",
        }
        fields = service.map_card_to_fields(card_data, ["Front", "Back"])
        assert fields["Front"] == "遅刻"
        assert '<img src="ankiminer_img_123.jpg" class="kn-image">' in fields["Back"]
        assert '[sound:ankiminer_audio_456.webm]' in fields["Back"]

    def test_mapping_arbitrary_two_field_fallback(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "水",
            "reading": "みず",
            "meaning": "water",
        }
        fields = service.map_card_to_fields(card_data, ["Question", "Answer"])
        assert fields["Question"] == "水"
        assert fields["Answer"] == '<div class="kn-meaning">water</div>'

    def test_add_note_success(self):
        service = AnkiConnectService()
        with patch.object(service, "create_deck"), \
             patch.object(service, "resolve_note_model", return_value=("Basic", ["Front", "Back"])), \
             patch.object(service, "_invoke", return_value=1234567):
            note_id = service.add_note("Default", {"expression": "犬", "meaning": "dog"})
            assert note_id == 1234567

    def test_find_existing_note_basic_model_with_bracketed_reading(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [201]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 201,
                        "fields": {
                            "Front": {"value": "映画 [えいが]"},
                            "Back": {"value": "movie"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "映画", "えいが")
            assert found_id == 201

    def test_find_existing_note_html_formatted_fields(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [301]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 301,
                        "fields": {
                            "Front": {"value": "<div>映画&nbsp;[えいが]</div>"},
                            "Back": {"value": "<b>movie</b>"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "映画", "えいが")
            assert found_id == 301

    def test_find_existing_note_homonym_different_reading_rejected(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [401]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 401,
                        "fields": {
                            "Front": {"value": "角 [かど]"},
                            "Back": {"value": "corner"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            # Target is 角 with reading つの (horn)
            found_id = service.find_existing_note("Default", "角", "つの")
            assert found_id is None

    def test_find_existing_note_different_deck_skipped(self):
        service = AnkiConnectService()
        def mock_invoke(action, **params):
            if action == "findNotes":
                return [501]
            if action == "notesInfo":
                return [
                    {
                        "noteId": 501,
                        "deckName": "OtherDeck",
                        "fields": {
                            "Expression": {"value": "本"},
                            "Reading": {"value": "ほん"},
                        },
                    }
                ]
            return None

        with patch.object(service, "_invoke", side_effect=mock_invoke):
            found_id = service.find_existing_note("Default", "本", "ほん")
            assert found_id is None

    def test_add_note_with_explicit_model_uses_exact_model(self):
        service = AnkiConnectService()
        invoked_payloads = []

        def mock_invoke(action, **params):
            if action == "modelFieldNames":
                return ["Expression", "Meaning"]
            if action == "addNote":
                invoked_payloads.append(params)
                return 778899
            return None

        with patch.object(service, "create_deck"), \
             patch.object(service, "resolve_note_model") as mock_resolve, \
             patch.object(service, "_invoke", side_effect=mock_invoke):
            note_id = service.add_note(
                deck_name="Default",
                card_data={"expression": "空", "meaning": "sky"},
                model_name="Custom Vocab Model",
            )
            assert note_id == 778899
            # resolve_note_model must NOT be called when explicit model is provided
            mock_resolve.assert_not_called()
            # The payload passed to addNote must use the explicit model
            assert len(invoked_payloads) == 1
            assert invoked_payloads[0]["note"]["modelName"] == "Custom Vocab Model"

    def test_add_note_without_model_uses_automatic_resolution(self):
        service = AnkiConnectService()
        invoked_payloads = []

        def mock_invoke(action, **params):
            if action == "addNote":
                invoked_payloads.append(params)
                return 445566
            return None

        with patch.object(service, "create_deck"), \
             patch.object(service, "resolve_note_model", return_value=("Resolved Model", ["Front", "Back"])) as mock_resolve, \
             patch.object(service, "_invoke", side_effect=mock_invoke):
            note_id = service.add_note(
                deck_name="Default",
                card_data={"expression": "月", "meaning": "moon"},
                model_name=None,
            )
            assert note_id == 445566
            mock_resolve.assert_called_once()
            assert len(invoked_payloads) == 1
            assert invoked_payloads[0]["note"]["modelName"] == "Resolved Model"

    def test_get_model_capabilities_basic(self):
        service = AnkiConnectService()
        with patch.object(service, "get_model_field_names", return_value=["Front", "Back"]):
            caps = service.get_model_capabilities("Basic")
            assert caps["model_name"] == "Basic"
            assert caps["supports_image"] is False
            assert caps["supports_audio"] is False
            assert caps["supports_sentence"] is False

    def test_get_model_capabilities_rich_mining_model(self):
        service = AnkiConnectService()
        with patch.object(service, "get_model_field_names", return_value=["Expression", "Reading", "Meaning", "Sentence", "Audio", "Image"]):
            caps = service.get_model_capabilities("Mining")
            assert caps["model_name"] == "Mining"
            assert caps["supports_image"] is True
            assert caps["supports_audio"] is True
            assert caps["supports_sentence"] is True

    def test_map_card_graceful_omission_when_model_lacks_media_fields(self):
        service = AnkiConnectService()
        card_data = {
            "expression": "山",
            "reading": "やま",
            "meaning": "mountain",
            "image": "mountain.jpg",
            "audio": "mountain.mp3",
        }
        # Model only has Expression, Reading, Meaning (no Image or Audio)
        fields = service.map_card_to_fields(card_data, ["Expression", "Reading", "Meaning"])
        assert fields["Expression"] == "山"
        assert fields["Reading"] == "やま"
        assert fields["Meaning"] == '<div class="kn-meaning">mountain</div>'
        assert "Image" not in fields
        assert "Audio" not in fields

    def test_api_get_model_capabilities_endpoint(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        with patch.object(AnkiConnectService, "get_model_capabilities", return_value={
            "model_name": "Japanese Vocab",
            "fields": ["Word", "Reading", "Meaning", "Audio", "Picture"],
            "supports_image": True,
            "supports_audio": True,
            "supports_sentence": False,
        }):
            res = client.get("/api/anki/model-capabilities?model_name=Japanese%20Vocab")
            assert res.status_code == 200
            data = res.json()
            assert data["connected"] is True
            assert data["model_name"] == "Japanese Vocab"
            assert data["supports_image"] is True
            assert data["supports_audio"] is True
            assert data["supports_sentence"] is False


class TestAnkiConnectFormatterIntegration:
    @pytest.fixture(autouse=True)
    def setup_service(self):
        self.service = AnkiConnectService()

    # 1. Basic model receives formatted meaning HTML
    def test_01_basic_model_receives_formatted_meaning_html(self):
        card_data = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
        }
        fields = self.service.map_card_to_fields(card_data, ["Front", "Back"])
        assert fields["Front"] == "食べる [たべる]"
        assert '<div class="kn-card">' in fields["Back"]
        assert '<span class="kn-kana">たべる</span>' in fields["Back"]
        assert '<hr class="kn-divider">' in fields["Back"]
        assert '<div class="kn-meaning">to eat</div>' in fields["Back"]

    # 2. Multiple meanings remain structured and numbered
    def test_02_multiple_meanings_remain_structured_and_numbered(self):
        # Structured senses in entries
        card_data = {
            "expression": "掛ける",
            "reading": "かける",
            "meaning": "1. to hang\n2. to put on",
            "entries": [
                {
                    "dictionary": "Jitendex",
                    "senses": [
                        {"index": 1, "glosses": ["to hang", "to suspend"]},
                        {"index": 2, "glosses": ["to put on (glasses)"]},
                    ],
                }
            ],
        }
        fields = self.service.map_card_to_fields(card_data, ["Front", "Back"])
        assert '<ol class="kn-meanings">' in fields["Back"]
        assert "<li>to hang, to suspend</li>" in fields["Back"]
        assert "<li>to put on (glasses)</li>" in fields["Back"]

        # Also verify custom model Meaning field
        custom_fields = self.service.map_card_to_fields(card_data, ["Expression", "Meaning"])
        assert '<ol class="kn-meanings">' in custom_fields["Meaning"]
        assert "<li>to hang, to suspend</li>" in custom_fields["Meaning"]

    # 3. POS and tags survive into formatted meaning HTML
    def test_03_pos_and_tags_survive_into_formatted_meaning_html(self):
        card_data = {
            "expression": "落ちる",
            "reading": "おちる",
            "meaning": "to fall",
            "entries": [
                {
                    "dictionary": "Jitendex",
                    "senses": [
                        {
                            "index": 1,
                            "glosses": ["to fall", "to drop"],
                            "parts_of_speech": ["ichidan", "vi"],
                            "tags": ["usually kana"],
                            "field_tags": ["physics"],
                        }
                    ],
                }
            ],
        }
        fields = self.service.map_card_to_fields(card_data, ["Word", "Reading", "Meaning"])
        meaning_html = fields["Meaning"]
        assert '<span class="kn-pos">[ichidan, vi]</span>' in meaning_html
        assert '<span class="kn-tag">[usually kana, physics]</span>' in meaning_html
        assert "to fall, to drop" in meaning_html

    # 4. Example ruby survives correctly
    def test_04_example_ruby_survives_correctly(self):
        card_data = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
            "example_sentence": "朝ご飯を食べる。",
            "example_reading": "朝[あさ]御[ご]飯[はん]を食[た]べる。",
            "example_translation": "To eat breakfast.",
        }
        fields = self.service.map_card_to_fields(card_data, ["Expression", "Reading", "Meaning", "Sentence"])
        sentence_html = fields["Sentence"]
        assert "<ruby>朝<rt>あさ</rt></ruby>" in sentence_html
        assert "<ruby>御<rt>ご</rt></ruby>" in sentence_html
        assert "<ruby>飯<rt>はん</rt></ruby>" in sentence_html
        assert "<ruby>食<rt>た</rt></ruby>" in sentence_html
        assert "を" in sentence_html
        assert "べる。" in sentence_html

    # 5. Example translation survives
    def test_05_example_translation_survives(self):
        # Case A: Model with separate translation field (Kaishi)
        card_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "example_sentence": "映画を見る",
            "example_translation": "Watch a movie",
        }
        kaishi_fields = self.service.map_card_to_fields(
            card_data,
            ["Word", "Reading", "Meaning", "Example Sentence", "Example Sentence Meaning"],
        )
        assert kaishi_fields["Example Sentence Meaning"] == "Watch a movie"
        assert "映画を見る" in kaishi_fields["Example Sentence"]
        assert "kn-example-en" not in kaishi_fields["Example Sentence"]

        # Case B: Model without separate translation field (Yomitan Default)
        yomitan_fields = self.service.map_card_to_fields(
            card_data,
            ["Expression", "Reading", "Glossary", "Sentence"],
        )
        assert '<p class="kn-example-ja">映画を見る</p>' in yomitan_fields["Sentence"]
        assert '<p class="kn-example-en">Watch a movie</p>' in yomitan_fields["Sentence"]

    # 6. Pitch survives where applicable
    def test_06_pitch_survives_where_applicable(self):
        card_data = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
            "pitches": [
                PitchAccent(reading="たべる", position=2, pattern_name="nakadaka"),
            ],
        }
        # In Basic model
        basic_fields = self.service.map_card_to_fields(card_data, ["Front", "Back"])
        assert '<span class="kn-pitch">[② Nakadaka]</span>' in basic_fields["Back"]

        # In Custom model with Pitch field
        custom_fields = self.service.map_card_to_fields(
            card_data,
            ["Expression", "Reading", "Meaning", "Pitch"],
        )
        assert custom_fields["Pitch"] == "[② Nakadaka]"

    # 7. HTML/XSS input is escaped
    def test_07_html_xss_input_is_escaped(self):
        malicious_card = {
            "expression": "<script>alert('expr')</script>",
            "reading": "<img src=x onerror=alert('read')>",
            "meaning": '<a href="javascript:steal()">click</a> & test',
            "hint": "<script>alert('hint')</script>",
            "notes": '" onmouseover="hack()',
            "example_sentence": "<script>alert('ja')</script>",
            "example_translation": "<b>trans</b>",
            "image": 'photo.jpg" onerror="alert(1)',
            "audio": 'audio.mp3" onclick="alert(2)',
        }
        fields = self.service.map_card_to_fields(
            malicious_card,
            ["Expression", "Reading", "Meaning", "Hint", "Notes", "Sentence", "Translation", "Image", "Audio"],
        )
        for field_name, value in fields.items():
            assert "<script>" not in value, f"Unescaped <script> in {field_name}"
            assert 'onerror="alert' not in value, f"Unescaped attribute injection in {field_name}"
            assert 'onmouseover="hack' not in value, f"Unescaped attribute injection in {field_name}"
            assert 'onclick="alert' not in value, f"Unescaped attribute injection in {field_name}"

        assert "&lt;script&gt;" in fields["Expression"]
        assert "&lt;img src=x" in fields["Reading"]
        assert "&amp; test" in fields["Meaning"]
        assert "&quot; onmouseover=&quot;hack()" in fields["Notes"]
        assert "Image" not in fields
        assert "Audio" not in fields

    # 8. Media sanitization is preserved
    def test_08_media_sanitization_is_preserved(self):
        valid_card = {
            "expression": "猫",
            "image": "kiroku_img_12345.png",
            "audio": "kiroku_audio_67890.webm",
        }
        fields = self.service.map_card_to_fields(valid_card, ["Word", "SentencePicture", "SentenceSound"])
        assert fields["SentencePicture"] == '<img src="kiroku_img_12345.png">'
        assert fields["SentenceSound"] == '[sound:kiroku_audio_67890.webm]'

        # In Basic model
        basic_fields = self.service.map_card_to_fields(valid_card, ["Front", "Back"])
        assert '<img src="kiroku_img_12345.png" class="kn-image">' in basic_fields["Back"]
        assert '[sound:kiroku_audio_67890.webm]' in basic_fields["Back"]

        # Disallowed file extensions
        bad_card = {
            "expression": "猫",
            "image": "virus.exe",
            "audio": "payload.bat",
        }
        bad_fields = self.service.map_card_to_fields(bad_card, ["Word", "SentencePicture", "SentenceSound"])
        assert "SentencePicture" not in bad_fields
        assert "SentenceSound" not in bad_fields

    # 9. Existing Basic and custom model keyword mappings remain correct
    def test_09_existing_basic_and_custom_keyword_mappings(self):
        card_data = {
            "expression": "本",
            "reading": "ほん",
            "meaning": "book",
            "hint": "read",
            "notes": "common noun",
        }
        basic_fields = self.service.map_card_to_fields(card_data, ["Front", "Back"])
        assert basic_fields["Front"] == "本 [ほん]"
        assert "book" in basic_fields["Back"]
        assert "Hint: read" in basic_fields["Back"]
        assert "Notes: common noun" in basic_fields["Back"]

    # 10. Existing Kaishi mapping remains correct
    def test_10_existing_kaishi_mapping(self):
        card_data = {
            "expression": "猫",
            "reading": "ねこ",
            "meaning": "cat",
            "example_sentence": "猫がいる",
            "example_translation": "There is a cat",
        }
        fields = self.service.map_card_to_fields(
            card_data,
            ["Word", "Reading", "Meaning", "Example Sentence", "Example Sentence Meaning"],
        )
        assert fields["Word"] == "猫"
        assert fields["Reading"] == "ねこ"
        assert fields["Meaning"] == '<div class="kn-meaning">cat</div>'
        assert "猫がいる" in fields["Example Sentence"]
        assert fields["Example Sentence Meaning"] == "There is a cat"

    # 11. Existing Yomitan Default mapping remains correct
    def test_11_existing_yomitan_default_mapping(self):
        card_data = {
            "expression": "約束",
            "reading": "やくそく",
            "meaning": "promise; agreement",
            "example_sentence": "約束を守る",
            "audio": "audio.mp3",
        }
        fields = self.service.map_card_to_fields(card_data, ["Expression", "Reading", "Glossary", "Sentence", "Audio"])
        assert fields["Expression"] == "約束"
        assert fields["Reading"] == "やくそく"
        assert fields["Glossary"] == '<div class="kn-meaning">promise; agreement</div>'
        assert "約束を守る" in fields["Sentence"]
        assert fields["Audio"] == "[sound:audio.mp3]"

    # 12. Existing Anime/Japanese Mining mapping remains correct
    def test_12_existing_anime_japanese_mining_mapping(self):
        card_data = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
            "example_sentence": "ご飯を食べる",
            "audio": "taberu.mp3",
            "image": "taberu.jpg",
        }
        fields = self.service.map_card_to_fields(
            card_data,
            ["VocabKanji", "VocabFurigana", "VocabDef", "Sentence", "SentenceAudio", "SentenceImage"]
        )
        assert fields["VocabKanji"] == "食べる"
        assert fields["VocabFurigana"] == "たべる"
        assert fields["VocabDef"] == '<div class="kn-meaning">to eat</div>'
        assert "ご飯を食べる" in fields["Sentence"]
        assert fields["SentenceAudio"] == "[sound:taberu.mp3]"
        assert fields["SentenceImage"] == '<img src="taberu.jpg">'

    # 13. Multi-dictionary data does not silently disappear
    def test_13_multi_dictionary_data_does_not_silently_disappear(self):
        card_data = {
            "expression": "勉強",
            "reading": "べんきょう",
            "meaning": "study",
            "entries": [
                {
                    "dictionary": "Jitendex",
                    "senses": [{"index": 1, "glosses": ["study", "diligence"]}],
                },
                {
                    "dictionary": "新明解",
                    "senses": [{"index": 1, "glosses": ["学問などを学ぶこと"]}],
                },
            ],
        }
        fields = self.service.map_card_to_fields(card_data, ["Expression", "Meaning"])
        meaning_html = fields["Meaning"]
        assert "study, diligence" in meaning_html
        assert "学問などを学ぶこと" in meaning_html
        assert '<ol class="kn-meanings">' in meaning_html

    # 14. Cards with no structured entries still work using legacy/default meaning data
    def test_14_cards_with_no_structured_entries_work_using_legacy_data(self):
        card_data = {
            "expression": "走る",
            "reading": "はしる",
            "meaning": "1. to run\n2. to dash\n3. to retreat",
            "entries": [],
        }
        fields = self.service.map_card_to_fields(card_data, ["Expression", "Meaning"])
        meaning_html = fields["Meaning"]
        assert '<ol class="kn-meanings">' in meaning_html
        assert "<li>to run</li>" in meaning_html
        assert "<li>to dash</li>" in meaning_html
        assert "<li>to retreat</li>" in meaning_html

    # 15. Existing saved cards remain compatible
    def test_15_existing_saved_cards_remain_compatible(self):
        # Legacy card dictionary shape without entries/examples keys
        legacy_card = {
            "expression": "川",
            "reading": "かわ",
            "meaning": "river",
            "hint": "",
            "example_sentence": "",
            "example_translation": "",
            "image": "",
            "audio": "",
            "tags": "nature",
            "notes": "",
        }
        fields = self.service.map_card_to_fields(legacy_card, ["Front", "Back"])
        assert fields["Front"] == "川 [かわ]"
        assert '<div class="kn-meaning">river</div>' in fields["Back"]
        assert "kn-media" not in fields["Back"]
        assert "kn-hint" not in fields["Back"]

