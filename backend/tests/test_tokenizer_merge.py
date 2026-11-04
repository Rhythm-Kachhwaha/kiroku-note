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
