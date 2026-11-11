"""Tests for Phase 3 vocabulary categorization, word sets, deterministic drills, invariants, and API routes."""
from __future__ import annotations

from pathlib import Path
import random
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.db.connection import db_session, ensure_vocab_practice_tables, init_db
from app.main import app
from app.repositories.word_state_repository import WordStateRepository
from app.services.dictionary_provider import resolve_dictionary_db_path
from app.services.vocab_practice import (
    BLANK_TOKEN,
    CAT_ADJECTIVE_I,
    CAT_ADJECTIVE_NA,
    CAT_ADVERB,
    CAT_EXPRESSION,
    CAT_NOUN,
    CAT_ONOMATOPOEIA,
    CAT_SURU_VERB,
    CAT_VERB_GODAN,
    CAT_VERB_ICHIDAN,
    CAT_VERB_INTRANSITIVE,
    CAT_VERB_KURU,
    CAT_VERB_TRANSITIVE,
    ConjugationDrillGenerator,
    ContrastClozeGenerator,
    SentenceContext,
    TypedRecallGenerator,
    VocabPracticeService,
    VtViDrillGenerator,
    WordTarget,
    add_word_set_items,
    analyze_sentence_usage_tags,
    build_word_target_from_dict,
    categorize_and_persist_word,
    classify_tags_to_categories,
    create_custom_word_set,
    delete_custom_word_set,
    get_practice_stats,
    get_word_categories,
    get_word_set_detail,
    list_word_sets_with_coverage,
    normalize_japanese_answer,
    recommend_practice_queue,
    record_practice_result,
    romaji_to_hiragana,
    sync_categories_from_word_states,
    validate_distractor_safety,
    verify_inflection_roundtrip,
    verify_sentence_roundtrip,
)
from kiroku_dictionary import DictionaryEngine
from kiroku_dictionary.deinflect import deinflect


@pytest.fixture
def test_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "kiroku_vocab_practice_test.db"
    monkeypatch.setenv("KIROKU_DB_PATH", str(db_path))
    monkeypatch.setenv("ANKIMINER_DB_PATH", str(db_path))
    init_db(db_path)
    return db_path


@pytest.fixture(scope="module")
def dict_engine() -> DictionaryEngine:
    dict_path = resolve_dictionary_db_path()
    if not dict_path.is_file():
        pytest.skip("kiroku_dict.sqlite not present in workspace")
    engine = DictionaryEngine(str(dict_path))
    yield engine
    engine.close()


# ---------------------------------------------------------------------------
# 1. Word Categorization, Multi-tag Persistence, Word Sets & Usage Tags
# ---------------------------------------------------------------------------

def test_tag_to_category_mapping_and_mimetic_subtypes():
    """JMdict tags map deterministically to multi-tag learner categories and on-mim subtypes."""
    adv_tags = classify_tags_to_categories(["adv", "adv-to"])
    assert [(t.category, t.subtype) for t in adv_tags] == [(CAT_ADVERB, "adv-to")]

    giongo = classify_tags_to_categories(["on-mim", "adv-to"], expression="ざあざあ", reading="ざあざあ")
    assert (CAT_ONOMATOPOEIA, "giongo") in [(t.category, t.subtype) for t in giongo]

    giseigo = classify_tags_to_categories(["on-mim"], expression="わんわん", reading="わんわん")
    assert (CAT_ONOMATOPOEIA, "giseigo") in [(t.category, t.subtype) for t in giseigo]

    gitaigo = classify_tags_to_categories(["on-mim", "adv-to", "vs"], expression="ころころ", reading="ころころ")
    pairs = {(t.category, t.subtype) for t in gitaigo}
    assert (CAT_ONOMATOPOEIA, "gitaigo") in pairs
    assert (CAT_ADVERB, "adv-to") in pairs
    assert (CAT_SURU_VERB, "vs") in pairs

    emotion = classify_tags_to_categories(["on-mim", "vs"], expression="わくわく", reading="わくわく")
    assert (CAT_ONOMATOPOEIA, "emotion") in [(t.category, t.subtype) for t in emotion]

    verb_multi = classify_tags_to_categories(["v5k", "vt", "vi"])
    v_cats = {t.category for t in verb_multi}
    assert v_cats == {CAT_VERB_GODAN, CAT_VERB_TRANSITIVE, CAT_VERB_INTRANSITIVE}

    v1_tags = classify_tags_to_categories(["v1", "vt"])
    assert {t.category for t in v1_tags} == {CAT_VERB_ICHIDAN, CAT_VERB_TRANSITIVE}

    vk_tags = classify_tags_to_categories(["vk", "vi"])
    assert {t.category for t in vk_tags} == {CAT_VERB_KURU, CAT_VERB_INTRANSITIVE}

    adj_exp = classify_tags_to_categories(["adj-i", "adj-na", "n", "exp"])
    assert {t.category for t in adj_exp} == {CAT_ADJECTIVE_I, CAT_ADJECTIVE_NA, CAT_NOUN, CAT_EXPRESSION}


