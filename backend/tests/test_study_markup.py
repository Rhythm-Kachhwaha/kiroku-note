"""
Targeted Tests for Kiroku Study Markup Parser, AST, and Validation.
-------------------------------------------------------------------
Covers:
- Plain Japanese text and punctuation preservation
- Underline: {u|...}
- Blank target anchor: {blank|key}
- Star marker: {star}
- Ruby furigana: [base|reading]
- Mixed nested markup (e.g. underline containing ruby)
- Deterministic serialization & round trips (to_markup, to_plain_text, to_reading_text, to_safe_html)
- Position-aware error reporting (line, column, offset, snippet)
- Malformed delimiters & unclosed brackets/braces
- Invalid ruby structures (empty base, empty reading, multiple pipes, nested brackets)
- Unsupported markup tags and HTML injection rejection
- Group anchor validation and duplicate detection
"""
from __future__ import annotations

import pytest

from app.study.markup import (
    BlankNode,
    MarkupSyntaxError,
    MarkupValidationError,
    RubyNode,
    StarNode,
    TextNode,
    UnderlineNode,
    count_stars,
    extract_anchors,
    has_blank,
    has_star,
    has_underline,
    parse_markup,
    to_markup,
    to_plain_text,
    to_reading_text,
    to_safe_html,
    validate_group_anchors,
)


def test_plain_japanese_text():
    """Test parsing of plain Japanese text preserving all punctuation and spacing."""
    raw = "あの山は　とても高いです。今日は、天気がいいですね！「はい」"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    assert isinstance(ast.nodes[0], TextNode)
    assert ast.nodes[0].content == raw
    assert to_markup(ast) == raw
    assert to_plain_text(ast) == raw


def test_ruby_furigana_basic():
    """Test [base|reading] parsing and text extraction."""
    raw = "[漢字|かんじ]"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    node = ast.nodes[0]
    assert isinstance(node, RubyNode)
    assert node.base == "漢字"
    assert node.reading == "かんじ"
    assert to_markup(ast) == "[漢字|かんじ]"
    assert to_plain_text(ast) == "漢字"
    assert to_reading_text(ast) == "かんじ"
    assert to_safe_html(ast) == "<ruby>漢字<rt>かんじ</rt></ruby>"


def test_underline_basic():
    """Test {u|...} underline node parsing."""
    raw = "{u|下線部テキスト}"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    node = ast.nodes[0]
    assert isinstance(node, UnderlineNode)
    assert len(node.children) == 1
    assert isinstance(node.children[0], TextNode)
    assert node.children[0].content == "下線部テキスト"
    assert to_markup(ast) == raw
    assert to_plain_text(ast) == "下線部テキスト"
    assert has_underline(ast) is True


def test_blank_anchor_basic():
    """Test {blank|key} anchor target."""
    raw = "{blank|blank_35}"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    node = ast.nodes[0]
    assert isinstance(node, BlankNode)
    assert node.key == "blank_35"
    assert to_markup(ast) == raw
    assert has_blank(ast) is True
    assert extract_anchors(ast) == ["blank_35"]


def test_star_marker_basic():
    """Test {star} star target for F2 sentence composition."""
    raw = "{star}"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    assert isinstance(ast.nodes[0], StarNode)
    assert to_markup(ast) == "{star}"
    assert to_plain_text(ast) == "★"
    assert has_star(ast) is True
    assert count_stars(ast) == 1


def test_mixed_markup_with_underline_and_ruby():
    """Test complex stem with underline wrapping ruby and surrounding text."""
    raw = "あの{u|[山|やま]}は　たかいです。"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 3
    assert isinstance(ast.nodes[0], TextNode)
    assert ast.nodes[0].content == "あの"

    u_node = ast.nodes[1]
    assert isinstance(u_node, UnderlineNode)
    assert len(u_node.children) == 1
    assert isinstance(u_node.children[0], RubyNode)
    assert u_node.children[0].base == "山"
    assert u_node.children[0].reading == "やま"

    assert isinstance(ast.nodes[2], TextNode)
    assert ast.nodes[2].content == "は　たかいです。"

    # Round trip
    assert to_markup(ast) == raw
    assert to_plain_text(ast) == "あの山は　たかいです。"
    assert to_reading_text(ast) == "あのやまは　たかいです。"
    assert to_safe_html(ast) == 'あの<span class="study-target-underline"><ruby>山<rt>やま</rt></ruby></span>は　たかいです。'


def test_f2_sentence_ordering_stem():
    """Test F2 sentence composition stem with multiple blanks and one star."""
    raw = "きのうは　びょういんへ　__　__　{star}　__　いけませんでした。"
    ast = parse_markup(raw)
    assert has_star(ast) is True
    assert count_stars(ast) == 1
    assert to_markup(ast) == raw


def test_escape_characters():
    """Test escaped delimiters \\{, \\}, \\[, \\], \\|."""
    raw = r"\{テスト\} \[かっこ\] \|パイプ\|"
    ast = parse_markup(raw)
    assert len(ast.nodes) == 1
    assert isinstance(ast.nodes[0], TextNode)
    assert ast.nodes[0].content == "{テスト} [かっこ] |パイプ|"


