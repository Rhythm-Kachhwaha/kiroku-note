"""Golden and performance tests for local dictionary engine (Slice 10)."""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.dictionary_provider import DictionaryTermNotFoundError
from app.services.yomitan import (
    IdentifiedTerm,
    YomitanService,
    get_dictionary_service,
    reset_dictionary_service,
)
from tests.conftest_dict import configured_dict_service, synthetic_dict_db_path


def test_golden_tabemashita_to_taberu(configured_dict_service: YomitanService):
    """食べました -> 食べる (polite past of ichidan verb)."""
    term = configured_dict_service.identify("食べました")
    assert term.expression == "食べる"
    assert term.reading == "たべる"

    enriched = configured_dict_service.enrich(term)
    assert enriched.expression == "食べる"
    assert any("eat" in sense.glosses[0] for e in enriched.entries for sense in e.senses)


def test_golden_itte_to_iku(configured_dict_service: YomitanService):
    """行って -> 行く (te-form of godan verb)."""
    term = configured_dict_service.identify("行って")
    assert term.expression == "行く"
    assert term.reading == "いく"

    enriched = configured_dict_service.enrich(term)
    assert enriched.expression == "行く"
    assert any("go" in sense.glosses[0] for e in enriched.entries for sense in e.senses)


def test_golden_takakunakatta_to_takai(configured_dict_service: YomitanService):
    """高くなかった -> 高い (negative past of i-adjective)."""
    term = configured_dict_service.identify("高くなかった")
    assert term.expression == "高い"
    assert term.reading == "たかい"

    enriched = configured_dict_service.enrich(term)
    assert enriched.expression == "高い"
    assert any("high" in sense.glosses[0] or "expensive" in sense.glosses[0] for e in enriched.entries for sense in e.senses)


def test_golden_gohan_single_entry(configured_dict_service: YomitanService):
    """ご飯 -> exact match ごはん (must NOT deconstruct into 飯)."""
    term = configured_dict_service.identify("ご飯")
    assert term.expression == "ご飯"
    assert term.reading == "ごはん"


def test_golden_gakkou_ni_iku_selection(configured_dict_service: YomitanService):
    """学校に行く -> longest start hit is 学校."""
    term = configured_dict_service.identify("学校に行く")
    assert term.expression == "学校"
    assert term.reading == "がっこう"


def test_golden_tabesaseraretakunakatta(configured_dict_service: YomitanService):
    """食べさせられたくなかった -> complex causative-passive-desire-negative-past deinflects to 食べる."""
    term = configured_dict_service.identify("食べさせられたくなかった")
    assert term.expression == "食べる"
    assert term.reading == "たべる"


def test_golden_katakana_loanword(configured_dict_service: YomitanService):
    """コーヒー -> katakana loanword resolves correctly."""
    term = configured_dict_service.identify("コーヒー")
    assert term.expression == "コーヒー"
    assert term.reading == "コーヒー"

    enriched = configured_dict_service.enrich(term)
    assert any("coffee" in sense.glosses[0] for e in enriched.entries for sense in e.senses)


def test_golden_kana_only_fallback(configured_dict_service: YomitanService):
    """Single kana word with no dictionary entry (ぽぽぽ) falls back to raw text."""
    term = configured_dict_service.identify("ぽぽぽ")
    assert term.expression == "ぽぽぽ"
    assert term.reading == "ぽぽぽ"


def test_golden_okurigana_variants(configured_dict_service: YomitanService):
    """行う and 行なう both resolve cleanly."""
    t1 = configured_dict_service.identify("行う")
    assert t1.expression == "行う"
    assert t1.reading == "おこなう"

    t2 = configured_dict_service.identify("行なう")
    assert t2.expression == "行なう"
    assert t2.reading == "おこなう"


def test_golden_no_hit_error_code(configured_dict_service: YomitanService):
    """Non-Japanese text or unknown kanji raises DICT_TERM_NOT_FOUND."""
    with pytest.raises(DictionaryTermNotFoundError) as exc_info:
        configured_dict_service.identify("xyz123")
    assert "could not identify a Japanese term" in str(exc_info.value)