def test_real_dict_categorization_and_multi_tag_persistence(test_db: Path, dict_engine: DictionaryEngine):
    """Real Jitendex entries resolve to canonical sequence_ids and persist multi-tag rows."""
    korokoro = categorize_and_persist_word(dict_engine, expression="ころころ", db_path=test_db)
    assert korokoro is not None
    assert CAT_ONOMATOPOEIA in korokoro.categories
    assert CAT_ADVERB in korokoro.categories
    assert "gitaigo" in korokoro.subtypes

    benkyou = categorize_and_persist_word(dict_engine, expression="勉強", db_path=test_db)
    assert benkyou is not None
    assert CAT_NOUN in benkyou.categories
    assert CAT_SURU_VERB in benkyou.categories

    rows = get_word_categories(sequence_id=korokoro.sequence_id, db_path=test_db)
    assert len(rows) >= 2
    assert {r["category"] for r in rows} >= {CAT_ONOMATOPOEIA, CAT_ADVERB}


def test_word_sets_and_coverage_respects_reading_and_excludes_blacklisted(
    test_db: Path,
    dict_engine: DictionaryEngine,
):
    """Tag-based and custom word sets compute known/learning/total/coverage excluding blacklisted."""
    ws_repo = WordStateRepository(db_path=test_db)
    t_shizuka = categorize_and_persist_word(dict_engine, expression="静か", db_path=test_db)
    t_takai = categorize_and_persist_word(dict_engine, expression="高い", db_path=test_db)
    t_koro = categorize_and_persist_word(dict_engine, expression="ころころ", db_path=test_db)
    t_waku = categorize_and_persist_word(dict_engine, expression="わくわく", db_path=test_db)
    assert all(x is not None for x in (t_shizuka, t_takai, t_koro, t_waku))

    # Mark ころころ known, わくわく blacklisted, 静か learning
    ws_repo.set_user_word_state(state="known", sequence_id=t_koro.sequence_id, reading=t_koro.reading, expression=t_koro.expression)
    ws_repo.set_user_word_state(state="blacklisted", sequence_id=t_waku.sequence_id, reading=t_waku.reading, expression=t_waku.expression)
    ws_repo.set_user_word_state(state="learning", sequence_id=t_shizuka.sequence_id, reading=t_shizuka.reading, expression=t_shizuka.expression)
    ws_repo.set_user_word_state(state="seen", sequence_id=t_takai.sequence_id, reading=t_takai.reading, expression=t_takai.expression)

    # Homograph isolation: same sequence_id with different reading in word_states
    ws_repo.set_user_word_state(state="learning", sequence_id=t_koro.sequence_id, reading="ころころテスト", expression=t_koro.expression)

    custom = create_custom_word_set(
        "Mimetic Pack",
        description="Core mimetics",
        items=[
            {"sequence_id": t_koro.sequence_id, "reading": t_koro.reading, "expression": t_koro.expression},
            {"sequence_id": t_waku.sequence_id, "reading": t_waku.reading, "expression": t_waku.expression},
            {"sequence_id": t_shizuka.sequence_id, "reading": t_shizuka.reading, "expression": t_shizuka.expression},
        ],
        db_path=test_db,
    )
    assert custom["slug"] == "mimetic-pack"

    add_word_set_items(
        "mimetic-pack",
        [{"sequence_id": t_takai.sequence_id, "reading": t_takai.reading, "expression": t_takai.expression}],
        db_path=test_db,
    )

    detail = get_word_set_detail("mimetic-pack", db_path=test_db)
    assert detail is not None
    # 4 items added, 1 blacklisted (わくわく) -> total_count == 3, known == 1, learning == 1
    assert detail["total_count"] == 3
    assert detail["known_count"] == 1
    assert detail["learning_count"] == 1
    assert detail["coverage_ratio"] == pytest.approx(1 / 3, abs=1e-3)

    all_sets = {s.slug: s for s in list_word_sets_with_coverage(db_path=test_db)}
    assert "cat-onomatopoeia" in all_sets
    # わくわく is blacklisted so only ころころ's two reading rows count -> total 2, known 1, learning 1
    onmim_cov = all_sets["cat-onomatopoeia"]
    assert onmim_cov.known_count == 1
    assert onmim_cov.learning_count == 1
    assert onmim_cov.total_count == 2

    assert delete_custom_word_set("mimetic-pack", db_path=test_db) is True
    assert get_word_set_detail("mimetic-pack", db_path=test_db) is None


def test_sentence_usage_tags(dict_engine: DictionaryEngine):
    """Per-sentence usage tags detect na-adj + に, mimetic + と, mimetic + する, and を + vt."""
    tags1 = analyze_sentence_usage_tags("静かに本を読む。", dict_engine=dict_engine)
    assert any(t["tag"] == "adverbial_na_ni" for t in tags1)

    tags2 = analyze_sentence_usage_tags("ボールがころころと転がる。", dict_engine=dict_engine)
    assert any(t["tag"] == "quotative_mimetic_to" for t in tags2)

    tags3 = analyze_sentence_usage_tags("旅行がわくわくする。", dict_engine=dict_engine)
    assert any(t["tag"] == "mimetic_suru" for t in tags3)

    tags4 = analyze_sentence_usage_tags("ドアを閉める。", dict_engine=dict_engine)
    assert any(t["tag"] == "transitive_wo" for t in tags4)


# ---------------------------------------------------------------------------
# 2. Shared Lenient Answer Normalizer & Typed Recall
# ---------------------------------------------------------------------------

