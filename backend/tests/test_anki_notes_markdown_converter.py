from app.services.anki_formatter import convert_markdown_to_anki_html


def test_convert_markdown_bold_and_italics():
    html = convert_markdown_to_anki_html("This is **bold** and *italic* text.")
    assert "<strong>bold</strong>" in html
    assert "<em>italic</em>" in html
    assert "**" not in html


def test_convert_markdown_table_to_compact_key_value_lines():
    md = "| Item | Meaning |\n| --- | --- |\n| 食べる | To eat |\n| 飲む | To drink |"
    html = convert_markdown_to_anki_html(md)
    assert "<table" not in html or "kn-notes-table" in html
    assert "食べる: To eat" in html
    assert "|" not in html


def test_convert_markdown_escapes_xss():
    html = convert_markdown_to_anki_html("**Note** <script>alert(1)</script> <img src=x onerror=alert(1)>")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "onerror" not in html or "&lt;img" in html
