import json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
MASTER_DATASET_PATH = ROOT / "backend" / "app" / "data" / "master_grammar_dataset.json"
PROVENANCE_PATH = ROOT / "backend" / "app" / "data" / "master_grammar_provenance.json"


def test_master_grammar_dataset_exists_and_valid():
    assert MASTER_DATASET_PATH.exists(), "master_grammar_dataset.json must exist"
    data = json.loads(MASTER_DATASET_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert len(data) >= 700, f"Expected at least 700 reconciled concepts, got {len(data)}"

    levels = {item["canonical_level"] for item in data}
    assert levels == {"N5", "N4", "N3", "N2", "N1"}


def test_reference_audits_100_percent_accounted_for():
    assert PROVENANCE_PATH.exists(), "master_grammar_provenance.json must exist"
    prov = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))

    # Assert counts of accounted reference items
    ref_counts = {"N5": 0, "N4": 0, "N3": 0, "N2": 0, "N1": 0}
    for item in prov["reference_entries"]:
        ref_counts[item["source_level"]] += 1

    assert ref_counts["N5"] == 84
    assert ref_counts["N4"] == 132
    assert ref_counts["N3"] == 182
    assert ref_counts["N2"] == 197
    assert ref_counts["N1"] == 253
    assert sum(ref_counts.values()) == 848


def test_easiest_supported_level_rule_applied():
    data = json.loads(MASTER_DATASET_PATH.read_text(encoding="utf-8"))
    level_rank = {"N5": 1, "N4": 2, "N3": 3, "N2": 4, "N1": 5}

    for item in data:
        sources = item.get("source_evidence", [])
        if not sources:
            continue
        source_ranks = [level_rank[s["source_level"]] for s in sources if s.get("source_level") in level_rank]
        if source_ranks:
            expected_rank = min(source_ranks)
            actual_rank = level_rank[item["canonical_level"]]
            assert actual_rank == expected_rank, (
                f"Concept {item['concept_id']} level {item['canonical_level']} does not match easiest "
                f"supported rank {expected_rank} among {[s['source_level'] for s in sources]}"
            )
