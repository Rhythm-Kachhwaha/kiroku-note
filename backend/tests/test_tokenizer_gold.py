import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2] / "tools"
sys.path.insert(0, str(TOOLS))

from compare_tokenizers import compare, load_cases  # noqa: E402


FIXTURE = Path(__file__).parent / "fixtures" / "tokenizer_gold.json"
EXPECTED_FIELDS = {"surfaces", "lemmas", "readings", "pos", "inflections", "grammar_ids", "spans"}


def test_gold_corpus_has_reviewable_n5_to_n2_draft():
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    cases = load_cases(FIXTURE)

    assert len(cases) == 150
    assert len(data["cases"]) >= 18
    assert data["generated_draft_cases"]["provenance"] == "needs_owner_review"
    assert {case["jlpt"] for case in cases} == {"N5", "N4", "N3", "N2"}
    assert {tag for case in cases for tag in case["tags"]} >= {
        "everyday_failure", "three_paragraph_corpus", "inflection_chain",
        "particle", "compound", "loanword", "name", "latin_digits",
        "punctuation", "grammar_span",
    }


def test_expected_answers_are_explicit_and_unreviewed_drafts_are_not_authoritative():
    for case in load_cases(FIXTURE):
        assert case["provenance"] in {"generated_draft", "machine_suggestion", "owner_reviewed", "needs_owner_review"}
        assert EXPECTED_FIELDS <= set(case["expected"])
        if case["provenance"] != "owner_reviewed":
            assert not any(case["expected"][field] for field in EXPECTED_FIELDS)


def test_comparison_report_is_deterministic_without_tokenizers():
    cases = load_cases(FIXTURE)
    runner = lambda text: [{"surface": text}]
    first = compare(cases, {"fixture-runner": runner})
    second = compare(cases, {"fixture-runner": runner})

    assert first["case_count"] == 150
    assert first["unreviewed_cases"] == 150
    assert first["runners"]["fixture-runner"]["case_errors"] == 0
    assert first["runners"]["fixture-runner"]["token_count"] == 150
    assert first["runners"]["fixture-runner"]["latency_ms"] >= 0
    assert set(first["runners"]["fixture-runner"]) >= {
        "load_time_ms", "dictionary_size_bytes", "memory_bytes",
    }
    assert second["runners"]["fixture-runner"]["token_count"] == first["runners"]["fixture-runner"]["token_count"]

def test_authoritative_cases_only_are_comparable():
    cases = [case for case in load_cases(FIXTURE) if case["provenance"] == "owner_reviewed"]
    assert cases == []
