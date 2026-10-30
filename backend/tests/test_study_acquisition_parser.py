"""
Unit and Integration Tests for JapaneseTest4You Parser and Media Downloader (Batch 2).
-------------------------------------------------------------------------------------
Tests:
- Deterministic parsing of Grammar Exercise 01 (10 questions, blanks, 4 choices, answer keys)
- Deterministic parsing of Reading Exercise 02 (multiple passages, group references, anchor keys)
- Asset URL preservation and AssetDownloader SSRF whitelist enforcement
- Answer key extraction and cross-verification
- Conversion to M3 structured ingestion payload
"""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import pytest

from app.study.acquisition.media.asset_downloader import (
    AssetDownloader,
    _validate_image_url,
)
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations


@pytest.fixture
def fixtures_dir():
    return Path(__file__).resolve().parent / "fixtures" / "study_acquisition"


@pytest.fixture
def grammar_fixture(fixtures_dir):
    return (fixtures_dir / "raw_keenable_exercise_1.md").read_text(encoding="utf-8")


@pytest.fixture
def reading_fixture(fixtures_dir):
    return (fixtures_dir / "raw_keenable_reading_2.md").read_text(encoding="utf-8")


# =============================================================================
# 1. Grammar Exercise Parsing Tests
# =============================================================================

def test_parse_grammar_exercise_1(grammar_fixture):
    """Verify parsing of Grammar Exercise 01 produces 10 pristine questions with answer claims."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/"
    exercise = parser.parse(grammar_fixture, url=url)

    assert exercise.title == "JLPT N4 – Grammar Exercise 01"
    assert exercise.jlpt_level == "N4"
    assert exercise.section == "grammar"
    assert len(exercise.passages) == 0
    assert len(exercise.questions) == 10
    assert len(exercise.answer_claims) == 10

    # Inspect Question 1
    q1 = exercise.questions[0]
    assert q1.question_number == 1
    assert q1.external_id == "Q1"
    assert q1.stem == "あの人は病気ではない {blank} くすりをたくさん飲んでいます。"
    assert len(q1.choices) == 4
    assert [c.text for c in q1.choices] == ["ので", "ために", "のに", "から"]
    assert q1.answer is not None
    assert q1.answer.claimed_ordinal == 3
    assert q1.answer.rationale == "あの人は病気ではないのにくすりをたくさん飲んでいます。"
    assert not q1.answer.is_conflicted

    # Inspect Question 10
    q10 = exercise.questions[9]
    assert q10.question_number == 10
    assert q10.stem == "明日の夕方 {blank} 東京に戻りたい。アルバイトに行かなければならないから。"
    assert len(q10.choices) == 4
    assert [c.text for c in q10.choices] == ["までで", "まで", "までに", "にまで"]
    assert q10.answer is not None
    assert q10.answer.claimed_ordinal == 3

    # Verify deterministic output on second pass
    exercise_2 = parser.parse(grammar_fixture, url=url)
    assert exercise.model_dump() == exercise_2.model_dump()


# =============================================================================
# 2. Reading Exercise with Passages and Images Tests
# =============================================================================

def test_parse_reading_exercise_2(reading_fixture):
    """Verify parsing of Reading Exercise 02 extracts 2 passages, diagram images, and 7 questions."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/"
    exercise = parser.parse(reading_fixture, url=url)

    assert exercise.jlpt_level == "N4"
    assert exercise.section == "reading"
    assert len(exercise.passages) == 2
    assert len(exercise.questions) == 7
    assert len(exercise.answer_claims) == 7

    # Verify Passage 1
    p1 = exercise.passages[0]
    assert p1.passage_id == "passage_1"
    assert p1.title == "Reading passage 1"
    assert "川田(かわだ)さん" in p1.text
    assert p1.image_urls == ["https://japanesetest4you.com/image/jlpt-n4-reading-2-01.gif"]

    # Verify Questions for Passage 1 (Q1 to Q4)
    for q_idx in range(4):
        q = exercise.questions[q_idx]
        assert q.group_reference == "passage_1"

    q1 = exercise.questions[0]
    assert q1.question_number == 1
    assert q1.anchor_key == "1"
    assert [c.text for c in q1.choices] == [
        "おなかがいたいんです",
        "おなかがいたいでしょう",
        "おなかがいたいんですから",
        "おなかがいたくなりますか",
    ]
    assert q1.answer.claimed_ordinal == 1
    assert "おなかがいたいんです" in q1.answer.rationale

    # Verify Passage 2
    p2 = exercise.passages[1]
    assert p2.passage_id == "passage_2"
    assert "かいぎ室を利用する人へ" in p2.text
    assert p2.image_urls == ["https://japanesetest4you.com/image/jlpt-n4-reading-2-02.gif"]

    # Verify Questions for Passage 2 (Q5 to Q7)
    for q_idx in range(4, 7):
        q = exercise.questions[q_idx]
        assert q.group_reference == "passage_2"

    q5 = exercise.questions[4]
    assert q5.question_number == 5
    assert [c.text for c in q5.choices] == ["三つ", "四つ", "五つ", "六つ"]
    assert q5.answer.claimed_ordinal == 3


