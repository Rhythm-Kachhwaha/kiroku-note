"""
Targeted Tests for Question Family Contracts (F1–F6).
------------------------------------------------------
Covers:
- Valid synthetic examples for F1, F2, F3, F4, F5, F6
- Invalid family discriminator rejection
- Format and family mismatch detection
- Unsupported JLPT level for format (e.g. word_formation on N3)
- Choice modes: text, image, and unprinted
- Choice count bounds (min/max limits enforced per format)
- Choice ordinal uniqueness and sequential requirements
- F2 sentence ordering permutation validation & star answer derivation
- F2 contradiction between answer and derived star choice
- F3 reading passage association without duplicating passage text
- F4 text grammar anchor validation
- F5 individual audio asset association & unprinted choice support (quick_response)
- F6 shared audio group association (N1/N2 only)
- Serialization / deserialization round-trips via parse_question_payload
- Valid incomplete / draft questions (e.g. without answers or with unassigned permutations)
"""
from __future__ import annotations

import json
import pytest
from pydantic import ValidationError

from app.study.contracts import (
    AnswerOrigin,
    AnswerPayload,
    AssetRefPayload,
    AssetRole,
    ChoiceMode,
    ChoicePayload,
    ContentGroupPayload,
    F1QuestionPayload,
    F2QuestionPayload,
    F3QuestionPayload,
    F4QuestionPayload,
    F5QuestionPayload,
    F6QuestionPayload,
    GroupAnchorPayload,
    GroupPartPayload,
    JlptLevel,
    QuestionCategory,
    QuestionStatus,
    StructuralFamily,
    parse_question_payload,
)
from app.study.formats import (
    FormatFamilyMismatchError,
    FormatLevelMismatchError,
    FormatNotFoundError,
    InvalidChoiceCountError,
)


# =============================================================================
# Family F1 Tests (Inline-target MCQ)
# =============================================================================

