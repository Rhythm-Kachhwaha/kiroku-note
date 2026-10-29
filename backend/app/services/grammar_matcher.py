"""Data-driven sentence matching against the bundled grammar index."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from .grammar_reference import GrammarReferenceService


_BARE_PARTICLES = {
    "は", "が", "を", "に", "へ", "で", "と", "の", "も", "から", "まで",
    "より", "か", "よ", "ね", "わ",
}
_JAPANESE = r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]"


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


class GrammarMatcher:
    """Find grammar formations by interpreting each index row's matcher spec."""

    def __init__(self, reference_service: GrammarReferenceService | None = None):
        self.reference = reference_service or GrammarReferenceService()

    @staticmethod
    def _tokens(tokens: list[dict[str, Any]], raw_text: str) -> list[tuple[str, int, int, dict[str, Any]]]:
        result = []
        cursor = 0
        for token in tokens:
            text = str(token.get("text", token.get("surface", "")))
            if not text:
                continue
            start = raw_text.find(text, cursor)
            if start < 0:
                continue
            result.append((text, start, start + len(text), token))
            cursor = start + len(text)
        return result

    @staticmethod
    def _grammar_start(raw_text: str, suffix_start: int) -> int:
        particles = set("はがをにへでとのも")
        start = suffix_start
        while start > 0 and re.match(_JAPANESE, raw_text[start - 1]):
            if raw_text[start - 1] in particles:
                break
            start -= 1
        return start

    def _candidate(
        self, point: dict[str, Any], raw_text: str, start: int, end: int, *,
        confidence: str = "high", matched: str | None = None,
    ) -> MatchedGrammarSpan:
        breakdown = point.get("english_breakdown", "")
        formation = point.get("formation")
        if matched and matched != formation:
            breakdown = f"{breakdown} Matched here as: {matched}."
        return MatchedGrammarSpan(
            pattern_key=point["pattern_key"],
            pattern_display=point.get("pattern_display", f"〜{point['pattern_key']}"),
            text=raw_text[start:end], start=start, end=end,
            level=point.get("level", ""), meaning_short=point.get("meaning_short", ""),
            english_breakdown=breakdown, formation=formation,
            confidence=confidence, matched_formation=matched,
        )

    @staticmethod
    def _guarded(match: re.Match[str], raw_text: str, guards: dict[str, Any] | None) -> bool:
        if not guards:
            return True
        preceding = raw_text[:match.start()]
        following = raw_text[match.end():]
        required = guards.get("required_preceding", [])
        forbidden = guards.get("forbidden_preceding", [])
        if required and not any(preceding.endswith(value) for value in required):
            return False
        if any(preceding.endswith(value) for value in forbidden):
            return False
        if guards.get("required_following") and not any(
            following.startswith(value) for value in guards["required_following"]
        ):
            return False
        if any(following.startswith(value) for value in guards.get("forbidden_following", [])):
            return False
        minimum = guards.get("minimum_sentence_context")
        return not minimum or len(raw_text) >= int(minimum)

    @staticmethod
    def _inflection_regex(spec: dict[str, Any]) -> str | None:
        inflection = spec.get("inflection")
        if not isinstance(inflection, dict):
            return None
        required = inflection.get("required_form")
        suffix = inflection.get("suffix")
        if required not in {"て", "た", "ない", "ます-stem", "dictionary", "plain"}:
            return None
        if not isinstance(suffix, str):
            return None
        prefixes = {
            "て": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+て",
            "た": r"[\u3041-\u309f\u30a1-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+た",
            "ない": r"[\u3041-\u309f\u30a1-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+ない",
            "ます-stem": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
            "dictionary": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
            "plain": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
        }
        return prefixes[required] + re.escape(suffix)

    def _regexes(self, point: dict[str, Any], spec: dict[str, Any]) -> list[str]:
        regex = spec.get("regex")
        if isinstance(regex, str) and regex:
            return [regex]
        inflection_regex = self._inflection_regex(spec)
        if inflection_regex:
            return [inflection_regex]
        variants = spec.get("variants") or point.get("variants") or []
        return [re.escape(value) for value in variants if isinstance(value, str) and value]

    def _match_point(self, point: dict[str, Any], raw_text: str) -> list[MatchedGrammarSpan]:
        spec = point.get("matcher") or {}
        if not isinstance(spec, dict) or spec.get("match_mode") == "reference_only":
            return []
        matches: list[MatchedGrammarSpan] = []
        if spec.get("type") == "discontinuous":
            first = spec.get("first")
            second = spec.get("second")
            if not isinstance(first, str) or not isinstance(second, str):
                return []
            gap = int(spec.get("max_gap", 20))
            clause_break = spec.get("clause_break", "[、。！？]")
            pattern = f"(?P<a>{first})(?P<m>[^、。！？]{{0,{gap}}}?)(?P<b>{second})"
            for match in re.finditer(pattern, raw_text):
                matches.append(self._candidate(
                    point, raw_text, match.start(), match.end(),
                    confidence=str(spec.get("confidence", "high")),
                ))
            return matches

        for regex in self._regexes(point, spec):
            try:
                found = re.finditer(regex, raw_text)
            except re.error:
                continue
            for match in found:
                if spec.get("ambiguity_group") == "そうだ":
                    prefix = match.group()[:-3]
                    is_plain = prefix.endswith(("る", "た", "ない", "だ"))
                    if point["pattern_key"] == "そうだ(hearsay)" and not is_plain:
                        continue
                    if point["pattern_key"] == "そうだ(appearance)" and is_plain:
                        continue
                guards = None if spec.get("ambiguity_group") == "そうだ" else (
                    spec.get("guards") or point.get("guards")
                )
                if not self._guarded(match, raw_text, guards):
                    continue
                start = match.start()
                matched = None
                if point["pattern_key"] in {"てしまう", "ておく"}:
                    suffix_start = match.start()
                    if point["pattern_key"] == "てしまう":
                        suffix = re.search(r"(?:てしま|ちゃ)", match.group())
                        if suffix:
                            suffix_start += suffix.start()
                    start = self._grammar_start(raw_text, suffix_start)
                    if point["pattern_key"] == "てしまう":
                        suffix = re.search(r"(?:てしま|ちゃ).*$", match.group())
                        matched = f"V-て + {suffix.group() if suffix else match.group()}"
                    else:
                        matched = "V-て + とく" if match.group().endswith("とく") else "V-て + おく"
                elif spec.get("ambiguity_group") == "そうだ":
                    start = self._grammar_start(raw_text, match.end() - 3)
                matches.append(self._candidate(
                    point, raw_text, start, match.end(),
                    confidence=str(spec.get("confidence", "high")), matched=matched,
                ))
        return matches

    def match_sentence(
        self, tokens: list[dict], raw_text: str, show_basic_particles: bool = False
    ) -> list[MatchedGrammarSpan]:
        candidates: list[MatchedGrammarSpan] = []
        points = self.reference.get_points()
        by_key = {point["pattern_key"]: point for point in points}
        for point in points:
            candidates.extend(self._match_point(point, raw_text))

        if show_basic_particles:
            for token, start, end, _ in self._tokens(tokens, raw_text):
                if token in _BARE_PARTICLES and token in by_key:
                    candidates.append(self._candidate(by_key[token], raw_text, start, end))

        candidates = [
            item for item in candidates
            if show_basic_particles or not (
                item.text in _BARE_PARTICLES and item.end - item.start == 1
            )
        ]
        unique: dict[tuple[str, int, int], MatchedGrammarSpan] = {}
        for item in candidates:
            unique.setdefault((item.pattern_key, item.start, item.end), item)
        candidates = list(unique.values())
        candidates.sort(key=lambda item: (-(item.end - item.start), item.start, item.pattern_key))
        occupied: list[tuple[int, int]] = []
        for item in candidates:
            item.also_possible = any(
                item.start < end and start < item.end for start, end in occupied
            )
            if not item.also_possible:
                occupied.append((item.start, item.end))
        return sorted(candidates, key=lambda item: (item.start, -(item.end - item.start), item.also_possible))
