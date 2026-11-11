"""Roundtrip and distractor-safety invariants (Report Section 10: Abstain Rather Than Guess)."""
from __future__ import annotations

import re
from typing import Any, Callable, Iterable, Sequence

from app.repositories.word_state_repository import normalize_word_reading
from app.services.sentence_analysis import analyze
from app.services.vocab_practice.models import (
    AbstentionRecord,
    BLANK_TOKEN,
    WordTarget,
)


_PAREN_RE = re.compile(r"\([^)]*\)")
_WORD_RE = re.compile(r"[a-z0-9]+")
_GLOSS_STOPWORDS = frozenset({
    "a", "an", "the", "to", "of", "in", "on", "at", "by", "for", "with",
    "from", "as", "or", "and", "be", "is", "are", "was", "were", "it",
    "its", "oneself", "something", "someone", "sb", "sth", "e", "g", "esp",
    "etc", "usually", "often", "very", "like", "way", "manner", "state",
    "being", "having", "making", "doing", "get", "make", "do",
    "all", "one", "two", "over", "under", "out", "into", "onto", "about",
    "after", "before", "again", "another", "much", "more", "most", "some",
    "such", "also", "even", "just", "only", "too", "well", "still", "quite",
    "rather", "used", "things", "thing", "great", "large", "small", "little",
})


def _clean_gloss_phrase(gloss: str) -> str:
    stripped = _PAREN_RE.sub("", str(gloss or "")).strip().lower()
    stripped = re.sub(r"\s+", " ", stripped)
    return stripped


def _extract_gloss_keywords(glosses: Iterable[str]) -> tuple[set[str], set[str]]:
    """Return (normalized_phrases, meaningful_keywords) from English glosses."""
    phrases: set[str] = set()
    keywords: set[str] = set()
    for raw in glosses:
        no_parens = _PAREN_RE.sub("", str(raw or ""))
        for part in re.split(r"[;,/]", no_parens):
            phrase = _clean_gloss_phrase(part)
            if not phrase:
                continue
            phrases.add(phrase)
            for tok in _WORD_RE.findall(phrase):
                if len(tok) >= 3 and tok not in _GLOSS_STOPWORDS:
                    keywords.add(tok)
    return phrases, keywords


def glosses_overlap(target_glosses: Sequence[str], candidate_glosses: Sequence[str]) -> bool:
    """Return True if two words share gloss synonyms or overlapping core English meanings."""
    if not target_glosses or not candidate_glosses:
        return False
    t_phrases, t_words = _extract_gloss_keywords(target_glosses)
    c_phrases, c_words = _extract_gloss_keywords(candidate_glosses)

    if t_phrases & c_phrases:
        return True

    shared = t_words & c_words
    if not shared:
        return False

    min_len = min(len(t_words), len(c_words))
    if min_len <= 2:
        return True
    jaccard = len(shared) / max(1, len(t_words | c_words))
    return jaccard >= 0.34 or len(shared) >= 2


def locate_target_span(
    sentence: str,
    target: WordTarget,
    *,
    target_surface: str | None = None,
    dict_engine: Any = None,
) -> tuple[int, int, str, Any] | None:
    """
    Locate the exact character span (start, end, surface, resolved_morpheme) of target in sentence.

    Uses Phase 1 tokenizer (`sentence_analysis.analyze` + `dict_engine`) to ensure canonical match.
    """
    if not sentence or dict_engine is None:
        return None
    if not target.sequence_id or int(target.sequence_id) <= 0:
        return None

    analysis = analyze(sentence, dict_lookup=dict_engine)
    target_read_norm = normalize_word_reading(target.reading)

    matches: list[tuple[int, int, str, Any]] = []
    for m in analysis.merged:
        if m.sequence_id is None:
            continue
        if int(m.sequence_id) != int(target.sequence_id):
            continue
        m_read = normalize_word_reading(m.canonical_reading or m.reading)
        if target_read_norm and m_read and m_read != target_read_norm:
            continue
        if target_surface and m.surface != target_surface:
            continue
        matches.append((m.start, m.end, m.surface, m))

    # Ambiguity guard: if the target word appears multiple times, only accept if target_surface uniquely pins 1 or take unique match
    if len(matches) == 1:
        return matches[0]
    return None


