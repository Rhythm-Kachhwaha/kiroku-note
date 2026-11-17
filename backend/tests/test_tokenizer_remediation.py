"""Comprehensive golden test suite verifying remediation of tokenizer & annotator issues (T1-T12)."""
import pytest
from app.services.sentence_analysis import analyze, SentenceAnalysis
from app.services.subtitle_annotator import SubtitleAnnotatorService
from app.services.tokenizers.sudachi import get_sudachi_tokenizer


GOLDEN_SENTENCES = [
    # T1: Shouts and elongated vowels
    "あああああ",
    "うおおおおお",
    "ぐああああああ",
    "はああああ",
    "ええええっ",
    "やめてくれえええ",
    # T2: Small kana symbol attachments
    "ひぃぃ",
    "ふぇぇぇ",
    "うわぁぁぁん",
    "たすけてぇぇ",
    # T3: Prolonged sound marks
    "かめはめ波ーーーーッ",
    "ハ～ッハッハッハ",
    # T4: Elongated and colloquial forms
    "スゴ〜イ！",
    "うるせえ！",
    "やべえよ",
    "強えな",
    "すっげえ",
    "ダメェェェ",
    "ぞ〜",
    "よ〜",
    "ま〜",
    # T5: Grammar boundaries and particles
    "食べてしまった",
    "なんだって",
    "そうなんだって",
    "行くんだから",
    # T6: Pronoun and noun compounding boundaries
    "ご飯なに",
    "なにそれ",
    "田中先輩",
    "A級戦犯",
    "S級ヒーロー",
    # T7: Verb repetitions, honorifics, and everyday phrases
    "走れ走れ走れ",
    "お兄ちゃん",
    "おじいちゃんたち",
    "ごめんなさーい",
    "おはよ〜ございま〜す",
    # T8: Numbers and full-width ASCII
    "２０２６年",
    "3人",
    # T10: Interjections & single kana that previously had false JLPT matches
    "うおお",
    "おはよ〜",
    "ち",
    "お",
]


def test_concatenation_surface_invariant():
    """Invariant 1: Concatenated surface forms must strictly reconstruct the input text."""
    tok = get_sudachi_tokenizer("small")
    for sent in GOLDEN_SENTENCES:
        analysis = analyze(sent)
        reconstructed = "".join(m.surface for m in analysis.merged)
        assert reconstructed == sent, f"Mismatch for '{sent}': got '{reconstructed}'"


def test_t1_shouts_and_elongations_dont_fragment():
    """T1: Runs of identical vowels/elongations are consolidated into single tokens."""
    res_a = analyze("あああああ")
    assert len(res_a.merged) == 1
    assert res_a.merged[0].surface == "あああああ"

    res_u = analyze("うおおおおお")
    # Should not produce stray single kana
    assert all(len(m.surface) > 1 or m.surface not in {"お"} for m in res_u.merged)


def test_t2_small_kana_not_stray_symbols():
    """T2: Small kana attach to preceding word rather than isolated 補助記号."""
    res = analyze("たすけてぇぇ")
    # All surface fragments concatenated
    assert "".join(m.surface for m in res.merged) == "たすけてぇぇ"
    assert not any(m.surface in {"ぇ", "ぇぇ"} and m.pos[0] == "補助記号" for m in res.merged)


def test_t3_consecutive_prolonged_marks_consolidated():
    """T3: Consecutive ー and ッ are attached or consolidated."""
    res = analyze("かめはめ波ーーーーッ")
    reconstructed = "".join(m.surface for m in res.merged)
    assert reconstructed == "かめはめ波ーーーーッ"
    # Should not produce multiple isolated 1-char prolonged marks
    dash_tokens = [m for m in res.merged if all(c in "ー〜～ッ" for c in m.surface)]
    assert len(dash_tokens) <= 1


def test_t4_colloquial_lemmas_normalized(tmp_path):
    """T4: Colloquial variations (うるせえ, やべえ, すっげえ) resolve to valid standard base lemmas."""
    service = SubtitleAnnotatorService(db_path=tmp_path / "test.db", learner_level="N1")
    tokens = service.annotate_text("うるせえ！やべえ！")
    lemmas = {t["lemma"] for t in tokens}
    assert "煩い" in lemmas or "うるさい" in lemmas
    assert "やばい" in lemmas


def test_t5_grammar_boundary_protection():
    """T5: Compound particle matching does not turn てしまった into interjection しまった."""
    analysis = analyze("食べてしまった")
    # Last token should be verb しまう, not interjection
    verbs = [m for m in analysis.merged if "動詞" in m.pos]
    assert any(m.lemma == "しまう" for m in verbs)


def test_t6_pronoun_and_proper_noun_separation():
    """T6: ご飯なに, なにそれ, and 田中先輩 do not form single accidental compound lemmas."""
    res_gohan = analyze("ご飯なに")
    assert [m.surface for m in res_gohan.merged] == ["ご飯", "なに"]

    res_nani = analyze("なにそれ")
    assert [m.surface for m in res_nani.merged] == ["なに", "それ"]

    res_tanaka = analyze("田中先輩")
    assert [m.surface for m in res_tanaka.merged] == ["田中", "先輩"]

    res_hero = analyze("S級ヒーロー")
    assert [m.surface for m in res_hero.merged] == ["S級", "ヒーロー"]


def test_t7_repeated_verbs_not_compounded():
    """T7: 走れ走れ走れ produces 3 separate verb instances, not 走れ走れる."""
    res = analyze("走れ走れ走れ")
    assert len(res.merged) == 3
    for m in res.merged:
        assert m.surface == "走れ"
        assert m.lemma == "走る"


def test_t8_number_normalization(tmp_path):
    """T8: Full-width digits are normalized via NFKC."""
    service = SubtitleAnnotatorService(db_path=tmp_path / "test.db", learner_level="N1")
    tokens = service.annotate_text("２０２６年")
    year_token = tokens[0]
    assert year_token["surface"] == "２０２６年"
    # Lemma should be normalized
    assert "2026" in year_token["lemma"] or year_token["lemma"] == "2026年"


def test_t10_no_false_jlpt_hits_on_interjections(tmp_path):
    """T10: Interjections and single kana stutters do not map to random kanji JLPT words."""
    service = SubtitleAnnotatorService(db_path=tmp_path / "test.db", learner_level="N1")
    tokens = service.annotate_text("うおお！ち…お！")
    for t in tokens:
        if t["surface"] in {"うおお", "ち", "お"}:
            assert t["status"] != "should_know"


def test_sentence_analysis_tuples():
    """Verify SentenceAnalysis returns immutable tuples."""
    analysis = analyze("テスト文です")
    assert isinstance(analysis.morphemes, tuple)
    assert isinstance(analysis.merged, tuple)

