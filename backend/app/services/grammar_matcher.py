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
    concept_id: str | None = None
    span_approx: bool = False

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

    @staticmethod
    def _token_kind(token: dict[str, Any], text: str) -> str:
        if text in _BARE_PARTICLES:
            return "particle"
        pos = " ".join(
            str(token.get(key, ""))
            for key in ("pos", "part_of_speech", "partOfSpeech", "part_of_speech_detail")
        ).lower()
        if "助詞" in pos or "particle" in pos:
            return "particle"
        if (
            "動詞" in pos
            or "verb" in pos
            or "形容詞" in pos
            or "adjective" in pos
            or "助動詞" in pos
            or "auxiliary" in pos
            or token.get("is_auxiliary")
            or token.get("is_predicate")
        ):
            return "predicate"
        base = str(token.get("base_form", token.get("lemma", "")))
        return "predicate" if base == "する" or text in {"する", "し", "した", "して"} else "other"

    @classmethod
    def _anchored_start(
        cls,
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
        match_start: int,
        match_end: int | None = None,
    ) -> int:
        if match_end is None:
            match_end = match_start + 1
        overlapping = [
            index for index, (_, start, end, _) in enumerate(token_spans)
            if start < match_end and match_start < end
        ]
        first_kind = (
            cls._token_kind(token_spans[overlapping[0]][3], token_spans[overlapping[0]][0])
            if overlapping else None
        )
        token_index = overlapping[0] if first_kind == "particle" else next(
            (
                index for index in overlapping
                if cls._token_kind(token_spans[index][3], token_spans[index][0]) == "predicate"
            ),
            None,
        )
        if token_index is None and overlapping:
            token_index = overlapping[0]
        if token_index is None:
            return match_start
        start = token_spans[token_index][1]
        current_index = token_index
        while current_index:
            previous = token_spans[current_index - 1]
            current = token_spans[current_index]
            if previous[2] != current[1] or cls._token_kind(previous[3], previous[0]) == "particle":
                break
            next_kind = cls._token_kind(current[3], current[0])
            previous_kind = cls._token_kind(previous[3], previous[0])
            is_suru_noun = (
                previous_kind == "other"
                and next_kind == "predicate"
                and str(current[3].get("base_form", current[3].get("lemma", ""))) == "する"
            )
            if previous_kind != "predicate" and not is_suru_noun:
                break
            start = previous[1]
            current_index -= 1
        return start

    @staticmethod
    def _token_boundaries(
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
        start: int,
        end: int,
    ) -> bool:
        return any(token_start == start for _, token_start, _, _ in token_spans) and any(
            token_end == end for _, _, token_end, _ in token_spans
        )

    def _candidate(
        self, point: dict[str, Any], raw_text: str, start: int, end: int, *,
        confidence: str = "high", matched: str | None = None, span_approx: bool = False,
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
            concept_id=point.get("concept_id"), span_approx=span_approx,
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
            "た": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+た",
            "ない": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+ない",
            "ます-stem": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
            "dictionary": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
            "plain": r"[\u3041-\u309f\u30a1-\u30fa\u30f7-\u30ff々ー一-龯]+",
        }
        return prefixes[required] + re.escape(suffix)

    def _regexes(self, point: dict[str, Any], spec: dict[str, Any]) -> list[str]:
        if point.get("pattern_key") == "たい":
            stem = _JAPANESE + "+"
            return [f"{stem}(?:たくなかった|たくない|たかった|たい)"]
        if point.get("pattern_key") == "ている":
            stem = _JAPANESE + "+"
            return [f"{stem}(?:ていなかった|ていない|ていた|ている)"]
        regex = spec.get("regex")
        if isinstance(regex, str) and regex:
            return [regex]
        inflection_regex = self._inflection_regex(spec)
        if inflection_regex:
            return [inflection_regex]
        variants = spec.get("variants") or point.get("variants") or []
        regexes = [re.escape(value) for value in variants if isinstance(value, str) and value]
        return regexes

    @staticmethod
    def _bounded_fallback_start(raw_text: str, start: int, end: int | None = None) -> int:
        particles = set("はがをにへでとのも")
        while start > 0 and re.match(_JAPANESE, raw_text[start - 1]):
            if raw_text[start - 1] in particles:
                break
            start -= 1
        if end is not None:
            for offset, char in enumerate(raw_text[start:end]):
                if char in particles:
                    start = start + offset + 1
        return start

    def _match_point(
        self,
        point: dict[str, Any],
        raw_text: str,
        tokens: list[tuple[str, int, int, dict[str, Any]]] | None = None,
    ) -> list[MatchedGrammarSpan]:
        spec = point.get("matcher") or {}
        if not isinstance(spec, dict) or spec.get("match_mode") == "reference_only":
            return []
        token_spans = tokens or []
        span_approx = not bool(token_spans)
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
                    span_approx=span_approx,
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
                if token_spans and len(match.group()) <= 2 and not self._token_boundaries(
                    token_spans, match.start(), match.end()
                ):
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
                if token_spans:
                    start = self._anchored_start(token_spans, start, match.end())
                    if not any(
                        self._token_kind(token[3], token[0]) == "predicate"
                        for token in token_spans
                    ) and regex.startswith("["):
                        start = self._bounded_fallback_start(raw_text, start, match.end())
                else:
                    start = self._bounded_fallback_start(
                        raw_text, start, match.end() if regex.startswith("[") else None
                    )
                matches.append(self._candidate(
                    point, raw_text, start, match.end(),
                    confidence=str(spec.get("confidence", "high")), matched=matched,
                    span_approx=span_approx,
                ))
        return matches

    def match_sentence(
        self, tokens: list[dict], raw_text: str, show_basic_particles: bool = False
    ) -> list[MatchedGrammarSpan]:
        candidates: list[MatchedGrammarSpan] = []
        points = self.reference.get_points()
        by_key = {point["pattern_key"]: point for point in points}
        token_spans = self._tokens(tokens, raw_text)
        for point in points:
            candidates.extend(self._match_point(point, raw_text, token_spans))

        if show_basic_particles:
            particle_tokens = tokens or [{"text": char} for char in raw_text]
            for token, start, end, _ in self._tokens(particle_tokens, raw_text):
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
            dedup_key = (item.concept_id or item.pattern_key, item.start, item.end)
            unique.setdefault(dedup_key, item)
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
