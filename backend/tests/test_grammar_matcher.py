import json
from pathlib import Path

import pytest

from app.services.grammar_matcher import GrammarMatcher


def tokens(sentence: str) -> list[dict[str, str]]:
    return [{"text": char} for char in sentence]


MATCH_CASES = [
    ("食べてしまった。", "てしまう"), ("忘れてしまう。", "てしまう"),
    ("やってしまった。", "てしまう"), ("言ってちゃった。", "てしまう"),
    ("食べちゃった。", "てしまう"), ("寝ちゃう。", "てしまう"),
    ("行かなければならない。", "なければならない"), ("見なきゃ。", "なければならない"),
    ("勉強しなくてはいけない。", "なければならない"), ("帰らなきゃならない。", "なければならない"),
    ("見たことがある。", "たことがあります"), ("行ったことがあります。", "たことがあります"),
    ("読んでおく。", "ておく"), ("予約しとく。", "ておく"),
    ("行けば行くほど上手になる。", "ば〜ほど"), ("考えれば考えるほど難しい。", "ば〜ほど"),
    ("本とか映画とかが好きだ。", "とか〜とか"), ("野菜とか果物とかを買う。", "とか〜とか"),
    ("雨にもかかわらず出かけた。", "にもかかわらず"), ("忙しいにもかかわらず来た。", "にもかかわらず"),
    ("学生にしては詳しい。", "にしては"), ("子供にしては落ち着いている。", "にしては"),
    ("先生がお話しになる。", "お〜になる"), ("社長がお読みになる。", "お〜になる"),
    ("雨が降りそうだ。", "そうだ(appearance)"), ("彼は元気そうだ。", "そうだ(appearance)"),
    ("雨が降るそうだ。", "そうだ(hearsay)"), ("先生が来たそうだ。", "そうだ(hearsay)"),
    ("これは本当らしい。", "らしい"), ("彼は学生らしい。", "らしい"),
    ("行くわけではない。", "わけではない"), ("嫌いなわけではない。", "わけではない"),
    ("そんなわけがない。", "わけがない"), ("彼が来るわけがない。", "わけがない"),
    ("何もせずに寝た。", "ずに"), ("朝食を食べずに出た。", "ずに"),
    ("諦めかねない。", "かねない"), ("事故になりかねない。", "かねない"),
    ("彼は来たところで帰った。", "たところで"), ("今さら言ったところで遅い。", "たところで"),
    ("彼は何でもできるものだ。", "ものだ"), ("昔はよく遊んだものだ。", "ものだ"),
]


@pytest.mark.parametrize(("sentence", "pattern"), MATCH_CASES)
def test_forty_plus_reference_backed_sentences(sentence: str, pattern: str):
    match = next(
        (item for item in GrammarMatcher().match_sentence(tokens(sentence), sentence)
         if item.pattern_key == pattern),
        None,
    )
    assert match is not None, sentence
    assert match.start < match.end
    assert match.english_breakdown


def test_uses_bundled_yomitan_fixture_tokens():
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "yomitan_sentence_tokenize_fixture.json").read_text(
            encoding="utf-8"
        )
    )
    sentence = fixture["sentence"]
    result = GrammarMatcher().match_sentence(fixture["tokens"], sentence)
    assert result == []  # the fixture is a tokenization contract, not a grammar hit


def test_contraction_has_derived_formation_and_breakdown():
    item = GrammarMatcher().match_sentence(tokens("食べちゃった。"), "食べちゃった。")[0]
    assert item.pattern_key == "てしまう"
    assert item.matched_formation == "V-て + ちゃった"
    assert "Matched here as" in item.english_breakdown


def test_そうだ_distinguishes_appearance_and_hearsay():
    matcher = GrammarMatcher()
    appearance = matcher.match_sentence(tokens("雨が降りそうだ。"), "雨が降りそうだ。")[0]
    hearsay = matcher.match_sentence(tokens("雨が降るそうだ。"), "雨が降るそうだ。")[0]
    assert (appearance.pattern_key, appearance.confidence) == ("そうだ(appearance)", "medium")
    assert (hearsay.pattern_key, hearsay.confidence) == ("そうだ(hearsay)", "high")


def test_longest_span_precedence_marks_overlapping_alternative():
    items = GrammarMatcher().match_sentence(tokens("雨にもかかわらず出かけた。"), "雨にもかかわらず出かけた。")
    assert items[0].pattern_key == "にもかかわらず"
    assert items[0].also_possible is False


def test_bare_particles_are_suppressed_but_compounds_remain():
    sentence = "学校に行って友達に会った。"
    items = GrammarMatcher().match_sentence(tokens(sentence), sentence)
    assert not {item.text for item in items} & {"に", "で", "て"}
    compound = GrammarMatcher().match_sentence(tokens("雨にもかかわらず出かけた。"), "雨にもかかわらず出かけた。")
    assert any(item.pattern_key == "にもかかわらず" for item in compound)


def test_basic_particles_can_be_explicitly_enabled():
    sentence = "学校に行く。"
    items = GrammarMatcher().match_sentence(tokens(sentence), sentence, show_basic_particles=True)
    assert any(item.pattern_key == "に" for item in items)


def test_inflected_span_excludes_preceding_subject_context():
    sentence = "私は食べちゃった。"
    item = next(item for item in GrammarMatcher().match_sentence(tokens(sentence), sentence)
                if item.pattern_key == "てしまう")
    assert item.text == "食べちゃった"


def test_matched_formation_comes_from_the_explicit_suffix_group():
    sentence = "食べてしまって困った。"
    item = next(item for item in GrammarMatcher().match_sentence(tokens(sentence), sentence)
                if item.pattern_key == "てしまう")
    assert item.matched_formation == "V-て + てしまって"


def test_copular_dそうだ_is_hearsay():
    sentence = "これは学生だそうだ。"
    item = next(item for item in GrammarMatcher().match_sentence(tokens(sentence), sentence)
                if item.pattern_key.startswith("そうだ"))
    assert item.pattern_key == "そうだ(hearsay)"
    assert item.text == "学生だそうだ"


def test_takotogaaru_canonical_match_is_not_duplicated():
    sentence = "見たことがある。"
    items = [item for item in GrammarMatcher().match_sentence(tokens(sentence), sentence)
             if item.pattern_key == "たことがあります"]
    assert len(items) == 1
    assert items[0].text == "たことがある"