def test_lenient_normalizer_romaji_kana_width():
    """Pure Python romaji->hiragana and NFKC/katakana folding match WanaKana inputs."""
    assert romaji_to_hiragana("taberu") == "たべる"
    assert romaji_to_hiragana("shizuka") == "しずか"
    assert romaji_to_hiragana("kittemasu") == "きってます"
    assert romaji_to_hiragana("matcha") == "まっちゃ"
    assert romaji_to_hiragana("assari") == "あっさり"
    assert romaji_to_hiragana("ltsu") == "っ"
    assert romaji_to_hiragana("xtsu") == "っ"
    assert romaji_to_hiragana("kon'nichiha") == "こんにちは"
    assert romaji_to_hiragana("konnnichiha") == "こんにちは"
    assert romaji_to_hiragana("kan'i") == "かんい"
    assert romaji_to_hiragana("hon'ya") == "ほんや"
    assert normalize_japanese_answer("kan'i") == "かんい"
    assert normalize_japanese_answer("hon'ya") == "ほんや"
    assert normalize_japanese_answer("kon'nichiha") == "こんにちは"
    assert normalize_japanese_answer("　タベル！ ") == "たべる"
    assert normalize_japanese_answer("ｔａｂｅｒｕ") == "たべる"
    assert normalize_japanese_answer("ｂｅｎｋｙｏｕ") == "べんきょう"
    assert normalize_japanese_answer("ｔｏｕｋｙｏｕ") == "とうきょう"
    assert normalize_japanese_answer("ｏｏｋｉｉ") == "おおきい"
    assert normalize_japanese_answer("オオキイ") == "おおきい"


def test_typed_recall_reading_and_meaning_cloze(dict_engine: DictionaryEngine):
    """Typed Recall grades romaji/kana/full-width/kanji variants and enforces roundtrip."""
    gen = TypedRecallGenerator(dict_engine=dict_engine)
    taberu = build_word_target_from_dict(dict_engine, "食べる")
    assert taberu is not None

    # Reading recall: shows 食べる, rejects kanji answer, accepts hiragana/katakana/romaji/full-width
    q_read = gen.generate(taberu, SentenceContext(sentence="朝ごはんを食べる。", mode="reading"))
    assert q_read is not None
    assert q_read.question_type == "typed_recall_reading"
    assert gen.grade(q_read, "たべる").is_correct is True
    assert gen.grade(q_read, "タベル").is_correct is True
    assert gen.grade(q_read, "taberu").is_correct is True
    assert gen.grade(q_read, "ｔａｂｅｒｕ").is_correct is True
    assert gen.grade(q_read, "食べる").is_correct is False

    # Reading recall abstains for kana-only word
    koro = build_word_target_from_dict(dict_engine, "ころころ")
    assert koro is not None
    assert gen.generate(koro, SentenceContext(mode="reading")) is None
    assert any(a.reason_code == "reading_recall_requires_kanji" for a in gen.abstentions)

    # Meaning/cloze recall: roundtrip verified and accepts kanji/kana/romaji
    q_mean = gen.generate(taberu, SentenceContext(sentence="私はパンを食べる。", mode="meaning"))
    assert q_mean is not None
    assert q_mean.blanked_sentence == f"私はパンを{BLANK_TOKEN}。"
    assert gen.grade(q_mean, "食べる").is_correct is True
    assert gen.grade(q_mean, "たべる").is_correct is True
    assert gen.grade(q_mean, "taberu").is_correct is True


# ---------------------------------------------------------------------------
# 3. Contrast Cloze & Pattern Fill
# ---------------------------------------------------------------------------

def test_contrast_cloze_and_pattern_fill(dict_engine: DictionaryEngine):
    """Contrast Cloze picks voicing-contrast/same-category safe distractors; Pattern Fill checks uniqueness."""
    gen = ContrastClozeGenerator(dict_engine=dict_engine)
    koro = build_word_target_from_dict(dict_engine, "ころころ")
    assert koro is not None

    q = gen.generate(koro, SentenceContext(sentence="ボールがころころと転がる。"))
    assert q is not None
    assert q.question_type == "contrast_cloze"
    assert q.blanked_sentence == f"ボールが{BLANK_TOKEN}と転がる。"
    assert len(q.choices) == 4
    choice_texts = {c.text for c in q.choices}
    assert "ころころ" in choice_texts
    assert "ごろごろ" in choice_texts  # voicing contrast partner included
    assert gen.grade(q, "ころころ").is_correct is True
    assert gen.grade(q, "ごろごろ").is_correct is False

    # Pattern fill on na-adj + に before verb
    shizuka = build_word_target_from_dict(dict_engine, "静か")
    assert shizuka is not None
    q_pat = gen.generate(shizuka, SentenceContext(sentence="部屋で静かに本を読む。", mode="pattern_fill"))
    assert q_pat is not None
    assert q_pat.question_type == "pattern_fill"
    assert q_pat.blanked_sentence == f"部屋で静か{BLANK_TOKEN}本を読む。"
    assert gen.grade(q_pat, "に").is_correct is True
    assert gen.grade(q_pat, "と").is_correct is False


# ---------------------------------------------------------------------------
# 4. Verb Transitive/Intransitive & Particle Drill
# ---------------------------------------------------------------------------

