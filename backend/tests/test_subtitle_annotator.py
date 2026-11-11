"""Unit and latency tests for SubtitleAnnotatorService.

Tests:
1. Tokenization and annotation of subtitle cues with start, end, surface, lemma, reading, status, jlpt_level.
2. Inflected mined forms: surface resolves lemma, matches mined cards above learner level -> status='mined'.
3. Overlap precedence: word within learner level -> status='should_know' EVEN IF in mined cards.
4. Function words: particles and copulas classified as 'unstyled' when ignore_function_words=True (default).
5. Strict latency target: Batch annotate 100+ cues against SQLite with latency strictly < 2.5ms per cue.
"""
from __future__ import annotations

import datetime
from pathlib import Path
import sqlite3
import time
import pytest

from app.db.connection import init_db
from app.services.jlpt_reference import JlptReferenceService
from app.services.subtitle_annotator import (
    AnnotatedCue,
    AnnotatedToken,
    SubtitleAnnotatorService,
)


@pytest.fixture
def test_db(tmp_path: Path) -> Path:
    """Create a temporary SQLite database with cards and known_words tables initialized."""
    db_path = tmp_path / "kiroku_test.db"
    init_db(db_path)
    return db_path


def _insert_card(db_path: Path, expression: str, reading: str = "", deck_name: str = "Default") -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO cards (
                expression, reading, normalized_expression, normalized_reading,
                normalized_deck_name, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (expression, reading, expression, reading, deck_name.lower(), now, now),
        )
        conn.commit()


def _insert_known_word(db_path: Path, word: str) -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            "INSERT INTO known_words (word, created_at) VALUES (?, ?)",
            (word, now),
        )
        conn.commit()


# ============================================================================
# Step 2: Unit tests
# ============================================================================


