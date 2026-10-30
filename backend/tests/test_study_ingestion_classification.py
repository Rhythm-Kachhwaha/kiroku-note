"""
Unit Tests for Question Format and Structural Family Classifier.
----------------------------------------------------------------
Verifies:
- Instruction-based matching for all JLPT categories (Vocabulary, Grammar, Reading, Listening).
- Level constraint enforcement and automatic safe fallback.
- Structural heuristic matching (star marker, passage blanks, audio cues).
- Confidence scoring and rule traceability.
"""
from __future__ import annotations

import pytest

from app.study.contracts.enums import (
    JlptLevel,
    QuestionCategory,
    StructuralFamily,
)
from app.study.ingestion.classification.classifier import FormatClassifier
from app.study.ingestion.models import ChoiceDraft, QuestionDraft


def test_classify_kanji_reading():
    """Test classifying kanji reading from instruction."""
    draft = QuestionDraft(
        instruction_text="次の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。",
        raw_stem="あの{u|山}は高いです。",
        raw_choices=[ChoiceDraft(ordinal=1, label="1", text="やま")],
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N5)

    assert cls.format_code == "kanji_reading"
    assert cls.structural_family == StructuralFamily.F1
    assert cls.category == QuestionCategory.VOCABULARY
    assert cls.level == JlptLevel.N5
    assert cls.confidence == 1.0


def test_classify_orthography():
    """Test classifying orthography."""
    draft = QuestionDraft(
        instruction_text="次の言葉を漢字で書くとき、最もよいものを一つ選びなさい。",
        raw_stem="あした{u|ともだち}にあいます。",
        raw_choices=[ChoiceDraft(ordinal=1, label="1", text="友達")],
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N4)

    assert cls.format_code == "orthography"
    assert cls.structural_family == StructuralFamily.F1
    assert cls.category == QuestionCategory.VOCABULARY
    assert cls.level == JlptLevel.N4


def test_classify_sentence_composition_star():
    """Test classifying sentence composition via star marker heuristic."""
    draft = QuestionDraft(
        raw_stem="わたしは ＿＿ ＿＿ {star} ＿＿ 買いました。",
        raw_choices=[
            ChoiceDraft(ordinal=1, label="1", text="本を"),
            ChoiceDraft(ordinal=2, label="2", text="きのう"),
            ChoiceDraft(ordinal=3, label="3", text="店で"),
            ChoiceDraft(ordinal=4, label="4", text="たくさん"),
        ],
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N3)

    assert cls.format_code == "sentence_composition"
    assert cls.structural_family == StructuralFamily.F2
    assert cls.category == QuestionCategory.GRAMMAR
    assert cls.confidence >= 0.9


def test_classify_text_grammar():
    """Test classifying text grammar passage question."""
    draft = QuestionDraft(
        instruction_text="文章の文法：次の文章を読んで...",
        raw_stem="[ 25 ] の言葉",
        group_reference="passage_1",
        anchor_key="25",
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N2, group_type="passage")

    assert cls.format_code == "text_grammar"
    assert cls.structural_family == StructuralFamily.F4
    assert cls.category == QuestionCategory.GRAMMAR


def test_classify_reading_comprehension():
    """Test classifying reading comprehension question in passage."""
    draft = QuestionDraft(
        instruction_text="短文読解：次の文章を読んで答えなさい。",
        raw_stem="筆者が言いたいことは何か。",
        group_reference="passage_short_1",
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N1, group_type="passage")

    assert cls.format_code == "comprehension_short"
    assert cls.structural_family == StructuralFamily.F3
    assert cls.category == QuestionCategory.READING


def test_classify_listening_quick_response():
    """Test classifying listening quick response (3 choices)."""
    draft = QuestionDraft(
        instruction_text="即時応答：短い文を聞いて...",
        raw_stem="こんにちは。",
        raw_choices=[
            ChoiceDraft(ordinal=1, label="1", text=""),
            ChoiceDraft(ordinal=2, label="2", text=""),
            ChoiceDraft(ordinal=3, label="3", text=""),
        ],
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N2, has_audio=True)

    assert cls.format_code == "quick_response"
    assert cls.structural_family == StructuralFamily.F5
    assert cls.category == QuestionCategory.LISTENING


def test_classify_level_incompatible_fallback():
    """Test word_formation (N2-only) falls back safely if level is N5."""
    draft = QuestionDraft(
        instruction_text="語形成：言葉の組み立てとして最もよいもの...",
        raw_stem="テスト語形成",
    )
    classifier = FormatClassifier()
    cls = classifier.classify(draft, default_level=JlptLevel.N5)

    # N5 does not allow word_formation -> falls back to contextual_expressions
    assert cls.format_code == "contextual_expressions"
    assert cls.level == JlptLevel.N5
    assert any("level_incompatible_fallback" in r for r in cls.matched_rules)