def test_vt_vi_drill_pair_and_particle_cue_and_abstention(dict_engine: DictionaryEngine):
    """vt/vi drill works with が/を cues and abstains on topic は or dual-transitivity verbs."""
    gen = VtViDrillGenerator(dict_engine=dict_engine)
    shimaru = build_word_target_from_dict(dict_engine, "閉まる")
    shimeru = build_word_target_from_dict(dict_engine, "閉める")
    assert shimaru is not None and shimeru is not None

    # Verb pair drill with が cue and past-tense inflection matching
    q_vi = gen.generate(shimaru, SentenceContext(sentence="ドアが閉まった。"))
    assert q_vi is not None
    assert q_vi.question_type == "vt_vi_drill"
    assert {c.text for c in q_vi.choices} == {"閉まった", "閉めた"}
    assert gen.grade(q_vi, "閉まった").is_correct is True
    assert gen.grade(q_vi, "閉めた").is_correct is False

    # Particle cue mode
    q_part = gen.generate(shimeru, SentenceContext(sentence="ドアを閉める。", mode="particle_cue"))
    assert q_part is not None
    assert {c.text for c in q_part.choices} == {"を", "が"}
    assert gen.grade(q_part, "を").is_correct is True
    assert gen.grade(q_part, "が").is_correct is False

    # Ambiguous topic marker は -> MUST abstain
    assert gen.generate(shimaru, SentenceContext(sentence="ドアは閉まった。")) is None
    assert any(a.reason_code == "missing_or_ambiguous_particle_cue" for a in gen.abstentions)

    # Dual transitivity (自他動詞) like 開く -> MUST abstain
    hiraku = build_word_target_from_dict(dict_engine, "開く")
    assert hiraku is not None
    assert gen.generate(hiraku, SentenceContext(sentence="ドアが開いた。")) is None
    assert any(a.reason_code == "ambiguous_verb_transitivity" for a in gen.abstentions)


# ---------------------------------------------------------------------------
# 5. Conjugation Drill (Deinflector Roundtrip)
# ---------------------------------------------------------------------------

def test_conjugation_drill_all_verb_classes_and_deinflect_roundtrip(dict_engine: DictionaryEngine):
    """Conjugation Drill generates negative, past, negative_past, te_form, passive, causative, potential, polite_imperative."""
    gen = ConjugationDrillGenerator(dict_engine=dict_engine)
    cases = [
        ("食べる", "negative", "食べない", "tabenai"),
        ("食べる", "past", "食べた", "tabeta"),
        ("食べる", "negative_past", "食べなかった", "tabenakatta"),
        ("食べる", "te_form", "食べて", "tabete"),
        ("食べる", "passive", "食べられる", "taberareru"),
        ("食べる", "causative", "食べさせる", "tabesaseru"),
        ("食べる", "polite_imperative", "食べなさい", "tabenasai"),
        ("書く", "negative", "書かない", "kakanai"),
        ("書く", "past", "書いた", "kaita"),
        ("書く", "te_form", "書いて", "kaite"),
        ("書く", "potential", "書ける", "kakeru"),
        ("書く", "passive", "書かれる", "kakareru"),
        ("書く", "causative", "書かせる", "kakaseru"),
        ("書く", "polite_imperative", "書きなさい", "kakinasai"),
        ("行く", "te_form", "行って", "itte"),
        ("行く", "past", "行った", "itta"),
        ("来る", "negative", "来ない", "konai"),
        ("来る", "polite_imperative", "来なさい", "kinasai"),
        ("勉強", "past", "勉強した", "benkyoushita"),
        ("高い", "negative_past", "高くなかった", "takakunakatta"),
    ]
    for word_str, form, expected_expr, romaji_ans in cases:
        target = build_word_target_from_dict(dict_engine, word_str)
        assert target is not None, f"Failed to resolve {word_str}"
        q = gen.generate(target, SentenceContext(target_conjugation=form))
        assert q is not None, f"Failed to generate {word_str} -> {form}: {gen.abstentions[-1:]}"
        assert expected_expr in q.expected_answers
        assert gen.grade(q, expected_expr).is_correct is True
        assert gen.grade(q, romaji_ans).is_correct is True
        assert verify_inflection_roundtrip(
            q.metadata["base_form"],
            expected_expr,
            q.metadata["rule"],
        )


# ---------------------------------------------------------------------------
# 6. Roundtrip & Distractor Safety Invariants + Abstention
# ---------------------------------------------------------------------------

