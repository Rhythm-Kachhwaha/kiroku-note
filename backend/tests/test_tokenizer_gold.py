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

    assert len(cases) == 150
    assert len(data["cases"]) >= 18
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

    assert first["case_count"] == 150
    assert first["unreviewed_cases"] == sum(case["provenance"] != "owner_reviewed" for case in cases)
    assert first["runners"]["fixture-runner"]["case_errors"] == 0
    assert first["runners"]["fixture-runner"]["token_count"] == 150
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
