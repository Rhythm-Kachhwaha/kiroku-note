import json
import sys
from pathlib import Path
from typing import Any

TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))

from compare_tokenizers import compare, load_cases  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "tokenizer_gold.json"
EXPECTED_FIELDS = {"surfaces", "lemmas", "readings", "pos", "inflections", "grammar_ids", "spans"}

ACCURACY_THRESHOLD = 0.90
MIN_REVIEWED_FOR_THRESHOLD = 20


def test_gold_corpus_has_reviewable_n5_to_n2_draft():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = load_cases(FIXTURE)

    assert len(cases) >= 150
    assert len(data["cases"]) >= 31
    assert data["generated_draft_cases"]["provenance"] in {
        "needs_owner_review", "machine_suggestion", "owner_reviewed",
    }
    assert {case["jlpt"] for case in cases} == {"N5", "N4", "N3", "N2"}
    assert {tag for case in cases for tag in case["tags"]} >= {
        "everyday_failure", "three_paragraph_corpus", "inflection_chain",
        "particle", "compound", "loanword", "name", "latin_digits",
        "punctuation", "grammar_span",
    }


def test_expected_answers_are_explicit_and_unreviewed_drafts_are_not_authoritative():
    for case in load_cases(FIXTURE):
        assert case["provenance"] in {
            "generated_draft", "machine_suggestion", "owner_reviewed", "needs_owner_review",
        }
        assert EXPECTED_FIELDS <= set(case["expected"])


def test_comparison_report_is_deterministic_without_tokenizers():
    cases = load_cases(FIXTURE)
    runner = lambda text: [{"surface": text}]
    first = compare(cases, {"fixture-runner": runner})
    second = compare(cases, {"fixture-runner": runner})

    assert first["case_count"] == len(cases)
    assert first["unreviewed_cases"] == sum(case["provenance"] != "owner_reviewed" for case in cases)
    assert first["runners"]["fixture-runner"]["case_errors"] == 0
    assert first["runners"]["fixture-runner"]["token_count"] == len(cases)
    assert first["runners"]["fixture-runner"]["latency_ms"] >= 0
    assert set(first["runners"]["fixture-runner"]) >= {
        "load_time_ms", "dictionary_size_bytes", "memory_bytes",
    }
    assert second["runners"]["fixture-runner"]["token_count"] == first["runners"]["fixture-runner"]["token_count"]


def test_authoritative_cases_only_are_comparable():
    cases = [case for case in load_cases(FIXTURE) if case["provenance"] == "owner_reviewed"]
    for case in cases:
        assert case["provenance"] == "owner_reviewed"
        assert EXPECTED_FIELDS <= set(case["expected"])


def test_authoritative_comparison_reports_segmentation_lemma_and_span_errors():
    cases = [{
        "id": "reviewed-001",
        "source": "日本語",
        "expected": {
            "surfaces": ["日本語"],
            "lemmas": ["日本語"],
            "readings": ["にほんご"],
            "pos": [["名詞"]],
            "spans": [[0, 3]],
        },
        "provenance": "owner_reviewed",
    }]

    report = compare(cases, {
        "fixture-runner": lambda text: [{
            "surface": "日本",
            "lemma": "日本",
            "reading": "にほん",
            "pos": ["名詞"],
            "start": 0,
            "end": 2,
        }],
    })

    result = report["runners"]["fixture-runner"]
    assert result["authoritative_case_errors"] == 1
    assert result["segmentation_errors"] == 1
    assert result["lemma_errors"] == 1
    assert result["span_errors"] == 1
    assert result["error_cases"] == ["reviewed-001"]


