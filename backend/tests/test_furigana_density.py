"""Tests for T3-H Furigana Density Control (All / Advanced-only / None)."""
from app.services.anki_formatter import format_basic_back, format_example_html, format_ruby_html


def test_format_ruby_html_all_mode():
    # In 'all' mode, all bracketed kanji should produce <ruby>
    text = "朝[あさ]御[ご]飯[はん]を食[た]べる。"
    html_out = format_ruby_html(text=text, furigana_mode="all")
    assert "<ruby>朝<rt>あさ</rt></ruby>" in html_out
    assert "<ruby>食<rt>た</rt></ruby>" in html_out


def test_format_ruby_html_none_mode():
    # In 'none' mode, all <ruby> tags should be suppressed
    text = "朝[あさ]御[ご]飯[はん]を食[た]べる。"
    html_out = format_ruby_html(text=text, furigana_mode="none")
    assert "<ruby>" not in html_out
    assert "<rt>" not in html_out
    assert "朝御飯を食べる。" == html_out


def test_format_ruby_html_advanced_only_mode():
    # '食' is N5 kanji (common), '飯' is N4 kanji (common) -> ruby suppressed
    # '顕' is N1 kanji -> ruby preserved
    text = "食[た]べる。顕[けん]著[ちょ]な例。"
    html_out = format_ruby_html(text=text, furigana_mode="advanced_only")
    # N5 kanji '食' should have NO ruby
    assert "<ruby>食" not in html_out
    assert "食べる。" in html_out
    # N1 kanji '顕' should HAVE ruby
    assert "<ruby>顕<rt>けん</rt></ruby>" in html_out


def test_format_example_html_with_furigana_mode():
    example_text = "映画[えいが]を見[み]る。"
    # '映', '画', '見' are N4/N5 kanji
    html_advanced = format_example_html(japanese=example_text, translation="Watch a movie.", furigana_mode="advanced_only")
    assert "<ruby>映<rt>えい</rt></ruby>" not in html_advanced
    assert "映画を見る。" in html_advanced
    assert "Watch a movie." in html_advanced

    html_all = format_example_html(japanese=example_text, translation="Watch a movie.", furigana_mode="all")
    assert "<ruby>" in html_all


def test_format_basic_back_with_card_settings_furigana_mode():
    card_dict = {
        "expression": "食べる",
        "reading": "たべる",
        "meaning": "to eat",
        "example_sentence": "ご飯[はん]を食[た]べる。",
        "card_settings": {
            "furigana_mode": "advanced_only",
        },
    }
    back_html = format_basic_back(card=card_dict)
    # Both '飯' and '食' are N4/N5 -> suppressed
    assert "<ruby>食" not in back_html
    assert "ご飯を食べる。" in back_html
