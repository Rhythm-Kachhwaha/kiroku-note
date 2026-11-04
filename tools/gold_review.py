"""Interactive review and machine suggestion tool for tokenizer gold corpus.

Allows the owner to:
1. Generate machine suggestions from the active SubtitleAnnotatorService pipeline.
2. Display per-case diffs between expected and suggested tokens.
3. Review cases interactively (y/n/e/q) to mark them as 'owner_reviewed'.
4. Batch generate suggestions (--suggest-all) or accept cases (--accept-count N).
5. Report corpus review stats and accuracy.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

FIXTURE_PATH = ROOT / "backend" / "tests" / "fixtures" / "tokenizer_gold.json"


def get_annotator_service():
    from app.services.subtitle_annotator import SubtitleAnnotatorService
    return SubtitleAnnotatorService()


def generate_suggestion(service: Any, text: str) -> dict[str, Any]:
    """Run active annotator pipeline on text and return normalized expected dictionary."""
    tokens = service.annotate_text(text)
    return {
        "surfaces": [t["surface"] for t in tokens],
        "lemmas": [t["lemma"] for t in tokens],
        "readings": [t["reading"] for t in tokens],
        "pos": [[t["pos"]] if isinstance(t["pos"], str) else list(t["pos"]) for t in tokens],
        "levels": [t.get("jlpt_level") for t in tokens],
        "spans": [[t["start_char"], t["end_char"]] for t in tokens],
        "inflections": [],
        "grammar_ids": [],
    }


def load_raw_fixture(path: Path = FIXTURE_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_raw_fixture(data: dict[str, Any], path: Path = FIXTURE_PATH) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def format_tokens_compact(suggestion: dict[str, Any]) -> str:
    surfaces = suggestion.get("surfaces", [])
    lemmas = suggestion.get("lemmas", [])
    levels = suggestion.get("levels", [])
    parts = []
    for i in range(len(surfaces)):
        s = surfaces[i]
        l = lemmas[i] if i < len(lemmas) else s
        lvl = levels[i] if i < len(levels) and levels[i] else "-"
        if s == l:
            parts.append(f"{s}[{lvl}]")
        else:
            parts.append(f"{s}->{l}[{lvl}]")
    return " / ".join(parts)


def diff_suggestions(expected: dict[str, Any], suggested: dict[str, Any]) -> str:
    exp_str = format_tokens_compact(expected)
    sug_str = format_tokens_compact(suggested)
    if not any(expected.get(k) for k in ("surfaces", "lemmas")):
        return f"  Expected:  (empty)\n  Suggested: {sug_str}"
    return f"  Expected:  {exp_str}\n  Suggested: {sug_str}"


def stats(data: dict[str, Any]) -> dict[str, Any]:
    cases = data.get("cases", [])
    reviewed = sum(1 for c in cases if c.get("provenance") == "owner_reviewed")
    with_suggestions = sum(1 for c in cases if c.get("provenance") == "machine_suggestion")
    needs_review = sum(1 for c in cases if c.get("provenance") == "needs_owner_review")
    total_expanded = len(cases) + data.get("generated_draft_cases", {}).get("count", 0)
    return {
        "explicit_cases": len(cases),
        "total_corpus_cases": total_expanded,
        "owner_reviewed": reviewed,
        "machine_suggestion": with_suggestions,
        "needs_owner_review": needs_review,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=FIXTURE_PATH)
    parser.add_argument("--stats", action="store_true", help="Print corpus stats and exit")
    parser.add_argument("--suggest-all", action="store_true", help="Fill empty cases with machine suggestions")
    parser.add_argument("--accept-count", type=int, default=0, help="Accept the first N cases as owner_reviewed")
    parser.add_argument("--case-id", type=str, help="Review or inspect a single case by ID")
    parser.add_argument("--interactive", action="store_true", help="Run interactive review session in terminal")
    args = parser.parse_args(argv)

    data = load_raw_fixture(args.fixture)

    if args.stats:
        s = stats(data)
        print("Gold Corpus Statistics:")
        for k, v in s.items():
            print(f"  {k}: {v}")
        return 0

    service = get_annotator_service()

    if args.suggest_all:
        updated = 0
        for case in data.get("cases", []):
            if case.get("provenance") != "owner_reviewed":
                sug = generate_suggestion(service, case["source"])
                case["expected"] = sug
                case["provenance"] = "machine_suggestion"
                updated += 1
        save_raw_fixture(data, args.fixture)
        print(f"Updated {updated} cases with machine suggestions.")
        return 0

    if args.accept_count > 0:
        accepted = 0
        for case in data.get("cases", []):
            if accepted >= args.accept_count:
                break
            sug = generate_suggestion(service, case["source"])
            case["expected"] = sug
            case["provenance"] = "owner_reviewed"
            accepted += 1
        save_raw_fixture(data, args.fixture)
        print(f"Accepted {accepted} cases as owner_reviewed.")
        return 0

    if args.case_id:
        target = next((c for c in data.get("cases", []) if c["id"] == args.case_id), None)
        if not target:
            print(f"Case '{args.case_id}' not found.")
            return 1
        sug = generate_suggestion(service, target["source"])
        print(f"Case: {target['id']} ({target.get('provenance')})")
        print(f"Source: {target['source']}")
        print(diff_suggestions(target.get("expected", {}), sug))
        return 0

    # Interactive mode (or default)
    print("Running interactive review session. (Ctrl+C to stop)")
    reviewed = 0
    modified = False
    cases = data.get("cases", [])

    try:
        for case in cases:
            if case.get("provenance") == "owner_reviewed":
                continue
            sug = generate_suggestion(service, case["source"])
            print("-" * 60)
            print(f"[{case['id']}] Source: {case['source']}")
            print(diff_suggestions(case.get("expected", {}), sug))

            choice = input("Accept as owner_reviewed? [y=accept / n=skip / q=quit]: ").strip().lower()
            if choice == "y":
                case["expected"] = sug
                case["provenance"] = "owner_reviewed"
                reviewed += 1
                modified = True
                print("Accepted.")
            elif choice == "q":
                break
            else:
                print("Skipped.")
    except (KeyboardInterrupt, EOFError):
        print("\nReview session interrupted.")

    if modified:
        save_raw_fixture(data, args.fixture)
        print(f"Saved {reviewed} newly reviewed cases.")
    else:
        print("No changes to save.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