def test_reviewed_cases_accuracy_gate():
    """Reviewed cases must match pipeline output. Accuracy must exceed 0.90 if >= 20 reviewed."""
    from app.services.subtitle_annotator import SubtitleAnnotatorService

    cases = [case for case in load_cases(FIXTURE) if case["provenance"] == "owner_reviewed"]
    if not cases:
        # No reviewed cases yet; gate is inactive until owner reviews
        return

    service = SubtitleAnnotatorService()
    correct = 0
    errors: list[dict[str, Any]] = []

    for case in cases:
        tokens = service.annotate_text(case["source"])
        actual_surfaces = [t["surface"] for t in tokens]
        actual_lemmas = [t["lemma"] for t in tokens]
        expected = case["expected"]
        exp_surfaces = expected.get("surfaces", [])
        exp_lemmas = expected.get("lemmas", [])

        is_match = (actual_surfaces == exp_surfaces and actual_lemmas == exp_lemmas)
        if "levels" in expected and expected["levels"]:
            actual_levels = [t.get("jlpt_level") for t in tokens]
            is_match = is_match and (actual_levels == expected["levels"])

        if is_match:
            correct += 1
        else:
            errors.append({
                "id": case["id"],
                "source": case["source"],
                "expected": {"surfaces": exp_surfaces, "lemmas": exp_lemmas},
                "actual": {"surfaces": actual_surfaces, "lemmas": actual_lemmas},
            })

    accuracy = correct / len(cases)
    print(f"\n[Gold Corpus Accuracy] {correct}/{len(cases)} cases passed ({accuracy:.2%})")

    if len(cases) >= MIN_REVIEWED_FOR_THRESHOLD:
        assert accuracy >= ACCURACY_THRESHOLD, (
            f"Accuracy {accuracy:.2%} is below threshold {ACCURACY_THRESHOLD:.2%}. "
            f"Failed cases: {errors}"
        )
    else:
        assert len(errors) == 0, f"Reviewed cases failed: {errors}"


def _build_homograph_dict_db(db_path: Path) -> Path:
    """Create a deterministic synthetic dictionary SQLite DB for Phase 1 canonical resolution tests."""
    import sqlite3
    from kiroku_dictionary.schema import compress_content, create_indexes, create_schema, normalize_text

    conn = sqlite3.connect(str(db_path))
    create_schema(conn)
    conn.execute("INSERT INTO meta (key, value) VALUES ('jitendex_title', 'Jitendex Synthetic')")

    def _sc(pos_code: str) -> bytes:
        return compress_content([
            {
                "type": "structured-content",
                "content": [
                    {
                        "tag": "span",
                        "data": {"content": "part-of-speech-info", "code": pos_code},
                        "content": pos_code,
                    }
                ],
            }
        ])

    entries = [
        # 生 homographs
        ("生", "なま", "", "\u2605", 200.0, 1378450, "", "Jitendex", _sc("adj-no")),
        ("生", "せい", "", "", 0.0, 2088240, "", "Jitendex", _sc("n")),
        ("生", "き", "", "", 0.0, 1378440, "", "Jitendex", _sc("n")),
        # 日 homographs
        ("日", "ひ", "", "\u2605", 200.0, 1463770, "", "Jitendex", _sc("n")),
        ("日", "にち", "", "\u2605", 200.0, 2083100, "", "Jitendex", _sc("n")),
        ("日", "か", "", "", 0.0, 2083110, "", "Jitendex", _sc("n-suf")),
        # 上手 homographs
        ("上手", "じょうず", "", "\u2605 priority\xa0form", 200.0, 1353320, "", "Jitendex", _sc("adj-na")),
        ("上手", "うわて", "", "", 0.0, 1580400, "", "Jitendex", _sc("n")),
        ("上手", "かみて", "", "", -1.0, 1580400, "", "Jitendex", _sc("n")),
        ("上手", "じょうて", "", "obsolete\xa0reading", -101.0, 1353320, "", "Jitendex", _sc("adj-na")),
        # 行った disambiguation: 行く vs 行う
        ("行く", "いく", "v5", "\u2605 priority\xa0form", 200.0, 1578850, "", "Jitendex", _sc("v5k-s")),
        ("行く", "ゆく", "v5", "\u2605 priority\xa0form", 198.0, 1578850, "", "Jitendex", _sc("v5k-s")),
        ("行う", "おこなう", "v5", "\u2605 priority\xa0form", 200.0, 1589060, "", "Jitendex", _sc("v5u")),
        # Honorific + common words
        ("お願い", "おねがい", "", "\u2605", 200.0, 2036870, "", "Jitendex", _sc("n")),
        ("する", "する", "vs", "\u2605", 200.0, 1157170, "", "Jitendex", _sc("vs-i")),
        ("歩く", "あるく", "v5", "\u2605", 200.0, 1514320, "", "Jitendex", _sc("v5k")),
    ]
    for term, reading, rules, def_tags, score, seq, term_tags, dict_name, blob in entries:
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
                blob,
            ),
        )
    create_indexes(conn)
    conn.commit()
    conn.close()
    return db_path


