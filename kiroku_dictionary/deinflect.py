"""
deinflect.py -- Cleanroom Japanese deinflection engine and rules table.

Transforms inflected surface forms (verbs, adjectives, contractions) into candidate
dictionary headwords paired with their required POS rule constraints and inflection chains.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator


@dataclass(frozen=True)
class DeinflectionCandidate:
    term: str
    rule: str  # Required dictionary rule: "v1", "v5", "vs", "vk", "adj-i", or "all"
    reasons: tuple[str, ...]

    def matches_entry_rules(self, entry_rules_str: str) -> bool:
        """Return True if this candidate's required rule matches the entry's rule tags."""
        if self.rule == "all":
            return True
        if not entry_rules_str:
            return False
        entry_rules = set(entry_rules_str.split())
        if self.rule in entry_rules:
            return True
        # v5 matches any specific godan rule (v5k, v5s, etc.)
        if self.rule == "v5" and any(r.startswith("v5") for r in entry_rules):
            return True
        if self.rule == "vs" and any(r.startswith("vs") for r in entry_rules):
            return True
        if self.rule == "vk" and any(r.startswith("vk") for r in entry_rules):
            return True
        return False


# Rule definition: (inflected_suffix, base_suffix, in_context, out_context, reason)
# in_context: valid context of the inflected form ("any", "v1", "adj-i", "te", etc.)
# out_context: required rule of the base form ("v1", "v5", "vs", "vk", "adj-i", etc.)
_RULES: list[tuple[str, str, str, str, str]] = [
    # =========================================================================
    # Polite (丁寧語 - ます)
    # =========================================================================
    ("ませんでした", "る", "any", "v1", "polite-negative-past"),
    ("きませんでした", "く", "any", "v5", "polite-negative-past"),
    ("ぎませんでした", "ぐ", "any", "v5", "polite-negative-past"),
    ("しませんでした", "す", "any", "v5", "polite-negative-past"),
    ("ちませんでした", "つ", "any", "v5", "polite-negative-past"),
    ("にませんでした", "ぬ", "any", "v5", "polite-negative-past"),
    ("びませんでした", "ぶ", "any", "v5", "polite-negative-past"),
    ("みませんでした", "む", "any", "v5", "polite-negative-past"),
    ("りませんでした", "る", "any", "v5", "polite-negative-past"),
    ("いませんでした", "う", "any", "v5", "polite-negative-past"),
    ("しませんでした", "する", "any", "vs", "polite-negative-past"),
    ("きませんでした", "くる", "any", "vk", "polite-negative-past"),
    ("来ませんでした", "来る", "any", "vk", "polite-negative-past"),

    ("ません", "る", "any", "v1", "polite-negative"),
    ("きません", "く", "any", "v5", "polite-negative"),
    ("ぎません", "ぐ", "any", "v5", "polite-negative"),
    ("しません", "す", "any", "v5", "polite-negative"),
    ("ちません", "つ", "any", "v5", "polite-negative"),
    ("にません", "ぬ", "any", "v5", "polite-negative"),
    ("びません", "ぶ", "any", "v5", "polite-negative"),
    ("みません", "む", "any", "v5", "polite-negative"),
    ("りません", "る", "any", "v5", "polite-negative"),
    ("いません", "う", "any", "v5", "polite-negative"),
    ("しません", "する", "any", "vs", "polite-negative"),
    ("きません", "くる", "any", "vk", "polite-negative"),
    ("来ません", "来る", "any", "vk", "polite-negative"),

    ("ました", "る", "any", "v1", "polite-past"),
    ("きました", "く", "any", "v5", "polite-past"),
    ("ぎました", "ぐ", "any", "v5", "polite-past"),
    ("しました", "す", "any", "v5", "polite-past"),
    ("ちました", "つ", "any", "v5", "polite-past"),
    ("にました", "ぬ", "any", "v5", "polite-past"),
    ("びました", "ぶ", "any", "v5", "polite-past"),
    ("みました", "む", "any", "v5", "polite-past"),
    ("りました", "る", "any", "v5", "polite-past"),
    ("いました", "う", "any", "v5", "polite-past"),
    ("しました", "する", "any", "vs", "polite-past"),
    ("きました", "くる", "any", "vk", "polite-past"),
    ("来ました", "来る", "any", "vk", "polite-past"),

    ("ましょう", "る", "any", "v1", "polite-volitional"),
    ("きましょう", "く", "any", "v5", "polite-volitional"),
    ("ぎましょう", "ぐ", "any", "v5", "polite-volitional"),
    ("しましょう", "す", "any", "v5", "polite-volitional"),
    ("ちましょう", "つ", "any", "v5", "polite-volitional"),
    ("にましょう", "ぬ", "any", "v5", "polite-volitional"),
    ("びましょう", "ぶ", "any", "v5", "polite-volitional"),
    ("みましょう", "む", "any", "v5", "polite-volitional"),
    ("りましょう", "る", "any", "v5", "polite-volitional"),
    ("いましょう", "う", "any", "v5", "polite-volitional"),
    ("しましょう", "する", "any", "vs", "polite-volitional"),
    ("きましょう", "くる", "any", "vk", "polite-volitional"),
    ("来ましょう", "来る", "any", "vk", "polite-volitional"),

    ("ます", "る", "any", "v1", "polite"),
    ("きます", "く", "any", "v5", "polite"),
    ("ぎます", "ぐ", "any", "v5", "polite"),
    ("します", "す", "any", "v5", "polite"),
    ("ちます", "つ", "any", "v5", "polite"),
    ("にます", "ぬ", "any", "v5", "polite"),
    ("びます", "ぶ", "any", "v5", "polite"),
    ("みます", "む", "any", "v5", "polite"),
    ("ります", "る", "any", "v5", "polite"),
    ("います", "う", "any", "v5", "polite"),
    ("します", "する", "any", "vs", "polite"),
    ("きます", "くる", "any", "vk", "polite"),
    ("来ます", "来る", "any", "vk", "polite"),

    # =========================================================================
    # Negative (ない / なかった / なくて / なければ / ず)
    # =========================================================================
    ("なかった", "ない", "any", "adj-i", "past"),
    ("なくて", "ない", "any", "adj-i", "te-form"),
    ("なければ", "ない", "any", "adj-i", "conditional"),
    ("なきゃ", "ない", "any", "adj-i", "contraction-nakya"),
    ("なくちゃ", "ない", "any", "adj-i", "contraction-nakucha"),
    ("ないで", "ない", "any", "adj-i", "te-form"),

    ("ない", "る", "any", "v1", "negative"),
    ("かない", "く", "any", "v5", "negative"),
    ("がない", "ぐ", "any", "v5", "negative"),
    ("さない", "す", "any", "v5", "negative"),
    ("たない", "つ", "any", "v5", "negative"),
    ("なない", "ぬ", "any", "v5", "negative"),
    ("ばない", "ぶ", "any", "v5", "negative"),
    ("まない", "む", "any", "v5", "negative"),
    ("らない", "る", "any", "v5", "negative"),
    ("わない", "う", "any", "v5", "negative"),
    ("しない", "する", "any", "vs", "negative"),
    ("こない", "くる", "any", "vk", "negative"),
    ("来ない", "来る", "any", "vk", "negative"),

    # Negative archaism / contractions (ず, ずに, ぬ, ん)
    ("ずに", "ない", "any", "adj-i", "negative"),
    ("ず", "ない", "any", "adj-i", "negative"),
    ("かぬ", "く", "any", "v5", "negative"),
    ("がぬ", "ぐ", "any", "v5", "negative"),
    ("さぬ", "す", "any", "v5", "negative"),
    ("たぬ", "つ", "any", "v5", "negative"),
    ("なぬ", "ぬ", "any", "v5", "negative"),
    ("ばぬ", "ぶ", "any", "v5", "negative"),
    ("まぬ", "む", "any", "v5", "negative"),
    ("らぬ", "る", "any", "v5", "negative"),
    ("わぬ", "う", "any", "v5", "negative"),
    ("せぬ", "する", "any", "vs", "negative"),
    ("せず", "する", "any", "vs", "negative"),

    # =========================================================================
    # Past / Perfective (た)
    # =========================================================================
    ("た", "る", "any", "v1", "past"),
    ("いた", "く", "any", "v5", "past"),
    ("いだ", "ぐ", "any", "v5", "past"),
    ("した", "す", "any", "v5", "past"),
    ("った", "つ", "any", "v5", "past"),
    ("んだ", "ぬ", "any", "v5", "past"),
    ("んだ", "ぶ", "any", "v5", "past"),
    ("んだ", "む", "any", "v5", "past"),
    ("った", "る", "any", "v5", "past"),
    ("った", "う", "any", "v5", "past"),
    ("した", "する", "any", "vs", "past"),
    ("きた", "くる", "any", "vk", "past"),
    ("来た", "来る", "any", "vk", "past"),
    # Special: 行く -> 行った, いった -> いく
    ("行った", "行く", "any", "v5", "past"),
    ("いった", "いく", "any", "v5", "past"),
    # Special: 問う/請う -> 問うた
    ("うた", "う", "any", "v5", "past"),

    # =========================================================================
    # Te-form (て / で)
    # =========================================================================
    ("て", "る", "any", "v1", "te-form"),
    ("いて", "く", "any", "v5", "te-form"),
    ("いで", "ぐ", "any", "v5", "te-form"),
    ("して", "す", "any", "v5", "te-form"),
    ("って", "つ", "any", "v5", "te-form"),
    ("んで", "ぬ", "any", "v5", "te-form"),
    ("んで", "ぶ", "any", "v5", "te-form"),
    ("んで", "む", "any", "v5", "te-form"),
    ("って", "る", "any", "v5", "te-form"),
    ("って", "う", "any", "v5", "te-form"),
    ("して", "する", "any", "vs", "te-form"),
    ("きて", "くる", "any", "vk", "te-form"),
    ("来て", "来る", "any", "vk", "te-form"),
    # Special: 行く -> 行って, いって -> いく
    ("行って", "行く", "any", "v5", "te-form"),
    ("いって", "いく", "any", "v5", "te-form"),
    ("うて", "う", "any", "v5", "te-form"),

    # =========================================================================
    # Conditional (たら / だら)
    # =========================================================================
    ("たら", "た", "any", "any", "conditional"),
    ("だら", "だ", "any", "any", "conditional"),

    # =========================================================================
    # Conditional (ば)
    # =========================================================================
    ("れば", "る", "any", "v1", "conditional"),
    ("けば", "く", "any", "v5", "conditional"),
    ("げば", "ぐ", "any", "v5", "conditional"),
    ("せば", "す", "any", "v5", "conditional"),
    ("てば", "つ", "any", "v5", "conditional"),
    ("ねば", "ぬ", "any", "v5", "conditional"),
    ("べば", "ぶ", "any", "v5", "conditional"),
    ("めば", "む", "any", "v5", "conditional"),
    ("れば", "る", "any", "v5", "conditional"),
    ("えば", "う", "any", "v5", "conditional"),
    ("すれば", "する", "any", "vs", "conditional"),
    ("くれば", "くる", "any", "vk", "conditional"),
    ("来れば", "来る", "any", "vk", "conditional"),

    # =========================================================================
    # Potential & Passive (られる / れる / かれる etc.)
    # =========================================================================
    ("られる", "る", "any", "v1", "passive-or-potential"),
    ("れる", "る", "any", "v1", "potential"),  # short potential (ら抜き言葉: 食べれる)
    ("かれる", "く", "any", "v5", "passive"),
    ("がれる", "ぐ", "any", "v5", "passive"),
    ("される", "す", "any", "v5", "passive"),
    ("たれる", "つ", "any", "v5", "passive"),
    ("なれる", "ぬ", "any", "v5", "passive"),
    ("ばれる", "ぶ", "any", "v5", "passive"),
    ("まれる", "む", "any", "v5", "passive"),
    ("られる", "る", "any", "v5", "passive"),
    ("われる", "う", "any", "v5", "passive"),
    ("される", "する", "any", "vs", "passive"),
    ("こられる", "くる", "any", "vk", "passive-or-potential"),
    ("来られる", "来る", "any", "vk", "passive-or-potential"),
    ("これる", "くる", "any", "vk", "potential"),
    ("来れる", "来る", "any", "vk", "potential"),

    # Godan potential (e-dan + る, behaves as v1)
    ("ける", "く", "any", "v5", "potential"),
    ("げる", "ぐ", "any", "v5", "potential"),
    ("せる", "す", "any", "v5", "potential"),
    ("てる", "つ", "any", "v5", "potential"),
    ("ねる", "ぬ", "any", "v5", "potential"),
    ("べる", "ぶ", "any", "v5", "potential"),
    ("める", "む", "any", "v5", "potential"),
    ("れる", "る", "any", "v5", "potential"),
    ("える", "う", "any", "v5", "potential"),

    # =========================================================================
    # Causative (させる / かせる etc.)
    # =========================================================================
    ("させる", "る", "any", "v1", "causative"),
    ("かせる", "く", "any", "v5", "causative"),
    ("がせる", "ぐ", "any", "v5", "causative"),
    ("させる", "す", "any", "v5", "causative"),
    ("たせる", "つ", "any", "v5", "causative"),
    ("なせる", "ぬ", "any", "v5", "causative"),
    ("ばせる", "ぶ", "any", "v5", "causative"),
    ("ませる", "む", "any", "v5", "causative"),
    ("らせる", "る", "any", "v5", "causative"),
    ("わせる", "う", "any", "v5", "causative"),
    ("させる", "する", "any", "vs", "causative"),
    ("こさせる", "くる", "any", "vk", "causative"),
    ("来させる", "来る", "any", "vk", "causative"),

    # Causative-passive (させられる / かせられる / かされる)
    ("させられる", "る", "any", "v1", "causative-passive"),
    ("かせられる", "く", "any", "v5", "causative-passive"),
    ("かされる", "く", "any", "v5", "causative-passive"),
    ("がせられる", "ぐ", "any", "v5", "causative-passive"),
    ("たせられる", "つ", "any", "v5", "causative-passive"),
    ("たされる", "つ", "any", "v5", "causative-passive"),
    ("なせられる", "ぬ", "any", "v5", "causative-passive"),
    ("なされる", "ぬ", "any", "v5", "causative-passive"),
    ("ばせられる", "ぶ", "any", "v5", "causative-passive"),
    ("ばされる", "ぶ", "any", "v5", "causative-passive"),
    ("ませられる", "む", "any", "v5", "causative-passive"),
    ("まされる", "む", "any", "v5", "causative-passive"),
    ("らせられる", "る", "any", "v5", "causative-passive"),
    ("らされる", "る", "any", "v5", "causative-passive"),
    ("わせられる", "う", "any", "v5", "causative-passive"),
    ("わされる", "う", "any", "v5", "causative-passive"),
    ("させられる", "する", "any", "vs", "causative-passive"),
    ("こさせられる", "くる", "any", "vk", "causative-passive"),
    ("来させられる", "来る", "any", "vk", "causative-passive"),

    # =========================================================================
    # Volitional (よう / おう etc.)
    # =========================================================================
    ("よう", "る", "any", "v1", "volitional"),
    ("こう", "く", "any", "v5", "volitional"),
    ("ごう", "ぐ", "any", "v5", "volitional"),
    ("そう", "す", "any", "v5", "volitional"),
    ("とう", "つ", "any", "v5", "volitional"),
    ("のう", "ぬ", "any", "v5", "volitional"),
    ("ぼう", "ぶ", "any", "v5", "volitional"),
    ("もう", "む", "any", "v5", "volitional"),
    ("ろう", "る", "any", "v5", "volitional"),
    ("おう", "う", "any", "v5", "volitional"),
    ("しよう", "する", "any", "vs", "volitional"),
    ("こよう", "くる", "any", "vk", "volitional"),
    ("来よう", "来る", "any", "vk", "volitional"),

    # =========================================================================
    # Imperative (命令形)
    # =========================================================================
    ("ろ", "る", "any", "v1", "imperative"),
    ("よ", "る", "any", "v1", "imperative"),
    ("け", "く", "any", "v5", "imperative"),
    ("げ", "ぐ", "any", "v5", "imperative"),
    ("せ", "す", "any", "v5", "imperative"),
    ("て", "つ", "any", "v5", "imperative"),
    ("ね", "ぬ", "any", "v5", "imperative"),
    ("べ", "ぶ", "any", "v5", "imperative"),
    ("め", "む", "any", "v5", "imperative"),
    ("れ", "る", "any", "v5", "imperative"),
    ("え", "う", "any", "v5", "imperative"),
    ("しろ", "する", "any", "vs", "imperative"),
    ("せよ", "する", "any", "vs", "imperative"),
    ("こい", "くる", "any", "vk", "imperative"),
    ("来い", "来る", "any", "vk", "imperative"),

    # =========================================================================
    # Desire / Tai (たい - inflects as adj-i)
    # =========================================================================
    ("たい", "る", "any", "v1", "desire"),
    ("きたい", "く", "any", "v5", "desire"),
    ("ぎたい", "ぐ", "any", "v5", "desire"),
    ("したい", "す", "any", "v5", "desire"),
    ("ちたい", "つ", "any", "v5", "desire"),
    ("にたい", "ぬ", "any", "v5", "desire"),
    ("びたい", "ぶ", "any", "v5", "desire"),
    ("みたい", "む", "any", "v5", "desire"),
    ("りたい", "る", "any", "v5", "desire"),
    ("いたい", "う", "any", "v5", "desire"),
    ("したい", "する", "any", "vs", "desire"),
    ("きたい", "くる", "any", "vk", "desire"),
    ("来たい", "来る", "any", "vk", "desire"),

    # =========================================================================
    # Conjectural / Sou (そう - looks like)
    # =========================================================================
    ("そう", "る", "any", "v1", "conjectural"),
    ("きそう", "く", "any", "v5", "conjectural"),
    ("ぎそう", "ぐ", "any", "v5", "conjectural"),
    ("しそう", "す", "any", "v5", "conjectural"),
    ("ちそう", "つ", "any", "v5", "conjectural"),
    ("にそう", "ぬ", "any", "v5", "conjectural"),
    ("びそう", "ぶ", "any", "v5", "conjectural"),
    ("みそう", "む", "any", "v5", "conjectural"),
    ("りそう", "る", "any", "v5", "conjectural"),
    ("いそう", "う", "any", "v5", "conjectural"),
    ("しそう", "する", "any", "vs", "conjectural"),
    ("きそう", "くる", "any", "vk", "conjectural"),
    ("来そう", "来る", "any", "vk", "conjectural"),
    ("そう", "い", "any", "adj-i", "conjectural"),

    # =========================================================================
    # Excess / Sugiru (すぎる - inflects as v1)
    # =========================================================================
    ("すぎる", "る", "any", "v1", "excess"),
    ("きすぎる", "く", "any", "v5", "excess"),
    ("ぎすぎる", "ぐ", "any", "v5", "excess"),
    ("しすぎる", "す", "any", "v5", "excess"),
    ("ちすぎる", "つ", "any", "v5", "excess"),
    ("にすぎる", "ぬ", "any", "v5", "excess"),
    ("びすぎる", "ぶ", "any", "v5", "excess"),
    ("みすぎる", "む", "any", "v5", "excess"),
    ("りすぎる", "る", "any", "v5", "excess"),
    ("いすぎる", "う", "any", "v5", "excess"),
    ("しすぎる", "する", "any", "vs", "excess"),
    ("きすぎる", "くる", "any", "vk", "excess"),
    ("来すぎる", "来る", "any", "vk", "excess"),
    ("すぎる", "い", "any", "adj-i", "excess"),

    # =========================================================================
    # Contractions (ちゃう / じゃう / てる / でる / とく / どく)
    # =========================================================================
    ("ちゃう", "て", "any", "te", "contraction-chau"),
    ("ちゃった", "て", "any", "te", "contraction-chau-past"),
    ("ちゃって", "て", "any", "te", "contraction-chau-te"),
    ("じゃう", "で", "any", "te", "contraction-jau"),
    ("じゃった", "で", "any", "te", "contraction-jau-past"),
    ("じゃって", "で", "any", "te", "contraction-jau-te"),

    ("てる", "て", "any", "te", "contraction-teru"),
    ("てた", "て", "any", "te", "contraction-teru-past"),
    ("でる", "で", "any", "te", "contraction-deru"),
    ("でた", "で", "any", "te", "contraction-deru-past"),

    ("とく", "て", "any", "te", "contraction-toku"),
    ("といた", "て", "any", "te", "contraction-toku-past"),
    ("どく", "で", "any", "te", "contraction-doku"),
    ("どいた", "で", "any", "te", "contraction-doku-past"),

    # =========================================================================
    # I-Adjectives (高い, 美しい)
    # =========================================================================
    ("くない", "い", "any", "adj-i", "negative"),
    ("くなかった", "い", "any", "adj-i", "negative-past"),
    ("くなくて", "い", "any", "adj-i", "negative-te"),
    ("くなければ", "い", "any", "adj-i", "negative-conditional"),
    ("かった", "い", "any", "adj-i", "past"),
    ("かったら", "い", "any", "adj-i", "conditional"),
    ("ければ", "い", "any", "adj-i", "conditional"),
    ("くて", "い", "any", "adj-i", "te-form"),
    ("く", "い", "any", "adj-i", "adverbial"),
    ("さ", "い", "any", "adj-i", "nominalization"),

    # Irregular: いい / 良い (よい)
    ("よくない", "いい", "any", "adj-i", "negative"),
    ("よくなかった", "いい", "any", "adj-i", "negative-past"),
    ("よかった", "いい", "any", "adj-i", "past"),
    ("よければ", "いい", "any", "adj-i", "conditional"),
    ("よくて", "いい", "any", "adj-i", "te-form"),
    ("よく", "いい", "any", "adj-i", "adverbial"),
    ("よさそう", "いい", "any", "adj-i", "conjectural"),
    ("よさ", "いい", "any", "adj-i", "nominalization"),

    ("よくない", "よい", "any", "adj-i", "negative"),
    ("よくなかった", "よい", "any", "adj-i", "negative-past"),
    ("よかった", "よい", "any", "adj-i", "past"),
    ("よければ", "よい", "any", "adj-i", "conditional"),
    ("よくて", "よい", "any", "adj-i", "te-form"),
    ("よく", "よい", "any", "adj-i", "adverbial"),
    ("よさそう", "よい", "any", "adj-i", "conjectural"),
    ("よさ", "よい", "any", "adj-i", "nominalization"),

    ("良くない", "良い", "any", "adj-i", "negative"),
    ("良くなかった", "良い", "any", "adj-i", "negative-past"),
    ("良かった", "良い", "any", "adj-i", "past"),
    ("良ければ", "良い", "any", "adj-i", "conditional"),
    ("良くて", "良い", "any", "adj-i", "te-form"),
    ("良く", "良い", "any", "adj-i", "adverbial"),
    ("良さそう", "良い", "any", "adj-i", "conjectural"),
    ("良さ", "良い", "any", "adj-i", "nominalization"),

    # Irregular: ある -> ない
    ("ない", "ある", "any", "v5", "negative"),
    ("なかった", "ある", "any", "v5", "negative-past"),
]


def deinflect(text: str, max_depth: int = 5) -> list[DeinflectionCandidate]:
    """
    Generate candidate dictionary headwords and inflection chains for text.
    Returns uninflected text first, followed by deinflected candidates.
    """
    clean_text = text.strip()
    if not clean_text:
        return []

    results: list[DeinflectionCandidate] = []
    seen: set[tuple[str, str]] = set()

    # Always include the surface text itself with rule "all"
    initial = DeinflectionCandidate(clean_text, "all", ())
    results.append(initial)
    seen.add((clean_text, "all"))

    # BFS exploration queue: (current_text, current_context, chain)
    queue: list[tuple[str, str, tuple[str, ...], int]] = [(clean_text, "any", (), 0)]

    while queue:
        curr_text, curr_ctx, chain, depth = queue.pop(0)
        if depth >= max_depth:
            continue

        for inf_sfx, base_sfx, in_ctx, out_ctx, reason in _RULES:
            # Check context validity
            if in_ctx != "any" and curr_ctx != "any" and curr_ctx != in_ctx:
                continue

            if curr_text.endswith(inf_sfx):
                prefix = curr_text[: -len(inf_sfx)] if inf_sfx else curr_text
                # Prevent reducing to an empty stem
                if not prefix and not base_sfx:
                    continue

                new_text = prefix + base_sfx
                new_chain = chain + (reason,)

                # If out_ctx is a terminal dictionary rule, record as candidate
                if out_ctx in ("v1", "v5", "vs", "vk", "adj-i", "all"):
                    key = (new_text, out_ctx)
                    if key not in seen:
                        seen.add(key)
                        results.append(DeinflectionCandidate(new_text, out_ctx, new_chain))

                # Also continue exploring if valid
                queue.append((new_text, out_ctx, new_chain, depth + 1))

    return results
