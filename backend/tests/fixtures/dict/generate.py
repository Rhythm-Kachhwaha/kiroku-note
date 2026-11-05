"""Synthetic dictionary fixture generator (zero licensed data)."""
from __future__ import annotations

import json
from pathlib import Path
import zipfile


def create_synthetic_jitendex_zip(dest_path: Path) -> Path:
    """Create a minimal Yomitan-compliant Jitendex zip archive."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    index_json = {
        "title": "Jitendex (Synthetic Test)",
        "format": 3,
        "revision": "test.2026.1",
        "sequenced": True,
        "author": "Kiroku Test Suite",
    }

    # Yomitan term bank format:
    # [term, reading, def_tags, rules, score, glossary, sequence, term_tags]
    terms = [
        # 1. 食べる (v1)
        ["食べる", "たべる", "", "v1", 100, ["to eat", "to consume"], 1, "v1"],
        # 2. 行く (v5k, v5)
        ["行く", "いく", "", "v5k v5", 100, ["to go", "to move"], 2, "v5"],
        # 3. 高い (adj-i)
        ["高い", "たかい", "", "adj-i", 100, ["high", "expensive", "tall"], 3, "adj-i"],
        # 4. ご飯 (noun) vs 飯 (noun)
        ["ご飯", "ごはん", "", "", 100, ["cooked rice", "meal"], 4, "n"],
        ["飯", "めし", "", "", 40, ["meal", "cooked grains"], 5, "n"],
        # 5. 学校 (noun)
        ["学校", "がっこう", "", "", 100, ["school", "educational institution"], 6, "n"],
        # 6. コーヒー (loanword)
        ["コーヒー", "コーヒー", "", "", 100, ["coffee"], 7, "n"],
        # 7. ありがとう (interjection)
        ["ありがとう", "ありがとう", "", "", 100, ["thank you"], 8, "int"],
        # 8. Okurigana variants: 行う and 行なう
        ["行う", "おこなう", "", "v5", 100, ["to perform", "to conduct", "to do"], 9, "v5"],
        ["行なう", "おこなう", "", "v5", 90, ["to perform", "to conduct", "to do"], 10, "v5"],
    ]

    with zipfile.ZipFile(dest_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.json", json.dumps(index_json, ensure_ascii=False))
        zf.writestr("term_bank_1.json", json.dumps(terms, ensure_ascii=False))

    return dest_path


def create_synthetic_kanjidic_zip(dest_path: Path) -> Path:
    """Create a minimal Yomitan-compliant KANJIDIC zip archive."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    index_json = {
        "title": "KANJIDIC (Synthetic Test)",
        "format": 3,
        "revision": "test.2026.1",
        "author": "Kiroku Test Suite",
    }

    # Yomitan kanji bank format:
    # [character, onyomi, kunyomi, tags, meanings, stats]
    kanji = [
        ["食", "ショク", "た.べる", "grade2", ["eat", "food"], {"grade": "2"}],
        ["行", "コウ ギョウ", "い.く ゆ.く おこな.う", "grade2", ["going", "journey", "act"], {"grade": "2"}],
        ["高", "コウ", "たか.い", "grade2", ["tall", "high", "expensive"], {"grade": "2"}],
        ["飯", "ハン", "めし", "grade4", ["meal", "boiled rice"], {"grade": "4"}],
        ["学", "ガク", "まな.ぶ", "grade1", ["study", "learning", "science"], {"grade": "1"}],
        ["校", "コウ", "", "grade1", ["school", "exam"], {"grade": "1"}],
    ]

    with zipfile.ZipFile(dest_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.json", json.dumps(index_json, ensure_ascii=False))
        zf.writestr("kanji_bank_1.json", json.dumps(kanji, ensure_ascii=False))

    return dest_path
