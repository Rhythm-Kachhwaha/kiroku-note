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
    "dictionary": "Dictionary (辞書形)",
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
    "causative_passive": "Causative-Passive (させられる)",
    "potential": "Potential (られる/える)",
    "polite_imperative": "Polite imperative (なさい)",
    "imperative": "Imperative (命令形)",
    "prohibitive": "Prohibitive (な)",
    "volitional": "Volitional (よう/おう)",
    "conditional": "Conditional (ば)",
    "conditional_tara": "Conditional (たら)",
    "desire": "Desire (たい)",
}

ALL_VERB_INSPECTOR_FORMS: tuple[str, ...] = (
    "dictionary",
    "polite",
    "negative",
    "polite_negative",
    "past",
    "polite_past",
    "negative_past",
    "polite_negative_past",
    "te_form",
    "potential",
    "passive",
    "causative",
    "causative_passive",
    "volitional",
    "conditional",
    "conditional_tara",
    "imperative",
    "prohibitive",
    "desire",
    "polite_imperative",
)

_V5ARU_VERBS: frozenset[str] = frozenset({
    "いらっしゃる",
    "おっしゃる",
    "くださる",
    "なさる",
    "ござる",
    "下さる",
    "為さる",
    "御座る",
})

_TOU_EXCEPTIONS: frozenset[str] = frozenset({
    "問う",
    "とう",
    "請う",
    "こう",
    "厭う",
    "いとう",
})

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


def inflect_word(base: str, rule: str, target_form: str, *, allow_vs_potential: bool = False) -> str | None:
    """Deterministically inflect a dictionary headword or reading given its rule and target form."""
    if not base or not rule:
        return None

    if target_form == "dictionary":
        if rule == "vs" and base != "する" and not base.endswith("する"):
            return base + "する"
        return base

    if target_form == "prohibitive":
        dict_form = inflect_word(base, rule, "dictionary")
        return (dict_form + "な") if dict_form else None

    if target_form == "conditional_tara":
        past_form = inflect_word(base, rule, "past")
        return (past_form + "ら") if past_form else None

    if rule == "v1":
        if not base.endswith("る") or len(base) < 2:
            return None
        stem = base[:-1]
        imperative_form = "くれ" if base in ("くれる", "呉れる") else stem + "ろ"
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
            "causative_passive": stem + "させられる",
            "potential": stem + "られる",
            "polite_imperative": stem + "なさい",
            "imperative": imperative_form,
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

        # Special irregulars: 行く/いく (and compounds ending in 行く) -> 行って/行った
        if (base in ("行く", "いく") or base.endswith("行く")) and target_form in ("te_form", "past"):
            return stem + ("って" if target_form == "te_form" else "った")
        # 問う/請う/厭う -> うて/うた
        if base in _TOU_EXCEPTIONS and target_form in ("te_form", "past"):
            return stem + ("うて" if target_form == "te_form" else "うた")
        # ある/有る/在る -> ない/なかった; no standard potential
        if base in ("ある", "有る", "在る"):
            if target_form == "negative":
                return "ない"
            if target_form == "negative_past":
                return "なかった"
            if target_form == "potential":
                return None

        # Honorific godan (v5aru): いらっしゃる, おっしゃる, くださる, なさる, ござる
        is_v5aru = base in _V5ARU_VERBS
        i_stem = stem + ("い" if is_v5aru else row["i"])
        if is_v5aru and target_form == "imperative":
            return None if base in ("ござる", "御座る") else stem + "い"

        causative_passive_form = (
            stem + "さされる" if ending == "す" else f"{stem}{row['a']}せられる / {stem}{row['a']}される"
        )

        v5_map = {
            "negative": stem + row["a"] + "ない",
            "past": stem + row["ta"],
            "negative_past": stem + row["a"] + "なかった",
            "te_form": stem + row["te"],
            "polite": i_stem + "ます",
            "polite_negative": i_stem + "ません",
            "polite_past": i_stem + "ました",
            "polite_negative_past": i_stem + "ませんでした",
            "passive": stem + row["a"] + "れる",
            "causative": stem + row["a"] + "せる",
            "causative_passive": causative_passive_form,
            "potential": stem + row["e"] + "る",
            "polite_imperative": i_stem + "なさい",
            "imperative": stem + row["e"],
            "volitional": stem + row["o"],
            "conditional": stem + row["e"] + "ば",
            "desire": i_stem + "たい",
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
            "causative_passive": stem + "させられる",
            "polite_imperative": stem + "しなさい",
            "imperative": stem + "しろ",
            "volitional": stem + "しよう",
            "conditional": stem + "すれば",
            "desire": stem + "したい",
        }
        if allow_vs_potential:
            vs_map["potential"] = stem + "できる"
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
            "causative_passive": prefix + k_ko + "させられる",
            "potential": prefix + k_ko + "られる",
            "polite_imperative": prefix + k_ki + "なさい",
            "imperative": prefix + k_ko + "い",
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


