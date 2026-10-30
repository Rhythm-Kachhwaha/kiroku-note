"""
URL Filtering and Classification for Study Bank Acquisition.
------------------------------------------------------------
Distinguishes valid exercise permalinks from advertisements, pagination controls,
navigation bars, Patreon promotions, reference lists, and eBooks.

Covers all 5 JLPT levels (N1–N5) and all 5 exercise categories:
Grammar, Reading, Vocabulary, Kanji, and Listening.
"""
from __future__ import annotations

import re
import urllib.parse

# Domains/paths rejected immediately as ads, trackers, eBooks, reference lists, or non-exercise resources
DISCARD_PATTERNS = [
    re.compile(r"patreon\.com", re.IGNORECASE),
    re.compile(r"feeds\.feedburner\.com", re.IGNORECASE),
    re.compile(r"/wp-content/uploads/.*(?:ADVERTISEMENT|MAINPAGE-AD)", re.IGNORECASE),
    re.compile(r"/flashcard/(?:contact|about)", re.IGNORECASE),
    re.compile(r"/\?s=", re.IGNORECASE),
    re.compile(r"/author/", re.IGNORECASE),
    re.compile(r"/tag/", re.IGNORECASE),
    re.compile(r"#more-\d+", re.IGNORECASE),
    # Reference lists (Vocabulary List, Grammar List) - not practice tests
    re.compile(r"/jlpt-[nN][1-5]-(?:vocabulary|grammar)-list/?", re.IGNORECASE),
    # eBooks
    re.compile(r"/ebook-.*", re.IGNORECASE),
    # Otaku corner
    re.compile(r"/category/otaku-corner/", re.IGNORECASE),
]

# Patterns representing valid JapaneseTest4You exercise posts across all 5 categories
EXERCISE_URL_PATTERNS = [
    re.compile(
        r"https?://japanesetest4you\.com/japanese-language-proficiency-test-jlpt-[nN][1-5]-(?:grammar|reading|vocabulary|kanji|listening)-(?:exercise|test)-\d+[a-z]?/?",
        re.IGNORECASE,
    ),
    re.compile(
        r"https?://japanesetest4you\.com/jlpt-[nN][1-5]-(?:grammar|reading|vocabulary|kanji|listening)-(?:exercise|test)-\d+[a-z]?/?",
        re.IGNORECASE,
    ),
]


def is_exercise_url(url: str) -> bool:
    """Return True if URL is a recognized exercise post, False if noise or navigation."""
    if not url or not url.startswith(("http://", "https://")):
        return False

    clean_url = url.split("#")[0]

    # 1. Reject if matching any discard pattern
    for pattern in DISCARD_PATTERNS:
        if pattern.search(clean_url):
            return False

    # 2. Reject root category archives
    parsed = urllib.parse.urlparse(clean_url)
    if parsed.path.startswith("/category/") or parsed.path in ("", "/"):
        return False

    # 3. Check for positive exercise pattern
    for pattern in EXERCISE_URL_PATTERNS:
        if pattern.search(clean_url):
            return True

    # 4. Fallback heuristic: japanesetest4you post with 'exercise' or 'test' in slug (excluding lists)
    path_lower = parsed.path.lower()
    if "japanesetest4you.com" in parsed.netloc:
        if "-list" in path_lower or "ebook" in path_lower:
            return False
        if ("exercise" in path_lower or "test" in path_lower) and any(f"n{lvl}" in path_lower for lvl in (1, 2, 3, 4, 5)):
            return True

    return False


def extract_level_and_section(url: str, title: str = "") -> tuple[str, str]:
    """
    Extract JLPT level (e.g. 'N4') and section ('grammar', 'reading', 'vocabulary', 'kanji', 'listening')
    from URL path or title.
    """
    combined = f"{url} {title}".lower()

    level = ""
    for lvl in ("n1", "n2", "n3", "n4", "n5"):
        if f"jlpt-{lvl}" in combined or f"jlpt {lvl}" in combined or f"-{lvl}-" in combined or f"/{lvl}/" in combined:
            level = lvl.upper()
            break

    section = "grammar"
    if "reading" in combined:
        section = "reading"
    elif "kanji" in combined:
        section = "kanji"
    elif "listening" in combined or "choukai" in combined:
        section = "listening"
    elif "vocabulary" in combined or "vocab" in combined or "goi" in combined:
        section = "vocabulary"
    elif "grammar" in combined or "bunpou" in combined:
        section = "grammar"

    return level, section
