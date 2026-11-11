"""Deterministic Japanese conjugation generator, deinflector roundtrip verifier, and grader."""
from __future__ import annotations

import hashlib
from typing import Any

from app.repositories.word_state_repository import normalize_word_reading
from app.services.vocab_practice.categories import (
    CAT_ADJECTIVE_I,
    CAT_SURU_VERB,
    CAT_VERB_GODAN,
    CAT_VERB_ICHIDAN,
    CAT_VERB_KURU,
)
from app.services.vocab_practice.invariants import make_abstention
from app.services.vocab_practice.models import (
    AbstentionRecord,
    PracticeQuestion,
    PracticeResult,
    SentenceContext,
    WordTarget,
)
from app.services.vocab_practice.normalizer import check_lenient_answer
from kiroku_dictionary.deinflect import deinflect


CONJUGATION_LABELS: dict[str, str] = {
    "negative": "Plain negative (ない)",
    "past": "Plain past (た)",
    "negative_past": "Plain negative past (なかった)",
    "te_form": "Te-form (て/で)",
    "polite": "Polite non-past (ます)",
    "polite_negative": "Polite negative (ません)",
    "polite_past": "Polite past (ました)",
    "polite_negative_past": "Polite negative past (ませんでした)",
    "passive": "Passive (られる/れる)",
    "causative": "Causative (させる/せる)",
    "potential": "Potential (られる/える)",
    "polite_imperative": "Polite imperative (なさい)",
    "volitional": "Volitional (よう/おう)",
    "conditional": "Conditional (ば)",
    "desire": "Desire (たい)",
}

VERB_CONJUGATIONS: tuple[str, ...] = (
    "negative",
    "past",
    "negative_past",
    "te_form",
    "polite",
    "polite_negative",
    "polite_past",
    "polite_negative_past",
    "passive",
    "causative",
    "potential",
    "polite_imperative",
    "volitional",
    "conditional",
    "desire",
)

ADJ_I_CONJUGATIONS: tuple[str, ...] = (
    "negative",
    "past",
    "negative_past",
    "te_form",
    "conditional",
)

VS_CONJUGATIONS: tuple[str, ...] = tuple(
    form for form in VERB_CONJUGATIONS if form != "potential"
)

_GODAN_ROWS: dict[str, dict[str, str]] = {
    "う": {"a": "わ", "i": "い", "e": "え", "o": "おう", "te": "って", "ta": "った"},
    "く": {"a": "か", "i": "き", "e": "け", "o": "こう", "te": "いて", "ta": "いた"},
    "ぐ": {"a": "が", "i": "ぎ", "e": "げ", "o": "ごう", "te": "いで", "ta": "いだ"},
    "す": {"a": "さ", "i": "し", "e": "せ", "o": "そう", "te": "して", "ta": "した"},
    "つ": {"a": "た", "i": "ち", "e": "て", "o": "とう", "te": "って", "ta": "った"},
    "ぬ": {"a": "な", "i": "に", "e": "ね", "o": "のう", "te": "んで", "ta": "んだ"},
    "ぶ": {"a": "ば", "i": "び", "e": "べ", "o": "ぼう", "te": "んで", "ta": "んだ"},
    "む": {"a": "ま", "i": "み", "e": "め", "o": "もう", "te": "んで", "ta": "んだ"},
    "る": {"a": "ら", "i": "り", "e": "れ", "o": "ろう", "te": "って", "ta": "った"},
}


def resolve_inflection_rule(word: WordTarget) -> str | None:
    """Resolve the canonical deinflector rule ('v1', 'v5', 'vs', 'vk', 'adj-i') for word."""
    rule_tokens = set((word.rules or "").split()) | set(word.pos_codes)
    if "v1" in rule_tokens or "v1-s" in rule_tokens or word.has_category(CAT_VERB_ICHIDAN):
        return "v1"
    if any(r == "v5" or r.startswith("v5") for r in rule_tokens) or word.has_category(CAT_VERB_GODAN):
        return "v5"
    if "vk" in rule_tokens or word.has_category(CAT_VERB_KURU):
        return "vk"
    if any(r == "vs" or r.startswith("vs-") for r in rule_tokens) or word.has_category(CAT_SURU_VERB):
        return "vs"
    if "adj-i" in rule_tokens or "adj-ix" in rule_tokens or word.has_category(CAT_ADJECTIVE_I):
        return "adj-i"
    return None