def test_invariants_reject_unsafe_distractors_and_abstain(dict_engine: DictionaryEngine):
    """Distractor safety rejects cross-category, alternate forms, same sequence_id, and synonyms."""
    koro = build_word_target_from_dict(dict_engine, "ころころ")
    assert koro is not None

    blanked = f"ボールが{BLANK_TOKEN}と転がる。"
    ok, err = verify_sentence_roundtrip(
        original_sentence="ボールがころころと転がる。",
        blanked_sentence=blanked,
        target_surface="ころころ",
        target=koro,
        dict_engine=dict_engine,
    )
    assert ok is True and err == ""

    # 1. Cross-category distractor (noun 猫) rejected when requiring onomatopoeia
    neko = build_word_target_from_dict(dict_engine, "猫")
    assert neko is not None
    safe, reason = validate_distractor_safety(
        target=koro,
        distractor=neko,
        required_categories=(CAT_ONOMATOPOEIA,),
        blanked_sentence=blanked,
        dict_engine=dict_engine,
    )
    assert safe is False and reason == "distractor_cross_category"

    # 2. Same sequence_id / alternate form rejected
    alt_koro = WordTarget(
        sequence_id=koro.sequence_id,
        expression="コロコロ",
        reading="ころころ",
        glosses=("rolling",),
        categories=(CAT_ONOMATOPOEIA,),
    )
    safe2, reason2 = validate_distractor_safety(
        target=koro,
        distractor=alt_koro,
        required_categories=(CAT_ONOMATOPOEIA,),
        blanked_sentence=blanked,
        dict_engine=dict_engine,
    )
    assert safe2 is False and reason2 == "distractor_same_sequence_id"

    # 3. Synonym / overlapping English gloss rejected
    syn = WordTarget(
        sequence_id=9999991,
        expression="くるくる",
        reading="くるくる",
        glosses=("plump", "chubby"),
        categories=(CAT_ONOMATOPOEIA,),
    )
    safe3, reason3 = validate_distractor_safety(
        target=koro,
        distractor=syn,
        required_categories=(CAT_ONOMATOPOEIA,),
        blanked_sentence=blanked,
        dict_engine=dict_engine,
    )
    assert safe3 is False and reason3 == "distractor_synonym_gloss_overlap"

    # 4. Abstention when fewer than 3 safe distractors exist
    gen = ContrastClozeGenerator(dict_engine=dict_engine, min_distractors=3)
    # Build target with empty candidate pool by mocking a custom on-mim word with only 1 safe candidate
    sparse_target = WordTarget(
        sequence_id=koro.sequence_id,
        expression="ころころ",
        reading="ころころ",
        glosses=("rolling",),
        categories=(CAT_ADVERB,),
    )
    # Force an unresolved sentence target -> must abstain
    assert gen.generate(sparse_target, SentenceContext(sentence="全く関係ない文。")) is None
    assert gen.abstentions[-1].reason_code == "target_not_uniquely_located"


# ---------------------------------------------------------------------------
# 7. Random-Seed Fuzz / Corpus Sweep Across Multiple Words & Sentences
# ---------------------------------------------------------------------------

def test_random_seed_corpus_sweep_zero_invariant_violations(dict_engine: DictionaryEngine):
    """Sweep all 4 generators across a multi-word corpus with randomized seeds; assert zero invariant violations."""
    corpus = [
        ("食べる", "私は朝ごはんを食べる。", None),
        ("書く", "手紙を書く。", None),
        ("静か", "静かに本を読む。", None),
        ("ころころ", "ボールがころころと転がる。", None),
        ("わくわく", "明日の旅行にわくわくする。", None),
        ("きらきら", "星がきらきらと光る。", None),
        ("閉まる", "ドアが閉まった。", None),
        ("閉める", "窓を閉める。", None),
        ("始まる", "授業が始まった。", None),
        ("始める", "勉強を始める。", None),
        ("消える", "電気が消えた。", None),
        ("消す", "テレビを消す。", None),
        ("高い", "この山は高い。", None),
    ]

    service = VocabPracticeService(dict_engine=dict_engine)
    rng = random.Random(20261111)
    qtypes = ["typed_recall_reading", "typed_recall_meaning", "contrast_cloze", "pattern_fill", "vt_vi_drill", "conjugation_drill"]

    generated_count = 0
    for _ in range(40):
        word_str, sentence, _ = rng.choice(corpus)
        qtype = rng.choice(qtypes)
        word = build_word_target_from_dict(dict_engine, word_str)
        assert word is not None

        q, abstentions = service.generate(qtype, word, SentenceContext(sentence=sentence))
        if q is None:
            assert len(abstentions) >= 1
            assert abstentions[0].reason_code != ""
            continue

        generated_count += 1
        assert q.expected_sequence_id == word.sequence_id
        assert q.expected_sequence_id > 0

        # Check roundtrip invariant on any blanked question
        if q.blanked_sentence:
            if q.question_type == "pattern_fill":
                filled = q.blanked_sentence.replace(BLANK_TOKEN, q.expected_answers[0], 1)
                assert filled == q.sentence
            else:
                surface = q.metadata.get("target_surface") or q.expected_answers[0]
                ok, err = verify_sentence_roundtrip(
                    original_sentence=q.sentence,
                    blanked_sentence=q.blanked_sentence,
                    target_surface=surface,
                    target=q.target,
                    dict_engine=dict_engine,
                )
                assert ok, f"Roundtrip failed for {q.question_type}/{word_str}: {err}"

        # Check choices uniqueness & non-collision
        if q.choices:
            texts = [c.text for c in q.choices]
            assert len(texts) == len(set(texts))
            seq_ids = [c.sequence_id for c in q.choices if c.sequence_id is not None]
            assert len(seq_ids) == len(set(seq_ids))

        # Primary expected answer must grade True
        res = service.grade(q, q.expected_answers[0])
        assert res.is_correct is True

    assert generated_count >= 10


# ---------------------------------------------------------------------------
# 8. Recommender (What-Next Queue) & API Routes
# ---------------------------------------------------------------------------

