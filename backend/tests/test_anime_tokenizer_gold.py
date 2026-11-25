"""Anime dialogue gold-standard tokenization & pre-cleaning tests."""
from __future__ import annotations

import pytest

from app.services.subtitle_annotator import get_subtitle_annotator_service
from app.services.tokenizers import get_sudachi_tokenizer, sudachi_status
from app.services.tokenizers.merge import merge_morphemes


pytestmark = pytest.mark.skipif(
    not sudachi_status("core").get("ready"),
    reason="Sudachi core dictionary not available",
)


ANIME_GOLD_CASES = [
    ("宿題を忘れて全部食べちゃった。", [("宿題", "宿題"), ("忘れ", "忘れる"), ("全部", "全部"), ("食べちゃった", "食べる")]),
    ("早く行かなきゃ間に合わないじゃん！", [("早く", "早い"), ("行かなきゃ", "行く"), ("間に合わない", "間に合う"), ("じゃん", "じゃん")]),
    ("今月中に4人入部しないと廃部になっちゃうの。", [("今月中", "今月中"), ("入部", "入部"), ("しない", "する"), ("廃部", "廃部"), ("なっちゃう", "なる")]),
    ("実はどの部活に入ろうか迷ってて…", [("実は", "実は"), ("部活", "部活"), ("入ろう", "入る"), ("迷って", "迷う")]),
    ("予約しとくから大丈夫だってば。", [("予約", "予約"), ("しとく", "する"), ("大丈夫だ", "大丈夫")]),
]


@pytest.mark.parametrize("sentence,expected_pairs", ANIME_GOLD_CASES)
def test_anime_dialogue_tokenization_gold(sentence: str, expected_pairs: list[tuple[str, str]]):
    tok = get_sudachi_tokenizer("core")
    merged = merge_morphemes(tok.tokenize(sentence))
    actual = [(m.surface, m.lemma) for m in merged]
    for exp in expected_pairs:
        assert exp in actual, f"Expected {exp} in {actual}"


def test_subtitle_annotator_strips_ass_and_html_tags():
    ann = get_subtitle_annotator_service("N3")
    res = ann.annotate_cues(
        [
            {"id": "0", "start_ms": 0, "end_ms": 2000, "text": r"{\be1}終業チャイムまで<i>待てない</i>\N早く行かなきゃ"},
        ],
        learner_level="N3",
    )
    surfaces = [t["surface"] for t in res[0]["tokens"]]
    lemmas = [t["lemma"] for t in res[0]["tokens"]]
    assert "{" not in surfaces and "be1" not in surfaces and "i" not in surfaces
    assert "終業チャイム" in surfaces
    assert "待つ" in lemmas
    assert "行く" in lemmas
