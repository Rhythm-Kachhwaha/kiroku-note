"""End-to-End integration tests for WAV audio capture persistence and AnkiConnect synchronization."""
import base64
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError

# Canonical 44-byte RIFF/WAVE header + 4 bytes of 16-bit silence
WAV_BYTES = (
    b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x04\x00\x00\x00"
    b"\x00\x00\x00\x00"
)
WAV_DATA_URL = f"data:audio/wav;base64,{base64.b64encode(WAV_BYTES).decode('ascii')}"


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolate SQLite database and media storage directory for tests."""
    db_file = tmp_path / "test_audio_e2e.db"
    init_db(str(db_file))
    media_dir = tmp_path / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("KIROKU_DB_PATH", str(db_file))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_file))
    monkeypatch.setenv("KIROKU_MEDIA_DIR", str(media_dir))
    monkeypatch.setenv("ANKIMINER_MEDIA_DIR", str(media_dir))

    return {
        "db_file": db_file,
        "media_dir": media_dir,
    }


def test_save_card_with_wav_audio_and_sync(isolated_env):
    """Verify end-to-end saving of card with 16-bit Mono WAV data URL and binary retrieval."""
    client = TestClient(app)

    # 1. Save card with WAV data URL
    save_payload = {
        "expression": "音声テスト",
        "reading": "おんせいてすと",
        "meaning": "Audio end-to-end test",
        "deck_name": "Default",
        "audio": WAV_DATA_URL,
    }

    res = client.post("/api/cards/save", json=save_payload)
    assert res.status_code == 200, res.text
    card = res.json()
    assert card["audio"] != "", "Audio field must be populated"
    assert card["audio"].endswith(".wav"), "Audio filename must be a .wav file"

    # 2. Verify media endpoint serves the WAV file
    media_res = client.get(f"/api/media/{card['audio']}")
    assert media_res.status_code == 200
    assert media_res.headers["content-type"].startswith("audio/")
    assert media_res.content[:4] == b"RIFF"

    # 3. Verify card detail reflects the saved audio
    detail_res = client.get(f"/api/cards/{card['id']}")
    assert detail_res.status_code == 200
    assert detail_res.json()["audio"] == card["audio"]


def test_sync_card_with_wav_audio_to_ankiconnect(isolated_env):
    """Verify syncing card with WAV audio uploads media via storeMediaFile and adds note."""
    client = TestClient(app)

    # 1. Save card with WAV audio
    save_payload = {
        "expression": "聞こえる",
        "reading": "きこえる",
        "meaning": "to be audible, to be heard",
        "deck_name": "Default",
        "model_name": "Basic",
        "audio": WAV_DATA_URL,
    }
    save_res = client.post("/api/cards/save", json=save_payload)
    assert save_res.status_code == 200
    card = save_res.json()
    audio_filename = card["audio"]
    assert audio_filename.endswith(".wav")

    # 2. Mock AnkiConnect operations
    with patch.object(AnkiConnectService, "find_existing_note", return_value=None), \
         patch.object(AnkiConnectService, "get_model_names", return_value=["Basic"]), \
         patch.object(AnkiConnectService, "get_model_field_names", return_value=["Front", "Back"]), \
         patch.object(AnkiConnectService, "store_media_file", return_value=audio_filename) as mock_store, \
         patch.object(AnkiConnectService, "add_note", return_value=987654321) as mock_add_note:

        sync_res = client.post(f"/api/cards/{card['id']}/sync")
        assert sync_res.status_code == 200, sync_res.text
        sync_data = sync_res.json()
        assert sync_data["sync_status"] == "synced"
        assert sync_data["anki_note_id"] == 987654321

        # Verify store_media_file called with filename and WAV bytes
        mock_store.assert_called_once()
        store_kwargs = mock_store.call_args.kwargs if mock_store.call_args.kwargs else {}
        stored_file = store_kwargs.get("filename") or mock_store.call_args[0][0]
        stored_bytes = store_kwargs.get("data_bytes") or mock_store.call_args[0][1]
        assert stored_file == audio_filename
        assert stored_bytes == WAV_BYTES

        # Verify add_note received card_data with audio field
        mock_add_note.assert_called_once()
        add_kwargs = mock_add_note.call_args.kwargs if mock_add_note.call_args.kwargs else {}
        note_card_data = add_kwargs.get("card_data") or mock_add_note.call_args[0][1]
        assert note_card_data["audio"] == audio_filename

    # 3. Verify card in SQLite is marked synced with note ID
    detail_res = client.get(f"/api/cards/{card['id']}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["sync_status"] == "synced"
    assert detail["anki_note_id"] == 987654321
    assert detail["audio"] == audio_filename


def test_sync_card_dedicated_sentence_audio_field_mapping(isolated_env):
    """Verify note model with dedicated SentenceAudio field receives [sound:xxx.wav]."""
    anki_service = AnkiConnectService()
    model_fields = ["Expression", "Reading", "Meaning", "SentenceAudio", "SentenceImage"]
    card_data = {
        "expression": "聞こえる",
        "reading": "きこえる",
        "meaning": "to be heard",
        "audio": "kiroku_audio_20261006_test.wav",
    }
    mapped = anki_service.map_card_to_fields(card_data, model_fields)
    assert mapped["Expression"] == "聞こえる"
    assert mapped["SentenceAudio"] == "[sound:kiroku_audio_20261006_test.wav]"
    assert "[sound:" not in mapped.get("Meaning", "")


def test_sync_card_audio_preservation_on_anki_failure(isolated_env):
    """Verify local card and WAV audio are preserved without data loss when AnkiConnect fails."""
    client = TestClient(app)

    save_payload = {
        "expression": "失敗テスト",
        "reading": "しっぱいてすと",
        "meaning": "Failure soft resilience test",
        "deck_name": "Default",
        "audio": WAV_DATA_URL,
    }
    save_res = client.post("/api/cards/save", json=save_payload)
    assert save_res.status_code == 200
    card = save_res.json()
    audio_filename = card["audio"]

    # Mock AnkiConnect network outage
    with patch.object(AnkiConnectService, "find_existing_note", side_effect=AnkiConnectionError("Failed to reach AnkiConnect")):
        sync_res = client.post(f"/api/cards/{card['id']}/sync")
        assert sync_res.status_code == 200
        sync_data = sync_res.json()
        assert sync_data["sync_status"] == "failed"
        assert "Failed to reach AnkiConnect" in sync_data["error"]

    # Verify local SQLite card is preserved with audio and sync_status='failed'
    detail_res = client.get(f"/api/cards/{card['id']}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["sync_status"] == "failed"
    assert detail["audio"] == audio_filename

    # Verify audio file still accessible via media endpoint
    media_res = client.get(f"/api/media/{audio_filename}")
    assert media_res.status_code == 200
    assert media_res.content == WAV_BYTES