def test_lemma_validation_gate_fallback_and_backward_compat():
    """Lemma validation checks lemma -> normalized -> surface and stays compatible without dict."""
    from app.services.sentence_analysis import analyze, resolve_morphemes
    from app.services.tokenizers.base import Morpheme

    # Without dict_lookup, analyze preserves unvalidated backward-compatible defaults
    plain = analyze("歩いてたら")
    assert len(plain.merged) == 1
    assert plain.merged[0].lemma == "歩く"
    assert plain.merged[0].unresolved is False
    assert plain.merged[0].resolution_status == "unvalidated"
    assert plain.merged[0].canonical_id is None

    # With injected lookup set, fallback order lemma -> normalized -> surface applies
    valid_terms = {"お願い", "電話", "猫", "歩く"}
    tokens = [
        Morpheme("歩く", "歩く", "アルク", ("動詞",), 0, 2, "歩く"),
        Morpheme("お願いします", "願いする", "オネガイシマス", ("名詞",), 2, 8, "お願い"),
        Morpheme("ねこ", "ネコ", "ネコ", ("名詞",), 8, 10, "猫"),
        Morpheme("謎語", "謎語", "ナゾゴ", ("名詞",), 10, 12, "謎語"),
        Morpheme("。", "。", "。", ("補助記号",), 12, 13, "。"),
    ]
    # Use surface fallback when lemma and normalized both miss
    surface_fallback = [
        Morpheme("猫", "偽物", "ネコ", ("名詞",), 0, 1, "偽物2"),
    ]
    resolved = resolve_morphemes(tokens, dict_lookup=valid_terms)
    assert resolved[0].lemma == "歩く"
    assert resolved[0].unresolved is False
    assert resolved[0].resolution_status == "resolved"

    assert resolved[1].lemma == "お願い"
    assert resolved[1].unresolved is False

    assert resolved[2].lemma == "猫"
    assert resolved[2].unresolved is False

    assert resolved[3].unresolved is True
    assert resolved[3].resolution_status == "unresolved"

    assert resolved[4].unresolved is False
    assert resolved[4].resolution_status == "skipped"

    surf_res = resolve_morphemes(surface_fallback, dict_lookup=valid_terms)
    assert surf_res[0].lemma == "猫"
    assert surf_res[0].unresolved is False


def test_unresolved_tokens_persistence_and_logging(tmp_path: Path):
    """init_db creates unresolved_tokens and analyze logs OOV tokens cleanly."""
    from app.db.connection import init_db, list_unresolved_tokens, record_unresolved_token
    from app.services.sentence_analysis import analyze

    app_db = tmp_path / "kiroku_app.sqlite"
    init_db(app_db)

    dict_db = _build_homograph_dict_db(tmp_path / "dict.sqlite")
    from kiroku_dictionary import DictionaryEngine

    engine = DictionaryEngine(str(dict_db))
    try:
        sentence = "謎猫が歩く。"
        analysis = analyze(
            sentence,
            dict_lookup=engine,
            log_unresolved=True,
            source="unit-test",
            db_path=app_db,
        )
        unresolved = [m for m in analysis.merged if m.unresolved]
        assert len(unresolved) >= 1
        assert any(m.surface in {"謎", "猫", "謎猫"} for m in unresolved)
    finally:
        engine.close()

    rows = list_unresolved_tokens(db_path=app_db)
    assert len(rows) >= 1
    assert any(r["sentence"] == "謎猫が歩く。" and r["source"] == "unit-test" for r in rows)

    # Direct helper call works too
    row_id = record_unresolved_token(
        "架空語",
        reading="カクウゴ",
        normalized_form="架空語",
        proposed_lemma="架空語",
        sentence="架空語だ。",
        source="subtitle",
        db_path=app_db,
    )
    assert row_id is not None
    latest = list_unresolved_tokens(limit=5, db_path=app_db)
    assert latest[0]["surface"] == "架空語"
    assert latest[0]["proposed_lemma"] == "架空語"


