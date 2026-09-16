"""Unit and integration tests for Frame Capture — Stage 3: Combined Media Card Lifecycle Verification.

Verifies:
- Dual media card creation (both screenshot image + sentence audio) in SQLite and local disk
- Partial media card workflows (image-only, audio-only, text-only)
- Re-save / edit idempotency (modifying text retains existing filenames with 0 duplicates)
- Independent media replacement and clearing (replace image preserves audio, replace audio preserves image)
- AnkiConnect field mapping for standard and custom models with dual/partial media
- Media failure isolation and sync retry behavior
"""

import base64
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError
from app.services.card_service import CardService
from app.services.media_storage import MediaStorageService


# 1x1 Transparent JPEG / minimal valid JPEG Data URL
MOCK_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
    "wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
)
MOCK_JPEG_DATA_URL = f"data:image/jpeg;base64,{MOCK_JPEG_B64}"

# Minimal valid WAV Data URL
MINIMAL_WAV_BYTES = (
    b"RIFF\x2c\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x80\xbb\x00\x00\x00\x77\x01\x00\x02\x00\x10\x00data\x08\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00"
)
MINIMAL_WAV_B64 = base64.b64encode(MINIMAL_WAV_BYTES).decode("ascii")
MINIMAL_WAV_DATA_URL = f"data:audio/wav;base64,{MINIMAL_WAV_B64}"


