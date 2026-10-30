"""
Unit Tests for Ingestion Segmentation and Pattern Parsing.
---------------------------------------------------------
Verifies:
- AnswerKeyParser: Inline answer extraction, separate answer key tables, external keys.
- TextSegmenter: Problem instructions, question stems, choice variations (circled, parens, lines),
  star markers for F2, blank anchors for F4, reading passages for F3.
"""
from __future__ import annotations

import pytest

from app.study.contracts.enums import ChoiceMode
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import ExtractedDocument, ExtractedPage
from app.study.ingestion.segmentation.answer_keys import AnswerKeyParser
from app.study.ingestion.segmentation.parser import TextSegmenter


def test_answer_key_parser_inline():
    """Test extracting inline answer key from question text."""
    text1 = "あの山は高いです。 正解: 2"
    cleaned1, ans1, raw1 = AnswerKeyParser.extract_inline_answer(text1)
    assert ans1 == 2
    assert "正解" not in cleaned1
    assert "あの山は高いです。" in cleaned1

    text2 = "テスト問題。 解答：③"
    cleaned2, ans2, raw2 = AnswerKeyParser.extract_inline_answer(text2)
    assert ans2 == 3

    text3 = "答えのない問題文。"
    cleaned3, ans3, raw3 = AnswerKeyParser.extract_inline_answer(text3)
    assert ans3 is None


def test_answer_key_parser_section():
    """Test parsing trailing answer table."""
    text = (
        "問題文がここに入ります。\n\n"
        "【正解一覧】\n"
        "問1: 2\n"
        "問2: 4\n"
        "問3: 1\n"
        "問4: 3\n"
    )
    keys = AnswerKeyParser.parse_answer_key_section(text)
    assert keys == {"1": 2, "2": 4, "3": 1, "4": 3}


def test_text_segmenter_f1_standalone_choices():
    """Test segmenting standard standalone F1 question with circled choices."""
    text = (
        "問題1 次の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。\n"
        "1 あの{u|山}は高いです。\n"
        "① かわ ② やま ③ うみ ④ き\n"
        "正解: 2\n"
    )
    doc = ExtractedDocument(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        raw_text=text,
        pages=[ExtractedPage(page_number=1, text=text)],
        source_name="Test Source",
    )
    segmenter = TextSegmenter()
    questions, groups = segmenter.segment(doc)

    assert len(questions) == 1
    assert len(groups) == 0

    q = questions[0]
    assert "{u|山}" in q.raw_stem
    assert len(q.raw_choices) == 4
    assert q.raw_choices[0].text == "かわ"
    assert q.raw_choices[1].text == "やま"
    assert q.raw_choices[2].text == "うみ"
    assert q.raw_choices[3].text == "き"
    assert q.source_answer_key == 2


def test_text_segmenter_f2_sentence_composition():
    """Test segmenting sentence composition question with star marker."""
    text = (
        "問題2 次の文の ★ に入る最もよいものを、1・2・3・4から一つ選びなさい。\n"
        "1 わたしは ＿＿＿ ＿＿＿ ★ ＿＿＿ 買いました。\n"
        "1 くだものを 2 きのう 3 デパートで 4 たくさん\n"
        "正解: 4\n"
    )
    doc = ExtractedDocument(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        raw_text=text,
        pages=[ExtractedPage(page_number=1, text=text)],
        source_name="Test Source",
    )
    segmenter = TextSegmenter()
    questions, groups = segmenter.segment(doc)

    assert len(questions) == 1
    q = questions[0]
    assert "{star}" in q.raw_stem
    assert len(q.raw_choices) == 4
    assert q.source_answer_key == 4


def test_text_segmenter_f3_reading_passage():
    """Test segmenting reading comprehension passage followed by questions."""
    text = (
        "次の文章を読んで、後の問いに対する答えとして最もよいものを一つ選びなさい。\n"
        "日本には四季があります。春には桜が咲き、多くの人が花見を楽しみます。\n"
        "秋には紅葉が美しく、冬には雪が降ります。\n\n"
        "1 日本の春に咲く花は何ですか。\n"
        "1 うめ 2 さくら 3 ひまわり 4 きく\n"
        "正解: 2\n\n"
        "2 秋に美しいものは何ですか。\n"
        "1 こうよう 2 ゆき 3 はな 4 さくら\n"
        "正解: 1\n"
    )
    doc = ExtractedDocument(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        raw_text=text,
        pages=[ExtractedPage(page_number=1, text=text)],
        source_name="Reading Test",
    )
    segmenter = TextSegmenter()
    questions, groups = segmenter.segment(doc)

    assert len(groups) == 1
    assert len(questions) == 2
    assert "四季があります" in groups[0].raw_body
    assert questions[0].group_reference == groups[0].draft_id
    assert questions[1].group_reference == groups[0].draft_id
    assert questions[0].group_ordinal == 1
    assert questions[1].group_ordinal == 2


def test_text_segmenter_f4_text_grammar_blanks():
    """Test segmenting text grammar passage with blanks [ 25 ] and [ 26 ]."""
    text = (
        "次の文章を読んで、文章全体の趣旨を踏まえて、[ 25 ]から[ 26 ]の中に入る最もよいものを一つ選びなさい。\n"
        "毎朝散歩をすることにしている。[ 25 ]、健康のためである。雨の日でも [ 26 ]。\n\n"
        "25 1 なぜなら 2 だから 3 しかし 4 それで\n"
        "正解: 1\n\n"
        "26 1 歩く 2 歩かない 3 走る 4 休む\n"
        "正解: 1\n"
    )
    doc = ExtractedDocument(
        adapter_kind=IngestAdapterKind.PASTED_TEXT,
        raw_text=text,
        pages=[ExtractedPage(page_number=1, text=text)],
        source_name="Text Grammar Test",
    )
    segmenter = TextSegmenter()
    questions, groups = segmenter.segment(doc)

    assert len(groups) == 1
    group = groups[0]
    assert len(group.anchors) == 2
    assert group.anchors[0]["anchor_key"] == "25"
    assert group.anchors[1]["anchor_key"] == "26"

    assert len(questions) == 2
    assert questions[0].anchor_key == "25"
    assert questions[1].anchor_key == "26"

