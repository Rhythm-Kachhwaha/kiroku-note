import os
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.api.study.auth import set_study_api_token
from app.db.connection import init_db
from app.main import app
from app.study.connection import reset_study_db_manager
from app.services.vocab_practice import (
    PracticeChoice,
    PracticeQuestion,
    VocabPracticeService,
    WordTarget,
    record_practice_result,
)


class VocabMistakesBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_mistakes_bridge.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)

        # Setup study auth token
        self.token = "test_study_token_123"
        os.environ["KIROKU_STUDY_API_TOKEN"] = self.token
        set_study_api_token(self.token)
        reset_study_db_manager()

        self.client = TestClient(app, headers={"Authorization": f"Bearer {self.token}"})

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_graded_incorrect_answer_appears_in_incorrect_history(self):
        # Grade an incorrect answer via VocabPracticeService with persist=True
        target = WordTarget(
            sequence_id=1001,
            expression="犬",
            reading="いぬ",
            glosses=("dog",),
            categories=("noun",),
        )
        question = PracticeQuestion(
            question_id="test_q_in_bridge_1",
            question_type="typed_recall",
            prompt="Translate to Japanese reading: dog",
            target=target,
            expected_reading="いぬ",
            expected_answers=("いぬ",),
            expected_sequence_id=1001,
        )

        service = VocabPracticeService(db_path=self.db_path)
        result = service.grade(question, "ねこ", persist=True, response_time_ms=1200)
        self.assertFalse(result.is_correct)

        # Check /api/study/v1/history/incorrect
        resp = self.client.get("/api/study/v1/history/incorrect")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(data["total"], 1)
        found = [item for item in data["items"] if "犬" in item.get("prompt_markup", "")]
        self.assertTrue(len(found) > 0)
        item = found[0]
        self.assertEqual(item["your_answer"], "ねこ")
        self.assertEqual(item["correct_answer"], "いぬ")