class TestStage3CombinedMediaLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "media"
        self.db_path = Path(self.temp_dir.name) / "test_stage3.db"

        self.orig_media_env = os.environ.get("ANKIMINER_MEDIA_DIR")
        self.orig_db_env = os.environ.get("ANKIMINER_DB_PATH")

        os.environ["ANKIMINER_MEDIA_DIR"] = str(self.media_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)

        init_db(self.db_path)
        self.client = TestClient(app)
        self.repo = CardRepository(self.db_path)
        self.media_service = MediaStorageService(self.media_dir)
        self.anki_service = AnkiConnectService()
        self.card_service = CardService(
            card_repository=self.repo,
            anki_service=self.anki_service
        )

    def tearDown(self):
        if self.orig_media_env is not None:
            os.environ["ANKIMINER_MEDIA_DIR"] = self.orig_media_env
        else:
            os.environ.pop("ANKIMINER_MEDIA_DIR", None)

        if self.orig_db_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.orig_db_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)

        self.temp_dir.cleanup()

    def test_save_card_with_both_image_and_audio(self):
        """Saving a card with both image and audio creates exactly one image file and one audio file."""
        req = SaveCardRequest(
            expression="約束",
            reading="やくそく",
            meaning="promise",
            example_sentence="彼と約束をした。",
            image=MOCK_JPEG_DATA_URL,
            audio=MINIMAL_WAV_DATA_URL
        )

        card = self.card_service.save_card(req)
        self.assertIsNotNone(card.id)

        # Image assertions
        self.assertTrue(card.image.startswith("ankiminer_img_"))
        self.assertTrue(card.image.endswith(".jpg"))
        img_path = self.media_service.get_media_path(card.image)
        self.assertIsNotNone(img_path)
        self.assertTrue(img_path.is_file())

        # Audio assertions
        self.assertTrue(card.audio.startswith("ankiminer_audio_"))
        self.assertTrue(card.audio.endswith(".wav"))
        audio_path = self.media_service.get_media_path(card.audio)
        self.assertIsNotNone(audio_path)
        self.assertTrue(audio_path.is_file())

        # Exactly 1 image and 1 audio file on disk
        img_files = list(self.media_dir.glob("ankiminer_img_*.jpg"))
        audio_files = list(self.media_dir.glob("ankiminer_audio_*.wav"))
        self.assertEqual(len(img_files), 1)
        self.assertEqual(len(audio_files), 1)

        # Stored in SQLite
        db_card = self.repo.get_by_id(card.id)
        self.assertIsNotNone(db_card)
        self.assertEqual(db_card.image, card.image)
        self.assertEqual(db_card.audio, card.audio)

    def test_partial_media_and_text_only_workflows(self):
        """Image-only, audio-only, and text-only cards save cleanly without regressions."""
        # 1. Image only
        req_img = SaveCardRequest(
            expression="花火",
            reading="はなび",
            meaning="fireworks",
            image=MOCK_JPEG_DATA_URL
        )
        card_img = self.card_service.save_card(req_img)
        self.assertTrue(card_img.image.startswith("ankiminer_img_"))
        self.assertEqual(card_img.audio, "")

        # 2. Audio only
        req_aud = SaveCardRequest(
            expression="雷",
            reading="かみなり",
            meaning="thunder",
            audio=MINIMAL_WAV_DATA_URL
        )
        card_aud = self.card_service.save_card(req_aud)
        self.assertEqual(card_aud.image, "")
        self.assertTrue(card_aud.audio.startswith("ankiminer_audio_"))

        # 3. Text only
        req_txt = SaveCardRequest(
            expression="風",
            reading="かぜ",
            meaning="wind"
        )
        card_txt = self.card_service.save_card(req_txt)
        self.assertEqual(card_txt.image, "")
        self.assertEqual(card_txt.audio, "")

    def test_reopen_and_resave_dual_media_card_no_duplication(self):
        """Modifying text on a saved dual-media card re-saves without creating duplicate files."""
        req = SaveCardRequest(
            expression="桜",
            reading="さくら",
            meaning="cherry blossom",
            image=MOCK_JPEG_DATA_URL,
            audio=MINIMAL_WAV_DATA_URL
        )
        card = self.card_service.save_card(req)
        orig_img = card.image
        orig_audio = card.audio

        # Edit text only and re-save using filename
        req_edit = SaveCardRequest(
            id=card.id,
            expression="桜",
            reading="さくら",
            meaning="cherry blossom (updated meaning)",
            image=orig_img,
            audio=orig_audio
        )
        card_edited = self.card_service.save_card(req_edit)
        self.assertEqual(card_edited.id, card.id)
        self.assertEqual(card_edited.meaning, "cherry blossom (updated meaning)")
        self.assertEqual(card_edited.image, orig_img)
        self.assertEqual(card_edited.audio, orig_audio)

        # Verify disk counts remain exactly 1 image and 1 audio
        img_files = list(self.media_dir.glob("ankiminer_img_*.jpg"))
        audio_files = list(self.media_dir.glob("ankiminer_audio_*.wav"))
        self.assertEqual(len(img_files), 1)
        self.assertEqual(len(audio_files), 1)

        # Edit text only using full API URL format (as restored in frontend)
        req_edit_url = SaveCardRequest(
            id=card.id,
            expression="桜",
            reading="さくら",
            meaning="cherry blossom (second update)",
            image=f"http://127.0.0.1:21828/api/media/{orig_img}",
            audio=f"http://127.0.0.1:21828/api/media/{orig_audio}"
        )
        card_edited_url = self.card_service.save_card(req_edit_url)
        self.assertEqual(card_edited_url.id, card.id)
        self.assertEqual(card_edited_url.image, orig_img)
        self.assertEqual(card_edited_url.audio, orig_audio)
        self.assertEqual(len(list(self.media_dir.glob("ankiminer_img_*.jpg"))), 1)
        self.assertEqual(len(list(self.media_dir.glob("ankiminer_audio_*.wav"))), 1)

    def test_independent_media_replacement_and_clearing(self):
        """Replacing/clearing one media type leaves the other untouched."""
        req = SaveCardRequest(
            expression="月",
            reading="つき",
            meaning="moon",
            image=MOCK_JPEG_DATA_URL,
            audio=MINIMAL_WAV_DATA_URL
        )
        card = self.card_service.save_card(req)
        orig_img = card.image
        orig_audio = card.audio

        # 1. Replace image only -> new image generated, audio preserved
        req_rep_img = SaveCardRequest(
            id=card.id,
            expression="月",
            reading="つき",
            meaning="moon",
            image=MOCK_JPEG_DATA_URL,  # new base64 data
            audio=orig_audio  # retained filename
        )
        card_rep_img = self.card_service.save_card(req_rep_img)
        self.assertNotEqual(card_rep_img.image, orig_img)
        self.assertEqual(card_rep_img.audio, orig_audio)
        new_img = card_rep_img.image

        # 2. Replace audio only -> new audio generated, image preserved
        req_rep_aud = SaveCardRequest(
            id=card.id,
            expression="月",
            reading="つき",
            meaning="moon",
            image=new_img,  # retained filename
            audio=MINIMAL_WAV_DATA_URL  # new base64 data
        )
        card_rep_aud = self.card_service.save_card(req_rep_aud)
        self.assertEqual(card_rep_aud.image, new_img)
        self.assertNotEqual(card_rep_aud.audio, orig_audio)
        new_audio = card_rep_aud.audio

        # 3. Clear image -> image is "", audio preserved
        req_clr_img = SaveCardRequest(
            id=card.id,
            expression="月",
            reading="つき",
            meaning="moon",
            image="",
            audio=new_audio
        )
        card_clr_img = self.card_service.save_card(req_clr_img)
        self.assertEqual(card_clr_img.image, "")
        self.assertEqual(card_clr_img.audio, new_audio)

        # 4. Clear audio -> audio is "", image re-attached
        req_clr_aud = SaveCardRequest(
            id=card.id,
            expression="月",
            reading="つき",
            meaning="moon",
            image=new_img,
            audio=""
        )
        card_clr_aud = self.card_service.save_card(req_clr_aud)
        self.assertEqual(card_clr_aud.image, new_img)
        self.assertEqual(card_clr_aud.audio, "")

    def test_ankiconnect_dual_media_basic_model_mapping(self):
        """Standard Basic model mapping attaches formatted image tag and sound tag to Back."""
        card_data = {
            "expression": "約束",
            "reading": "やくそく",
            "meaning": "promise",
            "hint": "",
            "example_sentence": "約束を守る。",
            "example_translation": "Keep a promise.",
            "image": "ankiminer_img_test.jpg",
            "audio": "ankiminer_audio_test.wav",
            "tags": "test",
            "notes": "",
        }

        model_fields = ["Front", "Back"]
        fields = self.anki_service.map_card_to_fields(card_data, model_fields)

        self.assertIn("Back", fields)
        back_field = fields["Back"]
        self.assertIn("promise", back_field)
        self.assertIn('[sound:ankiminer_audio_test.wav]', back_field)
        self.assertIn('<img src="ankiminer_img_test.jpg" class="kn-image">', back_field)

    def test_ankiconnect_dual_media_custom_model_mapping(self):
        """Custom model maps image to Picture/Image and audio to SentenceAudio/Audio fields."""
        card_data = {
            "expression": "桜",
            "reading": "さくら",
            "meaning": "cherry blossom",
            "hint": "",
            "example_sentence": "桜が咲く。",
            "example_translation": "Cherry blossoms bloom.",
            "image": "ankiminer_img_sakura.jpg",
            "audio": "ankiminer_audio_sakura.wav",
            "tags": "japanese",
            "notes": "",
        }

        # 1. Custom model with both Picture and SentenceAudio
        model_fields_both = ["Expression", "Meaning", "Picture", "SentenceAudio"]
        fields_both = self.anki_service.map_card_to_fields(card_data, model_fields_both)
        self.assertEqual(fields_both.get("Picture"), '<img src="ankiminer_img_sakura.jpg">')
        self.assertEqual(fields_both.get("SentenceAudio"), '[sound:ankiminer_audio_sakura.wav]')

        # 2. Custom model with only Picture (no audio field)
        model_fields_img_only = ["Expression", "Meaning", "Picture"]
        fields_img_only = self.anki_service.map_card_to_fields(card_data, model_fields_img_only)
        self.assertEqual(fields_img_only.get("Picture"), '<img src="ankiminer_img_sakura.jpg">')
        self.assertNotIn("SentenceAudio", fields_img_only)

        # 3. Custom model with only Audio (no image field)
        model_fields_aud_only = ["Expression", "Meaning", "Audio"]
        fields_aud_only = self.anki_service.map_card_to_fields(card_data, model_fields_aud_only)
        self.assertEqual(fields_aud_only.get("Audio"), '[sound:ankiminer_audio_sakura.wav]')
        self.assertNotIn("Picture", fields_aud_only)

        # 4. Custom model with neither (text only)
        model_fields_text_only = ["Expression", "Meaning"]
        fields_text_only = self.anki_service.map_card_to_fields(card_data, model_fields_text_only)
        self.assertNotIn("Picture", fields_text_only)
        self.assertNotIn("Audio", fields_text_only)
        self.assertEqual(fields_text_only.get("Expression"), "桜")

    def test_sync_card_transfers_both_media_to_anki(self):
        """Syncing a dual-media card invokes storeMediaFile for both image and audio."""
        req = SaveCardRequest(
            expression="海",
            reading="うみ",
            meaning="sea",
            image=MOCK_JPEG_DATA_URL,
            audio=MINIMAL_WAV_DATA_URL
        )
        card = self.card_service.save_card(req)

        with patch.object(self.anki_service, "find_existing_note", return_value=None), \
             patch.object(self.anki_service, "get_model_names", return_value=["Basic"]), \
             patch.object(self.anki_service, "get_model_field_names", return_value=["Front", "Back"]), \
             patch.object(self.anki_service, "store_media_file", return_value="ok") as mock_store, \
             patch.object(self.anki_service, "add_note", return_value=123456) as mock_add_note:

            synced_card = self.card_service.sync_card(card.id)

            self.assertEqual(synced_card.sync_status, "synced")
            self.assertEqual(synced_card.anki_note_id, 123456)
            self.assertEqual(mock_store.call_count, 2)

            # Check that both image and audio files were sent to AnkiConnect
            stored_filenames = [call[1]["filename"] for call in mock_store.call_args_list]
            self.assertIn(card.image, stored_filenames)
            self.assertIn(card.audio, stored_filenames)

    def test_sync_retry_idempotency(self):
        """Failed sync can be retried and successfully syncs both media without side effects."""
        req = SaveCardRequest(
            expression="山",
            reading="やま",
            meaning="mountain",
            image=MOCK_JPEG_DATA_URL,
            audio=MINIMAL_WAV_DATA_URL
        )
        card = self.card_service.save_card(req)

        # 1. First sync fails
        with patch.object(self.anki_service, "find_existing_note", side_effect=AnkiConnectionError("AnkiConnect unreachable")):
            failed_res = self.card_service.sync_card(card.id)
            self.assertEqual(failed_res.sync_status, "failed")

        failed_card = self.repo.get_by_id(card.id)
        self.assertEqual(failed_card.sync_status, "failed")
        self.assertIsNotNone(failed_card.sync_error)
        self.assertTrue(failed_card.image.startswith("ankiminer_img_"))
        self.assertTrue(failed_card.audio.startswith("ankiminer_audio_"))

        # 2. Retry sync succeeds
        with patch.object(self.anki_service, "find_existing_note", return_value=None), \
             patch.object(self.anki_service, "get_model_names", return_value=["Basic"]), \
             patch.object(self.anki_service, "get_model_field_names", return_value=["Front", "Back"]), \
             patch.object(self.anki_service, "store_media_file", return_value="ok"), \
             patch.object(self.anki_service, "add_note", return_value=987654):

            retried_card = self.card_service.sync_card(card.id)
            self.assertEqual(retried_card.sync_status, "synced")
            self.assertEqual(retried_card.anki_note_id, 987654)
            self.assertIsNone(retried_card.error)


if __name__ == "__main__":
    unittest.main()
