"""Offline golden checks for source markup fidelity and provenance flags."""
from __future__ import annotations

from pathlib import Path

from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser


FIXTURES = Path(__file__).parent / "fixtures" / "study_acquisition"


def test_golden_fixtures_preserve_question_families() -> None:
    parser = JapaneseTest4YouParser()
    grammar = parser.parse(
        (FIXTURES / "raw_keenable_exercise_1.md").read_text(encoding="utf-8"),
        url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/",
    )
    reading = parser.parse(
        (FIXTURES / "raw_keenable_reading_2.md").read_text(encoding="utf-8"),
        url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-2/",
    )
    orthography = parser.parse(
        (FIXTURES / "synthetic_orthography.md").read_text(encoding="utf-8"),
        url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n1-kanji-exercise-2/",
    )

    assert grammar.questions[0].stem and len(grammar.questions[0].choices) == 4
    assert grammar.questions[0].answer is not None
    assert reading.questions[0].group_reference == "passage_1"
    assert reading.questions[0].answer is not None
    assert orthography.questions[0].answer is not None


def test_explicit_markup_and_degradation_flags_are_conservative() -> None:
    parser = JapaneseTest4YouParser()
    marked = parser.parse(
        """Title: JLPT N4 Grammar Exercise 99
1. <u>大切</u> なことです。
選択肢１
選択肢２
選択肢３
選択肢４
**Answer Key:**
Question 1: 1 (大切)
""",
        url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-99/",
    )
    assert "{u|大切}" in marked.questions[0].stem
    assert "underline_unverified" not in marked.fidelity_flags

    degraded = parser.parse(
        """Title: JLPT N4 Grammar Exercise 98
1. <ruby><rb>漢字</rb><rt>かんじ</rt></ruby> _______。
選択肢１
選択肢２
**Answer Key:**
Question 1: 1
""",
        url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-98/",
    )
    assert "choice_layout_ambiguous" in degraded.fidelity_flags
    assert "ruby_unverified" not in degraded.fidelity_flags
