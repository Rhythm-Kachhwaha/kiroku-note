from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.grammar_coverage import (  # noqa: E402
    MINIMUM_HITS,
    assert_coverage,
    measure,
)


def test_index_examples_meet_baseline_and_negative_corpus():
    result = measure()
    assert_coverage(result)
    for level, minimum in MINIMUM_HITS.items():
        assert result["by_level"][level]["detected"] >= minimum
    assert result["false_positives"] == []