def test_recommender_ranks_weak_and_frequent_words_excluding_blacklisted(
    test_db: Path,
    dict_engine: DictionaryEngine,
):
    """Recommender surfaces weak/frequent tracking words first and excludes blacklisted/ignored."""
    ws_repo = WordStateRepository(db_path=test_db)
    w_weak = categorize_and_persist_word(dict_engine, expression="食べる", db_path=test_db)
    w_strong = categorize_and_persist_word(dict_engine, expression="書く", db_path=test_db)
    w_black = categorize_and_persist_word(dict_engine, expression="猫", db_path=test_db)
    assert w_weak and w_strong and w_black

    ws_repo.set_user_word_state(state="tracking", sequence_id=w_weak.sequence_id, reading=w_weak.reading, expression=w_weak.expression)
    ws_repo.set_user_word_state(state="known", sequence_id=w_strong.sequence_id, reading=w_strong.reading, expression=w_strong.expression)
    ws_repo.set_user_word_state(state="blacklisted", sequence_id=w_black.sequence_id, reading=w_black.reading, expression=w_black.expression)

    for i in range(4):
        ws_repo.log_encounter(
            sequence_id=w_weak.sequence_id,
            reading=w_weak.reading,
            expression=w_weak.expression,
            sentence="毎日パンを食べる。",
            source_media=f"ep{i}",
        )

    record_practice_result(
        sequence_id=w_weak.sequence_id,
        reading=w_weak.reading,
        expression=w_weak.expression,
        question_type="conjugation_drill",
        category=CAT_VERB_ICHIDAN,
        is_correct=False,
        user_answer="食べらない",
        expected_answer="食べない",
        db_path=test_db,
    )
    record_practice_result(
        sequence_id=w_strong.sequence_id,
        reading=w_strong.reading,
        expression=w_strong.expression,
        question_type="conjugation_drill",
        category=CAT_VERB_GODAN,
        is_correct=True,
        user_answer="書いた",
        expected_answer="書いた",
        db_path=test_db,
    )

    queue = recommend_practice_queue(limit=10, db_path=test_db)
    seqs = [r.sequence_id for r in queue]
    assert w_black.sequence_id not in seqs
    assert seqs[0] == w_weak.sequence_id
    assert queue[0].accuracy == 0.0
    assert queue[0].encounter_count == 4


def test_vocab_practice_api_routes_end_to_end(test_db: Path, dict_engine: DictionaryEngine):
    """All /api/vocab-practice/* endpoints work end-to-end without touching study.db."""
    client = TestClient(app)

    # 1. Classify + persist word
    r_cls = client.post("/api/vocab-practice/categories/classify", json={"expression": "ころころ", "persist": True})
    assert r_cls.status_code == 200
    word_data = r_cls.json()["word"]
    assert CAT_ONOMATOPOEIA in word_data["categories"]
    seq_koro = word_data["sequence_id"]

    # 2. List categories
    r_cats = client.get("/api/vocab-practice/categories", params={"sequence_id": seq_koro})
    assert r_cats.status_code == 200
    assert r_cats.json()["total"] >= 2

    # 3. Create custom word set & list word sets
    r_ws_create = client.post(
        "/api/vocab-practice/word-sets",
        json={
            "name": "API Test Set",
            "items": [{"sequence_id": seq_koro, "reading": "ころころ", "expression": "ころころ"}],
        },
    )
    assert r_ws_create.status_code == 201
    assert r_ws_create.json()["total_count"] == 1

    r_ws_list = client.get("/api/vocab-practice/word-sets")
    assert r_ws_list.status_code == 200
    slugs = {s["slug"] for s in r_ws_list.json()["word_sets"]}
    assert "api-test-set" in slugs
    assert "cat-onomatopoeia" in slugs

    # 4. Generate & grade question (stateful by question_id + romaji)
    r_gen = client.post(
        "/api/vocab-practice/generate",
        json={
            "question_type": "conjugation_drill",
            "expression": "食べる",
            "target_conjugation": "past",
        },
    )
    assert r_gen.status_code == 200
    gen_body = r_gen.json()
    assert gen_body["generated"] is True
    q_id = gen_body["question"]["question_id"]

    r_grade = client.post(
        "/api/vocab-practice/grade",
        json={"question_id": q_id, "answer": "tabeta", "persist": True, "response_time_ms": 850},
    )
    assert r_grade.status_code == 200
    assert r_grade.json()["is_correct"] is True

    # 5. Stats & usage tags
    r_stats = client.get("/api/vocab-practice/stats")
    assert r_stats.status_code == 200
    assert r_stats.json()["total_attempts"] == 1
    assert r_stats.json()["total_correct"] == 1

    r_tags = client.post("/api/vocab-practice/usage-tags", json={"sentence": "静かに話す。"})
    assert r_tags.status_code == 200
    assert any(t["tag"] == "adverbial_na_ni" for t in r_tags.json()["usage_tags"])

    # 6. Delete custom word set
    r_del = client.delete("/api/vocab-practice/word-sets/api-test-set")
    assert r_del.status_code == 200
    assert r_del.json()["deleted"] is True


# ---------------------------------------------------------------------------
# 9. Edge Cases: All Verb Classes, Duplicate Spans, Abstentions, Error Codes & study.db Isolation
# ---------------------------------------------------------------------------

