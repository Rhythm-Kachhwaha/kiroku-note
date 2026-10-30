"""
Unit and Integration Tests for Milestone 4.1: Parser Robustness and Format Coverage.
------------------------------------------------------------------------------------
Tests all JLPT question formats discovered across JapaneseTest4You:
- Listening with diagram images and unprinted choices (F5 task_based_listening)
- Listening with textual choices (F5 key_points_listening)
- Listening with shared passage audio tracks (F6 integrated_listening)
- Sentence composition with star arrangement (F2 sentence_composition)
- Kanji reading with context sentence attachment (F1 kanji_reading)
- Orthography word-to-kanji conversion (F1 orthography)
- Audio retrieval and MediaStore content addressing without DB writes
- Audio binary signature validation (ID3 / MPEG sync frames)
- URL filtering & classification for all 5 categories + reference/eBook rejection
- Deterministic format classification and ambiguity warnings
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import pytest
import httpx

from app.study.acquisition.crawler.url_filter import (
    extract_level_and_section,
    is_exercise_url,
)
from app.study.acquisition.media.asset_downloader import (
    AssetDownloader,
    is_valid_audio_bytes,
)
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.models import AudioAssociation, StarArrangementMetadata
from app.study.media import MediaStore


@pytest.fixture
def fixtures_dir():
    return Path(__file__).resolve().parent / "fixtures" / "study_acquisition"


@pytest.fixture
def listening_diagram_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_listening_diagram.html").read_text(encoding="utf-8")


@pytest.fixture
def listening_text_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_listening_text.html").read_text(encoding="utf-8")


@pytest.fixture
def shared_audio_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_shared_audio.html").read_text(encoding="utf-8")


@pytest.fixture
def star_grammar_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_star_grammar.md").read_text(encoding="utf-8")


@pytest.fixture
def kanji_context_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_kanji_context.md").read_text(encoding="utf-8")


@pytest.fixture
def orthography_fixture(fixtures_dir):
    return (fixtures_dir / "synthetic_orthography.md").read_text(encoding="utf-8")


# =============================================================================
# 1. Listening Tests: Audio Tracks, Diagrams, Unprinted Choices
# =============================================================================

def test_parse_listening_with_diagram_and_unprinted_choices(listening_diagram_fixture):
    """Verify parsing listening exercise with question audio, diagram images, and unprinted numeric choices."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-listening-exercise-1/"
    exercise = parser.parse(listening_diagram_fixture, url=url)

    assert exercise.jlpt_level == "N5"
    assert exercise.section == "listening"
    assert len(exercise.questions) == 2
    assert len(exercise.audio_tracks) == 2

    # Question 1: Audio + Diagram + 1..4 numeric choices
    q1 = exercise.questions[0]
    assert q1.question_number == 1
    assert q1.audio is not None
    assert q1.audio.scope == "question"
    assert q1.audio.target_id == "Q1"
    assert q1.audio.track_url == "https://japanesetest4you.com/choukai/0002/n5_1_1.mp3"
    assert q1.image_urls == ["https://japanesetest4you.com/image/2007_04_listen_quiz1.jpg"]
    assert len(q1.choices) == 4
    assert [c.text for c in q1.choices] == ["1", "2", "3", "4"]
    assert q1.format_code == "task_based_listening"
    assert q1.answer is not None
    assert q1.answer.claimed_ordinal == 2

    # Question 2: Independent audio track
    q2 = exercise.questions[1]
    assert q2.question_number == 2
    assert q2.audio is not None
    assert q2.audio.track_url == "https://japanesetest4you.com/choukai/0002/n5_1_2.mp3"
    assert q2.answer.claimed_ordinal == 1

    # Verify M3 payload formatting
    m3_payload = exercise.to_m3_structured_payload()
    assert len(m3_payload["questions"]) == 2
    assert len(m3_payload["questions"][0]["attached_assets"]) == 2
    asset_kinds = [a["kind"] for a in m3_payload["questions"][0]["attached_assets"]]
    assert "audio" in asset_kinds
    assert "diagram" in asset_kinds


def test_parse_listening_with_textual_choices(listening_text_fixture):
    """Verify parsing listening exercise with Japanese text radio choices."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n1-listening-exercise-1/"
    exercise = parser.parse(listening_text_fixture, url=url)

    assert exercise.jlpt_level == "N1"
    assert exercise.section == "listening"
    assert len(exercise.questions) == 2

    q1 = exercise.questions[0]
    assert len(q1.choices) == 4
    assert q1.choices[0].text == "水の量を増やす"
    assert q1.choices[1].text == "水の量を減らす"
    assert q1.format_code == "key_points_listening"
    assert q1.answer.claimed_ordinal == 2

    q2 = exercise.questions[1]
    assert q2.choices[0].text == "ゴミ袋を買う"
    assert q2.format_code == "key_points_listening"
    assert q2.answer.claimed_ordinal == 3


def test_parse_shared_audio_in_passage(shared_audio_fixture):
    """Verify parsing passage-level shared audio track associated with multi-question context."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n1-listening-exercise-shared/"
    exercise = parser.parse(shared_audio_fixture, url=url)

    assert len(exercise.passages) == 1
    p = exercise.passages[0]
    assert p.audio is not None
    assert p.audio.scope == "passage"
    assert p.audio.track_url == "https://japanesetest4you.com/choukai/0008/n1_shared.mp3"

    assert len(exercise.questions) == 2
    for q in exercise.questions:
        assert q.group_reference == p.passage_id