def test_basic_tokenization_and_cue_fields(test_db: Path):
    """Subtitle cue is tokenized with start, end, surface, lemma, reading, status, jlpt_level."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    cues = [
        {"start": 1.25, "end": 3.50, "text": "本を読む"},
    ]

    annotated = service.annotate_cues(cues)
    assert len(annotated) == 1
    cue = annotated[0]

    # Verify cue fields accessible via dict and attribute access
    assert cue["start"] == 1.25
    assert cue.start == 1.25
    assert cue["end"] == 3.50
    assert cue.end == 3.50
    assert cue["text"] == "本を読む"
    assert len(cue["tokens"]) >= 3

    # Check token fields
    token_surfaces = [t["surface"] for t in cue["tokens"]]
    assert "本" in token_surfaces
    assert "を" in token_surfaces
    assert "読む" in token_surfaces

    hon_token = next(t for t in cue["tokens"] if t["surface"] == "本")
    assert hon_token["lemma"] == "本"
    assert hon_token["jlpt_level"] == "N5"
    assert hon_token["status"] == "should_know"
    assert hon_token["reading"] != ""

    yomu_token = next(t for t in cue["tokens"] if t["surface"] == "読む")
    assert yomu_token["lemma"] == "読む"
    assert yomu_token["jlpt_level"] == "N5"
    assert yomu_token["status"] == "should_know"


def test_inflected_mined_forms_resolution(test_db: Path):
    """Inflected mined forms resolve lemma: e.g. 美味しかった -> lemma 美味しい with status='mined'."""
    # 美味しい is N1 in OpenJLPT. Learner level is N4.
    # We add 美味しい to mined cards.
    _insert_card(test_db, expression="美味しい", reading="おいしい")

    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    cue = {"start": 0.0, "end": 2.0, "text": "美味しかった"}

    annotated = service.annotate_cue(cue)
    assert len(annotated["tokens"]) == 1

    token = annotated["tokens"][0]
    assert token["surface"] == "美味しかった"
    assert token["lemma"] == "美味しい"
    assert token["reading"] == "おいしい"
    assert token["status"] == "mined"
    assert token["jlpt_level"] == "N1"


def test_inflected_mined_forms_unlisted_word_in_known_words(test_db: Path):
    """Inflected forms for unlisted / slang word in known_words table gets status='mined'."""
    # Add unlisted word to known_words
    _insert_known_word(test_db, "ガチャ")

    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N5")
    cue = {"start": 5.0, "end": 7.0, "text": "ガチャ引いた"}

    annotated = service.annotate_cue(cue)
    surfaces = [t["surface"] for t in annotated["tokens"]]
    assert "ガチャ" in surfaces

    gacha_token = next(t for t in annotated["tokens"] if t["surface"] == "ガチャ")
    assert gacha_token["lemma"] == "ガチャ"
    assert gacha_token["status"] == "mined"
    assert gacha_token["jlpt_level"] is None


def test_overlap_precedence_should_know_over_mined(test_db: Path):
    """Green precedence on overlap: If word is within learner level, status is 'should_know' EVEN IF mined."""
    # 食べる is N5 in OpenJLPT. Learner level is N4 (N5 <= N4 -> within learner level).
    # We explicitly insert 食べる into cards and known_words.
    _insert_card(test_db, expression="食べる", reading="たべる")
    _insert_known_word(test_db, "食べる")

    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    cue = {"start": 0.0, "end": 2.0, "text": "ご飯を食べた"}

    annotated = service.annotate_cue(cue)
    tabeta_token = next(t for t in annotated["tokens"] if t["surface"] == "食べた")

    assert tabeta_token["lemma"] == "食べる"
    assert tabeta_token["jlpt_level"] == "N5"
    # CRITICAL: Overlap precedence rule requires 'should_know', NOT 'mined'
    assert tabeta_token["status"] == "should_know"


def test_function_words_ignored_by_default(test_db: Path):
    """Particles and copulas are unstyled and not highlighted as should_know when ignore_function_words=True."""
    # より is N3 in OpenJLPT. If learner level is N1, normally N3 is within N1 (should_know).
    # But because より is a particle in PARTICLES, it MUST be classified as 'unstyled' when ignored!
    service_default = SubtitleAnnotatorService(db_path=test_db, learner_level="N1", ignore_function_words=True)
    annotated = service_default.annotate_cue({"start": 0.0, "end": 1.0, "text": "これよりテストです"})

    yori_token = next(t for t in annotated["tokens"] if t["surface"] == "より")
    assert yori_token["status"] == "unstyled"

    desu_token = next(t for t in annotated["tokens"] if t["surface"] == "です")
    assert desu_token["status"] == "unstyled"

    # When ignore_function_words=False, より should be treated normally as should_know
    service_no_ignore = SubtitleAnnotatorService(db_path=test_db, learner_level="N1", ignore_function_words=False)
    annotated_no_ignore = service_no_ignore.annotate_cue({"start": 0.0, "end": 1.0, "text": "これよりテストです"})
    yori_token_active = next(t for t in annotated_no_ignore["tokens"] if t["surface"] == "より")
    assert yori_token_active["status"] == "should_know"


def test_function_words_all_particles_and_copulas_unstyled(test_db: Path):
    """Verify standard particles and copulas are all unstyled under default settings."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N1", ignore_function_words=True)

    particles = ["は", "が", "を", "に", "へ", "で", "と", "の", "も", "から", "まで", "より", "か", "よ", "ね", "わ"]
    copulas = ["です", "だ", "ます", "でした", "ました"]

    for word in particles + copulas:
        cue = {"start": 0.0, "end": 1.0, "text": word}
        res = service.annotate_cue(cue)
        assert len(res["tokens"]) == 1
        assert res["tokens"][0]["status"] == "unstyled", f"Expected '{word}' to be unstyled"


