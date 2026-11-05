import pytest

from app.services.grammar_matcher import GrammarMatcher
from app.services.grammar_reference import GrammarReferenceService


def test_ta_tokorode_inverted_spans_fixed():
    matcher = GrammarMatcher()
    for sentence in ("彼は来たところで帰った。", "今さら言ったところで遅い。"):
        tokens = [{"text": char} for char in sentence]
        matches = matcher.match_sentence(tokens, sentence)
        point_match = next((item for item in matches if item.pattern_key == "たところで"), None)
        assert point_match is not None, f"Expected match for たところで in {sentence}"
        assert 0 <= point_match.start < point_match.end <= len(sentence)
        assert point_match.text == sentence[point_match.start:point_match.end]
        assert point_match.text != ""


def test_master_dataset_example_sentences_span_invariants():
    ref = GrammarReferenceService()
    matcher = GrammarMatcher(ref)
    points = ref.get_points()

    sentences: list[str] = []
    for point in points:
        for ex in point.get("examples") or []:
            if isinstance(ex, dict) and ex.get("ja"):
                sentences.append(ex["ja"])
            elif isinstance(ex, str) and ex:
                sentences.append(ex)

    assert len(sentences) > 0, "Expected example sentences in grammar reference"

    for sentence in sentences:
        # Test both with raw_text and with char-level tokens
        for toks in (None, [{"text": c} for c in sentence]):
            matches = matcher.match_sentence(tokens=toks, raw_text=sentence)
            for span in matches:
                assert 0 <= span.start < span.end <= len(sentence), (
                    f"Invalid span bounds ({span.start}, {span.end}) for pattern {span.pattern_key} in sentence {sentence!r}"
                )
                assert span.text == sentence[span.start:span.end], (
                    f"Span text mismatch for pattern {span.pattern_key} in sentence {sentence!r}: "
                    f"got {span.text!r}, expected {sentence[span.start:span.end]!r}"
                )
