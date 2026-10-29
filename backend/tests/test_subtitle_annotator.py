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

