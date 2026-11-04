"""Tests for Sudachi tokenizer thread safety and sentence analysis caching."""
from __future__ import annotations

import concurrent.futures
from app.services.sentence_analysis import (
    analyze,
    clear_analysis_cache,
    get_analysis_cache_info,
)
from app.services.tokenizers.sudachi import get_sudachi_tokenizer


def test_sudachi_tokenizer_multithreading():
    tokenizer = get_sudachi_tokenizer("small")
    sample_texts = [
        "すもももももももものうち",
        "雨が降りそうです",
        "美味しいご飯をたくさん食べた",
        "日本語の勉強を毎日続けている",
    ]

    def worker(worker_id: int):
        errors = []
        for i in range(500):
            text = sample_texts[(worker_id + i) % len(sample_texts)]
            try:
                tokens = tokenizer.tokenize(text)
                if not tokens:
                    errors.append(f"Empty tokens for {text}")
            except Exception as e:
                errors.append(f"Worker {worker_id} iter {i} error: {e}")
        return errors

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(worker, i) for i in range(16)]
        all_errors = []
        for f in concurrent.futures.as_completed(futures):
            all_errors.extend(f.result())

    assert all_errors == [], f"Thread errors encountered: {all_errors}"


def test_sentence_analysis_cache():
    clear_analysis_cache()
    info_start = get_analysis_cache_info()

    text = "美味しいご飯を食べる"
    res1 = analyze(text, "small")
    assert res1 is not None
    assert len(res1.morphemes) > 0
    assert len(res1.merged) > 0

    info_after_first = get_analysis_cache_info()
    assert info_after_first.misses == info_start.misses + 1
    assert info_after_first.hits == info_start.hits

    res2 = analyze(text, "small")
    assert res2 == res1

    info_after_second = get_analysis_cache_info()
    assert info_after_second.hits == info_after_first.hits + 1
    assert info_after_second.misses == info_after_first.misses
