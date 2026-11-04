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
import tracemalloc
from pathlib import Path
from typing import Any, Callable, Mapping

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

    dict_obj = sudachi_dictionary.Dictionary(dict=dictionary)
    mode = sudachi_tokenizer.Tokenizer.SplitMode.C
    tokenizer = dict_obj.create() if hasattr(dict_obj, "create") else dict_obj.tokenizer(mode=mode)
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
            "level": token.get("level", token.get("jlpt_level")),
            "normalized": token.get("normalized", token.get("surface", token.get("text", ""))),
        }
    return {"surface": str(token), "lemma": "", "reading": "", "pos": [], "start": None, "end": None, "normalized": str(token)}


def _available_runners() -> dict[str, Callable[[str], list[dict[str, Any]]]]:
    runners: dict[str, Callable[[str], list[dict[str, Any]]]] = {}
    started = time.perf_counter()
    try:
        from app.services.subtitle_annotator import SubtitleAnnotatorService
        service = SubtitleAnnotatorService()
        def _pipeline_run(text: str) -> list[dict[str, Any]]:
            toks = service.annotate_text(text)
            return [{
                "surface": t["surface"],
                "lemma": t["lemma"],
                "reading": t["reading"],
                "pos": [t["pos"]] if isinstance(t["pos"], str) else list(t["pos"]),
                "start": t["start_char"],
                "end": t["end_char"],
                "level": t.get("jlpt_level"),
                "normalized": t["lemma"],
            } for t in toks]
        runners["kiroku-pipeline"] = _pipeline_run
        setattr(runners["kiroku-pipeline"], "load_time_ms", round((time.perf_counter() - started) * 1000, 3))
    except Exception:
        pass

    started = time.perf_counter()
    try:
        module = importlib.import_module("backend.app.services.subtitle_annotator")
        if any(callable(getattr(module, name, None)) for name in (
            "tokenize_sentence", "tokenize", "annotate_sentence",
        )):
            runners["legacy"] = _legacy_tokenize
            setattr(runners["legacy"], "load_time_ms", round((time.perf_counter() - started) * 1000, 3))
    except ImportError:
        pass
    started = time.perf_counter()
    try:
        importlib.import_module("sudachipy")
        runners["sudachi-small"] = lambda text: _sudachi_tokenize(text, "small")
        runners["sudachi-core"] = lambda text: _sudachi_tokenize(text, "core")
        load_time_ms = round((time.perf_counter() - started) * 1000, 3)
        for runner in (runners["sudachi-small"], runners["sudachi-core"]):
            setattr(runner, "load_time_ms", load_time_ms)
    except ImportError:
        pass
    return runners


def _field_errors(
    expected: Mapping[str, Any],
    actual: list[dict[str, Any]],
) -> dict[str, int]:
    actual_fields = {
        "surfaces": [token["surface"] for token in actual],
        "lemmas": [token["lemma"] for token in actual],
        "readings": [token["reading"] for token in actual],
        "pos": [token["pos"] for token in actual],
    }
    if "levels" in expected and expected["levels"]:
        actual_fields["levels"] = [token.get("level") for token in actual]

    errors: dict[str, int] = {}
    for field, values in actual_fields.items():
        expected_values = expected.get(field, [])
        if values != expected_values:
            errors[field] = 1

    expected_spans = expected.get("spans", [])
    actual_spans = [[token["start"], token["end"]] for token in actual]
    if expected_spans and actual_spans != expected_spans:
        errors["spans"] = 1
    return errors


def _runner_metric(runner: Callable[..., Any], name: str) -> int | float | None:
    value = getattr(runner, name, None)
    return value if isinstance(value, (int, float)) else None


def compare(cases: list[dict[str, Any]], runners: dict[str, Callable[[str], list[dict[str, Any]]]]) -> dict[str, Any]:
    report: dict[str, Any] = {
        "case_count": len(cases),
        "runners": {},
        "unreviewed_cases": sum(case["provenance"] != "owner_reviewed" for case in cases),
    }
    for name, runner in sorted(runners.items()):
        started = time.perf_counter()
        errors = 0
        token_count = 0
        segmentation_errors = 0
        lemma_errors = 0
        morphology_errors = 0
        span_errors = 0
        error_cases: list[str] = []
        tracemalloc.start()
        for case in cases:
            try:
                actual = [_normalise_token(token) for token in runner(case["source"])]
                token_count += len(actual)
                if case["provenance"] != "owner_reviewed":
                    continue
                field_errors = _field_errors(case["expected"], actual)
                segmentation_errors += field_errors.get("surfaces", 0)
                lemma_errors += field_errors.get("lemmas", 0)
                morphology_errors += sum(
                    field_errors.get(field, 0) for field in ("readings", "pos")
                )
                span_errors += field_errors.get("spans", 0)
                if field_errors:
                    error_cases.append(case["id"])
            except Exception as exc:
                errors += 1
                error_cases.append(f"{case['id']}: {type(exc).__name__}")
        _, peak_memory = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        report["runners"][name] = {
            "status": "available" if not errors else "error",
            "case_errors": errors,
            "authoritative_case_errors": len(error_cases),
            "error_cases": error_cases,
            "segmentation_errors": segmentation_errors,
            "lemma_errors": lemma_errors,
            "morphology_errors": morphology_errors,
            "span_errors": span_errors,
            "token_count": token_count,
            "latency_ms": elapsed_ms,
            "load_time_ms": _runner_metric(runner, "load_time_ms"),
            "dictionary_size_bytes": _runner_metric(runner, "dictionary_size_bytes"),
            "memory_bytes": peak_memory,
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