def inflect_word(base: str, rule: str, target_form: str) -> str | None:
    """Deterministically inflect a dictionary headword or reading given its rule and target form."""
    if not base or not rule:
        return None

    if rule == "v1":
        if not base.endswith("る") or len(base) < 2:
            return None
        stem = base[:-1]
        v1_map = {
            "negative": stem + "ない",
            "past": stem + "た",
            "negative_past": stem + "なかった",
            "te_form": stem + "て",
            "polite": stem + "ます",
            "polite_negative": stem + "ません",
            "polite_past": stem + "ました",
            "polite_negative_past": stem + "ませんでした",
            "passive": stem + "られる",
            "causative": stem + "させる",
            "potential": stem + "られる",
            "polite_imperative": stem + "なさい",
            "volitional": stem + "よう",
            "conditional": stem + "れば",
            "desire": stem + "たい",
        }
        return v1_map.get(target_form)

    if rule == "v5":
        ending = base[-1]
        row = _GODAN_ROWS.get(ending)
        if row is None or len(base) < 2:
            return None
        stem = base[:-1]

        # Special irregulars: 行く/いく -> 行って/行った; ある/有る/在る -> ない/なかった
        if base in ("行く", "いく") and target_form in ("te_form", "past"):
            return stem + ("って" if target_form == "te_form" else "った")
        if base in ("ある", "有る", "在る"):
            if target_form == "negative":
                return "ない"
            if target_form == "negative_past":
                return "なかった"

        v5_map = {
            "negative": stem + row["a"] + "ない",
            "past": stem + row["ta"],
            "negative_past": stem + row["a"] + "なかった",
            "te_form": stem + row["te"],
            "polite": stem + row["i"] + "ます",
            "polite_negative": stem + row["i"] + "ません",
            "polite_past": stem + row["i"] + "ました",
            "polite_negative_past": stem + row["i"] + "ませんでした",
            "passive": stem + row["a"] + "れる",
            "causative": stem + row["a"] + "せる",
            "potential": stem + row["e"] + "る",
            "polite_imperative": stem + row["i"] + "なさい",
            "volitional": stem + row["o"],
            "conditional": stem + row["e"] + "ば",
            "desire": stem + row["i"] + "たい",
        }
        return v5_map.get(target_form)

    if rule == "vs":
        stem = base[:-2] if base.endswith("する") else base
        if base != "する" and not base.endswith("する"):
            # Noun + する verb (e.g., 勉強 -> 勉強しない)
            stem = base
        vs_map = {
            "negative": stem + "しない",
            "past": stem + "した",
            "negative_past": stem + "しなかった",
            "te_form": stem + "して",
            "polite": stem + "します",
            "polite_negative": stem + "しません",
            "polite_past": stem + "しました",
            "polite_negative_past": stem + "しませんでした",
            "passive": stem + "される",
            "causative": stem + "させる",
            "polite_imperative": stem + "しなさい",
            "volitional": stem + "しよう",
            "conditional": stem + "すれば",
            "desire": stem + "したい",
        }
        return vs_map.get(target_form)

    if rule == "vk":
        if base.endswith("来る"):
            prefix, k_ko, k_ki, k_ku = base[:-2], "来", "来", "来"
        elif base.endswith("くる"):
            prefix, k_ko, k_ki, k_ku = base[:-2], "こ", "き", "く"
        else:
            return None
        vk_map = {
            "negative": prefix + k_ko + "ない",
            "past": prefix + k_ki + "た",
            "negative_past": prefix + k_ko + "なかった",
            "te_form": prefix + k_ki + "て",
            "polite": prefix + k_ki + "ます",
            "polite_negative": prefix + k_ki + "ません",
            "polite_past": prefix + k_ki + "ました",
            "polite_negative_past": prefix + k_ki + "ませんでした",
            "passive": prefix + k_ko + "られる",
            "causative": prefix + k_ko + "させる",
            "potential": prefix + k_ko + "られる",
            "polite_imperative": prefix + k_ki + "なさい",
            "volitional": prefix + k_ko + "よう",
            "conditional": prefix + k_ku + "れば",
            "desire": prefix + k_ki + "たい",
        }
        return vk_map.get(target_form)

    if rule == "adj-i":
        if base in ("いい", "よい"):
            stem = "よ"
        elif base == "良い":
            stem = "良"
        elif base.endswith("い") and len(base) >= 2:
            stem = base[:-1]
        else:
            return None
        adj_map = {
            "negative": stem + "くない",
            "past": stem + "かった",
            "negative_past": stem + "くなかった",
            "te_form": stem + "くて",
            "conditional": stem + "ければ",
        }
        return adj_map.get(target_form)

    return None


def verify_inflection_roundtrip(base: str, inflected: str, rule: str) -> bool:
    """Verify via kiroku_dictionary.deinflect that inflected roundtrips back to (base, rule)."""
    if not base or not inflected or not rule:
        return False
    for cand in deinflect(inflected):
        if cand.term == base and cand.matches_entry_rules(rule):
            return True
    return False