def test_golden_phase1_contractions_honorifics_and_shinasai(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Verify LocalDictionaryProvider handles しなさい, 歩いてたら, お願いします, and Sudachi priority."""
    import json
    import zipfile
    from kiroku_dictionary.importer import build_database
    from app.services.dictionary_provider import LocalDictionaryProvider
    from tests.fixtures.dict.generate import create_synthetic_kanjidic_zip

    zip_path = tmp_path / "phase1_jitendex.zip"
    kanji_zip = create_synthetic_kanjidic_zip(tmp_path / "phase1_kanjidic.zip")
    db_path = tmp_path / "phase1_dict.sqlite"
    index_json = {
        "title": "Jitendex Phase1 Test",
        "format": 3,
        "revision": "test.phase1.1",
        "sequenced": True,
        "author": "Kiroku Test Suite",
    }
    terms = [
        ["する", "する", "", "vs", 200, ["to do"], 1157170, "vs"],
        ["歩く", "あるく", "", "v5", 200, ["to walk"], 1514320, "v5"],
        ["お願い", "おねがい", "", "", 200, ["request"], 2036870, "n"],
        ["お", "お", "", "", 0, ["honorific prefix"], 2089690, "pref"],
        ["待つ", "まつ", "", "v5", 200, ["to wait"], 1423310, "v5"],
        ["待てる", "まてる", "", "v1", 10, ["potential wait"], 9999001, "v1"],
    ]
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.json", json.dumps(index_json, ensure_ascii=False))
        zf.writestr("term_bank_1.json", json.dumps(terms, ensure_ascii=False))
    build_database(jitendex_path=str(zip_path), kanjidic_path=str(kanji_zip), output_db_path=str(db_path))

    provider = LocalDictionaryProvider(db_path=db_path)
    try:
        shinasai = provider.identify("しなさい")
        assert shinasai.expression == "する"
        assert shinasai.reading == "する"

        aruitetara = provider.identify("歩いてたら")
        assert aruitetara.expression == "歩く"
        assert aruitetara.reading == "あるく"

        onegai = provider.identify("お願いします")
        assert onegai.expression == "お願い"
        assert onegai.reading == "おねがい"

        # Sudachi lemma (待つ) outranks an alternative shorter-chain deinflector candidate (待てる)
        matenai = provider.identify("待てない")
        assert matenai.expression == "待つ"
        assert matenai.reading == "まつ"
    finally:
        provider.close()


def test_regression_get_dictionary_service_singleton(synthetic_dict_db_path: Path, monkeypatch: pytest.MonkeyPatch):
    """get_dictionary_service() must be constructed once and reused across invocations."""
    reset_dictionary_service()
    monkeypatch.setenv("KIROKU_DICTIONARY_DB_PATH", str(synthetic_dict_db_path))

    s1 = get_dictionary_service()
    s2 = get_dictionary_service()
    s3 = get_dictionary_service()

    assert s1 is s2
    assert s2 is s3
    reset_dictionary_service()


@pytest.mark.perf
def test_perf_sequential_captures_p95_under_50ms(configured_dict_service: YomitanService):
    """200 sequential captures p95 < 50ms after warmup."""
    # Warmup
    for _ in range(5):
        term = configured_dict_service.identify("食べました")
        configured_dict_service.enrich(term)

    terms_to_capture = [
        "食べました",
        "行って",
        "高くなかった",
        "ご飯",
        "学校に行く",
        "食べさせられたくなかった",
        "コーヒー",
        "行う",
    ]

    durations_ms: list[float] = []
    for i in range(200):
        query = terms_to_capture[i % len(terms_to_capture)]
        t0 = time.perf_counter()
        identified = configured_dict_service.identify(query)
        _ = configured_dict_service.enrich(identified)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        durations_ms.append(elapsed_ms)

    p95 = float(np.percentile(durations_ms, 95))
    mean = float(np.mean(durations_ms))
    print(f"\n[Perf] 200 sequential lookups: mean={mean:.2f}ms, p95={p95:.2f}ms")

    assert p95 < 50.0, f"p95 latency was {p95:.2f}ms, expected < 50.0ms"