def _describe_formation_rule(base: str, rule: str, target_form: str, is_iku_exc: bool = False) -> str:
    """Return a concise, verb-specific formation rule for a given conjugation form."""
    if target_form == "dictionary":
        if rule == "v1":
            return "Base form (stem + る)"
        if rule == "v5":
            return f"Base form (ends in {base[-1]})"
        if rule == "vs":
            return "Suru verb base (〜する)"
        if rule == "vk":
            return "Kuru irregular base (来る/くる)"
        return "Base form"

    if target_form == "prohibitive":
        return "Dictionary form + な"
    if target_form == "conditional_tara":
        return "Plain past (た) + ら"

    if rule == "v1":
        if base in ("くれる", "呉れる") and target_form == "imperative":
            return "Exception (くれる): stem (くれ) without ろ"
        v1_rules = {
            "negative": "Drop る + ない",
            "past": "Drop る + た",
            "negative_past": "Drop る + なかった",
            "te_form": "Drop る + て",
            "polite": "Drop る + ます",
            "polite_negative": "Drop る + ません",
            "polite_past": "Drop る + ました",
            "polite_negative_past": "Drop る + ませんでした",
            "passive": "Drop る + られる",
            "causative": "Drop る + させる",
            "causative_passive": "Drop る + させられる",
            "potential": "Drop る + られる",
            "polite_imperative": "Drop る + なさい",
            "imperative": "Drop る + ろ",
            "volitional": "Drop る + よう",
            "conditional": "Drop る + れば",
            "desire": "Drop る + たい",
        }
        return v1_rules.get(target_form, "Drop る + suffix")

    if rule == "v5":
        ending = base[-1]
        row = _GODAN_ROWS.get(ending, {})
        if is_iku_exc and target_form in ("te_form", "past"):
            return "Exception (行く): く -> って" if target_form == "te_form" else "Exception (行く): く -> った"
        if base in _TOU_EXCEPTIONS and target_form in ("te_form", "past"):
            return "Exception (問う/請う): う -> うて" if target_form == "te_form" else "Exception (問う/請う): う -> うた"
        if base in ("ある", "有る", "在る") and target_form in ("negative", "negative_past"):
            return "Exception (ある): uses ない" if target_form == "negative" else "Exception (ある): uses なかった"
        if base in _V5ARU_VERBS and target_form in ("polite", "polite_negative", "polite_past", "polite_negative_past", "polite_imperative", "desire", "imperative"):
            if target_form == "imperative":
                return "Honorific godan: る -> い"
            return "Honorific godan: る -> い + suffix"

        a_ch = row.get("a", "a")
        i_ch = row.get("i", "i")
        e_ch = row.get("e", "e")
        o_ch = row.get("o", "o")
        te_ch = row.get("te", "て")
        ta_ch = row.get("ta", "た")
        v5_rules = {
            "negative": f"{ending} -> {a_ch} + ない",
            "past": f"{ending} -> {ta_ch}",
            "negative_past": f"{ending} -> {a_ch} + なかった",
            "te_form": f"{ending} -> {te_ch}",
            "polite": f"{ending} -> {i_ch} + ます",
            "polite_negative": f"{ending} -> {i_ch} + ません",
            "polite_past": f"{ending} -> {i_ch} + ました",
            "polite_negative_past": f"{ending} -> {i_ch} + ませんでした",
            "passive": f"{ending} -> {a_ch} + れる",
            "causative": f"{ending} -> {a_ch} + せる",
            "causative_passive": f"{ending} -> {a_ch} + せられる / される" if ending != "す" else "す -> さされる",
            "potential": f"{ending} -> {e_ch} + る",
            "polite_imperative": f"{ending} -> {i_ch} + なさい",
            "imperative": f"{ending} -> {e_ch}",
            "volitional": f"{ending} -> {o_ch}",
            "conditional": f"{ending} -> {e_ch} + ば",
            "desire": f"{ending} -> {i_ch} + たい",
        }
        return v5_rules.get(target_form, f"Godan {ending}-row")

    if rule == "vs":
        vs_rules = {
            "negative": "する -> しない",
            "past": "する -> した",
            "negative_past": "する -> しなかった",
            "te_form": "する -> して",
            "polite": "する -> します",
            "polite_negative": "する -> しません",
            "polite_past": "する -> しました",
            "polite_negative_past": "する -> しませんでした",
            "passive": "する -> される",
            "causative": "する -> させる",
            "causative_passive": "する -> させられる",
            "potential": "する -> できる (suppletive)",
            "polite_imperative": "する -> しなさい",
            "imperative": "する -> しろ",
            "volitional": "する -> しよう",
            "conditional": "する -> すれば",
            "desire": "する -> したい",
        }
        return vs_rules.get(target_form, "Suru irregular")

    if rule == "vk":
        vk_rules = {
            "negative": "く -> こ + ない",
            "past": "く -> き + た",
            "negative_past": "く -> こ + なかった",
            "te_form": "く -> き + て",
            "polite": "く -> き + ます",
            "polite_negative": "く -> き + ません",
            "polite_past": "く -> き + ました",
            "polite_negative_past": "く -> き + ませんでした",
            "passive": "く -> こ + られる",
            "causative": "く -> こ + させる",
            "causative_passive": "く -> こ + させられる",
            "potential": "く -> こ + られる",
            "polite_imperative": "く -> き + なさい",
            "imperative": "く -> こい",
            "volitional": "く -> こ + よう",
            "conditional": "く -> く + れば",
            "desire": "く -> き + たい",
        }
        return vk_rules.get(target_form, "Kuru irregular")

    return ""


