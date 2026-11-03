"""Compare available tokenizer implementations against the R1 gold corpus.

This tool is intentionally independent of production runtime selection. It can
run with no optional tokenizer installed and always emits deterministic JSON.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "tokenizer_gold.json"


def load_cases(path: Path = FIXTURE) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = list(data["cases"])
    levels = ("N5", "N4", "N3", "N2")
    for index, case in enumerate(cases):
        case["jlpt"] = case.get("jlpt", levels[index % len(levels)])
    draft = data["generated_draft_cases"]
    templates = draft["source_templates"]
    for index in range(draft["count"]):
        template = templates[index % len(templates)]
        number = index + 1
        cases.append({
            "id": f'{draft["id_prefix"]}{number:03d}',
            "source": template.format(n=number),
            "tags": [draft["tags"][index % len(draft["tags"])]],
            "expected": dict(draft["expected"]),
            "provenance": draft["provenance"],
            "jlpt": levels[index % len(levels)],
        })
    return cases


def _legacy_tokenize(text: str) -> list[dict[str, Any]]:
    module = importlib.import_module("backend.app.services.subtitle_annotator")
    candidates = ("tokenize_sentence", "tokenize", "annotate_sentence")
    for name in candidates:
        function = getattr(module, name, None)
        if callable(function):
            result = function(text)
            return [_normalise_token(token) for token in result]
    raise RuntimeError("No supported legacy tokenizer entry point was found")


def _sudachi_tokenize(text: str, dictionary: str) -> list[dict[str, Any]]:
    from sudachipy import dictionary as sudachi_dictionary
    from sudachipy import tokenizer as sudachi_tokenizer

    tokenizer = sudachi_dictionary.Dictionary(dict=dictionary).create()
    mode = sudachi_tokenizer.Tokenizer.SplitMode.C
    return [{
        "surface": token.surface(),
        "lemma": token.dictionary_form(),
        "reading": token.reading_form(),
        "pos": list(token.part_of_speech()),
        "start": token.begin(),
        "end": token.end(),
        "normalized": token.normalized_form(),
    } for token in tokenizer.tokenize(text, mode)]


def _normalise_token(token: Any) -> dict[str, Any]:
    if isinstance(token, dict):
        return {
            "surface": token.get("surface", token.get("text", "")),
            "lemma": token.get("lemma", token.get("base_form", "")),
            "reading": token.get("reading", ""),
            "pos": token.get("pos", []),
            "start": token.get("start"),
            "end": token.get("end"),
            "normalized": token.get("normalized", token.get("surface", token.get("text", ""))),
        }
    return {"surface": str(token), "lemma": "", "reading": "", "pos": [], "start": None, "end": None, "normalized": str(token)}


def _available_runners() -> dict[str, Callable[[str], list[dict[str, Any]]]]:
    runners: dict[str, Callable[[str], list[dict[str, Any]]]] = {}
    try:
        importlib.import_module("backend.app.services.subtitle_annotator")
        runners["legacy"] = _legacy_tokenize
    except Exception:
        pass
    try:
        importlib.import_module("sudachipy")
        runners["sudachi-small"] = lambda text: _sudachi_tokenize(text, "small")
        runners["sudachi-core"] = lambda text: _sudachi_tokenize(text, "core")
    except Exception:
        pass
    return runners


def compare(cases: list[dict[str, Any]], runners: dict[str, Callable[[str], list[dict[str, Any]]]]) -> dict[str, Any]:
    report: dict[str, Any] = {"case_count": len(cases), "runners": {}, "unreviewed_cases": sum(case["provenance"] != "owner_reviewed" for case in cases)}
    for name, runner in sorted(runners.items()):
        started = time.perf_counter()
        errors = 0
        token_count = 0
        for case in cases:
            try:
                token_count += len(runner(case["source"]))
            except Exception:
                errors += 1
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        report["runners"][name] = {
            "status": "available" if not errors else "error",
            "case_errors": errors,
            "token_count": token_count,
            "latency_ms": elapsed_ms,
            "load_time_ms": None,
            "dictionary_size_bytes": None,
            "memory_bytes": None,
        }
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = compare(load_cases(args.fixture), _available_runners())
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print(f"cases: {report['case_count']}; unreviewed: {report['unreviewed_cases']}")
        for name, result in report["runners"].items():
            print(f"{name}: {result['status']}, {result['latency_ms']} ms, {result['case_errors']} errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