class ConjugationDrillGenerator:
    """Deterministic conjugation drill generator verified against kiroku_dictionary.deinflect."""

    question_type = "conjugation_drill"

    def __init__(self, dict_engine: Any = None):
        self.dict_engine = dict_engine
        self.abstentions: list[AbstentionRecord] = []

    def _abstain(self, code: str, reason: str, target: WordTarget | None) -> None:
        self.abstentions.append(make_abstention(self.question_type, code, reason, target))

    def generate(
        self,
        word: WordTarget,
        context: SentenceContext | None = None,
    ) -> PracticeQuestion | None:
        if not word.sequence_id or int(word.sequence_id) <= 0:
            self._abstain("missing_sequence_id", "Target word must have a canonical JMdict sequence_id.", word)
            return None

        rule = resolve_inflection_rule(word)
        if rule is None:
            self._abstain(
                "non_inflectable_category",
                f"Word '{word.expression}' has no inflectable verb/i-adjective rule.",
                word,
            )
            return None

        ctx = context or SentenceContext()
        if rule == "adj-i":
            allowed_forms = ADJ_I_CONJUGATIONS
        elif rule == "vs":
            allowed_forms = VS_CONJUGATIONS
        else:
            allowed_forms = VERB_CONJUGATIONS
        requested_form = ctx.target_conjugation
        if requested_form is None:
            idx = int(word.sequence_id) % len(allowed_forms)
            requested_form = allowed_forms[idx]
        if requested_form not in allowed_forms:
            self._abstain(
                "unsupported_conjugation_form",
                f"Form '{requested_form}' is not supported for rule '{rule}'.",
                word,
            )
            return None

        base_expr = word.expression or word.reading
        base_read = normalize_word_reading(word.reading) or base_expr
        if rule == "vs" and not base_expr.endswith("する"):
            base_expr_suru = base_expr + "する"
            base_read_suru = base_read + "する"
        else:
            base_expr_suru = base_expr
            base_read_suru = base_read

        inflected_expr = inflect_word(base_expr_suru, rule, requested_form)
        inflected_read = inflect_word(base_read_suru, rule, requested_form)
        if not inflected_expr or not inflected_read:
            self._abstain(
                "inflection_generation_failed",
                f"Could not inflect '{base_expr}' ({rule}) to '{requested_form}'.",
                word,
            )
            return None

        # Roundtrip verification via deinflect.py
        check_expr = base_expr_suru if rule == "vs" else base_expr
        check_read = base_read_suru if rule == "vs" else base_read
        if (
            rule == "v5"
            and base_expr in ("有る", "在る")
            and base_read == "ある"
            and requested_form in ("negative", "negative_past")
        ):
            check_expr = base_read
        if not verify_inflection_roundtrip(check_expr, inflected_expr, rule):
            self._abstain(
                "deinflect_roundtrip_failed",
                f"Inflected expression '{inflected_expr}' failed deinflect() roundtrip to ({check_expr}, {rule}).",
                word,
            )
            return None
        if not verify_inflection_roundtrip(check_read, inflected_read, rule):
            self._abstain(
                "deinflect_reading_roundtrip_failed",
                f"Inflected reading '{inflected_read}' failed deinflect() roundtrip to ({check_read}, {rule}).",
                word,
            )
            return None

        label = CONJUGATION_LABELS.get(requested_form, requested_form)
        digest = hashlib.sha1(
            f"{word.sequence_id}|{base_expr}|{requested_form}".encode("utf-8")
        ).hexdigest()[:12]
        expected = tuple(dict.fromkeys([inflected_expr, inflected_read]))
        return PracticeQuestion(
            question_id=f"conj_{digest}",
            question_type="conjugation_drill",
            target=word,
            prompt=f"Conjugate {base_expr_suru} ({base_read_suru}) into: {label}",
            sentence=ctx.sentence,
            blanked_sentence="",
            hint="; ".join(word.glosses[:2]) if word.glosses else "",
            choices=(),
            expected_answers=expected,
            expected_sequence_id=int(word.sequence_id),
            expected_reading=inflected_read,
            accepted_forms=expected,
            allow_kanji_answer=True,
            usage_tags=tuple(ctx.usage_tags),
            metadata={
                "rule": rule,
                "target_conjugation": requested_form,
                "base_form": base_expr_suru,
            },
        )

    def grade(self, question: PracticeQuestion, answer: str) -> PracticeResult:
        is_correct, norm_user, matched_variant = check_lenient_answer(
            answer,
            expected_answers=question.expected_answers,
            accepted_forms=question.accepted_forms,
            expected_sequence_id=None,
            allow_kanji=True,
            dict_engine=None,
        )
        primary_expected = question.expected_answers[0] if question.expected_answers else question.expected_reading
        return PracticeResult(
            question_id=question.question_id,
            question_type=question.question_type,
            is_correct=is_correct,
            normalized_user_answer=norm_user,
            normalized_expected=question.expected_reading or primary_expected,
            expected_answer=primary_expected,
            matched_variant=matched_variant,
            feedback="Correct." if is_correct else f"Expected: {primary_expected} ({question.expected_reading})",
        )