def test_conjugation_drill_all_v5_subclasses_irregulars_and_vs_default(dict_engine: DictionaryEngine):
    """All v5 endings (u/k/g/s/t/n/b/m/r), v5k-s (行く), v5r-i (ある), v1, vs, vk, adj-i work cleanly."""
    gen = ConjugationDrillGenerator(dict_engine=dict_engine)

    # Every v5 subclass + v1 + vk + adj-i across key inflections
    subclass_cases = [
        ("買う", "past", "買った", "katta"),
        ("買う", "negative", "買わない", "kawanai"),
        ("書く", "te_form", "書いて", "kaite"),
        ("泳ぐ", "te_form", "泳いで", "oyoide"),
        ("泳ぐ", "past", "泳いだ", "oyoida"),
        ("話す", "te_form", "話して", "hanashite"),
        ("待つ", "te_form", "待って", "matte"),
        ("死ぬ", "past", "死んだ", "shinda"),
        ("遊ぶ", "te_form", "遊んで", "asonde"),
        ("読む", "past", "読んだ", "yonda"),
        ("走る", "te_form", "走って", "hashitte"),
        ("行く", "te_form", "行って", "itte"),
        ("行く", "past", "行った", "itta"),
        ("ある", "negative", "ない", "nai"),
        ("ある", "negative_past", "なかった", "nakatta"),
        ("ある", "past", "あった", "atta"),
        ("来る", "te_form", "来て", "kite"),
        ("来る", "volitional", "来よう", "koyou"),
        ("いい", "negative", "よくない", "yokunai"),
        ("良い", "past", "良かった", "yokatta"),
    ]
    for word_str, form, expected_ans, romaji_ans in subclass_cases:
        target = build_word_target_from_dict(dict_engine, word_str)
        assert target is not None, f"Failed to resolve {word_str}"
        q = gen.generate(target, SentenceContext(target_conjugation=form))
        assert q is not None, f"Failed to generate {word_str} -> {form}: {gen.abstentions[-1:]}"
        assert expected_ans in q.expected_answers
        assert "有らない" not in q.expected_answers
        assert "有らなかった" not in q.expected_answers
        assert gen.grade(q, expected_ans).is_correct is True
        assert gen.grade(q, romaji_ans).is_correct is True

    # vs verbs with default target_conjugation=None must never pick unsupported 'potential'
    for vs_word in ("する", "勉強", "愛する"):
        t_vs = build_word_target_from_dict(dict_engine, vs_word)
        assert t_vs is not None
        q_default = gen.generate(t_vs)
        assert q_default is not None, f"Default generation abstained for {vs_word}: {gen.abstentions[-1:]}"
        assert q_default.metadata["target_conjugation"] != "potential"
        assert gen.generate(t_vs, SentenceContext(target_conjugation="potential")) is None
        assert gen.abstentions[-1].reason_code == "unsupported_conjugation_form"


def test_roundtrip_duplicate_occurrences_and_abstention_guards(dict_engine: DictionaryEngine):
    """Duplicate occurrences abstain unless target_surface uniquely pins a span; abstentions cover missing seq/insufficient distractors."""
    taberu = build_word_target_from_dict(dict_engine, "食べる")
    koro = build_word_target_from_dict(dict_engine, "ころころ")
    tatsu = build_word_target_from_dict(dict_engine, "建つ")
    shimaru = build_word_target_from_dict(dict_engine, "閉まる")
    assert all(x is not None for x in (taberu, koro, tatsu, shimaru))

    # Duplicate occurrence with identical surface -> TypedRecall & ContrastCloze must abstain
    tr_gen = TypedRecallGenerator(dict_engine=dict_engine)
    assert tr_gen.generate(taberu, SentenceContext(sentence="毎日食べるし、夜も食べる。", mode="meaning")) is None
    assert tr_gen.abstentions[-1].reason_code == "target_not_uniquely_located"

    cc_gen = ContrastClozeGenerator(dict_engine=dict_engine)
    assert cc_gen.generate(koro, SentenceContext(sentence="ころころしてころころと転がる。")) is None
    assert cc_gen.abstentions[-1].reason_code == "target_not_uniquely_located"

    # Duplicate target with distinct surface pinned via target_surface -> roundtrip checks exact blank span
    sent_two = "今日は食べるけど昨日は食べた。"
    q_pinned = tr_gen.generate(
        taberu,
        SentenceContext(sentence=sent_two, target_surface="食べた", mode="meaning"),
    )
    assert q_pinned is not None
    assert q_pinned.blanked_sentence == f"今日は食べるけど昨日は{BLANK_TOKEN}。"
    ok, err = verify_sentence_roundtrip(
        original_sentence=sent_two,
        blanked_sentence=q_pinned.blanked_sentence,
        target_surface="食べた",
        target=taberu,
        dict_engine=dict_engine,
    )
    assert ok is True and err == ""

    # Double blank or empty target_surface rejected
    ok_dbl, _ = verify_sentence_roundtrip(
        original_sentence=sent_two,
        blanked_sentence=f"今日は{BLANK_TOKEN}けど昨日は{BLANK_TOKEN}。",
        target_surface="食べた",
        target=taberu,
        dict_engine=dict_engine,
    )
    assert ok_dbl is False
    ok_empty, _ = verify_sentence_roundtrip(
        original_sentence=sent_two,
        blanked_sentence=f"今日は食べるけど昨日は{BLANK_TOKEN}。",
        target_surface="",
        target=taberu,
        dict_engine=dict_engine,
    )
    assert ok_empty is False

    # Missing sequence_id abstention across ContrastCloze and VtViDrill
    no_seq = WordTarget(
        sequence_id=0,
        expression="ころころ",
        reading="ころころ",
        glosses=("rolling",),
        categories=(CAT_ONOMATOPOEIA,),
    )
    assert cc_gen.generate(no_seq, SentenceContext(sentence="ボールがころころと転がる。")) is None
    assert cc_gen.abstentions[-1].reason_code == "missing_sequence_id"

    vt_gen = VtViDrillGenerator(dict_engine=dict_engine)
    assert vt_gen.generate(no_seq, SentenceContext(sentence="ドアが閉まった。")) is None
    assert vt_gen.abstentions[-1].reason_code == "missing_sequence_id"

    # Insufficient safe distractors abstention when pool cannot reach min_distractors
    strict_cc = ContrastClozeGenerator(dict_engine=dict_engine, min_distractors=30)
    assert strict_cc.generate(koro, SentenceContext(sentence="ボールがころころと転がる。")) is None
    assert strict_cc.abstentions[-1].reason_code == "insufficient_safe_distractors"

    # Fixed curated vt/vi pair 建つ <-> 建てる works cleanly
    q_tatsu = vt_gen.generate(tatsu, SentenceContext(sentence="新しいビルが建つ。"))
    assert q_tatsu is not None
    assert {c.text for c in q_tatsu.choices} == {"建つ", "建てる"}

    # Clause boundary guard: earlier clause's が does not leak across verb+て into 閉まる
    assert vt_gen.generate(shimaru, SentenceContext(sentence="友達が来てすぐ閉まる。")) is None
    assert vt_gen.abstentions[-1].reason_code == "missing_or_ambiguous_particle_cue"
    # Same-clause が after verb+て still succeeds
    q_clause = vt_gen.generate(shimaru, SentenceContext(sentence="友達が来てドアが閉まる。"))
    assert q_clause is not None
    assert {c.text for c in q_clause.choices} == {"閉まる", "閉める"}