def test_greedy_longest_match(test_db: Path):
    """Greedy longest match scanner matches longer multi-character compound over short fragments."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    # これから is N4 (4 chars). Should NOT be split into これ (2) + から (2).
    cue = {"start": 0.0, "end": 2.0, "text": "これから約束の場所へ行こう"}
    res = service.annotate_cue(cue)

    surfaces = [t["surface"] for t in res["tokens"]]
    assert "これから" in surfaces
    assert "約束" in surfaces
    assert "場所" in surfaces
    assert "行こう" in surfaces

    ikou_token = next(t for t in res["tokens"] if t["surface"] == "行こう")
    assert ikou_token["lemma"] == "行く"
    assert ikou_token["jlpt_level"] == "N5"
    assert ikou_token["status"] == "should_know"


def test_mined_words_loaded_from_both_cards_and_known_words(test_db: Path):
    """Mined words query union of cards table (normalized_expression) and known_words table (word)."""
    # Insert card into cards table
    _insert_card(test_db, expression="本気", reading="ほんき")  # N1/unlisted
    # Insert word into known_words table
    _insert_known_word(test_db, "覚悟")  # N1

    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N5")
    cue = {"start": 0.0, "end": 2.0, "text": "本気の覚悟"}
    res = service.annotate_cue(cue)

    honki_token = next(t for t in res["tokens"] if t["surface"] == "本気")
    kakugo_token = next(t for t in res["tokens"] if t["surface"] == "覚悟")

    assert honki_token["status"] == "mined"
    assert kakugo_token["status"] == "mined"


def test_batch_annotate_latency_strictly_under_2_5ms_per_cue(test_db: Path):
    """Batch annotate 100+ cues against SQLite asserting latency is strictly < 2.5ms per cue."""
    # Seed DB with several mined cards and known words
    for i in range(50):
        _insert_card(test_db, f"単語{i}", reading=f"たんご{i}")
        _insert_known_word(test_db, f"既知{i}")
    _insert_card(test_db, "美味しい", reading="おいしい")

    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")

    # Generate 120 diverse realistic cues
    sample_texts = [
        "美味しかったご飯を食べました。",
        "これから約束の場所へ行こう。",
        "明日は友達と一緒に映画を見ます。",
        "日本語の勉強はとても面白いです。",
        "駅の前で待っていますから、急いでください。",
        "先生に質問をしました。",
        "新しい車を買いたいと思います。",
        "猫が部屋の中で寝ています。",
        "天気がいいから散歩に行きましょう。",
        "宿題を忘れてしまいました。",
    ]

    cues = [
        {"start": float(i * 2), "end": float(i * 2 + 1.8), "text": sample_texts[i % len(sample_texts)]}
        for i in range(120)
    ]

    assert len(cues) >= 100

    # Warm-up run with 1 cue
    service.annotate_cue(cues[0])

    # Timed batch annotation
    start_time = time.perf_counter()
    results = service.annotate_cues(cues)
    elapsed_total_s = time.perf_counter() - start_time

    assert len(results) == 120

    elapsed_ms_per_cue = (elapsed_total_s * 1000.0) / len(cues)
    print(f"\nLatency: {elapsed_ms_per_cue:.4f} ms per cue (total: {elapsed_total_s*1000.0:.2f} ms for {len(cues)} cues)")

    # Latency MUST be strictly < 2.5ms per cue
    assert elapsed_ms_per_cue < 2.5, f"Latency {elapsed_ms_per_cue:.4f} ms/cue exceeded 2.5 ms limit"


def test_edge_cases_empty_and_whitespace(test_db: Path):
    """Empty cues list, empty text, and whitespace cues are handled gracefully."""
    service = SubtitleAnnotatorService(db_path=test_db)
    assert service.annotate_cues([]) == []

    cue_empty = service.annotate_cue({"start": 0.0, "end": 1.0, "text": ""})
    assert cue_empty["tokens"] == []

    cue_spaces = service.annotate_cue({"start": 1.0, "end": 2.0, "text": "   "})
    assert len(cue_spaces["tokens"]) == 3
    assert all(t["status"] == "unstyled" for t in cue_spaces["tokens"])


def test_non_numeric_cue_timestamps_default_to_zero(test_db: Path):
    """Malformed timestamp values do not abort annotation."""
    service = SubtitleAnnotatorService(db_path=test_db)

    cue = service.annotate_cue({
        "start": "not-a-number",
        "end": None,
        "text": "本",
    })

    assert cue["start"] == 0.0
    assert cue["end"] == 0.0
    assert cue["text"] == "本"
    assert cue["tokens"]


def test_complex_deinflection_chain(test_db: Path):
    """Complex causative-passive negative past forms (食べさせられなかった) resolve to dictionary lemma."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    cue = {"start": 0.0, "end": 3.0, "text": "食べさせられなかった"}
    annotated = service.annotate_cue(cue)

    assert len(annotated["tokens"]) == 1
    tok = annotated["tokens"][0]
    assert tok["surface"] == "食べさせられなかった"
    assert tok["lemma"] == "食べる"
    assert tok["jlpt_level"] == "N5"
    assert tok["status"] == "should_know"


