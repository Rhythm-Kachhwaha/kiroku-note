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

NEGATIVE_CORPUS = [
    "私は本を読む。",
    "学校に行く。",
    "駅で友達を待つ。",
    "猫が窓のそばにいる。",
    "机の上に本を置く。",
    "今日は雨だ。",
    "明日は月曜日です。",
    "これは新しい本です。",
    "その映画は長いです。",
    "先生は教室にいる。",
    "電車で会社へ行く。",
    "母と買い物をする。",
    "父の車を使う。",
    "水を飲む。",
    "りんごを食べる。",
    "七時に起きる。",
    "友達は元気です。",
    "この部屋は静かです。",
    "犬は庭で遊ぶ。",
    "日本語の本を読む。",
    "スーパーで牛乳を買う。",
    "ホテルに泊まる。",
    "公園を歩く。",
    "駅から家まで走る。",
    "窓を開ける。",
    "ドアを閉める。",
    "テレビを見る。",
    "音楽を聞く。",
    "手紙を書く。",
    "写真を撮る。",
    "カメラを使う。",
    "コンピューターを修理する。",
    "バナナとパンを買う。",
    "青い空を見る。",
    "赤い花を植える。",
    "大きな犬がいる。",
    "小さい箱を持つ。",
    "新しい靴を履く。",
    "古い時計を直す。",
    "静かな町を歩く。",
    "便利なアプリを使う。",
    "カタカナの単語を読む。",
    "ひらがなの練習をする。",
    "漢字の読みを調べる。",
    "駅前の店で昼ご飯を食べる。",
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
            "SELECT pattern_key, level, examples FROM grammar_index ORDER BY id"
        ).fetchall()

    by_level: dict[str, dict[str, Any]] = {}
    for key, level, examples_json in rows:
        examples = _examples(examples_json)
        sentence = examples[0] if examples else ""
        if not sentence:
            continue
        items = matcher.match_sentence(
            [{"text": char} for char in sentence], sentence
        )
        entry = by_level.setdefault(level, {"detected": 0, "total": 0, "misses": []})
        entry["total"] += 1
        if any(item.pattern_key == key for item in items):
            entry["detected"] += 1
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
        print(f"{level}: {entry['detected']}/{entry['total']}")
        for miss in result["by_level"].get(level, {}).get("misses", []):
            print(f"  miss {miss['pattern_key']}: {miss['sentence']}")
    print(f"negative false positives: {len(result['false_positives'])}")
    assert_coverage(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
