"""
AnkiMiner - Stage 2 Frame Capture Tests
Unit and integration tests for image media storage, card persistence, idempotency,
and AnkiConnect image field mapping.
"""

import base64
import os
from pathlib import Path
import shutil
import tempfile
import pytest

from app.db.connection import init_db
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectService
from app.services.card_service import CardService
from app.services.media_storage import MediaStorageService


# 1x1 Transparent JPEG / minimal valid JPEG Data URL
MOCK_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
)
MOCK_JPEG_DATA_URL = f"data:image/jpeg;base64,{MOCK_JPEG_B64}"


@pytest.fixture
def temp_env():
    """Set up temporary database and media storage directories for testing."""
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test_cards.db")
    media_dir = os.path.join(temp_dir, "media")
    os.makedirs(media_dir, exist_ok=True)

    orig_media = os.environ.get("ANKIMINER_MEDIA_DIR")
    orig_db = os.environ.get("ANKIMINER_DB_PATH")

    os.environ["ANKIMINER_MEDIA_DIR"] = media_dir
    os.environ["ANKIMINER_DB_PATH"] = db_path

    init_db(Path(db_path))
    storage = MediaStorageService(media_dir=Path(media_dir))
    repository = CardRepository(db_path=Path(db_path))
    service = CardService(card_repository=repository)
    anki = AnkiConnectService()

    yield {
        "temp_dir": temp_dir,
        "db_path": db_path,
        "media_dir": media_dir,
        "storage": storage,
        "repository": repository,
        "service": service,
        "anki": anki,
    }

    if orig_media is not None:
        os.environ["ANKIMINER_MEDIA_DIR"] = orig_media
    else:
        os.environ.pop("ANKIMINER_MEDIA_DIR", None)

    if orig_db is not None:
        os.environ["ANKIMINER_DB_PATH"] = orig_db
    else:
        os.environ.pop("ANKIMINER_DB_PATH", None)

    shutil.rmtree(temp_dir, ignore_errors=True)


def test_media_storage_save_and_retrieve_image(temp_env):
    storage = temp_env["storage"]

    # Test saving JPEG Data URL
    filename = storage.save_media(MOCK_JPEG_DATA_URL, media_type="image")
    assert filename is not None
    assert filename.startswith("ankiminer_img_")
    assert filename.endswith(".jpg")

    # Verify file exists on disk
    file_path = storage.get_media_path(filename)
    assert file_path is not None
    assert os.path.exists(file_path)

    # Verify bytes match
    file_bytes = storage.get_media_bytes(filename)
    assert file_bytes is not None
    assert len(file_bytes) > 0


def test_media_storage_path_traversal_protection(temp_env):
    storage = temp_env["storage"]

    # Reject path traversal attempts
    assert storage.get_media_path("../../../etc/passwd") is None
    assert storage.get_media_path("..\\..\\windows\\win.ini") is None
    assert storage.get_media_path("/absolute/path/test.jpg") is None
    assert storage.get_media_bytes("../../../secret.txt") is None


def test_card_save_with_image_data_url(temp_env):
    service = temp_env["service"]

    # Save card with image Data URL
    req = SaveCardRequest(
        expression="映画",
        reading="えいが",
        meaning="movie; film",
        deck_name="Default",
        image="captured_frame.jpg",
        image_data=MOCK_JPEG_DATA_URL,
    )

    resp = service.save_card(req)
    assert resp.is_new is True
    assert resp.id is not None
    assert resp.image is not None
    assert resp.image.startswith("ankiminer_img_")
    assert resp.image.endswith(".jpg")

    # Verify card in SQLite repository
    card = service.get_card(resp.id)
    assert card is not None
    assert card.image == resp.image


def test_card_resave_idempotency_preserves_image_filename(temp_env):
    service = temp_env["service"]
    media_dir = temp_env["media_dir"]

    # Initial save
    req1 = SaveCardRequest(
        expression="約束",
        reading="やくそく",
        meaning="promise; agreement",
        deck_name="Default",
        image_data=MOCK_JPEG_DATA_URL,
    )
    resp1 = service.save_card(req1)
    saved_filename = resp1.image
    assert saved_filename is not None

    media_files_before = os.listdir(media_dir)
    assert len(media_files_before) == 1

    # Re-save with same filename and new text edit (without re-uploading duplicate image)
    req2 = SaveCardRequest(
        id=resp1.id,
        expression="約束",
        reading="やくそく",
        meaning="promise; agreement; appointment (updated)",
        deck_name="Default",
        image=saved_filename,
        image_data=None,  # Not re-uploaded
    )
    resp2 = service.save_card(req2)
    assert resp2.is_updated is True
    assert resp2.image == saved_filename

    media_files_after = os.listdir(media_dir)
    assert len(media_files_after) == 1, "Re-saving must not create duplicate media files"


def test_card_save_with_dual_media_image_and_audio(temp_env):
    service = temp_env["service"]

    # Mock 44-byte minimal WAV Data URL
    mock_wav_bytes = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    mock_wav_b64 = base64.b64encode(mock_wav_bytes).decode("ascii")
    mock_wav_data_url = f"data:audio/wav;base64,{mock_wav_b64}"

    req = SaveCardRequest(
        expression="猫",
        reading="ねこ",
        meaning="cat",
        deck_name="Default",
        image_data=MOCK_JPEG_DATA_URL,
        audio_data=mock_wav_data_url,
        media_mime_type="audio/wav",
    )

    resp = service.save_card(req)
    assert resp.is_new is True
    assert resp.image is not None and resp.image.startswith("ankiminer_img_")
    assert resp.audio is not None and resp.audio.startswith("ankiminer_audio_")

    card = service.get_card(resp.id)
    assert card.image == resp.image
    assert card.audio == resp.audio


def test_anki_connect_model_field_mapping_with_image(temp_env):
    anki = temp_env["anki"]

    card_dict = {
        "expression": "本",
        "reading": "ほん",
        "meaning": "book",
        "image": "ankiminer_img_20260915_test.jpg",
    }

    # Test 1: Japanese Mining Model with Picture field
    mining_fields = ["Expression", "Reading", "Meaning", "Picture", "SentenceAudio"]
    fields = anki.map_card_to_fields(card_dict, mining_fields)
    assert fields["Picture"] == '<img src="ankiminer_img_20260915_test.jpg">'
    assert fields["Expression"] == "ほん" or fields["Expression"] == "本"

    # Test 2: Standard Basic Model (Front / Back)
    basic_fields = ["Front", "Back"]
    basic_mapped = anki.map_card_to_fields(card_dict, basic_fields)
    assert '<img src="ankiminer_img_20260915_test.jpg" class="kn-image">' in basic_mapped["Back"]

    # Test 3: Model with Image field
    image_fields = ["Target Word", "Definition", "Image"]
    image_mapped = anki.map_card_to_fields(card_dict, image_fields)
    assert image_mapped["Image"] == '<img src="ankiminer_img_20260915_test.jpg">'
