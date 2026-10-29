"""Coverage and precision harness for the bundled grammar index."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / "backend" / "app" / "data" / "grammar_reference.sqlite"

# These are the measured pre-data-driven baseline. Raising a floor is an
# intentional acceptance-gate change and should be accompanied by index work.
MINIMUM_HITS = {"N5": 1, "N4": 6, "N3": 5, "N2": 1, "N1": 1}
MINIMUM_AUTO_PERCENT = 85

NEGATIVE_CORPUS = [
    "東京駅。", "大阪城。", "北海道。", "富士山。", "青空。",
    "夕焼け。", "春風。", "秋空。", "電気製品。", "新聞記事。",
    "映画館。", "図書館。", "病院。", "大学。", "会社。",
    "公園。", "教室。", "玄関。", "台所。", "庭。",
    "机。", "椅子。", "時計。", "電話。", "写真。",
    "音楽。", "旅行。", "料理。", "野球。", "天気。",
    "東京へ。", "駅に。", "本を。", "猫が。", "家で。",
    "友達と。", "私の。", "これも。", "駅前。", "青い空。",
    "赤い花。", "大きな犬。", "小さい箱。", "古い時計。", "新しい靴。",
]


def _examples(value: str | None) -> list[str]:
    try:
        rows = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    result = []
    for row in rows:
        if isinstance(row, str):
            result.append(row)
        elif isinstance(row, dict):
            sentence = row.get("ja") or row.get("japanese")
            if isinstance(sentence, str):
                result.append(sentence)
    return result


def _matcher(index_path: Path):
    sys.path.insert(0, str(ROOT / "backend"))
    from app.services.grammar_matcher import GrammarMatcher
    from app.services.grammar_reference import GrammarReferenceService

    return GrammarMatcher(GrammarReferenceService(index_path))


def measure(index_path: Path = DEFAULT_INDEX) -> dict[str, Any]:
    matcher = _matcher(index_path)
    with sqlite3.connect(index_path) as connection:
        rows = connection.execute(
            "SELECT pattern_key, level, examples, matcher FROM grammar_index ORDER BY id"
        ).fetchall()

    by_level: dict[str, dict[str, Any]] = {}
    for key, level, examples_json, matcher_json in rows:
        examples = _examples(examples_json)
        sentence = examples[0] if examples else ""
        if not sentence:
            continue
        items = matcher.match_sentence(
            [{"text": char} for char in sentence], sentence
        )
        entry = by_level.setdefault(
            level, {"detected": 0, "total": 0, "misses": [], "auto_detected": 0, "auto_total": 0}
        )
        entry["total"] += 1
        is_auto = json.loads(matcher_json or "{}").get("match_mode") != "reference_only"
        if is_auto:
            entry["auto_total"] += 1
        if any(item.pattern_key == key for item in items):
            entry["detected"] += 1
            if is_auto:
                entry["auto_detected"] += 1
        else:
            entry["misses"].append({"pattern_key": key, "sentence": sentence})

    false_positives = []
    for sentence in NEGATIVE_CORPUS:
        items = matcher.match_sentence(
            [{"text": char} for char in sentence], sentence
        )
        if items:
            false_positives.append(
                {"sentence": sentence, "matches": [item.pattern_key for item in items]}
            )
    return {"by_level": by_level, "false_positives": false_positives}


def assert_coverage(result: dict[str, Any]) -> None:
    failures = []
    for level, minimum in MINIMUM_HITS.items():
        entry = result["by_level"].get(level, {"detected": 0, "total": 0})
        if entry["detected"] < minimum:
            failures.append(
                f"{level}: {entry['detected']}/{entry['total']} "
                f"(minimum {minimum})"
            )
        if entry.get("auto_total") and (
            entry["auto_detected"] * 100 < MINIMUM_AUTO_PERCENT * entry["auto_total"]
        ):
            failures.append(
                f"{level} auto: {entry['auto_detected']}/{entry['auto_total']} "
                f"(minimum {MINIMUM_AUTO_PERCENT}%)"
            )
    if result["false_positives"]:
        failures.append(
            f"negative corpus: {len(result['false_positives'])} false positives"
        )
    if failures:
        raise AssertionError("; ".join(failures))


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    args = parser.parse_args()
    result = measure(args.index)
    for level in ("N5", "N4", "N3", "N2", "N1"):
        entry = result["by_level"].get(level, {"detected": 0, "total": 0})
        print(
            f"{level}: {entry['detected']}/{entry['total']} "
            f"(auto {entry.get('auto_detected', 0)}/{entry.get('auto_total', 0)})"
        )
        for miss in result["by_level"].get(level, {}).get("misses", []):
            print(f"  miss {miss['pattern_key']}: {miss['sentence']}")
    print(f"negative false positives: {len(result['false_positives'])}")
    assert_coverage(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
