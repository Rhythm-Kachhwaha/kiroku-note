"""Sentence-level matching against the bundled grammar reference index.

The matcher deliberately has no dictionary or HTTP dependency.  Tokenizers can
pass their normalized tokens when available, while the small set of formation
rules below also makes the matcher useful with an offline/literal token list.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from .grammar_reference import GrammarReferenceService


_BARE_PARTICLES = {
    "は", "が", "を", "に", "へ", "で", "と", "の", "も", "から", "まで",
    "より", "か", "よ", "ね", "わ",
}


@dataclass
class MatchedGrammarSpan:
    pattern_key: str
    pattern_display: str
    text: str
    start: int
    end: int
    level: str
    meaning_short: str
    english_breakdown: str
    formation: str | None = None
    confidence: str = "high"
    matched_formation: str | None = None
    also_possible: bool = False

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


_FALLBACKS: dict[str, dict[str, str]] = {
    "なければならない": {
        "display": "〜なければならない", "meaning": "must; have to",
        "breakdown": "ない (not) + ければ (if) + ならない (must not be absent)",
        "formation": "V-なければならない",
    },
    "ば〜ほど": {
        "display": "〜ば〜ほど", "meaning": "the more …, the more …",
        "breakdown": "ば marks the condition; ほど marks the corresponding degree",
        "formation": "V-ば + V-る + ほど",
    },
    "とか〜とか": {
        "display": "〜とか〜とか", "meaning": "things like … and …",
        "breakdown": "とか lists non-exhaustive examples",
        "formation": "N/V + とか … N/V + とか",
    },
    "お〜になる": {
        "display": "お〜になる", "meaning": "honorific form",
        "breakdown": "お + verb stem + になる makes an honorific expression",
        "formation": "お + V-stem + になる",
    },
    "にもかかわらず": {
        "display": "〜にもかかわらず", "meaning": "despite; in spite of",
        "breakdown": "に + も emphasizes the noun; かかわらず means without being affected by it",
        "formation": "N + にもかかわらず",
    },
    "にしては": {
        "display": "〜にしては", "meaning": "considering; for",
        "breakdown": "にしては sets a standard and contrasts the result with it",
        "formation": "N + にしては",
    },
    "そうだ(hearsay)": {
        "display": "〜そうだ (hearsay)", "meaning": "I hear that; it is said that",
        "breakdown": "Plain form + そうだ reports information heard from elsewhere",
        "formation": "Plain form + そうだ",
    },
}


class GrammarMatcher:
    """Find grammar formations, preferring the longest non-overlapping spans."""

    def __init__(self, reference_service: GrammarReferenceService | None = None):
        self.reference = reference_service or GrammarReferenceService()

    def _point(self, key: str) -> dict[str, Any]:
        point = self.reference.get_point_by_key(key)
        if point:
            return point
        fallback = _FALLBACKS.get(key, {})
        return {
            "pattern_key": key,
            "pattern_display": fallback.get("display", f"〜{key}"),
            "level": "N4",
            "meaning_short": fallback.get("meaning", ""),
            "english_breakdown": fallback.get("breakdown", ""),
            "formation": fallback.get("formation"),
        }

    @staticmethod
    def _tokens(tokens: list[dict[str, Any]], raw_text: str) -> list[tuple[str, int, int]]:
        result: list[tuple[str, int, int]] = []
        cursor = 0
        for token in tokens:
            text = str(token.get("text", token.get("surface", "")))
            if not text:
                continue
            start = raw_text.find(text, cursor)
            if start < 0:
                continue
            result.append((text, start, start + len(text)))
            cursor = start + len(text)
        return result

    def _candidate(
        self, key: str, raw_text: str, start: int, end: int, *,
        confidence: str = "high", matched: str | None = None,
    ) -> MatchedGrammarSpan:
        point = self._point(key)
        breakdown = point.get("english_breakdown", "")
        if matched and matched != point.get("formation"):
            breakdown = f"{breakdown} Matched here as: {matched}."
        return MatchedGrammarSpan(
            pattern_key=key,
            pattern_display=point.get("pattern_display", f"〜{key}"),
            text=raw_text[start:end], start=start, end=end,
            level=point.get("level", "N4"),
            meaning_short=point.get("meaning_short", ""),
            english_breakdown=breakdown,
            formation=point.get("formation"),
            confidence=confidence, matched_formation=matched,
        )

    def match_sentence(
        self, tokens: list[dict], raw_text: str, show_basic_particles: bool = False
    ) -> list[MatchedGrammarSpan]:
        candidates: list[MatchedGrammarSpan] = []

        def add_literal(key: str, pattern: str, *, matched: str | None = None):
            for match in re.finditer(re.escape(pattern), raw_text):
                candidates.append(self._candidate(key, raw_text, match.start(), match.end(), matched=matched))

        # Contractions are kept as their visible sentence span, but point at
        # the canonical formation so callers can explain what was normalized.
        for match in re.finditer(r"[\u3041-\u309f\u30a1-\u30fa一-龯]+(?:てしま(?:う|っ(?:た|て|たら)?)|ちゃ(?:う|っ(?:た|て|たら)?))", raw_text):
            text = match.group()
            suffix = text[-4:]
            candidates.append(self._candidate(
                "てしまう", raw_text, match.start(), match.end(),
                matched=f"V-て + {suffix}",
            ))
        for match in re.finditer(r"[\u3041-\u309f一-龯]+(?:なければなら(?:ない|なかった)|なきゃ(?:だめ|ならない)?)", raw_text):
            candidates.append(self._candidate(
                "なければならない", raw_text, match.start(), match.end(),
                matched="V-なければならない",
            ))
        for match in re.finditer(r"[\u3041-\u309f一-龯]+(?:なくては|なければ)いけ(?:ない|ません)", raw_text):
            candidates.append(self._candidate(
                "なければならない", raw_text, match.start(), match.end(),
                matched="V-なくてはいけない",
            ))
        for match in re.finditer(r"たことが(?:ある|あります)", raw_text):
            candidates.append(self._candidate(
                "たことがあります", raw_text, match.start(), match.end(),
                matched="V-た + ことがある",
            ))
        for match in re.finditer(r"[てで]おく", raw_text):
            candidates.append(self._candidate(
                "ておく", raw_text, match.start(), match.end(),
                matched=f"V-{match.group()[0]} + おく",
            ))
        for match in re.finditer(r"[\u3041-\u309f一-龯]+とく", raw_text):
            candidates.append(self._candidate(
                "ておく", raw_text, match.start(), match.end(),
                matched="V-て + とく",
            ))

        # Compound particles must be considered before their component に.
        for key, pattern in (
            ("にもかかわらず", "にもかかわらず"), ("にしては", "にしては"),
        ):
            add_literal(key, pattern)

        # Same-clause discontinuous constructions.
        for match in re.finditer(r"(?P<a>[\u3041-\u309f一-龯]+ば)(?P<m>[^、。！？]{0,20}?)(?P<b>[\u3041-\u309f一-龯]+ほど)", raw_text):
            candidates.append(self._candidate("ば〜ほど", raw_text, match.start(), match.end(), matched="V-ば + V-る + ほど"))
        for match in re.finditer(r"(?P<a>[\u3041-\u309f一-龯]+とか)(?P<m>[^、。！？]{0,20}?)(?P<b>[\u3041-\u309f一-龯]+とか)", raw_text):
            candidates.append(self._candidate("とか〜とか", raw_text, match.start(), match.end()))
        for match in re.finditer(r"お([\u3041-\u309f一-龯]{1,6})になる", raw_text):
            candidates.append(self._candidate("お〜になる", raw_text, match.start(), match.end()))

        # そうだ has two readings.  A preceding る/た plain form is
        # hearsay; a stem ending before そう is appearance.  If token data
        # cannot establish the distinction, retain an explicitly ambiguous
        # appearance result rather than silently claiming certainty.
        for match in re.finditer(r"([\u3041-\u309f一-龯]+)そうだ", raw_text):
            prefix = match.group(1)
            if prefix.endswith(("る", "た", "ない")):
                key, confidence = "そうだ(hearsay)", "high"
            else:
                key, confidence = "そうだ(appearance)", "medium"
            candidates.append(self._candidate(key, raw_text, match.start(), match.end(), confidence=confidence))

        # Reference patterns cover the remaining fixed suffixes.  This makes
        # newly added reference rows usable without changing matcher code.
        for key in ("たことがあります", "てしまう", "ておく"):
            pass
        for key in (
            "たことがあります", "たところで", "わけではない", "わけがない",
            "ことだ", "ものだ", "らしい", "みたい", "ずに", "かねない",
        ):
            display_key = key.replace("たことがあります", "たことがある")
            add_literal(display_key, key)

        if show_basic_particles:
            for token, start, end in self._tokens(tokens, raw_text):
                if token in _BARE_PARTICLES:
                    candidates.append(self._candidate(token, raw_text, start, end))
        else:
            candidates = [
                item for item in candidates
                if not (item.text in _BARE_PARTICLES and item.end - item.start == 1)
            ]

        # Longest first gives a stable primary cover.  Overlapping shorter
        # candidates are retained as alternatives for UI explanations.
        candidates.sort(key=lambda item: (-(item.end - item.start), item.start, item.pattern_key))
        occupied: list[tuple[int, int]] = []
        for item in candidates:
            item.also_possible = any(item.start < end and start < item.end for start, end in occupied)
            if not item.also_possible:
                occupied.append((item.start, item.end))
        return sorted(candidates, key=lambda item: (item.start, -(item.end - item.start), item.also_possible))
