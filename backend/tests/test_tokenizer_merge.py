"""Tests for morpheme merging rules and lemma normalization."""
from __future__ import annotations

import pytest

from app.services.tokenizers.base import Morpheme
from app.services.tokenizers.merge import merge_morphemes
from app.services.tokenizers.sudachi import get_sudachi_tokenizer


@pytest.fixture(scope="module")
def sudachi():
    return get_sudachi_tokenizer("small")


def test_merge_assert_table(sudachi):
    """Assert table required by Slice 9:
    お茶, お母さん, 先生たち, 待てない->待つ, 美味しい
    """
    cases = [
        ("お茶", "お茶", "お茶"),
        ("お母さん", "お母さん", "お母さん"),
        ("先生たち", "先生たち", "先生"),
        ("待てない", "待てない", "待つ"),
        ("美味しい", "美味しい", "美味しい"),
    ]
    for text, expected_surface, expected_lemma in cases:
        tokens = sudachi.tokenize(text)
        merged = merge_morphemes(tokens)
        assert len(merged) == 1, f"Expected 1 merged unit for {text}, got {merged}"
        assert merged[0].surface == expected_surface
        assert merged[0].lemma == expected_lemma


def test_adjective_stem_not_split(sudachi):
    """Verify 美味しい, 楽しい, 難しい are not split into stem + しい/い."""
    for word in ["美味しい", "楽しい", "難しい"]:
        tokens = sudachi.tokenize(word)
        merged = merge_morphemes(tokens)
        assert len(merged) == 1
        assert merged[0].surface == word
        assert merged[0].lemma == word

    # Also test handling when split morphemes are directly passed
    m_bimi = Morpheme("美味", "美味", "オイシ", ("名詞",), 0, 2, "美味")
    m_shii = Morpheme("しい", "しい", "シイ", ("接尾辞",), 2, 4, "しい")
    merged_split_bimi = merge_morphemes([m_bimi, m_shii])
    assert len(merged_split_bimi) == 1
    assert merged_split_bimi[0].surface == "美味しい"
    assert merged_split_bimi[0].lemma == "美味しい"

    m_tanoshi = Morpheme("楽し", "楽し", "タノシ", ("形容詞",), 0, 2, "楽し")
    m_i = Morpheme("い", "い", "イ", ("助動詞",), 2, 3, "い")
    merged_split_tanoshi = merge_morphemes([m_tanoshi, m_i])
    assert len(merged_split_tanoshi) == 1
    assert merged_split_tanoshi[0].surface == "楽しい"
    assert merged_split_tanoshi[0].lemma == "楽しい"

    m_muzukashi = Morpheme("難し", "難し", "ムズカシ", ("形容詞",), 0, 2, "難し")
    merged_split_muzukashi = merge_morphemes([m_muzukashi, m_i])
    assert len(merged_split_muzukashi) == 1
    assert merged_split_muzukashi[0].surface == "難しい"
    assert merged_split_muzukashi[0].lemma == "難しい"


def test_potential_form_lemma_normalization(sudachi):
    """一段 potential of godan verbs in vocab normalize to godan base."""
    cases = [
        ("読める", "読む"),
        ("話せる", "話す"),
        ("行けない", "行く"),
        ("買えない", "買う"),
    ]
    for text, expected_lemma in cases:
        tokens = sudachi.tokenize(text)
        merged = merge_morphemes(tokens)
        assert len(merged) == 1
        assert merged[0].lemma == expected_lemma


def test_contraction_merges_including_inflected_forms(sudachi):
    """てる/でる/ちゃう/じゃう contractions merge cleanly across inflections."""
    cases = [
        ("歩いてる", "歩いてる", "歩く"),
        ("歩いてた", "歩いてた", "歩く"),
        ("歩いてたら", "歩いてたら", "歩く"),
        ("飲んでる", "飲んでる", "飲む"),
        ("飲んでた", "飲んでた", "飲む"),
        ("飲んでたら", "飲んでたら", "飲む"),
        ("食べちゃう", "食べちゃう", "食べる"),
        ("食べちゃった", "食べちゃった", "食べる"),
        ("食べちゃって", "食べちゃって", "食べる"),
        ("食べちゃったら", "食べちゃったら", "食べる"),
        ("飲んじゃう", "飲んじゃう", "飲む"),
        ("飲んじゃった", "飲んじゃった", "飲む"),
        ("飲んじゃって", "飲んじゃって", "飲む"),
        ("飲んじゃったら", "飲んじゃったら", "飲む"),
    ]
    for text, expected_surface, expected_lemma in cases:
        merged = merge_morphemes(sudachi.tokenize(text))
        assert len(merged) == 1, f"Expected 1 token for {text}, got {merged}"
        assert merged[0].surface == expected_surface
        assert merged[0].lemma == expected_lemma


def test_honorific_prefixes_and_suru_nouns(sudachi):
    """Honorific お/ご + suru-nouns never produce fake lemmas like 願いする or お願う."""
    merged_onegaishimasu = merge_morphemes(sudachi.tokenize("お願いします"))
    assert [(m.surface, m.lemma) for m in merged_onegaishimasu] == [
        ("お願い", "お願い"),
        ("します", "する"),
    ]
    assert all("願いする" not in m.lemma and "お願う" not in m.lemma for m in merged_onegaishimasu)

    merged_itasu = merge_morphemes(sudachi.tokenize("お願いいたします"))
    assert [(m.surface, m.lemma) for m in merged_itasu] == [
        ("お願い", "お願い"),
        ("いたします", "いたす"),
    ]

    merged_denwa = merge_morphemes(sudachi.tokenize("お電話します"))
    assert [(m.surface, m.lemma) for m in merged_denwa] == [
        ("お電話", "電話"),
        ("します", "する"),
    ]

    merged_renraku = merge_morphemes(sudachi.tokenize("ご連絡します"))
    assert [(m.surface, m.lemma) for m in merged_renraku] == [
        ("ご連絡", "連絡"),
        ("します", "する"),
    ]


def test_auxiliary_suffixes_stay_separable(sudachi):
    """らしい, そう, みたい, なさい stay separable grammar tokens."""
    merged_rashii = merge_morphemes(sudachi.tokenize("食べさせられたくなかったらしい"))
    assert [(m.surface, m.lemma) for m in merged_rashii] == [
        ("食べさせられたくなかった", "食べる"),
        ("らしい", "らしい"),
    ]

    merged_sou = merge_morphemes(sudachi.tokenize("雨が降りそうだ"))
    assert [(m.surface, m.lemma) for m in merged_sou] == [
        ("雨", "雨"),
        ("が", "が"),
        ("降り", "降る"),
        ("そう", "そう"),
        ("だ", "だ"),
    ]

    merged_mitai = merge_morphemes(sudachi.tokenize("学生みたいだ"))
    assert [(m.surface, m.lemma) for m in merged_mitai] == [
        ("学生", "学生"),
        ("みたい", "みたい"),
        ("だ", "だ"),
    ]

    merged_genki_sou = merge_morphemes(sudachi.tokenize("元気そう"))
    assert [(m.surface, m.lemma) for m in merged_genki_sou] == [
        ("元気", "元気"),
        ("そう", "そう"),
    ]

    merged_shinasai = merge_morphemes(sudachi.tokenize("しなさい"))
    assert [(m.surface, m.lemma) for m in merged_shinasai] == [
        ("し", "する"),
        ("なさい", "なさる"),
    ]
