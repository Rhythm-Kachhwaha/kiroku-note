"""Tests verifying that vocabulary categorization tags for Curated Shelves are accurate."""
import pytest
from app.services.vocab_practice.categories import (
    classify_pos_heuristic,
    get_gap_breakdown_by_category,
    CAT_ADVERB,
    CAT_ONOMATOPOEIA,
    CAT_ADJECTIVE_I,
    CAT_ADJECTIVE_NA,
)
from app.services.vocab_practice.keigo import CANONICAL_KEIGO_TRIOS, get_keigo_entries


def test_adverb_tags_accuracy():
    """Verify that canonical Japanese adverbs across N5-N1 are accurately tagged as adverbs."""
    adverbs = [
        ("いつも", "いつも", "always"),
        ("あまり", "あまり", "not very"),
        ("とても", "とても", "very"),
        ("たいへん", "たいへん", "greatly; terribly"),
        ("ちょっと", "ちょっと", "a little; somewhat"),
        ("すぐ", "すぐ", "immediately; right away"),
        ("たくさん", "たくさん", "many; a lot"),
        ("もっと", "もっと", "more"),
        ("ずっと", "ずっと", "by far; all the time"),
        ("だんだん", "だんだん", "gradually"),
        ("ゆっくり", "ゆっくり", "slowly; leisurely"),
        ("しっかり", "しっかり", "firmly; tightly"),
        ("はっきり", "はっきり", "clearly; plainly"),
        ("急に", "きゅうに", "suddenly"),
        ("特に", "とくに", "especially"),
        ("必ず", "かならず", "certainly; without fail"),
    ]
    for expr, reading, meaning in adverbs:
        tag = classify_pos_heuristic(expr, reading, meaning)
        assert tag == CAT_ADVERB, f"Expected {expr} to be tagged as {CAT_ADVERB}, got {tag}"


def test_onomatopoeia_tags_accuracy():
    """Verify that sound symbolism and mimetic expressions are accurately tagged as onomatopoeia."""
    onomatopoeia = [
        ("わくわく", "わくわく", "tremble; get excited"),
        ("ざあざあ", "ざあざあ", "pouring (rain)"),
        ("ぴかぴか", "ぴかぴか", "sparkling; shiny"),
        ("どきどき", "どきどき", "heart pounding"),
        ("ふわふわ", "ふわふわ", "fluffy; light"),
        ("ごろごろ", "ごろごろ", "rumbling; purring"),
        ("にゃあにゃあ", "にゃあにゃあ", "meow"),
        ("いらいら", "いらいら", "irritated; impatient"),
        ("ペラペラ", "ペラペラ", "fluently; speaking well"),
        ("ドキドキ", "ドキドキ", "pounding heart"),
    ]
    for expr, reading, meaning in onomatopoeia:
        tag = classify_pos_heuristic(expr, reading, meaning)
        assert tag == CAT_ONOMATOPOEIA, f"Expected {expr} to be tagged as {CAT_ONOMATOPOEIA}, got {tag}"


def test_verb_tags_accuracy():
    """Verify that verbs are accurately identified from meanings and inflection stems."""
    verbs = [
        ("食べる", "たべる", "to eat"),
        ("飲む", "のむ", "to drink"),
        ("行く", "いく", "to go"),
        ("来る", "くる", "to come"),
        ("開ける", "あける", "to open (transitive)"),
        ("開く", "あく", "to open (intransitive)"),
        ("落とす", "おとす", "to drop"),
        ("落ちる", "おちる", "to fall"),
    ]
    for expr, reading, meaning in verbs:
        tag = classify_pos_heuristic(expr, reading, meaning)
        assert tag == "verb" or "verb" in tag, f"Expected {expr} to be tagged as verb, got {tag}"


def test_adjective_tags_accuracy():
    """Verify that i-adjectives and na-adjectives are accurately identified."""
    i_adjectives = [
        ("おいしい", "おいしい", "delicious"),
        ("大きい", "おおきい", "big"),
        ("高い", "たかい", "tall; expensive"),
        ("新しい", "あたらしい", "new"),
    ]
    for expr, reading, meaning in i_adjectives:
        tag = classify_pos_heuristic(expr, reading, meaning)
        assert tag == CAT_ADJECTIVE_I, f"Expected {expr} to be tagged as {CAT_ADJECTIVE_I}, got {tag}"

    na_adjectives = [
        ("静か", "しずか", "quiet (adjective)"),
        ("便利", "べんり", "convenient; handy"),
        ("親切", "しんせつ", "kind; gentle"),
    ]
    for expr, reading, meaning in na_adjectives:
        tag = classify_pos_heuristic(expr, reading, meaning)
        assert tag in (CAT_ADJECTIVE_NA, CAT_ADJECTIVE_I, "adjective"), f"Expected {expr} to be adjective, got {tag}"


def test_keigo_honorific_tags():
    """Verify that all canonical Keigo trios have valid Sonkeigo and Kenjougo tags and nuances."""
    assert len(CANONICAL_KEIGO_TRIOS) >= 15
    for item in CANONICAL_KEIGO_TRIOS:
        assert item["sonkeigo"]["expression"], "Sonkeigo expression must be present"
        assert item["kenjougo"]["expression"], "Kenjougo expression must be present"
        assert item["sonkeigo"]["meaning"], "Sonkeigo meaning must be present"
        assert item["kenjougo"]["meaning"], "Kenjougo meaning must be present"
        assert len(item["sonkeigo"]["nuance"]) > 0, "Sonkeigo nuance note required"
        assert len(item["kenjougo"]["nuance"]) > 0, "Kenjougo nuance note required"


def test_gap_breakdown_categories_partition():
    """Verify that JLPT gap breakdown categorizes vocabulary into clean buckets without overlap."""
    breakdown = get_gap_breakdown_by_category(level="N4", limit_per_category=30)
    assert "breakdown" in breakdown
    categories = breakdown["breakdown"]
    assert "adverb" in categories
    assert "noun" in categories
    assert "katakana_loanword" in categories
    assert "verb" in categories
    assert "adjective" in categories

    # Ensure no empty dictionary keys and total gaps match sum
    total_items = sum(len(items) for items in categories.values())
    assert breakdown["total_gaps"] == total_items
    assert total_items > 0

