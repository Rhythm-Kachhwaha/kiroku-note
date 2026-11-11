"""Phase 5 tests for anti-grind burst study modes (Sentence Scramble, Audio Shadowing, Consistency, API)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.db.connection import db_session, ensure_study_modes_tables, init_db
from app.main import app
from app.repositories.card_repository import CardDraft, CardRepository
from app.services.study_modes import (
    StudyModesService,
    build_scramble_item,
    build_shadowing_item,
    chunk_sentence,
    deterministic_shuffle_indices,
    grade_scramble_answer,
    resolve_card_audio_url,
    select_scramble_candidates,
)


class StudyModesEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_study_modes.db"
        self.original_env = os.environ.get("ANKIMINER_DB_PATH")
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        init_db(self.db_path)
        self.repo = CardRepository(self.db_path)

    def tearDown(self):
        if self.original_env is not None:
            os.environ["ANKIMINER_DB_PATH"] = self.original_env
        else:
            os.environ.pop("ANKIMINER_DB_PATH", None)
        self.temp_dir.cleanup()

    def test_scramble_chunks_sentence_with_key_particles_into_3_to_6_blocks(self):
        blocks = chunk_sentence("私は毎日日本語を勉強しています。")
        self.assertGreaterEqual(len(blocks), 3)
        self.assertLessEqual(len(blocks), 6)

        surfaces = [b["surface"] for b in blocks]
        self.assertIn("は", surfaces)
        self.assertIn("を", surfaces)
        wa_block = next(b for b in blocks if b["surface"] == "は")
        wo_block = next(b for b in blocks if b["surface"] == "を")
        self.assertEqual(wa_block["role"], "particle")
        self.assertIn("topic", wa_block["hint"])
        self.assertEqual(wo_block["role"], "particle")
        self.assertIn("object", wo_block["hint"])

    def test_scramble_coalesces_long_sentence_to_max_6_blocks(self):
        blocks = chunk_sentence("昨日の夜に友達と駅前の新しいレストランで晩ご飯を食べました。")
        self.assertGreaterEqual(len(blocks), 3)
        self.assertLessEqual(len(blocks), 6)
        self.assertEqual("".join(b["surface"] for b in blocks), "昨日の夜に友達と駅前の新しいレストランで晩ご飯を食べました")

    def test_scramble_deterministic_shuffle_never_equals_canonical_order(self):
        for length in (2, 3, 4, 5, 6):
            idx_a = deterministic_shuffle_indices(length, f"sentence-{length}")
            idx_b = deterministic_shuffle_indices(length, f"sentence-{length}")
            self.assertEqual(idx_a, idx_b)
            self.assertNotEqual(idx_a, list(range(length)))
            self.assertEqual(sorted(idx_a), list(range(length)))

    def test_scramble_build_and_grade_returns_per_tile_diff_and_gloss(self):
        item = build_scramble_item(
            "猫が魚を食べる。",
            english_gloss="The cat eats fish.",
            source_card_id=12,
        )
        self.assertNotEqual(item["shuffled_indices"], list(range(item["tile_count"])))

        ok_grade = grade_scramble_answer(item, item["expected_order"])
        self.assertTrue(ok_grade["is_correct"])
        self.assertEqual(ok_grade["english_gloss"], "The cat eats fish.")
        self.assertTrue(all(f["is_match"] for f in ok_grade["tile_feedback"]))

        wrong_order = list(reversed(item["expected_order"]))
        bad_grade = grade_scramble_answer(item, wrong_order)
        self.assertFalse(bad_grade["is_correct"])
        self.assertFalse(all(f["is_match"] for f in bad_grade["tile_feedback"]))

    def test_anti_grind_burst_size_validation(self):
        self.repo.save(
            CardDraft(
                expression="勉強",
                reading="べんきょう",
                meaning="study",
                example_sentence="私は日本語を勉強します。",
                example_translation="I study Japanese.",
            )
        )
        svc = StudyModesService(db_path=self.db_path)

        for invalid_size in (0, 1, 3, 15, 25, 300, True):
            with self.assertRaises(ValueError):
                svc.start_session("sentence_scramble", target_count=invalid_size)

        sess_5 = svc.start_session("sentence_scramble", target_count=5)
        self.assertEqual(sess_5["target_count"], 5)
        self.assertEqual(sess_5["status"], "active")

        sess_10 = svc.start_session("sentence_scramble", target_count=10)
        self.assertEqual(sess_10["target_count"], 10)

    def test_empty_database_returns_clean_empty_state_without_mock_items(self):
        svc = StudyModesService(db_path=self.db_path)
        scramble = svc.start_session("sentence_scramble", target_count=5)
        shadowing = svc.start_session("audio_shadowing", target_count=5)

        self.assertEqual(scramble["status"], "empty")
        self.assertEqual(scramble["items"], [])
        self.assertIsNone(scramble["session_id"])

        self.assertEqual(shadowing["status"], "empty")
        self.assertEqual(shadowing["items"], [])
        self.assertIsNone(shadowing["session_id"])

    def test_audio_shadowing_prefers_audio_cards_conceals_then_reveals_and_grades(self):
        self.repo.save(
            CardDraft(
                expression="本",
                reading="ほん",
                meaning="book",
                example_sentence="毎日図書館で本を読みます。",
                example_translation="I read books at the library every day.",
                audio="",
            )
        )
        self.repo.save(
            CardDraft(
                expression="天気",
                reading="てんき",
                meaning="weather",
                example_sentence="今日はとてもいい天気ですね。",
                example_translation="The weather is very nice today, isn't it?",
                audio="ankiminer_audio_20260914_1234abcd.wav",
            )
        )

        mock_kanji = MagicMock()
        mock_kanji.get_batch.return_value = {
            "今": {"character": "今", "meanings": ["now"], "onyomi": ["コン"], "kunyomi": ["いま"], "level": "N5", "strokes": 4},
            "日": {"character": "日", "meanings": ["day", "sun"], "onyomi": ["ニチ"], "kunyomi": ["ひ"], "level": "N5", "strokes": 4},
            "天": {"character": "天", "meanings": ["heaven"], "onyomi": ["テン"], "kunyomi": ["あまつ"], "level": "N5", "strokes": 4},
            "気": {"character": "気", "meanings": ["spirit"], "onyomi": ["キ"], "kunyomi": [], "level": "N5", "strokes": 6},
        }
        svc = StudyModesService(db_path=self.db_path, kanji_service=mock_kanji)
        sess = svc.start_session("audio_shadowing", target_count=5)

        self.assertEqual(len(sess["items"]), 2)
        first = sess["items"][0]
        # Audio-backed card must be prioritized first
        self.assertTrue(first["audio_available"])
        self.assertEqual(first["audio_url"], "/api/media/ankiminer_audio_20260914_1234abcd.wav")
        # Transcript, reading, gloss, kanji breakdown must be concealed initially
        self.assertFalse(first["revealed"])
        self.assertIsNone(first["transcript"])
        self.assertIsNone(first["reading"])
        self.assertIsNone(first["english_gloss"])
        self.assertEqual(first["kanji_breakdown"], [])

        revealed = svc.reveal_item(sess["session_id"], 0)
        self.assertTrue(revealed["revealed"])
        self.assertEqual(revealed["transcript"], "今日はとてもいい天気ですね。")
        self.assertEqual(revealed["reading"], "てんき")
        self.assertEqual(revealed["english_gloss"], "The weather is very nice today, isn't it?")
        self.assertEqual([k["character"] for k in revealed["kanji_breakdown"]], ["今", "日", "天", "気"])

        with self.assertRaises(ValueError):
            svc.submit_answer(sess["session_id"], 0, "maybe")

        grade_1 = svc.submit_answer(sess["session_id"], 0, "got_it")
        self.assertTrue(grade_1["is_correct"])
        self.assertEqual(grade_1["correct_count"], 1)

        grade_2 = svc.submit_answer(sess["session_id"], 1, "missed")
        self.assertFalse(grade_2["is_correct"])
        self.assertEqual(grade_2["correct_count"], 1)

        summary = svc.complete_session(sess["session_id"])
        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["correct_count"], 1)
        self.assertEqual(summary["total_count"], 2)
        self.assertEqual(summary["accuracy_percent"], 50)

    def test_rolling_7_day_consistency_has_no_punitive_streak_reset(self):
        svc = StudyModesService(db_path=self.db_path)
        ref = date(2026, 11, 11)

        with db_session(self.db_path) as conn:
            ensure_study_modes_tables(conn)
            # Active on day-5, skipped day-4/day-3/day-2, active on day-1 and today; plus 1 stale day-9 session
            sample_days = [
                (ref - timedelta(days=9), 5),  # outside 7-day window
                (ref - timedelta(days=5), 5),  # inside window
                (ref - timedelta(days=1), 10), # inside window
                (ref, 5),                      # today
                (ref, 5),                      # second burst today
            ]
            for d, count in sample_days:
                ts = datetime(d.year, d.month, d.day, 12, 0, tzinfo=timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO study_burst_sessions (
                        mode, target_count, status, correct_count, total_count, items_json, created_at, completed_at
                    ) VALUES ('sentence_scramble', ?, 'completed', ?, ?, '[]', ?, ?)
                    """,
                    (count, count, count, ts, ts),
                )
            conn.commit()

        consistency = svc.get_weekly_consistency(reference_date=ref)
        self.assertEqual(len(consistency["days"]), 7)
        self.assertEqual(consistency["active_days"], 3)
        self.assertEqual(consistency["total_bursts_7d"], 4)
        self.assertEqual(consistency["total_items_7d"], 25)
        self.assertEqual(consistency["days"][-1]["date"], "2026-11-11")
        self.assertEqual(consistency["days"][-1]["sessions_completed"], 2)
        self.assertEqual(consistency["days"][-1]["items_reviewed"], 10)

    def test_api_routes_end_to_end_and_422_on_invalid_burst_size(self):
        self.repo.save(
            CardDraft(
                expression="映画",
                reading="えいが",
                meaning="movie",
                example_sentence="週末に友達と映画を見ました。",
                example_translation="I watched a movie with my friend on the weekend.",
                audio="ankiminer_audio_20261111_demo.webm",
            )
        )
        client = TestClient(app)

        # Reject invalid burst sizes (e.g. 15 or 300)
        bad_resp = client.post("/api/study-modes/sessions", json={"mode": "sentence_scramble", "target_count": 300})
        self.assertEqual(bad_resp.status_code, 422)
        bad_resp_15 = client.post("/api/study-modes/sessions", json={"mode": "audio_shadowing", "target_count": 15})
        self.assertEqual(bad_resp_15.status_code, 422)

        # Start 5-item sentence scramble burst
        start_resp = client.post("/api/study-modes/sessions", json={"mode": "sentence_scramble", "target_count": 5})
        self.assertEqual(start_resp.status_code, 200)
        data = start_resp.json()
        session_id = data["session_id"]
        self.assertIsNotNone(session_id)
        self.assertEqual(data["mode"], "sentence_scramble")
        self.assertEqual(len(data["items"]), 1)

        # Fetch session
        get_resp = client.get(f"/api/study-modes/sessions/{session_id}")
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()["session_id"], session_id)

        # Missing session returns 404
        missing_resp = client.get("/api/study-modes/sessions/999999")
        self.assertEqual(missing_resp.status_code, 404)

        # Submit canonical order derived from blocks via tile count
        tile_count = data["items"][0]["tile_count"]
        canonical_ids = [f"tile_{i}" for i in range(tile_count)]
        ans_resp = client.post(
            f"/api/study-modes/sessions/{session_id}/answer",
            json={"item_index": 0, "user_answer": canonical_ids},
        )
        self.assertEqual(ans_resp.status_code, 200)
        self.assertTrue(ans_resp.json()["is_correct"])

        # Complete session & verify consistency endpoint reflects it
        comp_resp = client.post(f"/api/study-modes/sessions/{session_id}/complete")
        self.assertEqual(comp_resp.status_code, 200)
        comp_data = comp_resp.json()
        self.assertEqual(comp_data["status"], "completed")
        self.assertEqual(comp_data["accuracy_percent"], 100)
        self.assertGreaterEqual(comp_data["consistency"]["total_bursts_7d"], 1)

        cons_resp = client.get("/api/study-modes/consistency")
        self.assertEqual(cons_resp.status_code, 200)
        self.assertGreaterEqual(cons_resp.json()["active_days"], 1)

    def test_api_shadowing_reveal_and_kiroku_db_table_isolation(self):
        self.repo.save(
            CardDraft(
                expression="図書館",
                reading="としょかん",
                meaning="library",
                example_sentence="毎日図書館で本を読みます。",
                example_translation="I read books at the library every day.",
                audio="ankiminer_audio_20261111_lib.webm",
            )
        )
        client = TestClient(app)

        start_resp = client.post("/api/study-modes/sessions", json={"mode": "audio_shadowing", "target_count": 5})
        self.assertEqual(start_resp.status_code, 200)
        data = start_resp.json()
        session_id = data["session_id"]
        self.assertEqual(data["mode"], "audio_shadowing")
        self.assertEqual(len(data["items"]), 1)
        item = data["items"][0]
        self.assertFalse(item["revealed"])
        self.assertEqual(item["audio_url"], "/api/media/ankiminer_audio_20261111_lib.webm")
        self.assertIsNone(item["transcript"])
        self.assertIsNone(item["english_gloss"])
        self.assertEqual(item["kanji_breakdown"], [])

        # Reveal endpoint returns transcript, gloss, and kanji breakdown
        reveal_resp = client.post(f"/api/study-modes/sessions/{session_id}/reveal", json={"item_index": 0})
        self.assertEqual(reveal_resp.status_code, 200)
        revealed = reveal_resp.json()
        self.assertTrue(revealed["revealed"])
        self.assertEqual(revealed["transcript"], "毎日図書館で本を読みます。")
        self.assertEqual(revealed["english_gloss"], "I read books at the library every day.")
        self.assertIsInstance(revealed["kanji_breakdown"], list)

        # Submit self-grade & complete
        ans_resp = client.post(
            f"/api/study-modes/sessions/{session_id}/answer",
            json={"item_index": 0, "user_answer": "got_it"},
        )
        self.assertEqual(ans_resp.status_code, 200)
        self.assertTrue(ans_resp.json()["is_correct"])

        comp_resp = client.post(f"/api/study-modes/sessions/{session_id}/complete")
        self.assertEqual(comp_resp.status_code, 200)
        self.assertEqual(comp_resp.json()["correct_count"], 1)

        # Verify tables exist inside kiroku.db (ANKIMINER_DB_PATH)
        with db_session(self.db_path) as conn:
            tables = {
                row["name"]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            }
        self.assertIn("study_burst_sessions", tables)
        self.assertIn("study_burst_attempts", tables)

    def test_scramble_short_sentences_particles_and_invalid_duplicate_missing_indices(self):
        # 1-token sentence cannot be scrambled
        with self.assertRaises(ValueError):
            build_scramble_item("猫")

        # Particle preservation for に/で and は/が
        blocks = chunk_sentence("公園で友達に会いました。")
        surfaces = [b["surface"] for b in blocks]
        self.assertIn("で", surfaces)
        self.assertIn("に", surfaces)

        # Invalid, empty, duplicate, and missing tile submissions
        item = build_scramble_item("猫が魚を食べる。", english_gloss="The cat eats fish.")
        with self.assertRaises(ValueError):
            grade_scramble_answer(item, [])
        with self.assertRaises(ValueError):
            grade_scramble_answer(item, "   ")
        with self.assertRaises(ValueError):
            grade_scramble_answer(item, None)

        missing_res = grade_scramble_answer(item, item["expected_order"][:-1])
        self.assertFalse(missing_res["is_correct"])

        invalid_idx_res = grade_scramble_answer(item, [99, 1, 2, 3, 4][: len(item["blocks"])])
        self.assertFalse(invalid_idx_res["is_correct"])

        neg_idx_res = grade_scramble_answer(item, [-1, *range(1, len(item["blocks"]))])
        self.assertFalse(neg_idx_res["is_correct"])

        dup_id_res = grade_scramble_answer(
            item,
            [item["expected_order"][0], item["expected_order"][0], *item["expected_order"][2:]],
        )
        self.assertFalse(dup_id_res["is_correct"])

        # Duplicate tile ID must fail even when two blocks share the same surface (e.g., two に)
        dup_surface_item = {
            "blocks": [
                {"tile_id": "tile_0", "canonical_index": 0, "surface": "朝に", "reading": "あさに", "role": "noun", "hint": "noun"},
                {"tile_id": "tile_1", "canonical_index": 1, "surface": "に", "reading": "に", "role": "particle", "hint": "target"},
                {"tile_id": "tile_2", "canonical_index": 2, "surface": "家", "reading": "いえ", "role": "noun", "hint": "noun"},
                {"tile_id": "tile_3", "canonical_index": 3, "surface": "に", "reading": "に", "role": "particle", "hint": "target"},
                {"tile_id": "tile_4", "canonical_index": 4, "surface": "帰る", "reading": "かえる", "role": "verb", "hint": "verb"},
            ],
            "expected_order": ["tile_0", "tile_1", "tile_2", "tile_3", "tile_4"],
            "canonical_sentence": "朝にに家に帰る",
            "english_gloss": "",
        }
        dup_same_surface = grade_scramble_answer(
            dup_surface_item,
            ["tile_0", "tile_1", "tile_2", "tile_1", "tile_4"],
        )
        self.assertFalse(dup_same_surface["is_correct"])

    def test_shadowing_audio_url_resolution_and_fewer_than_target_count(self):
        self.assertEqual(resolve_card_audio_url("[sound:clip_01.mp3]"), "/api/media/clip_01.mp3")
        self.assertEqual(resolve_card_audio_url("https://example.com/audio.mp3"), "https://example.com/audio.mp3")
        self.assertIsNone(resolve_card_audio_url("../secret.wav"))
        self.assertIsNone(resolve_card_audio_url("/api/media/../secret.wav"))
        self.assertIsNone(resolve_card_audio_url(""))

        item_from_audio_path = build_shadowing_item(
            {
                "id": 7,
                "expression": "本",
                "reading": "ほん",
                "meaning": "book",
                "example_sentence": "本を読みます。",
                "audio_path": "book_read.wav",
            }
        )
        self.assertTrue(item_from_audio_path["audio_available"])
        self.assertEqual(item_from_audio_path["audio_url"], "/api/media/book_read.wav")

        # Fewer than target_count available cards should not invent mock cards
        self.repo.save(
            CardDraft(
                expression="猫",
                reading="ねこ",
                meaning="cat",
                example_sentence="猫が魚を食べる。",
                example_translation="The cat eats fish.",
            )
        )
        svc = StudyModesService(db_path=self.db_path)
        sess = svc.start_session("sentence_scramble", target_count=10)
        self.assertEqual(sess["target_count"], 10)
        self.assertEqual(sess["total_count"], 1)
        self.assertEqual(len(sess["items"]), 1)

        with self.assertRaises(ValueError):
            svc.start_session("unknown_mode", target_count=5)
        with self.assertRaises(ValueError):
            svc.start_session("sentence_scramble", target_count=0)
        with self.assertRaises(ValueError):
            svc.start_session("sentence_scramble", target_count=3)


if __name__ == "__main__":
    unittest.main()