@pytest.mark.parametrize(
    "text, expected_surface",
    [
        ("ご飯", "ご飯"),
        ("わたし", "わたし"),
        ("お金", "お金"),
        ("ありがとう", "ありがとう"),
        ("ごちそうさま", "ごちそうさま"),
        ("食べさせられた", "食べさせられた"),
        ("勉強しています", "勉強"),
    ],
)
def test_kana_spellings_and_aliases(test_db: Path, text: str, expected_surface: str):
    """Kana spellings and common aliases are tokenized without kanji fragments."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    tokens = service.annotate_text(text)
    surfaces = [token["surface"] for token in tokens]

    assert expected_surface in surfaces
    if text == "ご飯":
        gohan = next(token for token in tokens if token["surface"] == "ご飯")
        assert gohan["lemma"] == "御飯"
        assert gohan["reading"] == "ごはん"
        assert gohan["jlpt_level"] == "N5"
        assert "飯" not in surfaces


@pytest.mark.parametrize(
    ("text", "lemma"),
    [
        ("地域社会", "地域社会"),
        ("高齢者", "高齢者"),
        ("情報共有", "情報共有"),
        ("個人情報", "個人情報"),
        ("勉強していた", "勉強"),
        ("作っておく", "作る"),
        ("身についてきた", "身につく"),
        ("作られる", "作る"),
        ("高めながら", "高める"),
        ("コンビニ", "コンビニ"),
        ("スマートフォン", "スマートフォン"),
        ("テクノロジー", "テクノロジー"),
        ("アプリケーション", "アプリケーション"),
        ("アリサ", "アリサ"),
    ],
)
def test_vocab_tokenizer_keeps_compounds_inflections_and_loanwords(
    test_db: Path, text: str, lemma: str
):
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N1")
    tokens = service.annotate_text(text)

    assert len(tokens) == 1
    assert tokens[0]["surface"] == text
    assert tokens[0]["lemma"] == lemma
    assert tokens[0]["start_char"] == 0
    assert tokens[0]["end_char"] == len(text)


def test_vocab_tokenizer_offsets_ai_boundaries_and_function_words(test_db: Path):
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N1")
    tokens = service.annotate_text("地域社会。AI\nアリサは")

    surfaces_and_spans = [(t["surface"], t["start_char"], t["end_char"]) for t in tokens]
    if ("AI", 5, 7) in surfaces_and_spans:
        assert surfaces_and_spans == [
            ("地域社会", 0, 4),
            ("。", 4, 5),
            ("AI", 5, 7),
            ("\n", 7, 8),
            ("アリサ", 8, 11),
            ("は", 11, 12),
        ]
    else:
        assert surfaces_and_spans == [
            ("地域社会", 0, 4),
            ("。", 4, 5),
            ("A", 5, 6),
            ("I", 6, 7),
            ("\n", 7, 8),
            ("アリサ", 8, 11),
            ("は", 11, 12),
        ]
    assert tokens[-1]["status"] == "unstyled"


def test_spelling_variant_alias(test_db: Path):
    """Known spelling variants resolve to the canonical dictionary entry."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N1")
    tokens = service.annotate_text("綺麗")

    assert len(tokens) == 1
    assert tokens[0]["lemma"] == "奇麗"


