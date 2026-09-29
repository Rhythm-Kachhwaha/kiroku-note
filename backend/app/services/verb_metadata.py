from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence


@dataclass(frozen=True)
class VerbMetadata:
    is_verb: bool
    verb_type: str | None  # "ichidan", "godan", "suru", "kuru", "aux-verb", "irregular", or None
    is_transitive: bool
    is_intransitive: bool
    transitivity_label: str  # "他動詞", "自動詞", "自他動詞", "none"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def parse_verb_metadata(parts_of_speech: Sequence[str]) -> VerbMetadata:
    """Parse Yomitan / Jitendex parts of speech tokens into structured verb metadata."""
    normalized = [str(p).strip().lower() for p in parts_of_speech if p]

    is_copula = any(p in ("cop", "copula") or "copula" in p for p in normalized)
    is_ichidan = any(p == "1-dan" or p.startswith("1-dan") or "ichidan" in p or p.startswith("v1") for p in normalized)
    is_godan = any("5-dan" in p or "godan" in p or p.startswith("v5") for p in normalized)
    is_kuru = any(p == "kuru" or "kuru verb" in p or p == "vk" for p in normalized)
    is_aux = any("aux-verb" in p for p in normalized)

    # Check for noun / adverb / adjective presence
    has_noun_or_adv = any(
        p in ("noun", "n", "adverb", "adv", "na-adjective", "adj-na")
        or "noun" in p
        or "adverb" in p
        or "adjective" in p
        for p in normalized
    )

    # Explicit verb marker distinct from generic "suru" tag on nouns
    has_explicit_suru = any(
        p in ("vs", "suru verb", "suru-verb")
        or p.startswith("vs-")
        or (p in ("vt", "vi", "transitive", "intransitive") and any("suru" in x for x in normalized))
        for p in normalized
    )

    is_suru = any(p == "suru" or "suru verb" in p or p == "vs" or p.startswith("vs-") for p in normalized)

    # Guard: if entry contains noun/adverb/adjective and the only verb marker is "suru" as an inflection suffix
    if has_noun_or_adv and is_suru and not has_explicit_suru:
        is_suru = False

    # Guard: copula entries (e.g. です, だ) are not content verbs
    if is_copula:
        is_verb = False
        verb_type = None
    else:
        verb_type = None
        if is_ichidan:
            verb_type = "ichidan"
        elif is_godan:
            verb_type = "godan"
        elif is_suru:
            verb_type = "suru"
        elif is_kuru:
            verb_type = "kuru"
        elif is_aux:
            verb_type = "aux-verb"

        is_verb = verb_type is not None or (
            not has_noun_or_adv and any(
                p == "verb" or " verb" in p or "verb " in p or p in ("v1", "v5", "vi", "vt", "vs", "vk")
                for p in normalized
            )
        )

    if is_verb:
        is_transitive = any(
            p == "transitive" or " transitive" in p or "transitive " in p or p == "vt"
            for p in normalized
        )
        is_intransitive = any(
            p == "intransitive" or " intransitive" in p or "intransitive " in p or p == "vi"
            for p in normalized
        )
    else:
        is_transitive = False
        is_intransitive = False

    if is_transitive and is_intransitive:
        trans_label = "自他動詞"
    elif is_transitive:
        trans_label = "他動詞"
    elif is_intransitive:
        trans_label = "自動詞"
    else:
        trans_label = "none"

    return VerbMetadata(
        is_verb=is_verb,
        verb_type=verb_type,
        is_transitive=is_transitive,
        is_intransitive=is_intransitive,
        transitivity_label=trans_label,
    )
