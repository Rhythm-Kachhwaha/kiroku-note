"""End-to-end acceptance gate for the Part 2 grammar subsystem.

The corpus is intentionally kept here (rather than in a unit-test fixture) so
future grammar-index changes have a visible precision/recall contract.
"""
from __future__ import annotations

from time import perf_counter

from app.repositories.card_repository import CardDraft, CardRepository
from app.services.card_service import CardService
from app.services.grammar_matcher import GrammarMatcher
from app.services.grammar_service import GrammarService


class OfflineProvider:
    supports_sentence_tokenization = False

    def tokenize_with_inflection(self, text: str):
        raise RuntimeError("acceptance benchmark is offline")


CORPUS = [
    ("宿題を忘れて食べてしまった。", "てしまう"),
    ("食べちゃった。", "てしまう"),
    ("行かなければならない。", "なければならない"),
    ("行かなきゃ。", "なければならない"),
    ("見たことがある。", "たことがあります"),
    ("雨が降りそうだ。", "そうだ(appearance)"),
    ("雨が降るそうだ。", "そうだ(hearsay)"),
    ("来るはずがない。", "はずがない"),
    ("食べさせられたくなかった。", "使役受身"),
    ("ことになった。", "ことになる"),
    ("かもしれない。", "かもしれない"),
    ("ざるを得ない。", "ざるを得ない"),
    ("雨にもかかわらず出かけた。", "にもかかわらず"),
    ("行けば行くほど上手になる。", "ばほど"),
    ("お茶を飲むとかテレビを見ている。", "とかとか"),
    ("学生にしては詳しい。", "にしては"),
    ("先生がお話しになる。", "おになる"),
    ("読んでおく。", "ておく"),
    ("予約しとく。", "ておく"),
    ("行ったことがあります。", "たことがあります"),
    ("勉強しなくてはいけない。", "なければならない"),
    ("帰らなきゃならない。", "なければならない"),
    ("忘れてしまう。", "てしまう"),
    ("寝ちゃう。", "てしまう"),
    ("考えれば考えるほど難しい。", "ばほど"),
    ("本とか映画とかが好きだ。", "とかとか"),
    ("野菜とか果物とかを買う。", "とかとか"),
    ("忙しいにもかかわらず来た。", "にもかかわらず"),
    ("子供にしては落ち着いている。", "にしては"),
    ("社長がお読みになる。", "おになる"),
    ("彼は元気そうだ。", "そうだ(appearance)"),
    ("先生が来たそうだ。", "そうだ(hearsay)"),
    ("これは本当らしい。", "らしい"),
    ("彼は学生らしい。", "らしい"),
    ("行くわけではない。", "わけではない"),
    ("嫌いなわけではない。", "わけではない"),
    ("そんなわけがない。", "わけがない"),
    ("何もせずに寝た。", "ずに"),
    ("朝食を食べずに出た。", "ずに"),
    ("諦めかねない。", "かねない"),
    ("事故になりかねない。", "かねない"),
    ("彼は来たところで帰った。", "たところで"),
    ("今さら言ったところで遅い。", "たところで"),
    ("彼は何でもできるものだ。", "ものだ"),
    ("昔はよく遊んだものだ。", "ものだ"),
    # Extended 5-level positive cases (N5-N1)
    ("日本に行きたい。", "たい"),
    ("雨が降っている。", "ている"),
    ("寝る前に歯を磨く。", "前に"),
    ("食べた後で散歩した。", "後で"),
    ("高くておいしい。", "くて"),
    ("母に部屋を掃除させられた。", "使役受身"),
    ("料理がおいしい上に安い。", "上に"),
    ("彼は最後まで走り抜いた。", "抜く"),
    ("成功を目指すべく努力する。", "べく"),
    ("あんな失敗は二度とするまい。", "まい"),
    ("思い出すだに恐ろしい。", "だに"),
    ("料理といい接客といい素晴らしい。", "といいといい"),
    ("春めいてきた。", "めく"),
]


def _tokens(sentence: str) -> list[dict[str, str]]:
    return [{"text": char} for char in sentence]


def test_acceptance_corpus_precision_recall_and_negative_particles():
    matcher = GrammarMatcher()
    true_positives = 0
    false_positives = 0
    for sentence, expected in CORPUS:
        items = matcher.match_sentence(_tokens(sentence), sentence)
        if any(item.pattern_key == expected for item in items):
            true_positives += 1
        else:
            raise AssertionError(f"missed {expected!r} in {sentence!r}: {items}")
        false_positives += sum(
            item.text in {"は", "が", "を", "に", "へ", "で", "と", "の", "も"}
            and len(item.text) == 1
            for item in items
        )
    negative = "学校に行って友達に会った。"
    negative_items = matcher.match_sentence(_tokens(negative), negative)
    false_positives += sum(len(item.text) == 1 for item in negative_items if item.text in {"に", "で", "て"})
    assert false_positives == 0
    assert true_positives == len(CORPUS)
    assert true_positives / len(CORPUS) >= 0.95


def test_ambiguity_and_discontinuous_spans_are_preserved():
    matcher = GrammarMatcher()
    appearance = matcher.match_sentence(_tokens("雨が降りそうだ。"), "雨が降りそうだ。")
    hearsay = matcher.match_sentence(_tokens("雨が降るそうだ。"), "雨が降るそうだ。")
    assert next(x for x in appearance if x.pattern_key == "そうだ(appearance)").confidence == "medium"
    assert next(x for x in hearsay if x.pattern_key == "そうだ(hearsay)").confidence == "high"
    for sentence, key in (("行けば行くほど上手になる。", "ばほど"), ("お茶を飲むとかテレビを見ている。", "とかとか")):
        item = next(x for x in matcher.match_sentence(_tokens(sentence), sentence) if x.pattern_key == key)
        assert item.start < item.end and "Matched here" not in item.english_breakdown


def test_latency_and_single_word_capture_preservation(tmp_path):
    sentence = "宿題を忘れて食べてしまった。"
    service = GrammarService(provider=OfflineProvider(), db_path=tmp_path / "grammar.sqlite")
    start = perf_counter()
    cold = service.analyze(sentence)
    cold_seconds = perf_counter() - start
    start = perf_counter()
    warm = service.analyze(sentence)
    warm_seconds = perf_counter() - start
    assert cold["points"] and warm["cached"] is True
    assert cold_seconds < 4.0
    assert warm_seconds < 1.5
    single = service.analyze("食べる")
    assert single["sentence"] == "食べる"
    assert single["points"] == []


def test_failed_anki_sync_retains_grammar_card(tmp_path):
    class FailingAnki:
        def find_existing_note(self, **kwargs):
            return None

        def add_note(self, **kwargs):
            raise ConnectionError("acceptance Anki is offline")

    repository = CardRepository(tmp_path / "cards.sqlite")
    record, _, _, _ = repository.save_or_update(CardDraft(
        expression="食べてしまった", reading="たべてしまった",
        meaning="ended up eating", deck_name="Default",
        card_kind="grammar", source_text="宿題を忘れて食べてしまった。",
    ))
    result = CardService(card_repository=repository, anki_service=FailingAnki()).sync_card(record.id)
    retained = repository.get_by_id(record.id)
    assert result.sync_status == "failed"
    assert retained is not None
    assert retained.card_kind == "grammar"
    assert retained.sync_status == "failed"