def test_dynamic_mined_word_addition_and_reload(test_db: Path):
    """add_mined_word immediately marks word as mined; reload_mined_words refreshes from SQLite."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N5")

    # Before adding, an N1 word is unstyled
    cue = {"start": 0.0, "end": 1.0, "text": "覚悟"}
    res_before = service.annotate_cue(cue)
    assert res_before["tokens"][0]["status"] == "unstyled"

    # Dynamically add
    service.add_mined_word("覚悟", reading="かくご")
    res_after = service.annotate_cue(cue)
    assert res_after["tokens"][0]["status"] == "mined"
    assert res_after["tokens"][0]["reading"] == "かくご"

    # Insert another into SQLite and reload
    _insert_known_word(test_db, "挑戦")
    service.reload_mined_words()
    res_db = service.annotate_cue({"start": 0.0, "end": 1.0, "text": "挑戦"})
    assert res_db["tokens"][0]["status"] == "mined"


def test_json_serialization_and_dict_methods(test_db: Path):
    """Annotated cues and tokens serialize to JSON and support dict operations."""
    import json
    service = SubtitleAnnotatorService(db_path=test_db)
    cue = {"start": 1.0, "end": 2.5, "text": "本"}
    annotated = service.annotate_cue(cue)

    serialized = json.dumps(annotated, ensure_ascii=False)
    assert "start" in serialized
    assert "tokens" in serialized
    assert "should_know" in serialized


def test_slice_10_required_cases(test_db: Path):
    """Slice 10 required test cases:
    ごはん, 御飯, ご飯, お茶, 待てない, 美味しい, 日本語, 見た/見る level equality, ラーメン
    Additive response fields: known, pos, level_source, est_level
    """
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")

    # 1-3. ごはん, 御飯, ご飯
    for surface in ["ごはん", "御飯", "ご飯"]:
        tokens = service.annotate_text(surface)
        assert len(tokens) == 1
        assert tokens[0]["surface"] == surface
        assert tokens[0]["jlpt_level"] == "N5"
        assert tokens[0]["level_source"] == "vocab"
        assert tokens[0]["status"] == "should_know"

    # 4. お茶
    tokens_ocha = service.annotate_text("お茶")
    assert len(tokens_ocha) == 1
    assert tokens_ocha[0]["surface"] == "お茶"
    assert tokens_ocha[0]["jlpt_level"] == "N5"
    assert tokens_ocha[0]["level_source"] == "vocab"
    assert tokens_ocha[0]["status"] == "should_know"

    # 5. 待てない
    tokens_matenai = service.annotate_text("待てない")
    assert len(tokens_matenai) == 1
    assert tokens_matenai[0]["surface"] == "待てない"
    assert tokens_matenai[0]["lemma"] == "待つ"
    assert tokens_matenai[0]["jlpt_level"] == "N5"
    assert tokens_matenai[0]["level_source"] == "vocab"
    assert tokens_matenai[0]["status"] == "should_know"

    # 6. 美味しい (N1 -> with learner level N4, status is unstyled)
    tokens_oishii = service.annotate_text("美味しい")
    assert len(tokens_oishii) == 1
    assert tokens_oishii[0]["surface"] == "美味しい"
    assert tokens_oishii[0]["lemma"] == "美味しい"
    assert tokens_oishii[0]["jlpt_level"] == "N1"
    assert tokens_oishii[0]["level_source"] == "vocab"
    assert tokens_oishii[0]["status"] == "unstyled"

    # 7. 日本語 (unknown kanji word -> est_level=hardest kanji level N5, status='unstyled')
    tokens_nihongo = service.annotate_text("日本語")
    assert len(tokens_nihongo) == 1
    assert tokens_nihongo[0]["surface"] == "日本語"
    assert tokens_nihongo[0]["jlpt_level"] is None
    assert tokens_nihongo[0]["est_level"] == "N5"
    assert tokens_nihongo[0]["level_source"] == "kanji_est"
    assert tokens_nihongo[0]["status"] == "unstyled"

    # 8. 見た/見る level equality
    tokens_mita = service.annotate_text("見た")
    tokens_miru = service.annotate_text("見る")
    assert len(tokens_mita) == 1
    assert len(tokens_miru) == 1
    assert tokens_mita[0]["lemma"] == "見る"
    assert tokens_miru[0]["lemma"] == "見る"
    assert tokens_mita[0]["jlpt_level"] == tokens_miru[0]["jlpt_level"] == "N3"

    # 9. ラーメン (katakana loanword not in OpenJLPT)
    tokens_ramen = service.annotate_text("ラーメン")
    assert len(tokens_ramen) == 1
    assert tokens_ramen[0]["surface"] == "ラーメン"
    assert tokens_ramen[0]["jlpt_level"] is None
    assert tokens_ramen[0]["level_source"] is None
    assert tokens_ramen[0]["status"] == "unstyled"

    # Additive fields check
    token = tokens_ocha[0]
    assert "known" in token
    assert "pos" in token
    assert "level_source" in token
    assert "est_level" in token


def test_annotated_token_gloss_and_compound_segmentation(test_db: Path):
    """AnnotatedToken attaches gloss definition and preserves segmentation lemmas."""
    service = SubtitleAnnotatorService(db_path=test_db, learner_level="N4")
    tokens = service.annotate_text("あなたと本を読む")
    assert len(tokens) >= 3

    # Verify gloss field is available
    for tok in tokens:
        assert "gloss" in tok

    # "あなた" should have a gloss definition from OpenJLPT meanings
    anata = next((t for t in tokens if t["surface"] == "あなた"), None)
    assert anata is not None
    assert anata.get("gloss") != ""
    assert "you" in anata["gloss"].lower()


def _create_phase2_homograph_dict(db_path: Path) -> Path:
    from kiroku_dictionary.schema import compress_content, create_indexes, create_schema, normalize_text

    conn = sqlite3.connect(str(db_path))
    create_schema(conn)
    conn.execute("INSERT INTO meta (key, value) VALUES ('jitendex_title', 'Jitendex Synthetic')")
    blob = compress_content([{"type": "structured-content", "content": []}])

    entries = [
        ("生", "なま", "", "★", 200.0, 1378450, "", "Jitendex", blob),
        ("生", "せい", "", "", 10.0, 2088240, "", "Jitendex", blob),
        ("日", "ひ", "", "★", 200.0, 1463770, "", "Jitendex", blob),
        ("日", "にち", "", "★", 190.0, 2083100, "", "Jitendex", blob),
        ("行く", "いく", "v5", "★ priority", 200.0, 1578850, "", "Jitendex", blob),
        ("行う", "おこなう", "v5", "★ priority", 200.0, 1589060, "", "Jitendex", blob),
        ("駅", "えき", "", "★", 200.0, 1173930, "", "Jitendex", blob),
        ("式", "しき", "", "★", 200.0, 1317940, "", "Jitendex", blob),
        ("食べる", "たべる", "v1", "★", 200.0, 1358280, "", "Jitendex", blob),
        ("飲む", "のむ", "v5", "★", 200.0, 1168900, "", "Jitendex", blob),
    ]
    for term, reading, rules, def_tags, score, seq, term_tags, dict_name, content_blob in entries:
        conn.execute(
            """
            INSERT INTO terms (
                term, reading, norm_term, norm_reading, rules, def_tags, score,
                sequence, term_tags, dictionary, content_blob
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                term,
                reading,
                normalize_text(term),
                normalize_text(reading),
                rules,
                def_tags,
                score,
                seq,
                term_tags,
                dict_name,
                content_blob,
            ),
        )
    create_indexes(conn)
    conn.commit()
    conn.close()
    return db_path