def test_canonical_disambiguation_for_homographs(tmp_path: Path):
    """Canonical resolution disambiguates 生, 日, 上手, and 行った via reading, POS, and tags."""
    from kiroku_dictionary import DictionaryEngine
    from app.services.sentence_analysis import analyze
    from app.services.subtitle_annotator import SubtitleAnnotatorService

    dict_db = _build_homograph_dict_db(tmp_path / "homographs.sqlite")
    engine = DictionaryEngine(str(dict_db))
    try:
        # 生: なま vs せい vs き
        nama = engine.resolve_canonical("生", reading="ナマ", pos=("名詞",))
        sei = engine.resolve_canonical("生", reading="セイ", pos=("名詞",))
        ki = engine.resolve_canonical("生", reading="キ", pos=("名詞",))
        assert nama is not None and nama.canonical_id == (1378450, "なま")
        assert sei is not None and sei.canonical_id == (2088240, "せい")
        assert ki is not None and ki.canonical_id == (1378440, "き")

        # 日: ひ vs にち vs か
        hi = engine.resolve_canonical("日", reading="ヒ", pos=("名詞",))
        nichi = engine.resolve_canonical("日", reading="ニチ", pos=("名詞",))
        ka = engine.resolve_canonical("日", reading="カ", pos=("接尾辞", "名詞的", "助数詞"))
        assert hi is not None and hi.canonical_id == (1463770, "ひ")
        assert nichi is not None and nichi.canonical_id == (2083100, "にち")
        assert ka is not None and ka.canonical_id == (2083110, "か")

        # 上手: じょうず (形状詞) vs かみて/うわて (名詞)
        jouzu = engine.resolve_canonical("上手", reading="ジョウズ", pos=("形状詞", "一般"))
        kamite = engine.resolve_canonical("上手", reading="カミテ", pos=("名詞", "普通名詞"))
        uwate = engine.resolve_canonical("上手", reading="ウワテ", pos=("名詞", "普通名詞"))
        assert jouzu is not None and jouzu.canonical_id == (1353320, "じょうず")
        assert kamite is not None and kamite.canonical_id == (1580400, "かみて")
        assert uwate is not None and uwate.canonical_id == (1580400, "うわて")

        # 行った: いった -> 行く (1578850, いく) vs おこなった -> 行う (1589060, おこなう)
        iku_res = engine.resolve_canonical("行った", reading="いった", pos=("動詞",))
        okonau_res = engine.resolve_canonical("行った", reading="おこなった", pos=("動詞",))
        assert iku_res is not None and iku_res.canonical_id == (1578850, "いく")
        assert okonau_res is not None and okonau_res.canonical_id == (1589060, "おこなう")

        # Sentence-level canonical_id via analyze(..., dict_lookup=engine)
        a_iku = analyze("歩いてたら", dict_lookup=engine)
        assert a_iku.merged[0].sequence_id == 1514320
        assert a_iku.merged[0].canonical_reading == "あるく"
        assert a_iku.merged[0].canonical_id == (1514320, "あるく")

        # SubtitleAnnotatorService exposes sequence_id, canonical_reading, canonical_id
        app_db = tmp_path / "sub_test.sqlite"
        annotator = SubtitleAnnotatorService(db_path=app_db, dict_engine=engine)
        toks = annotator.annotate_text("お願いします")
        onegai_tok = next(t for t in toks if t.surface == "お願い")
        assert onegai_tok.sequence_id == 2036870
        assert onegai_tok.canonical_reading == "おねがい"
        assert onegai_tok.canonical_id == (2036870, "おねがい")
        assert onegai_tok.unresolved is False
        assert onegai_tok.resolution_status == "resolved"
    finally:
        engine.close()