# =============================================================================
# 3. M3 Structured Payload Conversion Tests
# =============================================================================

def test_m3_structured_payload_conversion(reading_fixture):
    """Verify conversion of ParsedExercise to M3 IngestInput dictionary."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/"
    exercise = parser.parse(reading_fixture, url=url)

    m3_payload = exercise.to_m3_structured_payload()

    assert "source" in m3_payload
    assert m3_payload["source"]["name"] == "JapaneseTest4You"
    assert m3_payload["source"]["level"] == "N4"

    assert "groups" in m3_payload
    assert len(m3_payload["groups"]) == 2
    assert m3_payload["groups"][0]["id"] == "passage_1"
    assert len(m3_payload["groups"][0]["attached_assets"]) == 1

    assert "questions" in m3_payload
    assert len(m3_payload["questions"]) == 7
    q1 = m3_payload["questions"][0]
    assert q1["format_code"] == "N4_READING_CHOICE"
    assert q1["group_reference"] == "passage_1"
    assert q1["anchor_key"] == "1"
    assert q1["answer"]["ordinal"] == 1


# =============================================================================
# 4. Media Asset Downloader & Security Tests
# =============================================================================

def test_asset_url_validation_and_ssrf_protection():
    """Verify URL validation allows whitelisted hosts and rejects SSRF targets."""
    # Permitted
    assert _validate_image_url("https://japanesetest4you.com/image/diagram.gif")
    assert _validate_image_url("https://www.japanesetest4you.com/image/diagram.gif")

    # Rejected non-whitelisted hosts
    with pytest.raises(PermissionError, match="not in the acquisition image whitelist"):
        _validate_image_url("https://malicious-site.com/image.gif")

    # Rejected schemes
    with pytest.raises(ValueError, match="Invalid image URL"):
        _validate_image_url("ftp://japanesetest4you.com/image.gif")


def test_asset_downloader_with_mock_client():
    """Verify AssetDownloader writes binary to MediaStore and computes SHA-256."""
    with tempfile.TemporaryDirectory() as tmpdir:
        media_store = MediaStore(media_dir=Path(tmpdir))

        class MockHttpResponse:
            status_code = 200
            content = b"GIF89a_test_image_bytes"
            headers = {"content-type": "image/gif"}
            def raise_for_status(self): pass

        class MockHttpClient:
            def get(self, url, **kwargs):
                return MockHttpResponse()

        downloader = AssetDownloader(media_store=media_store, client=MockHttpClient())
        img_url = "https://japanesetest4you.com/image/jlpt-n4-reading-2-01.gif"

        result = downloader.download_asset(img_url)

        assert "asset_id" in result
        assert result["mime_type"] == "image/gif"
        expected_path = media_store.media_dir / result["relative_path"]
        assert expected_path.is_file()
        assert expected_path.read_bytes() == b"GIF89a_test_image_bytes"