def test_homograph_collision_prevention_with_word_states(test_db: Path, tmp_path: Path):
    """word_states resolution prevents A1 homograph collisions for 行った, 生, and 日."""
    from unittest.mock import patch

    from kiroku_dictionary import DictionaryEngine
    from app.services.sentence_analysis import SentenceAnalysis, resolve_morphemes
    from app.services.tokenizers.base import Morpheme
    from app.services.word_state_service import WordStateService

    dict_db = _create_phase2_homograph_dict(tmp_path / "phase2_homographs.sqlite")
    engine = DictionaryEngine(str(dict_db))
    ws_service = WordStateService(db_path=test_db, dict_engine=engine)

    try:
        # Mark only 行く (1578850, いく), 生 (1378450, なま), and 日 (1463770, ひ) as known.
        ws_service.set_user_word_state(
            sequence_id=1578850, reading="いく", expression="行く", state="known"
        )
        ws_service.set_user_word_state(
            sequence_id=1378450, reading="なま", expression="生", state="known"
        )
        ws_service.set_user_word_state(
            sequence_id=1463770, reading="ひ", expression="日", state="known"
        )
        # Put 生 (2088240, せい) into learning to prove separate state per sequence_id/reading.
        ws_service.set_user_word_state(
            sequence_id=2088240, reading="せい", expression="生", state="learning"
        )

        annotator = SubtitleAnnotatorService(
            db_path=test_db, learner_level="N4", dict_engine=engine
        )

        # 1. Real Sudachi disambiguates 駅へ行った (行く) vs 式を行った (行う)
        toks_iku = annotator.annotate_text("駅へ行った")
        tok_itta_go = next(t for t in toks_iku if t.surface == "行った")
        assert tok_itta_go.lemma == "行く"
        assert tok_itta_go.sequence_id == 1578850
        assert tok_itta_go.word_state == "known"
        assert tok_itta_go.known is True

        toks_okonau = annotator.annotate_text("式を行った")
        tok_itta_do = next(t for t in toks_okonau if t.surface == "行った")
        assert tok_itta_do.lemma == "行う"
        assert tok_itta_do.sequence_id == 1589060
        assert tok_itta_do.word_state == "unseen"
        assert tok_itta_do.known is False

        # 2. 生 (なま vs せい) and 日 (ひ vs にち) resolve distinct word states by (sequence_id, reading)
        def _fake_analyze(text, **kwargs):
            mapping = {
                "生_nama": [Morpheme("生", "生", "ナマ", ("名詞", "普通名詞"), 0, 1, "生")],
                "生_sei": [Morpheme("生", "生", "セイ", ("名詞", "普通名詞"), 0, 1, "生")],
                "日_hi": [Morpheme("日", "日", "ヒ", ("名詞", "普通名詞"), 0, 1, "日")],
                "日_nichi": [Morpheme("日", "日", "ニチ", ("名詞", "普通名詞"), 0, 1, "日")],
            }
            morphemes = mapping[text]
            resolved = resolve_morphemes(morphemes, dict_lookup=engine)
            return SentenceAnalysis(morphemes=morphemes, merged=resolved)

        with patch("app.services.subtitle_annotator.analyze", side_effect=_fake_analyze):
            t_nama = annotator.annotate_text("生_nama")[0]
            t_sei = annotator.annotate_text("生_sei")[0]
            t_hi = annotator.annotate_text("日_hi")[0]
            t_nichi = annotator.annotate_text("日_nichi")[0]

        assert t_nama.sequence_id == 1378450
        assert t_nama.word_state == "known"
        assert t_nama.known is True

        assert t_sei.sequence_id == 2088240
        assert t_sei.word_state == "learning"
        assert t_sei.known is False

        assert t_hi.sequence_id == 1463770
        assert t_hi.word_state == "known"
        assert t_hi.known is True

        assert t_nichi.sequence_id == 2083100
        assert t_nichi.word_state == "unseen"
        assert t_nichi.known is False
    finally:
        engine.close()


