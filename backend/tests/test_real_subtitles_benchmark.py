"""Real Anime Subtitle Benchmark and Accuracy Verification.

Benchmarked against:
1. Episode 1 (.ass): KirokuSubtitles_[Frained] けいおん! 01 [retimed].ass (~397 cues)
2. Episode 14 (.srt): KirokuSubtitles_[VCB-Studio] K-ON! S1E14 [retimed].srt (~482 cues)
3. Installed PC database: %LOCALAPPDATA%/KirokuNote/data/kiroku.db (957+ cards) + OpenJLPT dataset.

Target Latency:
- Mean latency per cue strictly < 2.5ms.
- Total batch latency < 1.0s per episode track.

Metrics computed & verified:
- Total cues processed per episode
- Total tokens generated
- Breakdown of status: `should_know`, `mined`, `unstyled`
- Mean and max latency per cue
- Inflection lemma resolution across real anime dialogue lines.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import sys
import time
from typing import Any

# Ensure stdout handles Japanese characters safely on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import pytest

from app.config import get_db_path
from app.services.subtitle_annotator import (
    AnnotatedCue,
    AnnotatedToken,
    SubtitleAnnotatorService,
)

REAL_SUBS_DIR = Path("C:/Users/Rhythm/Downloads/subs")
EP1_ASS_FILENAME = "KirokuSubtitles_[Frained] けいおん! 01 [retimed].ass"
EP14_SRT_FILENAME = "KirokuSubtitles_[VCB-Studio] K-ON! S1E14 [retimed].srt"

EP1_ASS_PATH = REAL_SUBS_DIR / EP1_ASS_FILENAME
EP14_SRT_PATH = REAL_SUBS_DIR / EP14_SRT_FILENAME

# Fallback cues if the real subtitle folder is missing in another environment
FALLBACK_ASS_CUES: list[dict[str, Any]] = [
    {"start": 21.19, "end": 23.68, "text": "お姉ちゃん そろそろ起きないと…"},
    {"start": 32.39, "end": 33.67, "text": "はッ ８時！"},
    {"start": 33.86, "end": 35.14, "text": "ちッ 遅刻 遅刻ッ"},
    {"start": 35.27, "end": 36.17, "text": "何で急ぐの？"},
    {"start": 85.47, "end": 89.60, "text": "あれ？ 見間違えた～"},
    {"start": 115.89, "end": 118.59, "text": "終業チャイムまで待てない"},
    {"start": 121.54, "end": 125.86, "text": "精一杯Study After School"},
    {"start": 158.34, "end": 164.12, "text": "昨日より遠く おとといよりオクターブ高く"},
    {"start": 170.85, "end": 173.65, "text": "早起きしても早寝はNon Non Non!"},
    {"start": 185.13, "end": 189.32, "text": "歌えばShining After School"},
    {"start": 209.22, "end": 211.06, "text": "入学おめでとうございま～す"},
    {"start": 211.41, "end": 212.56, "text": "ぜひ テニス部へ"},
]

FALLBACK_SRT_CUES: list[dict[str, Any]] = [
    {"start": 98.12, "end": 100.86, "text": "ガチでカシマシ Never Ending Girls' Talk"},
    {"start": 100.99, "end": 103.69, "text": "終業チャイムまで待てない"},
    {"start": 103.79, "end": 106.49, "text": "遅刻はしても早退はNon Non Non!"},
    {"start": 106.64, "end": 110.96, "text": "精一杯Study After School"},
    {"start": 150.00, "end": 152.00, "text": "見えないところで努力した"},
    {"start": 160.00, "end": 163.00, "text": "コップが割れた"},
]


# ============================================================================
# Subtitle Parsers (ASS and SRT)
# ============================================================================


def strip_ass_override_tags(text: str) -> str:
    """Strip ASS/SSA override tags {\\...}, drawing commands, and normalize line breaks."""
    if not text:
        return ""
    # Strip drawing commands block {\p1}...{\p0}
    cleaned = re.sub(r"\{\\p[1-9]\}.*?\{\\p0\}", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\{\\p[1-9]\}.*$", "", cleaned, flags=re.IGNORECASE)
    # Strip style overrides {\...}
    cleaned = re.sub(r"\{[^}]*\}", "", cleaned)
    # Replace \N and \n with space
    cleaned = re.sub(r"\\[Nn]", " ", cleaned)
    # Replace \h with standard space
    cleaned = re.sub(r"\\h", " ", cleaned)
    # Strip HTML tags if present
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    # Normalize multiple whitespace characters
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip()


def strip_srt_tags(text: str) -> str:
    """Strip SRT formatting tags, HTML tags, and ASS remnants."""
    if not text:
        return ""
    cleaned = re.sub(r"\{[^}]*\}", "", text)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    cleaned = re.sub(r"\\[Nn]", " ", cleaned)
    cleaned = re.sub(r"\\h", " ", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip()


def parse_timestamp(time_str: str) -> float:
    """Parse ASS (H:MM:SS.cc) or SRT (HH:MM:SS,mmm) timestamp into seconds."""
    s = time_str.strip().replace(",", ".")
    parts = s.split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600.0 + float(parts[1]) * 60.0 + float(parts[2])
    elif len(parts) == 2:
        return float(parts[0]) * 60.0 + float(parts[1])
    return 0.0


def parse_ass_subtitles(source: Path | str) -> list[dict[str, Any]]:
    """Parse an Advanced SubStation Alpha (.ass) file into cue dictionaries."""
    if isinstance(source, Path):
        content = source.read_text(encoding="utf-8-sig", errors="replace")
    else:
        content = source

    cues: list[dict[str, Any]] = []
    in_events = False
    format_fields: list[str] = [
        "layer", "start", "end", "style", "name",
        "marginl", "marginr", "marginv", "effect", "text"
    ]
    start_idx = 1
    end_idx = 2
    text_idx = 9

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if line.startswith("[") and line.endswith("]"):
            in_events = (line.lower() == "[events]")
            continue

        if in_events and line.lower().startswith("format:"):
            header_str = line[7:].strip()
            format_fields = [f.strip().lower() for f in header_str.split(",")]
            start_idx = format_fields.index("start") if "start" in format_fields else 1
            end_idx = format_fields.index("end") if "end" in format_fields else 2
            text_idx = format_fields.index("text") if "text" in format_fields else len(format_fields) - 1
            continue

        if in_events and (line.startswith("Dialogue:") or line.startswith("dialogue:")):
            colon_pos = line.find(":")
            payload = line[colon_pos + 1:].strip()
            # Split up to len(format_fields) - 1 times so text contains all trailing commas
            parts = [p.strip() for p in payload.split(",", len(format_fields) - 1)]
            if len(parts) <= max(start_idx, end_idx, text_idx):
                continue

            start_sec = parse_timestamp(parts[start_idx])
            end_sec = parse_timestamp(parts[end_idx])
            raw_text = parts[text_idx]
            clean_text = strip_ass_override_tags(raw_text)

            if clean_text:
                cues.append({
                    "start": start_sec,
                    "end": end_sec,
                    "text": clean_text,
                })

    return cues


def parse_srt_subtitles(source: Path | str) -> list[dict[str, Any]]:
    """Parse a SubRip (.srt) subtitle file into cue dictionaries."""
    if isinstance(source, Path):
        content = source.read_text(encoding="utf-8-sig", errors="replace")
    else:
        content = source

    normalized = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    blocks = re.split(r"\n\s*\n", normalized)
    cues: list[dict[str, Any]] = []

    for block in blocks:
        lines = [l.strip() for l in block.split("\n") if l.strip()]
        if not lines:
            continue

        time_idx = 0
        if lines[0].isdigit() and len(lines) > 1:
            time_idx = 1

        if time_idx >= len(lines):
            continue

        time_line = lines[time_idx]
        time_match = re.search(
            r"(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})",
            time_line,
        )
        if not time_match:
            continue

        start_sec = parse_timestamp(time_match.group(1))
        end_sec = parse_timestamp(time_match.group(2))
        raw_text = " ".join(lines[time_idx + 1:])
        clean_text = strip_srt_tags(raw_text)

        if clean_text:
            cues.append({
                "start": start_sec,
                "end": end_sec,
                "text": clean_text,
            })

    return cues


# ============================================================================
# Unit Tests for Parsers
# ============================================================================


def test_parser_tag_stripping_unit():
    """Verify tag stripping correctly removes ASS overrides and format tags."""
    # ASS style override tags
    assert strip_ass_override_tags(r"{\be1}Chatting Now") == "Chatting Now"
    assert strip_ass_override_tags(r"希望{\rOPC}·{\r}欲望") == "希望·欲望"
    assert strip_ass_override_tags(r"New{\fscx50} {\r}Type") == "New Type"
    assert strip_ass_override_tags(r"{\p1}m 0 0 l 10 0{\p0}Hello") == "Hello"
    assert strip_ass_override_tags(r"Line1\NLine2\nLine3") == "Line1 Line2 Line3"
    assert strip_ass_override_tags(r"Word1\hWord2") == "Word1 Word2"

    # SRT tags
    assert strip_srt_tags(r"<i>Italic Text</i>") == "Italic Text"
    assert strip_srt_tags(r"{\be1}Sub title\NSecond Line") == "Sub title Second Line"

    # Timestamp parser
    assert abs(parse_timestamp("0:00:21.19") - 21.19) < 0.001
    assert abs(parse_timestamp("00:01:37,640") - 97.64) < 0.001


# ============================================================================
# Benchmark Test Suite
# ============================================================================


def test_real_subtitles_benchmark_episode_1_ass():
    """Benchmark SubtitleAnnotatorService on Episode 1 (.ass) ~397 cues."""
    # 1. Load cues
    if EP1_ASS_PATH.exists():
        cues = parse_ass_subtitles(EP1_ASS_PATH)
        assert len(cues) >= 390, f"Expected ~397 cues, found {len(cues)}"
        safe_name = EP1_ASS_PATH.name.encode("ascii", "replace").decode("ascii")
        print(f"\n[Real Benchmark] Loaded {len(cues)} cues from real ASS file: {safe_name}")
    else:
        cues = FALLBACK_ASS_CUES
        print(f"\n[Fallback] Loaded {len(cues)} fallback ASS cues")

    # 2. Instantiate SubtitleAnnotatorService connecting to installed PC database
    db_path = get_db_path()
    service = SubtitleAnnotatorService(
        db_path=db_path,
        learner_level="N4",
        ignore_function_words=True,
    )
    print(f"[Database] Connected to {db_path} ({len(service._mined_words)} mined expressions indexed)")

    # 3. Warmup 1 cue
    service.annotate_cue(cues[0])

    # 4. Measure batch annotation time
    t0 = time.perf_counter()
    annotated_cues = service.annotate_cues(cues)
    t1 = time.perf_counter()
    batch_elapsed_s = t1 - t0

    # 5. Measure individual cue latencies for distribution stats
    latencies_ms: list[float] = []
    for cue in cues:
        ct0 = time.perf_counter()
        _ = service.annotate_cue(cue)
        ct1 = time.perf_counter()
        latencies_ms.append((ct1 - ct0) * 1000.0)

    mean_latency_ms = sum(latencies_ms) / len(latencies_ms)
    max_latency_ms = max(latencies_ms)
    total_tokens = sum(len(c.tokens) for c in annotated_cues)

    # 6. Status breakdown
    status_counts: dict[str, int] = {"should_know": 0, "mined": 0, "unstyled": 0}
    for cue in annotated_cues:
        for tok in cue.tokens:
            st = tok.status
            status_counts[st] = status_counts.get(st, 0) + 1

    # Print comprehensive benchmark statistics
    print("=" * 60)
    print(f"BENCHMARK RESULTS: EPISODE 1 (.ass)")
    print("=" * 60)
    print(f"  Cues processed     : {len(cues)}")
    print(f"  Total tokens       : {total_tokens}")
    print(f"  Status breakdown   : should_know={status_counts['should_know']}, mined={status_counts['mined']}, unstyled={status_counts['unstyled']}")
    print(f"  Batch total time   : {batch_elapsed_s * 1000:.2f}ms ({batch_elapsed_s:.4f}s)")
    print(f"  Mean latency/cue   : {mean_latency_ms:.4f}ms (target < 2.5ms)")
    print(f"  Max latency/cue    : {max_latency_ms:.4f}ms")
    print("=" * 60)

    # 7. Strict assertions
    assert mean_latency_ms < 2.5, f"Mean latency {mean_latency_ms:.4f}ms exceeds target 2.5ms"
    assert batch_elapsed_s < 1.0, f"Batch elapsed time {batch_elapsed_s:.4f}s exceeds target 1.0s"
    assert status_counts["should_know"] > 0
    assert status_counts["mined"] > 0
    assert status_counts["unstyled"] > 0

    # 8. Verify inflection lemma resolution across dialogue lines
    # Look for specific inflections in Episode 1
    tokens_by_surface = {t.surface: t for c in annotated_cues for t in c.tokens}
    
    #起きない -> 起きる
    okinai_tokens = [t for c in annotated_cues for t in c.tokens if "起きない" in t.surface]
    assert len(okinai_tokens) > 0
    assert okinai_tokens[0].lemma == "起きる"
    assert okinai_tokens[0].status == "should_know"
    assert okinai_tokens[0].jlpt_level == "N5"

    # 見間違えた -> 見間違う (mined card!)
    if EP1_ASS_PATH.exists():
        mimachigaeta_tokens = [t for c in annotated_cues for t in c.tokens if "見間違えた" in t.surface]
        assert len(mimachigaeta_tokens) > 0
        assert mimachigaeta_tokens[0].lemma == "見間違う"
        assert mimachigaeta_tokens[0].status == "mined"

    # 待てない -> 待つ
    matenai_tokens = [t for c in annotated_cues for t in c.tokens if "待てない" in t.surface]
    assert len(matenai_tokens) > 0
    assert matenai_tokens[0].lemma == "待つ"
    assert matenai_tokens[0].status == "should_know"


def test_real_subtitles_benchmark_episode_14_srt():
    """Benchmark SubtitleAnnotatorService on Episode 14 (.srt) ~482 cues."""
    # 1. Load cues
    if EP14_SRT_PATH.exists():
        cues = parse_srt_subtitles(EP14_SRT_PATH)
        assert len(cues) >= 480, f"Expected ~482 cues, found {len(cues)}"
        print(f"\n[Real Benchmark] Loaded {len(cues)} cues from real SRT file: {EP14_SRT_PATH.name}")
    else:
        cues = FALLBACK_SRT_CUES
        print(f"\n[Fallback] Loaded {len(cues)} fallback SRT cues")

    # 2. Instantiate SubtitleAnnotatorService connecting to installed PC database
    db_path = get_db_path()
    service = SubtitleAnnotatorService(
        db_path=db_path,
        learner_level="N4",
        ignore_function_words=True,
    )
    print(f"[Database] Connected to {db_path} ({len(service._mined_words)} mined expressions indexed)")

    # 3. Warmup 1 cue
    service.annotate_cue(cues[0])

    # 4. Measure batch annotation time
    t0 = time.perf_counter()
    annotated_cues = service.annotate_cues(cues)
    t1 = time.perf_counter()
    batch_elapsed_s = t1 - t0

    # 5. Measure individual cue latencies for distribution stats
    latencies_ms: list[float] = []
    for cue in cues:
        ct0 = time.perf_counter()
        _ = service.annotate_cue(cue)
        ct1 = time.perf_counter()
        latencies_ms.append((ct1 - ct0) * 1000.0)

    mean_latency_ms = sum(latencies_ms) / len(latencies_ms)
    max_latency_ms = max(latencies_ms)
    total_tokens = sum(len(c.tokens) for c in annotated_cues)

    # 6. Status breakdown
    status_counts: dict[str, int] = {"should_know": 0, "mined": 0, "unstyled": 0}
    for cue in annotated_cues:
        for tok in cue.tokens:
            st = tok.status
            status_counts[st] = status_counts.get(st, 0) + 1

    # Print comprehensive benchmark statistics
    print("=" * 60)
    print(f"BENCHMARK RESULTS: EPISODE 14 (.srt)")
    print("=" * 60)
    print(f"  Cues processed     : {len(cues)}")
    print(f"  Total tokens       : {total_tokens}")
    print(f"  Status breakdown   : should_know={status_counts['should_know']}, mined={status_counts['mined']}, unstyled={status_counts['unstyled']}")
    print(f"  Batch total time   : {batch_elapsed_s * 1000:.2f}ms ({batch_elapsed_s:.4f}s)")
    print(f"  Mean latency/cue   : {mean_latency_ms:.4f}ms (target < 2.5ms)")
    print(f"  Max latency/cue    : {max_latency_ms:.4f}ms")
    print("=" * 60)

    # 7. Strict assertions
    assert mean_latency_ms < 2.5, f"Mean latency {mean_latency_ms:.4f}ms exceeds target 2.5ms"
    assert batch_elapsed_s < 1.0, f"Batch elapsed time {batch_elapsed_s:.4f}s exceeds target 1.0s"
    assert status_counts["should_know"] > 0
    assert status_counts["unstyled"] > 0

    # 8. Verify inflection lemma resolution across dialogue lines
    # Look for specific inflections in Episode 14
    if EP14_SRT_PATH.exists():
        # 見えない -> 見える (N4)
        mienai_tokens = [t for c in annotated_cues for t in c.tokens if "見えない" in t.surface]
        assert len(mienai_tokens) > 0
        assert mienai_tokens[0].lemma == "見える"
        assert mienai_tokens[0].status == "should_know"
        assert mienai_tokens[0].jlpt_level == "N4"

        # 割れた -> 割れる (N4)
        wareta_tokens = [t for c in annotated_cues for t in c.tokens if "割れた" in t.surface]
        assert len(wareta_tokens) > 0
        assert wareta_tokens[0].lemma == "割れる"
        assert wareta_tokens[0].status == "should_know"
        assert wareta_tokens[0].jlpt_level == "N4"


def test_inflection_lemma_resolution_accuracy():
    """Verify detailed accuracy of inflection lemma resolution across various Japanese verb/adj forms."""
    service = SubtitleAnnotatorService(
        db_path=get_db_path(),
        learner_level="N4",
        ignore_function_words=True,
    )

    test_cases = [
        # surface, expected_lemma, expected_status, expected_level
        ("起きない", "起きる", "should_know", "N5"),
        ("待てない", "待つ", "should_know", "N5"),
        ("歌えば", "歌う", "should_know", "N5"),
        ("見えない", "見える", "should_know", "N4"),
        ("割れた", "割れる", "should_know", "N4"),
        ("高く", "高い", "should_know", "N5"),
    ]

    for surface, expected_lemma, expected_status, expected_level in test_cases:
        tokens = service.annotate_text(surface, learner_level="N4", ignore_function_words=True)
        assert len(tokens) >= 1, f"Expected at least 1 token for '{surface}'"
        match = tokens[0]
        assert match.lemma == expected_lemma, f"For '{surface}': got lemma '{match.lemma}', expected '{expected_lemma}'"
        assert match.status == expected_status, f"For '{surface}': got status '{match.status}', expected '{expected_status}'"
        assert match.jlpt_level == expected_level, f"For '{surface}': got level '{match.jlpt_level}', expected '{expected_level}'"