def test_vocab_practice_api_error_codes_security_and_study_db_isolation(
    test_db: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    dict_engine: DictionaryEngine,
):
    """API returns proper 403/404/409/422 responses and never creates or touches study.db."""
    study_dir = tmp_path / "isolated_study_dir"
    monkeypatch.setenv("KIROKU_STUDY_DIR", str(study_dir))

    client = TestClient(app)

    # 422 on missing identifiers / invalid inputs
    assert client.post("/api/vocab-practice/categories/classify", json={}).status_code == 422
    assert client.post("/api/vocab-practice/categories/classify", json={"sequence_id": 0}).status_code == 422
    assert client.post("/api/vocab-practice/generate", json={}).status_code == 422
    assert client.post(
        "/api/vocab-practice/generate",
        json={"question_type": "unknown_type", "expression": "食べる"},
    ).status_code == 422
    assert client.post("/api/vocab-practice/usage-tags", json={"sentence": ""}).status_code == 422
    assert client.get("/api/vocab-practice/stats", params={"limit": 0}).status_code == 422
    assert client.post(
        "/api/vocab-practice/word-sets",
        json={"name": "Bad Seq", "items": [{"sequence_id": 0, "reading": "x"}]},
    ).status_code == 422
    assert client.post(
        "/api/vocab-practice/grade",
        json={"question": {"target": {"sequence_id": "not_an_int"}}, "answer": "a"},
    ).status_code == 422

    # 404 on unknown dictionary entry / word set / question_id
    assert client.post(
        "/api/vocab-practice/categories/classify",
        json={"expression": "存在しない架空語xyz"},
    ).status_code == 404
    assert client.post(
        "/api/vocab-practice/generate",
        json={"question_type": "typed_recall", "expression": "存在しない架空語xyz"},
    ).status_code == 404
    assert client.get("/api/vocab-practice/word-sets/nonexistent-slug").status_code == 404
    assert client.delete("/api/vocab-practice/word-sets/nonexistent-slug").status_code == 404
    assert client.post(
        "/api/vocab-practice/word-sets/cat-adverbs/items",
        json={"items": [{"sequence_id": 1358280, "reading": "たべる"}]},
    ).status_code == 404
    assert client.post(
        "/api/vocab-practice/grade",
        json={"question_id": "missing_q_id", "answer": "たべる"},
    ).status_code == 404

    # 409 on duplicate custom word set slug
    r1 = client.post("/api/vocab-practice/word-sets", json={"name": "Dup Set", "slug": "dup-set"})
    assert r1.status_code == 201
    r2 = client.post("/api/vocab-practice/word-sets", json={"name": "Dup Set 2", "slug": "dup-set"})
    assert r2.status_code == 409

    # 403 security middleware enforcement on hostile Origin / Host
    assert client.post(
        "/api/vocab-practice/generate",
        json={"question_type": "typed_recall", "expression": "食べる"},
        headers={"Origin": "https://evil.com"},
    ).status_code == 403
    assert client.get(
        "/api/vocab-practice/stats",
        headers={"Host": "attacker.com"},
    ).status_code == 403

    # study.db must remain completely untouched / uncreated
    assert not (study_dir / "study.db").exists()