def get_all_verb_conjugations(
    expression: str,
    reading: str = "",
    pos_codes: Sequence[str] | None = None,
    categories: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Compute all verb conjugation forms and verb-specific formation rules for the inspector."""
    expr = (expression or "").strip()
    read = normalize_word_reading(reading or "") or expr
    codes = {str(c).strip().lower() for c in (pos_codes or ()) if c}
    cats = {str(c).strip().lower().split(":")[0] for c in (categories or ()) if c}

    rule: str | None = None
    if "vk" in codes or "verb_kuru" in cats or expr in ("来る", "くる") or expr.endswith("来る"):
        rule = "vk"
    elif "vs" in codes or any(c.startswith("vs-") for c in codes) or "suru_verb" in cats:
        rule = "vs"
    elif "v1" in codes or "v1-s" in codes or "verb_ichidan" in cats:
        rule = "v1"
    elif any(c == "v5" or c.startswith("v5") for c in codes) or "verb_godan" in cats:
        rule = "v5"

    if rule is None:
        return {"is_verb": False, "group": None, "group_label": "", "rule": None, "exception_note": "", "forms": []}

    group_meta = {
        "v5": ("group_1", "G1"),
        "v1": ("group_2", "G2"),
        "vs": ("group_3", "G3"),
        "vk": ("group_3", "G3"),
    }
    group_key, group_label = group_meta[rule]

    is_iku_exc = (
        rule == "v5"
        and (
            "v5k-s" in codes
            or expr in ("行く", "いく")
            or expr.endswith("行く")
            or (read in ("いく", "ゆく") and expr.endswith("行"))
        )
    )

    exception_notes: list[str] = []
    if is_iku_exc:
        exception_notes.append("Special exception (行く): te-form is 行って and past is 行った (not 行いて/行いた).")
    elif expr in ("ある", "有る", "在る") and rule == "v5":
        exception_notes.append("Special exception (ある): plain negative is ない / なかった (not あらない).")
    elif expr in _TOU_EXCEPTIONS and rule == "v5":
        exception_notes.append("Special exception (問う/請う): te/ta-form uses うて/うた instead of って/った.")
    elif expr in _V5ARU_VERBS and rule == "v5":
        exception_notes.append("Honorific godan (v5aru): ます-stem uses い (e.g. いらっしゃいます) and imperative uses い.")
    elif expr in ("くれる", "呉れる") and rule == "v1":
        exception_notes.append("Special exception (くれる): imperative form is くれ (without ろ).")
    elif rule == "vs":
        exception_notes.append("Irregular する verb: potential uses できる instead of しれる.")
    elif rule == "vk":
        exception_notes.append("Irregular 来る verb: stem vowel changes across こ / き / く.")

    base_expr = expr
    base_read = read
    if rule == "vs" and base_expr != "する" and not base_expr.endswith("する"):
        base_expr = base_expr + "する"
    if rule == "vs" and base_read != "する" and not base_read.endswith("する"):
        base_read = base_read + "する"

    forms: list[dict[str, str]] = []
    for form_key in ALL_VERB_INSPECTOR_FORMS:
        if is_iku_exc and form_key in ("te_form", "past", "conditional_tara"):
            stem_e = base_expr[:-1]
            stem_r = base_read[:-1]
            if form_key == "te_form":
                val_e, val_r = stem_e + "って", stem_r + "って"
            elif form_key == "past":
                val_e, val_r = stem_e + "った", stem_r + "った"
            else:
                val_e, val_r = stem_e + "ったら", stem_r + "ったら"
        else:
            val_e = inflect_word(base_expr, rule, form_key, allow_vs_potential=True)
            val_r = inflect_word(base_read, rule, form_key, allow_vs_potential=True) if base_read != base_expr else val_e

        if not val_e:
            continue

        forms.append({
            "form": form_key,
            "label": CONJUGATION_LABELS.get(form_key, form_key),
            "value": val_e,
            "reading": val_r or val_e,
            "rule": _describe_formation_rule(base_expr, rule, form_key, is_iku_exc=is_iku_exc),
        })

    return {
        "is_verb": True,
        "group": group_key,
        "group_label": group_label,
        "rule": rule,
        "exception_note": " ".join(exception_notes),
        "forms": forms,
    }