def verify_sentence_roundtrip(
    *,
    original_sentence: str,
    blanked_sentence: str,
    target_surface: str,
    target: WordTarget,
    dict_engine: Any,
    blank_token: str = BLANK_TOKEN,
) -> tuple[bool, str]:
    """
    Enforce the Phase 3 Roundtrip Invariant:
    1. Replacing blank_token in blanked_sentence with target_surface reproduces original_sentence exactly.
    2. Tokenizing the filled sentence resolves the target span back to target (sequence_id, reading).
    """
    if not target.sequence_id or int(target.sequence_id) <= 0:
        return False, "Target word lacks a canonical JMdict sequence_id."
    if not target_surface:
        return False, "Target surface must be non-empty."
    if dict_engine is None:
        return False, "Dictionary engine is required for canonical roundtrip verification."
    if blanked_sentence.count(blank_token) != 1:
        return False, "Blanked sentence must contain exactly one blank token."

    rebuilt = blanked_sentence.replace(blank_token, target_surface, 1)
    if rebuilt != original_sentence:
        return False, "Rebuilding sentence from blank did not reproduce original sentence exactly."

    span_start = blanked_sentence.index(blank_token)
    span_end = span_start + len(target_surface)

    analysis = analyze(rebuilt, dict_lookup=dict_engine)
    target_read_norm = normalize_word_reading(target.reading)

    matched = [
        m for m in analysis.merged
        if m.start == span_start and m.end == span_end
    ]
    if not matched:
        return False, f"Tokenizer did not preserve span [{span_start}:{span_end}] for '{target_surface}'."

    tok = matched[0]
    if tok.sequence_id is None or int(tok.sequence_id) != int(target.sequence_id):
        return (
            False,
            f"Tokenizer resolved span to sequence_id={tok.sequence_id} instead of {target.sequence_id}.",
        )

    tok_read = normalize_word_reading(tok.canonical_reading or tok.reading)
    if target_read_norm and tok_read and tok_read != target_read_norm:
        return (
            False,
            f"Tokenizer reading '{tok_read}' did not match target reading '{target_read_norm}'.",
        )

    return True, ""


def validate_distractor_safety(
    *,
    target: WordTarget,
    distractor: WordTarget,
    required_categories: Iterable[str] = (),
    blanked_sentence: str = "",
    distractor_surface: str | None = None,
    dict_engine: Any = None,
    blank_token: str = BLANK_TOKEN,
    extra_fit_check: Callable[[WordTarget, str], bool] | None = None,
) -> tuple[bool, str]:
    """
    Enforce Distractor Safety Invariants (Report Section 10).

    Rejects any distractor that:
    1. lacks a canonical sequence_id,
    2. has a different learner category (when required_categories is given),
    3. shares sequence_id or is an alternate kanji/reading form of target,
    4. shares English gloss synonyms / overlapping meanings with target,
    5. fails tokenizer stability in the blank OR produces a valid/acceptable fit in the blank.
    """
    if not distractor.sequence_id or int(distractor.sequence_id) <= 0:
        return False, "distractor_missing_sequence_id"

    req_cats = set(required_categories)
    if req_cats and not (req_cats & set(distractor.categories)):
        return False, "distractor_cross_category"

    if int(distractor.sequence_id) == int(target.sequence_id):
        return False, "distractor_same_sequence_id"

    target_forms = {target.expression, target.reading, *target.alternate_forms}
    distractor_forms = {distractor.expression, distractor.reading, *distractor.alternate_forms}
    if target.expression == distractor.expression:
        return False, "distractor_same_expression"
    if (target_forms - {""}) & (distractor_forms - {""}):
        # Allow if strictly distinct reading? Reject shared expression/alternate form.
        if distractor.expression in target.alternate_forms or target.expression in distractor.alternate_forms:
            return False, "distractor_alternate_form"

    if glosses_overlap(target.glosses, distractor.glosses):
        return False, "distractor_synonym_gloss_overlap"

    if blanked_sentence and dict_engine is not None and blank_token in blanked_sentence:
        surface = distractor_surface or distractor.expression or distractor.reading
        alt_sentence = blanked_sentence.replace(blank_token, surface, 1)
        span_start = blanked_sentence.index(blank_token)
        span_end = span_start + len(surface)

        analysis = analyze(alt_sentence, dict_lookup=dict_engine)
        span_toks = [m for m in analysis.merged if m.start == span_start and m.end == span_end]
        if not span_toks:
            return False, "distractor_breaks_tokenization"
        tok = span_toks[0]
        if tok.sequence_id is None:
            return False, "distractor_unresolved_in_sentence"
        if int(tok.sequence_id) == int(target.sequence_id):
            return False, "distractor_resolves_to_target"
        if int(tok.sequence_id) != int(distractor.sequence_id):
            return False, "distractor_resolves_to_unexpected_entry"

        if extra_fit_check is not None and extra_fit_check(distractor, alt_sentence):
            return False, "distractor_valid_fit_in_blank"

    return True, ""


def make_abstention(
    generator: str,
    reason_code: str,
    reason: str,
    target: WordTarget | None = None,
) -> AbstentionRecord:
    """Create a structured AbstentionRecord for diagnostics and auditability."""
    return AbstentionRecord(
        generator=generator,
        reason_code=reason_code,
        reason=reason,
        sequence_id=target.sequence_id if target else None,
        expression=target.expression if target else "",
    )
