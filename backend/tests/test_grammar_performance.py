"""Performance benchmark for GrammarMatcher.match_sentence.

Measures per-sentence grammar analysis cost on a representative set of
Japanese sentences using the bundled grammar index. Results are printed for the
record; a generous upper-bound assertion guards against runaway regression
without being machine-flaky (the ~10 ms/sentence target and Windows timings are
verified by the owner on the target machine per R16).
"""
from __future__ import annotations

import time

import pytest

from app.services.grammar_matcher import GrammarMatcher

# Representative sentences spanning inflection chains, compounds, particles,
# loanwords, and mixed content. Kept independent of the span tests so this
# benchmark survives refactors of the span test fixtures.
SENTENCES = [
    "食べてしまった。",
    "忘れてしまう。",
    "やってしまった。",
    "言ってちゃった。",
    "食べちゃった。",
    "寝ちゃう。",
    "行かなければならない。",
    "見なきゃ。",
    "勉強しなくてはいけない。",
    "帰らなきゃならない。",
    "見たことがある。",
    "行ったことがあります。",
    "読んでおく。",
    "予約しとく。",
    "行けば行くほど上手になる。",
    "考えれば考えるほど難しい。",
    "本とか映画とかが好きだ。",
    "雨にもかかわらず出かけた。",
    "忙しいにもかかわらず来た。",
    "学生にしては詳しい。",
    "子供にしては落ち着いている。",
    "先生がお話しになる。",
    "社長がお読みになる。",
    "雨が降りそうだ。",
    "彼は元気そうだ。",
    "雨が降るそうだ。",
    "先生が来たそうだ。",
    "これは本当らしい。",
    "彼は学生らしい。",
    "行くわけではない。",
    "嫌いなわけではない。",
    "そんなわけがない。",
    "彼が来るわけがない。",
    "何もせずに寝た。",
    "朝食を食べずに出た。",
    "諦めかねない。",
    "事故になりかねない。",
    "彼は来たところで帰った。",
    "今さら言ったところで遅い。",
    "彼は何でもできるものだ。",
    "昔はよく遊んだものだ。",
    "毎日運動するようにしている。",
    "ここに名前を書いてください。",
    "私は日本語を勉強している。",
    "寿司を食べたい。",
    "友達と公園に行っている。",
]


def _time_match_sentence(matcher: GrammarMatcher, sentence: str) -> float:
    tokens = [{"text": ch} for ch in sentence]
    start = time.perf_counter()
    matcher.match_sentence(tokens, sentence)
    return (time.perf_counter() - start) * 1000.0


def test_match_sentence_per_record_is_reported_and_bounded():
    matcher = GrammarMatcher()
    timings_ms: list[float] = []
    for sentence in SENTENCES:
        timings_ms.append(_time_match_sentence(matcher, sentence))

    total_ms = sum(timings_ms)
    avg_ms = total_ms / len(SENTENCES)
    print(
        f"[grammar-perf] sentences={len(SENTENCES)} "
        f"total_ms={total_ms:.2f} avg_ms={avg_ms:.3f} "
        f"max_ms={max(timings_ms):.3f}"
    )

    # Generous, non-flaky upper bound: the whole batch must complete quickly.
    # The owner verifies the ~10 ms/sentence target on the target Windows
    # machine; this assertion only guards against a catastrophic regression.
    assert total_ms < 5000.0, f"grammar analysis too slow: {total_ms:.2f} ms total"

    # Regression guard: optimization must not change what  てしまう matches.
    sentence = "食べちゃった。"
    spans = matcher.match_sentence([{"text": ch} for ch in sentence], sentence)
    assert any(s.pattern_key == "てしまう" and s.text == "食べちゃった" for s in spans)


@pytest.mark.parametrize("sentence", SENTENCES)
def test_each_sentence_completes_quickly(sentence: str):
    """Per-sentence ceiling: no single sentence should take an unreasonable
    amount of time. Bound is deliberately generous to avoid flakiness."""
    matcher = GrammarMatcher()
    elapsed_ms = _time_match_sentence(matcher, sentence)
    assert elapsed_ms < 500.0, f"{sentence!r} took {elapsed_ms:.2f} ms"