def test_word_states_token_status_known_words_compat_and_encounter_recording(
    test_db: Path, tmp_path: Path
):
    """word_state integrates with ignored/blacklisted styling, known_words compatibility, and opt-in encounters."""
    from kiroku_dictionary import DictionaryEngine
    from app.services.word_state_service import WordStateService

    dict_db = _create_phase2_homograph_dict(tmp_path / "phase2_compat.sqlite")
    engine = DictionaryEngine(str(dict_db))
    ws_service = WordStateService(db_path=test_db, dict_engine=engine)

    try:
        ws_service.set_user_word_state(
            sequence_id=1173930, reading="えき", expression="駅", state="ignored"
        )
        ws_service.set_user_word_state(
            sequence_id=1317940, reading="しき", expression="式", state="blacklisted"
        )

        annotator = SubtitleAnnotatorService(
            db_path=test_db, learner_level="N5", dict_engine=engine
        )

        # Ignored / blacklisted words stay unstyled and known=False
        toks_ignored = annotator.annotate_text("駅に行く")
        tok_eki = next(t for t in toks_ignored if t.surface == "駅")
        assert tok_eki.word_state == "ignored"
        assert tok_eki.known is False
        assert tok_eki.status == "unstyled"

        toks_black = annotator.annotate_text("式を行う")
        tok_shiki = next(t for t in toks_black if t.surface == "式")
        assert tok_shiki.word_state == "blacklisted"
        assert tok_shiki.known is False
        assert tok_shiki.status == "unstyled"

        # Caller-passed known_words still sets known=True and word_state='known'
        toks_compat = annotator.annotate_text("飲む", known_words={"飲む"})
        tok_nomu = next(t for t in toks_compat if t.surface == "飲む")
        assert tok_nomu.known is True
        assert tok_nomu.word_state == "known"

        # Opt-in encounter recording advances unseen -> seen in word_states
        annotator.annotate_cues(
            [{"id": "c1", "start": 0.0, "end": 2.0, "text": "食べる"}],
            record_encounters=True,
            source_media="ep07.mkv",
        )
        summary = ws_service.get_encounter_summary(sequence_id=1358280, reading="たべる")
        assert summary["total_encounters"] == 1
        assert summary["episode_count"] == 1
        assert ws_service.get_word_state(sequence_id=1358280, reading="たべる").state == "seen"
    finally:
        engine.close()