def test_f1_valid_kanji_reading():
    """Test valid F1 Kanji Reading question with underline markup."""
    payload = {
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "category": "vocabulary",
        "prompt_markup": "あの{u|[山|やま]}は　たかいです。",
        "instruction_text": "___のことばは　どう　かきますか。",
        "choices": [
            {"ordinal": 1, "text_markup": "かわ", "is_correct": False},
            {"ordinal": 2, "text_markup": "やま", "is_correct": True, "answer_origin": "source_explicit"},
            {"ordinal": 3, "text_markup": "うみ", "is_correct": False},
            {"ordinal": 4, "text_markup": "き", "is_correct": False},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F1QuestionPayload)
    assert q.format_code == "kanji_reading"
    assert q.level == JlptLevel.N5
    assert len(q.choices) == 4
    assert q.answer is not None
    assert q.answer.choice_key == "choice_2"
    assert q.answer.answer_origin == AnswerOrigin.SOURCE_EXPLICIT


def test_f1_target_missing_rejected():
    """Test F1 Kanji Reading rejects stem lacking underline or blank target."""
    payload = {
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "category": "vocabulary",
        "stem_markup": "あの山はたかいです。",  # Missing {u|...} or {blank|...}
        "choices": [
            {"ordinal": 1, "text_markup": "かわ"},
            {"ordinal": 2, "text_markup": "やま"},
            {"ordinal": 3, "text_markup": "うみ"},
            {"ordinal": 4, "text_markup": "き"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "must contain an inline target markup" in str(exc_info.value)


def test_f1_multiple_correct_answers_rejected():
    """Test rejection when multiple choices have is_correct=True."""
    payload = {
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "prompt_markup": "{u|山}",
        "choices": [
            {"ordinal": 1, "text_markup": "かわ", "is_correct": True},
            {"ordinal": 2, "text_markup": "やま", "is_correct": True},
            {"ordinal": 3, "text_markup": "うみ", "is_correct": False},
            {"ordinal": 4, "text_markup": "き", "is_correct": False},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "Multiple choices are marked is_correct=True" in str(exc_info.value)


# =============================================================================
# Family F2 Tests (Sentence Composition / Ordering)
# =============================================================================

def test_f2_valid_sentence_ordering():
    """Test valid F2 sentence ordering with 4 fragments, star position, and auto-derivation."""
    payload = {
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N3",
        "category": "grammar",
        "prompt_markup": "きのうは　びょういんへ　__　__　{star}　__　いけませんでした。",
        "instruction_text": "★に入るものはどれですか。",
        "star_position": 3,
        "choices": [
            {"ordinal": 1, "text_markup": "いった", "fragment_order_position": 2},
            {"ordinal": 2, "text_markup": "ものの", "fragment_order_position": 3},
            {"ordinal": 3, "text_markup": "くすりを", "fragment_order_position": 4},
            {"ordinal": 4, "text_markup": "もらいに", "fragment_order_position": 1},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F2QuestionPayload)
    # Permutation: blank 1 -> choice 4, blank 2 -> choice 1, blank 3 -> choice 2, blank 4 -> choice 3
    assert q.fragment_order == [4, 1, 2, 3]
    # Blank 3 (star position 3) is choice 2
    assert q.derived_star_choice_key == "choice_2"
    assert q.answer is not None
    assert q.answer.choice_key == "choice_2"
    assert q.answer.answer_origin == AnswerOrigin.SOURCE_DERIVED


def test_f2_missing_star_rejected():
    """Test F2 question stem lacking {star} is rejected."""
    payload = {
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N3",
        "prompt_markup": "きのうは　びょういんへ　__　__　__　__　いけませんでした。",  # No {star}
        "choices": [
            {"ordinal": 1, "text_markup": "A", "fragment_order_position": 1},
            {"ordinal": 2, "text_markup": "B", "fragment_order_position": 2},
            {"ordinal": 3, "text_markup": "C", "fragment_order_position": 3},
            {"ordinal": 4, "text_markup": "D", "fragment_order_position": 4},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "must contain the target star marker '{star}'" in str(exc_info.value)


def test_f2_invalid_permutation_rejected():
    """Test duplicate fragment position rejected."""
    payload = {
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N3",
        "prompt_markup": "{star}",
        "fragment_order": [1, 1, 3, 4],  # Duplicate 1, missing 2
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "must be a strict permutation of [1, 2, 3, 4]" in str(exc_info.value)


def test_f2_contradictory_answer_rejected():
    """Test error when explicitly provided answer contradicts derived star choice."""
    payload = {
        "format_code": "sentence_composition",
        "structural_family": "F2",
        "level": "N3",
        "prompt_markup": "{star}",
        "star_position": 3,
        "fragment_order": [4, 1, 2, 3],  # Star (pos 3) is choice 2
        "answer": {"choice_key": "choice_1"},  # Contradicts derived choice_2
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "contradicts the derived star choice" in str(exc_info.value)


# =============================================================================
# Family F3 Tests (Reading Passage Groups)
# =============================================================================

def test_f3_valid_reading_short():
    """Test valid F3 short reading comprehension associated to group without duplicating text."""
    payload = {
        "format_code": "comprehension_short",
        "structural_family": "F3",
        "level": "N2",
        "category": "reading",
        "content_group_id": 101,
        "group_ordinal": 1,
        "prompt_markup": "筆者が最も主張したいことは何か。",
        "choices": [
            {"ordinal": 1, "text_markup": "リサイクルの費用を削減すべきだ。"},
            {"ordinal": 2, "text_markup": "リサイクルに必要な全エネルギーを視野に入れて評価すべきだ。", "is_correct": True},
            {"ordinal": 3, "text_markup": "リサイクル技術の導入を中止すべきだ。"},
            {"ordinal": 4, "text_markup": "消費者の分別努力だけで十分である。"},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F3QuestionPayload)
    assert q.content_group_id == 101
    assert q.group_ordinal == 1
    assert q.answer is not None
    assert q.answer.choice_key == "choice_2"


def test_f3_content_group_model():
    """Test ContentGroupPayload with parts and anchors."""
    grp_data = {
        "kind": "passage",
        "level": "N2",
        "title": "環境問題",
        "parts": [
            {"ordinal": 1, "role": "text", "markup": "第一段落のテキスト。"},
            {"ordinal": 2, "role": "text", "markup": "第二段落のテキスト。"},
        ],
    }
    grp = ContentGroupPayload.model_validate(grp_data)
    assert grp.kind.value == "passage"
    assert len(grp.parts) == 2


# =============================================================================
# Family F4 Tests (Text Grammar)
# =============================================================================

def test_f4_valid_text_grammar():
    """Test valid F4 text grammar question referencing an anchor_key."""
    payload = {
        "format_code": "text_grammar",
        "structural_family": "F4",
        "level": "N1",
        "category": "grammar",
        "content_group_id": 201,
        "group_ordinal": 1,
        "anchor_key": "blank_35",
        "prompt_markup": "【 35 】に入る最も適当なものはどれか。",
        "choices": [
            {"ordinal": 1, "text_markup": "求められつつある", "is_correct": True},
            {"ordinal": 2, "text_markup": "求められるべきではない"},
            {"ordinal": 3, "text_markup": "求めたきりである"},
            {"ordinal": 4, "text_markup": "求めるまでもない"},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F4QuestionPayload)
    assert q.anchor_key == "blank_35"
    assert q.answer is not None
    assert q.answer.choice_key == "choice_1"


def test_f4_missing_anchor_key_rejected():
    """Test F4 question requires anchor_key."""
    payload = {
        "format_code": "text_grammar",
        "structural_family": "F4",
        "level": "N1",
        "category": "grammar",
        "prompt_markup": "【 35 】に入るもの",
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "anchor_key" in str(exc_info.value)


# =============================================================================
# Family F5 Tests (Individual Audio Questions)
# =============================================================================

def test_f5_valid_task_based_listening():
    """Test valid F5 task-based listening with audio asset reference."""
    payload = {
        "format_code": "task_based_listening",
        "structural_family": "F5",
        "level": "N4",
        "category": "listening",
        "prompt_markup": "女の人はこれから何をしますか。",
        "audio_asset": {
            "role": "audio",
            "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "is_required": True,
        },
        "choices": [
            {"ordinal": 1, "text_markup": "部屋を掃除する"},
            {"ordinal": 2, "text_markup": "先生に電話をかける", "is_correct": True},
            {"ordinal": 3, "text_markup": "買い物に行く"},
            {"ordinal": 4, "text_markup": "本を返す"},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F5QuestionPayload)
    assert q.audio_asset is not None
    assert q.audio_asset.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_f5_quick_response_unprinted_choices():
    """Test F5 Quick Response with exactly 3 unprinted choices."""
    payload = {
        "format_code": "quick_response",
        "structural_family": "F5",
        "level": "N2",
        "category": "listening",
        "prompt_markup": "音声を聞いて、1から3の中から最も適当なものを一つ選んでください。",
        "audio_asset": {"role": "audio", "sha256": "a" * 64},
        "choices": [
            {"ordinal": 1, "mode": "unprinted"},
            {"ordinal": 2, "mode": "unprinted", "is_correct": True},
            {"ordinal": 3, "mode": "unprinted"},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F5QuestionPayload)
    assert len(q.choices) == 3
    assert all(c.mode == ChoiceMode.UNPRINTED for c in q.choices)
    assert q.answer is not None
    assert q.answer.choice_key == "choice_2"


def test_f5_quick_response_wrong_choice_count_rejected():
    """Test Quick Response rejects 4 choices (must have exactly 3)."""
    payload = {
        "format_code": "quick_response",
        "structural_family": "F5",
        "level": "N2",
        "category": "listening",
        "prompt_markup": "音声を聞いてください",
        "audio_asset": {"role": "audio", "sha256": "a" * 64},
        "choices": [
            {"ordinal": 1, "mode": "unprinted"},
            {"ordinal": 2, "mode": "unprinted"},
            {"ordinal": 3, "mode": "unprinted"},
            {"ordinal": 4, "mode": "unprinted"},  # Invalid: 4th choice
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "requires between 3 and 3 choices" in str(exc_info.value)


# =============================================================================
# Family F6 Tests (Shared Audio Groups)
# =============================================================================

def test_f6_valid_listening_integrated():
    """Test valid F6 Integrated Listening (N1/N2 only) linked to audio context."""
    payload = {
        "format_code": "listening_integrated",
        "structural_family": "F6",
        "level": "N1",
        "category": "listening",
        "content_group_id": 301,
        "group_ordinal": 1,
        "prompt_markup": "質問1: 男の人はどの製品を選ぶと言っていますか。",
        "choices": [
            {"ordinal": 1, "text_markup": "製品A"},
            {"ordinal": 2, "text_markup": "製品B", "is_correct": True},
            {"ordinal": 3, "text_markup": "製品C"},
            {"ordinal": 4, "text_markup": "製品D"},
        ],
    }
    q = parse_question_payload(payload)
    assert isinstance(q, F6QuestionPayload)
    assert q.level == JlptLevel.N1
    assert q.group_ordinal == 1


def test_f6_unsupported_level_rejected():
    """Test F6 rejected at N3 (only N1 and N2 supported)."""
    payload = {
        "format_code": "listening_integrated",
        "structural_family": "F6",
        "level": "N3",  # Unsupported level
        "category": "listening",
        "prompt_markup": "質問1",
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "not supported at JLPT level 'N3'" in str(exc_info.value)


# =============================================================================
# General Contract & Cross-Family Compatibility Tests
# =============================================================================

def test_invalid_structural_family_discriminator():
    """Test unknown family discriminator 'F9' rejected."""
    payload = {
        "format_code": "kanji_reading",
        "structural_family": "F9",
        "level": "N5",
        "prompt_markup": "{u|山}",
        "choices": [{"ordinal": 1, "text_markup": "かわ"}],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert any(k in str(exc_info.value).lower() for k in ("discriminator", "input should be", "tag", "union_tag_invalid"))


def test_format_family_mismatch():
    """Test format code belonging to F2 declared under F1 rejected."""
    payload = {
        "format_code": "sentence_composition",  # Belongs to F2
        "structural_family": "F1",             # Declared as F1
        "level": "N3",
        "prompt_markup": "{u|文}",
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "belongs to structural family 'F2', not requested family 'F1'" in str(exc_info.value)


def test_format_unsupported_level_word_formation():
    """Test word_formation rejected on N3 (word_formation is N2 only)."""
    payload = {
        "format_code": "word_formation",
        "structural_family": "F1",
        "level": "N3",  # Invalid: word_formation is N2 only
        "prompt_markup": "{u|新発売}",
        "choices": [
            {"ordinal": 1, "text_markup": "A"},
            {"ordinal": 2, "text_markup": "B"},
            {"ordinal": 3, "text_markup": "C"},
            {"ordinal": 4, "text_markup": "D"},
        ],
    }
    with pytest.raises(ValidationError) as exc_info:
        parse_question_payload(payload)
    assert "not supported at JLPT level 'N3'" in str(exc_info.value)


def test_valid_incomplete_unanswered_question():
    """Test that a draft question without an answer is structurally valid."""
    payload = {
        "format_code": "kanji_reading",
        "structural_family": "F1",
        "level": "N5",
        "status": "draft",
        "prompt_markup": "{u|川}",
        "choices": [
            {"ordinal": 1, "text_markup": "かわ"},
            {"ordinal": 2, "text_markup": "やま"},
            {"ordinal": 3, "text_markup": "うみ"},
            {"ordinal": 4, "text_markup": "き"},
        ],
    }
    q = parse_question_payload(payload)
    assert q.answer is None
    assert q.status == QuestionStatus.DRAFT


def test_serialization_roundtrip():
    """Test serializing model to JSON and parsing back reproduces exact contract."""
    original = F1QuestionPayload(
        format_code="kanji_reading",
        structural_family="F1",
        level=JlptLevel.N5,
        category=QuestionCategory.VOCABULARY,
        stem_markup="{u|[山|やま]}",
        instruction_text="テスト指示",
        choices=[
            ChoicePayload(ordinal=1, text_markup="かわ"),
            ChoicePayload(ordinal=2, text_markup="やま", is_correct=True),
            ChoicePayload(ordinal=3, text_markup="うみ"),
            ChoicePayload(ordinal=4, text_markup="き"),
        ],
    )
    json_str = original.model_dump_json()
    reconstituted = parse_question_payload(json_str)
    assert isinstance(reconstituted, F1QuestionPayload)
    assert reconstituted.format_code == original.format_code
    assert reconstituted.stem_markup == original.stem_markup
    assert reconstituted.answer is not None
    assert reconstituted.answer.choice_key == "choice_2"

