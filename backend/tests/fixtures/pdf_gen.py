"""
PDF generation fixtures using reportlab and local CJK fonts.
Generates synthetic PDFs for text quality and layout tests.
"""
from __future__ import annotations

import io
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_NAME = "HinaMincho"
_FONT_REGISTERED = False


def _ensure_font() -> None:
    global _FONT_REGISTERED
    if _FONT_REGISTERED:
        return
    font_path = Path(__file__).resolve().parents[3] / "desktop" / "src" / "ui" / "assets" / "fonts" / "hina-mincho.ttf"
    if font_path.is_file():
        pdfmetrics.registerFont(TTFont(FONT_NAME, str(font_path)))
        _FONT_REGISTERED = True


def generate_horizontal_paragraphs_pdf() -> bytes:
    """Generate PDF with multiple horizontal paragraphs including an indented line."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont(FONT_NAME, 12)
    # Paragraph 1
    c.drawString(50, 750, "第一段落の最初の行です。")
    c.drawString(65, 730, "第一段落の字下げされた二行目です。")
    # Paragraph 2
    c.drawString(50, 680, "第二段落の最初の行です。")
    c.drawString(50, 660, "第二段落の二行目です。")
    c.save()
    return buf.getvalue()


def generate_tategaki_pdf() -> bytes:
    """Generate PDF with tategaki (vertical Japanese) columns."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont(FONT_NAME, 14)
    # Column 1 (rightmost, x=450, top-to-bottom)
    text1 = ["本", "日", "は", "晴", "天", "な", "り"]
    for i, char in enumerate(text1):
        c.drawString(450, 750 - i * 22, char)
    # Column 2 (left of column 1, x=410, top-to-bottom)
    text2 = ["明", "日", "も", "良", "い", "天", "気"]
    for i, char in enumerate(text2):
        c.drawString(410, 750 - i * 22, char)
    c.save()
    return buf.getvalue()


def generate_ruby_pdf() -> bytes:
    """Generate PDF with kanji and ruby (furigana) directly above it."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    # Kanji base at y=700, font size 16
    c.setFont(FONT_NAME, 16)
    c.drawString(100, 700, "漢字")
    # Ruby text at y=716, font size 9 (< 16 * 0.78)
    c.setFont(FONT_NAME, 9)
    c.drawString(100, 716, "かんじ")
    # Trailing line text
    c.setFont(FONT_NAME, 16)
    c.drawString(140, 700, "の読み方を練習する。")
    c.save()
    return buf.getvalue()


def generate_two_column_pdf() -> bytes:
    """Generate PDF with two distinct text columns."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont(FONT_NAME, 12)
    # Left column (x=50)
    c.drawString(50, 750, "左列の第一行です。")
    c.drawString(50, 720, "左列の第二行です。")
    # Right column (x=330)
    c.drawString(330, 750, "右列の第一行です。")
    c.drawString(330, 720, "右列の第二行です。")
    c.save()
    return buf.getvalue()


def generate_repeating_header_footer_pdf() -> bytes:
    """Generate 2-page PDF with identical header and footer on both pages."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    # Page 1
    c.setFont(FONT_NAME, 10)
    c.drawString(100, 800, "共通模試ヘッダー：第1回")
    c.drawString(250, 40, "共通ページフッター")
    c.setFont(FONT_NAME, 12)
    c.drawString(100, 700, "1ページ目の本文問題文です。")
    c.showPage()
    # Page 2
    c.setFont(FONT_NAME, 10)
    c.drawString(100, 800, "共通模試ヘッダー：第1回")
    c.drawString(250, 40, "共通ページフッター")
    c.setFont(FONT_NAME, 12)
    c.drawString(100, 700, "2ページ目の本文問題文です。")
    c.save()
    return buf.getvalue()


def generate_mixed_latin_jp_pdf() -> bytes:
    """Generate PDF with mixed Latin letters, numbers, and Japanese text."""
    _ensure_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont(FONT_NAME, 12)
    c.drawString(50, 750, "2024年のJLPT N1試験に向けた学習計画です。")
    c.drawString(50, 725, "Kiroku NoteはFastAPIとSQLiteを使用しています。")
    c.drawString(50, 700, "HTTP status 200 OKが返却されました。")
    c.save()
    return buf.getvalue()
