import json
import sqlite3
from pathlib import Path

import pytest

from app.services.grammar_matcher import GrammarMatcher
from app.services.grammar_reference import GrammarReferenceService


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
    ("行けば行くほど上手になる。", "ばほど"), ("考えれば考えるほど難しい。", "ばほど"),
    ("本とか映画とかが好きだ。", "とかとか"), ("野菜とか果物とかを買う。", "とかとか"),
    ("雨にもかかわらず出かけた。", "にもかかわらず"), ("忙しいにもかかわらず来た。", "にもかかわらず"),
    ("学生にしては詳しい。", "にしては"), ("子供にしては落ち着いている。", "にしては"),
    ("先生がお話しになる。", "おになる"), ("社長がお読みになる。", "おになる"),
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


def test_new_index_row_is_matchable_without_matcher_code_change(tmp_path):
    database = tmp_path / "grammar.sqlite"
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            CREATE TABLE grammar_index (
                id INTEGER PRIMARY KEY, pattern_display TEXT, pattern_key TEXT,
                level TEXT, meaning_short TEXT, english_breakdown TEXT,
                formation TEXT, variants JSON, matcher JSON, guards JSON,
                examples JSON, group_id TEXT, source TEXT
            )
            """
        )
        connection.execute(
            """INSERT INTO grammar_index
            (pattern_display, pattern_key, level, meaning_short,
             english_breakdown, formation, variants, matcher, examples, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "〜テスト", "テスト", "N5", "test", "test", None, "[]",
                json.dumps({"type": "pattern", "variants": ["テスト"]}),
                "[]", "test",
            ),
        )
        connection.commit()
    matcher = GrammarMatcher(GrammarReferenceService(database))
    items = matcher.match_sentence(
        [{"text": char} for char in "これはテストです。"], "これはテストです。"
    )
    assert any(item.pattern_key == "テスト" for item in items)


def test_causative_passive_conjugations_match_sentence():
    matcher = GrammarMatcher()

    # 1. Past tense form (Fix 1 verification)
    past = matcher.match_sentence(tokens("掃除させられた。"), "掃除させられた。")
    assert any(item.pattern_key == "使役受身" for item in past)
    match_past = next(item for item in past if item.pattern_key == "使役受身")
    assert match_past.text == "掃除させられた"
    assert match_past.level == "N4"

    # 2. Non-past form
    non_past = matcher.match_sentence(tokens("掃除させられる。"), "掃除させられる。")
    assert any(item.pattern_key == "使役受身" for item in non_past)
    match_np = next(item for item in non_past if item.pattern_key == "使役受身")
    assert match_np.text == "掃除させられる"

    # 3. Negative form
    negative = matcher.match_sentence(tokens("掃除させられない。"), "掃除させられない。")
    assert any(item.pattern_key == "使役受身" for item in negative)
    match_neg = next(item for item in negative if item.pattern_key == "使役受身")
    assert match_neg.text == "掃除させられない"

    # 4. Desire negative past form
    desire_neg_past = matcher.match_sentence(tokens("掃除させられたくなかった。"), "掃除させられたくなかった。")
    assert any(item.pattern_key == "使役受身" for item in desire_neg_past)
    match_dnp = next(item for item in desire_neg_past if item.pattern_key == "使役受身")
    assert match_dnp.text == "掃除させられたくなかった"

    # 5. Unrelated sentence does not produce false positive
    unrelated = matcher.match_sentence(tokens("部屋を綺麗に掃除した。"), "部屋を綺麗に掃除した。")
    assert not any(item.pattern_key == "使役受身" for item in unrelated)


def test_colliding_patterns_with_different_meanings_both_match():
    # Verify that concepts sharing a pattern key (such as らしい N4 vs N3 or のに contrast vs purpose)
    # are both preserved and matchable.
    matcher = GrammarMatcher()
    sentence = "彼は学生らしい。"
    items = matcher.match_sentence(tokens(sentence), sentence)
    assert any(item.pattern_key == "らしい" for item in items)

    # Check that service exposes both concept lookup and key lookup
    ref = matcher.reference
    pt = ref.get_point_by_key("らしい")
    assert pt is not None
    assert len(pt["sources"]) >= 2


