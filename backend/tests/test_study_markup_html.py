from app.api.study.converters import render_markup_html


def test_render_markup_html_golden_format_targets():
    rendered = render_markup_html(
        "[漢字|かんじ]{u|を}{blank|blank_35}{star}"
    )

    assert "<ruby>漢字<rt>かんじ</rt></ruby>" in rendered
    assert '<span class="study-target-underline">を</span>' in rendered
    assert 'class="study-target-blank"' in rendered
    assert 'data-anchor="blank_35"' in rendered
    assert '<span class="study-target-star">★</span>' in rendered


def test_render_markup_html_escapes_invalid_legacy_markup():
    assert render_markup_html("<script>alert(1)</script>{bad") == "&lt;script&gt;alert(1)&lt;/script&gt;{bad"