# -----------------------------------------------------------------------------
# Syntax Error & Delimiter Validation Tests
# -----------------------------------------------------------------------------

def test_unclosed_ruby_delimiter():
    """Test error on unclosed ruby bracket '['."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの[漢字|かんじ は高い")
    err = exc_info.value
    assert "Unclosed ruby bracket" in str(err)
    assert err.line == 1
    assert err.column == 3
    assert err.offset == 2


def test_ruby_missing_pipe():
    """Test error on ruby annotation lacking '|' separator."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの[漢字かんじ]は高い")
    err = exc_info.value
    assert "missing '|' delimiter" in str(err)


def test_ruby_empty_base():
    """Test error on ruby with empty base text '[|かんじ]'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの[|かんじ]は高い")
    err = exc_info.value
    assert "base text cannot be empty" in str(err)


def test_ruby_empty_reading():
    """Test error on ruby with empty reading '[漢字|]'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの[漢字|]は高い")
    err = exc_info.value
    assert "reading cannot be empty" in str(err)


def test_ruby_multiple_pipes():
    """Test error on ruby with multiple '|' separators."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの[漢字|かん|じ]は高い")
    err = exc_info.value
    assert "Multiple '|' delimiters" in str(err)


def test_unclosed_underline_delimiter():
    """Test error on unclosed underline tag '{u|'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの{u|山は高い")
    err = exc_info.value
    assert "Unclosed underline tag" in str(err)
    assert err.column == 3


def test_nested_underline_rejected():
    """Test error on nested underline '{u|{u|...}}'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの{u|{u|山}}は高い")
    err = exc_info.value
    assert "Nested braced tags" in str(err)


def test_empty_underline_rejected():
    """Test error on empty underline '{u|}'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの{u|}は高い")
    err = exc_info.value
    assert "cannot be empty" in str(err)


def test_unclosed_blank_delimiter():
    """Test error on unclosed '{blank|'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("本文 {blank|35 ここで終わり")
    err = exc_info.value
    assert "Unclosed '{blank|'" in str(err)


def test_empty_blank_key():
    """Test error on empty blank anchor key '{blank|}'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("本文 {blank|} です")
    err = exc_info.value
    assert "anchor key cannot be empty" in str(err)


def test_unexpected_closing_bracket():
    """Test error on stray closing bracket ']'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("テスト]です")
    err = exc_info.value
    assert "Unexpected closing bracket" in str(err)


def test_unexpected_closing_brace():
    """Test error on stray closing brace '}'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("テスト}です")
    err = exc_info.value
    assert "Unexpected closing brace" in str(err)


def test_unsupported_tag_rejected():
    """Test error on unknown directive '{b|太字}'."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("あの{b|太字}テキスト")
    err = exc_info.value
    assert "Unsupported markup tag 'b'" in str(err)


def test_html_injection_rejected():
    """Test that arbitrary HTML tags like <script> or <ruby> raise syntax errors."""
    with pytest.raises(MarkupSyntaxError) as exc_info:
        parse_markup("悪意ある<script>alert('xss')</script>テキスト")
    err = exc_info.value
    assert "HTML tag '<script>' is not permitted" in str(err)


# -----------------------------------------------------------------------------
# Group Anchor Validation Tests
# -----------------------------------------------------------------------------

def test_validate_group_anchors_valid():
    """Test group anchors perfectly match passage parts."""
    parts = [
        "科学技術の発展は我々の生活を豊かにしてきたが、今まさに議論が {blank|blank_35}。",
        "したがって、今後の対応については {blank|blank_36} 必要がある。",
    ]
    declared = ["blank_35", "blank_36"]
    verified = validate_group_anchors(parts, declared)
    assert verified == ["blank_35", "blank_36"]


def test_validate_group_anchors_duplicate():
    """Test error when an anchor key appears multiple times in group parts."""
    parts = [
        "第一段落 {blank|blank_35}。",
        "第二段落 重複した {blank|blank_35}。",
    ]
    with pytest.raises(MarkupValidationError) as exc_info:
        validate_group_anchors(parts, ["blank_35"])
    assert "Duplicate anchor key 'blank_35'" in str(exc_info.value)


def test_validate_group_anchors_undeclared():
    """Test error when markup contains an anchor not registered in group."""
    parts = [
        "段落 {blank|blank_99}。",
    ]
    with pytest.raises(MarkupValidationError) as exc_info:
        validate_group_anchors(parts, ["blank_35"])
    assert "exist in passage markup but are not registered" in str(exc_info.value)


def test_validate_group_anchors_missing():
    """Test error when registered group anchor does not appear in any part."""
    parts = [
        "段落 {blank|blank_35}。",
    ]
    with pytest.raises(MarkupValidationError) as exc_info:
        validate_group_anchors(parts, ["blank_35", "blank_36"])
    assert "do not appear in any passage part markup" in str(exc_info.value)

