import pytest
from app.api.vocab_inventory import get_vocab_inventory

def test_vocab_inventory_adverbs_shelf():
    res = get_vocab_inventory(category="adverb", jlpt_level="N4", include_reference=True, limit=50)
    assert res.total > 0
    assert len(res.items) > 0
    # Every item returned should match adverb category
    for it in res.items:
        assert any("adverb" in c or "adv" in c for c in it.categories)
        assert not it.expression.startswith("word_")

def test_vocab_inventory_adjectives_shelf():
    res = get_vocab_inventory(category="adjective", jlpt_level="N4", include_reference=True, limit=50)
    assert res.total > 0
    assert len(res.items) > 0
    for it in res.items:
        assert any("adj" in c for c in it.categories)
        assert not it.expression.startswith("word_")

def test_vocab_inventory_filters_out_test_words():
    res = get_vocab_inventory(include_reference=False, limit=200)
    for it in res.items:
        assert not it.expression.startswith("word_")
        assert not it.expression.startswith("test_")