# =============================================================================
# 2. Grammar: Star Sentence Arrangement (F2 family)
# =============================================================================

def test_parse_star_sentence_ordering(star_grammar_fixture):
    """Verify parsing JLPT F2 star arrangement questions with blanks, star position, and rationale derivation."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n2-grammar-exercise-5/"
    exercise = parser.parse(star_grammar_fixture, url=url)

    assert exercise.jlpt_level == "N2"
    assert exercise.section == "grammar"
    assert len(exercise.questions) == 2

    # Question 1: 山田「田中さん、＿＿＿ ＿＿＿ ★ ＿＿＿ んですか。」
    q1 = exercise.questions[0]
    assert q1.star_arrangement is not None
    assert q1.star_arrangement.star_position == 3
    assert q1.star_arrangement.total_blanks == 4
    assert q1.star_arrangement.pre_stem == "山田「田中さん、"
    assert q1.star_arrangement.post_stem == "んですか。」"
    assert q1.star_arrangement.derived_order == [3, 1, 2, 4]  # これから(3) どこへ(1) 行く(2) つもりな(4)
    assert q1.star_arrangement.star_fragment == "行く"       # Choice 2 is at star position 3
    assert q1.format_code == "sentence_composition"
    assert q1.answer.claimed_ordinal == 2
    assert not q1.answer.is_conflicted

    # Question 2: どんなに難しくても、＿＿＿ ＿＿＿ ★ ＿＿＿ 努力する価値がある。
    q2 = exercise.questions[1]
    assert q2.star_arrangement is not None
    assert q2.star_arrangement.star_position == 3
    assert q2.star_arrangement.derived_order == [3, 2, 1, 4]  # この夢を(3) 最後まで(2) あきらめずに(1) 追い続ける(4)
    assert q2.star_arrangement.star_fragment == "あきらめずに"
    assert q2.format_code == "sentence_composition"
    assert q2.answer.claimed_ordinal == 1


# =============================================================================
# 3. Kanji: Reading and Orthography Tests
# =============================================================================

def test_parse_kanji_reading_context_attachment(kanji_context_fixture):
    """Verify parsing Kanji exercises with a context sentence shared across multiple subquestions."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-kanji-exercise-1/"
    exercise = parser.parse(kanji_context_fixture, url=url)

    assert exercise.jlpt_level == "N5"
    assert exercise.section == "kanji"
    assert len(exercise.questions) == 4

    # Context sentence attached to stems
    context_expected = "しけんは 来月 の 七月 八日、木よう日、九時 からです。"
    q1 = exercise.questions[0]
    assert context_expected in q1.stem
    assert "来月" in q1.stem
    assert q1.format_code == "kanji_reading"
    assert q1.answer.claimed_ordinal == 4
    assert not q1.answer.is_conflicted

    q4 = exercise.questions[3]
    assert context_expected in q4.stem
    assert "九時" in q4.stem
    assert q4.answer.claimed_ordinal == 3
    assert not q4.answer.is_conflicted


def test_parse_orthography_word_to_kanji(orthography_fixture):
    """Verify parsing orthography questions (word-to-kanji conversion)."""
    parser = JapaneseTest4YouParser()
    url = "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n1-kanji-exercise-2/"
    exercise = parser.parse(orthography_fixture, url=url)

    assert exercise.jlpt_level == "N1"
    assert len(exercise.questions) == 2

    # Q1: Kanji reading (choices are hiragana)
    q1 = exercise.questions[0]
    assert q1.format_code == "kanji_reading"
    assert q1.answer.claimed_ordinal == 1

    # Q2: Orthography (choices are kanji)
    q2 = exercise.questions[1]
    assert q2.format_code == "orthography"
    assert q2.answer.claimed_ordinal == 3
    assert not q2.answer.is_conflicted


# =============================================================================
# 4. Audio Retrieval and MediaStore Content-Addressed Storage
# =============================================================================

def test_audio_binary_signature_validation():
    """Verify is_valid_audio_bytes detects genuine ID3/MPEG headers and rejects junk."""
    valid_id3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\x00" * 20
    valid_mpeg_frame = b"\xFF\xFB\x90\x64" + b"\x00" * 20
    corrupted_data = b"NOT_AUDIO_FILE_DATA_HERE"

    assert is_valid_audio_bytes(valid_id3, ".mp3")
    assert is_valid_audio_bytes(valid_mpeg_frame, ".mp3")
    assert not is_valid_audio_bytes(corrupted_data, ".mp3")
    assert not is_valid_audio_bytes(b"", ".mp3")


