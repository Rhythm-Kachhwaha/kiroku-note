"""
Regex and String Patterns for Deterministic JLPT Question Segmentation.
-----------------------------------------------------------------------
Authoritative patterns for detecting section headers, instructions,
question stems, choice delimiters, star markers, blanks, and answers.
"""
from __future__ import annotations

import re

# Full-width to ASCII digit translation table
FULL_WIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")

# Circled numbers translation table
CIRCLED_DIGITS = {
    "①": "1", "②": "2", "③": "3", "④": "4",
    "⑤": "5", "⑥": "6", "⑦": "7", "⑧": "8",
}

# Katakana choice translation table
KATAKANA_CHOICES = {
    "ア": "1", "イ": "2", "ウ": "3", "エ": "4",
    "あ": "1", "い": "2", "う": "3", "え": "4",
}


def normalize_label(label: str) -> str:
    """Normalize choice or question label to standard ASCII string."""
    lbl = label.strip()
    if lbl in CIRCLED_DIGITS:
        return CIRCLED_DIGITS[lbl]
    if lbl in KATAKANA_CHOICES:
        return KATAKANA_CHOICES[lbl]
    lbl = lbl.translate(FULL_WIDTH_DIGITS)
    # Remove surrounding brackets/parens/dots
    return re.sub(r"^[(\[（〔【.]+|[)\]）〕】.]+$", "", lbl).strip()


# Section and problem headers (e.g. 問題1, 問題 2, 【問題3】, 第1問)
SECTION_HEADER_RE = re.compile(
    r"^(?:【\s*)?(?:問題|第)\s*([0-9０-９一二三四五六七八九十]+)\s*(?:問)?(?:\s*】)?(?:\s*[:：\.\s])?",
    re.MULTILINE,
)

# Instructions (e.g. 次の言葉の読み方として最もよいものを...)
INSTRUCTION_CUES = [
    "次の言葉の読み方として",
    "言葉の読み方として最もよいもの",
    "漢字で書くとき",
    "最もよいものを、1・2・3・4から一つ選びなさい",
    "最もよいものを、１・２・３・４から一つ選びなさい",
    "最もよいものを一つ選びなさい",
    "（　）に入れるのに最もよいもの",
    "意味が最も近いもの",
    "使い方として最もよいもの",
    "★に入る最もよいもの",
    "★ に入る最もよいもの",
    "文章を読んで、文章全体の趣旨を踏まえて",
    "後の問いに対する答えとして最もよいもの",
    "次の文章を読んで",
    "質問を聞いて",
    "音声を聞いて",
]

# Question number line starter (e.g. 問1, 問１, 1., 1　, （1）, (1))
QUESTION_START_RE = re.compile(
    r"^(?:(?:問|Q)\s*([0-9０-９]+)|(?:（|\()([0-9０-９]+)(?:）|\))|([0-9０-９]+)[\.．、\s])\s*",
    re.MULTILINE,
)

# Inline or multi-choice delimiters:
# 1. Circled numbers: ①, ②, ③, ④
CIRCLED_CHOICE_SPLIT_RE = re.compile(r"([①②③④])\s*")

# 2. Parenthesized numbers: (1), (2), (3), (4) or （１）, （２）, （３）, （４）
PAREN_CHOICE_SPLIT_RE = re.compile(r"(?:[（\(]([1-4１-４])[）\)])\s*")

# 3. Numbered choices: 1., 2., 3., 4. or 1 , 2 , 3 , 4
NUMBERED_CHOICE_LINE_RE = re.compile(r"^\s*([1-4１-４])[\.．、\s]\s*", re.MULTILINE)

# 4. Katakana choices: ア, イ, ウ, エ
KATAKANA_CHOICE_SPLIT_RE = re.compile(r"(?:^|[\s\t]+)([アイウエあいうえ])[\.．、\s]\s*")

# Sentence composition star marker (★ or ☆ or {star})
STAR_MARKER_RE = re.compile(r"(?:★|☆|\{star\})")

# Text grammar blank anchors: [ 25 ], 【35】, （28）, {blank|35}
BLANK_ANCHOR_RE = re.compile(r"(?:\[\s*([0-9０-９]+)\s*\]|【\s*([0-9０-９]+)\s*】|（\s*([0-9０-９]{2,3})\s*）|\{blank\|([a-zA-Z0-9_-]+)\})")

# Underline in prompt stem: {u|...}, ___...___, ＿＿＿...＿＿＿
UNDERLINE_RAW_RE = re.compile(r"(?:_{2,}|＿{2,})([^_＿]+)(?:_{2,}|＿{2,})")

# Inline answer declaration: e.g. 正解: 2, 解答: ②, 答え: 4
INLINE_ANSWER_RE = re.compile(
    r"(?:正解|解答|答え|正答|Answer|Ans)\s*[:：=\s]\s*([1-4１-４①-④アイウエ])",
    re.IGNORECASE,
)

# Trailing answer key section header: e.g. 正解一覧, 【解答】, Answer Key
ANSWER_KEY_SECTION_RE = re.compile(
    r"^(?:【\s*)?(?:正解一覧|解答一覧|Answer\s*Key|(?:正解|解答|正答)(?:\s*】|\s*$))",
    re.MULTILINE | re.IGNORECASE,
)