def test_asset_downloader_audio_retrieval():
    """Verify AssetDownloader downloads audio into MediaStore content-addressed path without DB writes."""
    valid_mp3_content = b"ID3\x03\x00\x00\x00\x00\x00\x00\xFF\xFB\x90\x64" + b"\x42" * 1024
    mp3_sha = hashlib.sha256(valid_mp3_content).hexdigest()

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=valid_mp3_content,
            headers={"Content-Type": "audio/mpeg"},
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    with tempfile.TemporaryDirectory() as tmp_dir:
        media_store = MediaStore(media_dir=tmp_dir)
        downloader = AssetDownloader(media_store=media_store, client=mock_client)

        result = downloader.download_asset(
            "https://japanesetest4you.com/choukai/0002/n5_1_1.mp3",
            conn=None,  # Strict zero-DB-write mode
            kind="audio",
        )

        assert result["asset_id"] == mp3_sha
        assert result["mime_type"] == "audio/mpeg"
        assert result["kind"] == "audio"
        assert result["relative_path"] == f"{mp3_sha[:2]}/{mp3_sha}.mp3"

        # Verify file on disk
        stored_path = Path(tmp_dir) / result["relative_path"]
        assert stored_path.exists()
        assert stored_path.read_bytes() == valid_mp3_content


def test_parser_with_media_retrieval(listening_diagram_fixture):
    """Verify JapaneseTest4YouParser retrieves media assets when downloader is supplied."""
    valid_mp3 = b"ID3\x03\x00\x00\x00\x00\x00\x00\xFF\xFB\x90\x64" + b"\x00" * 100

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=valid_mp3, headers={"Content-Type": "audio/mpeg"})

    mock_client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    with tempfile.TemporaryDirectory() as tmp_dir:
        media_store = MediaStore(media_dir=tmp_dir)
        downloader = AssetDownloader(media_store=media_store, client=mock_client)
        parser = JapaneseTest4YouParser(downloader=downloader)

        exercise = parser.parse(
            listening_diagram_fixture,
            url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-listening-exercise-1/",
            retrieve_media=True,
        )

        assert len(exercise.audio_tracks) == 2
        for track in exercise.audio_tracks:
            assert track.status == "retrieved"
            assert track.asset_id is not None
            assert track.local_path is not None
            # Verify file actually exists on disk in media store
            assert (Path(tmp_dir) / track.local_path).exists()


# =============================================================================
# 5. URL Filter & Classification Across All Categories
# =============================================================================

def test_url_filter_all_categories_and_rejections():
    """Verify URL filter allows exercises for all 5 categories and rejects reference lists and eBooks."""
    # Allowed across levels
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-grammar-exercise-1/")
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-kanji-exercise-1/")
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n3-reading-exercise-1/")
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n2-vocabulary-exercise-1/")
    assert is_exercise_url("https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n1-listening-exercise-1/")

    # Rejected reference lists
    assert not is_exercise_url("https://japanesetest4you.com/jlpt-n5-vocabulary-list/")
    assert not is_exercise_url("https://japanesetest4you.com/jlpt-n4-grammar-list/")

    # Rejected eBooks
    assert not is_exercise_url("https://japanesetest4you.com/ebook-jlpt-n5-grammar/")
    assert not is_exercise_url("https://japanesetest4you.com/ebook-jlpt-n1-grammar/")

    # Rejected ads and tags
    assert not is_exercise_url("https://japanesetest4you.com/category/otaku-corner/naruto/")

    # Verify section extraction
    assert extract_level_and_section("https://japanesetest4you.com/.../jlpt-n5-kanji-exercise-1/") == ("N5", "kanji")
    assert extract_level_and_section("https://japanesetest4you.com/.../jlpt-n1-listening-exercise-1/") == ("N1", "listening")


# =============================================================================
# 6. Ambiguous and Unsupported Structure Diagnostics
# =============================================================================

def test_ambiguous_and_unsupported_structure_diagnostics():
    """Verify parser flags ambiguous or malformed structures with explicit warnings."""
    malformed_markdown = """
Title: Malformed Exercise
URL: https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n3-grammar-exercise-99/

1. この文は選択肢が２つしかありません。
選択肢１
選択肢２

**Answer Key:**
Question 1: 1 (この文は選択肢が２つしかありません。)
"""
    parser = JapaneseTest4YouParser()
    exercise = parser.parse(malformed_markdown, url="https://japanesetest4you.com/test-99/")

    assert len(exercise.questions) == 1
    q = exercise.questions[0]
    assert len(q.choices) == 2
    # Flagged as warning, format code None or ambiguous
    assert any("Expected 4 choices" in w for w in exercise.warnings)

    m3_payload = exercise.to_m3_structured_payload()
    assert m3_payload["questions"][0]["metadata"].get("is_ambiguous_format") is True
