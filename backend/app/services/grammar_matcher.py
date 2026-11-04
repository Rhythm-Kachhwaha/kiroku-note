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
_JAPANESE_RE = re.compile(_JAPANESE)


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
        self._compiled_cache: dict[int, list[tuple[re.Pattern[str], bool]]] = {}

    @classmethod
    def _ensure_morpheme_tokens(
        cls, tokens: list[dict[str, Any]], raw_text: str
    ) -> list[dict[str, Any]]:
        if tokens and any("pos" in t or "lemma" in t or len(str(t.get("text", t.get("surface", "")))) > 1 for t in tokens):
            return tokens
        try:
            from .tokenizers import get_sudachi_tokenizer, sudachi_status
            from app.config import get_sudachi_dictionary_variant
            variant = get_sudachi_dictionary_variant()
            if sudachi_status(variant).get("ready"):
                tok = get_sudachi_tokenizer(variant)
                return [
                    {
                        "text": m.surface,
                        "surface": m.surface,
                        "lemma": m.lemma,
                        "base_form": m.lemma,
                        "reading": m.reading,
                        "pos": m.pos if isinstance(m.pos, (list, tuple)) else tuple(m.pos.split()),
                        "start": m.start,
                        "end": m.end,
                    }
                    for m in tok.tokenize(raw_text)
                ]
        except Exception:
            pass
        return tokens

    @staticmethod
    def _tokens(tokens: list[dict[str, Any]], raw_text: str) -> list[tuple[str, int, int, dict[str, Any]]]:
        result = []
        cursor = 0
        for token in tokens:
            text = str(token.get("text", token.get("surface", "")))
            if not text:
                continue
            if "start" in token and "end" in token:
                start = int(token["start"])
                end = int(token["end"])
                result.append((text, start, end, token))
                cursor = end
            else:
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
        while start > 0 and _JAPANESE_RE.match(raw_text[start - 1]):
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
        starts_bracket: bool = False,
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
        if overlapping:
            if not starts_bracket and token_spans[overlapping[0]][1] == match_start:
                token_index = overlapping[0]
            elif first_kind == "particle":
                token_index = overlapping[0]
            else:
                token_index = next(
                    (
                        index for index in overlapping
                        if cls._token_kind(token_spans[index][3], token_spans[index][0]) == "predicate"
                    ),
                    None,
                )
        else:
            token_index = None

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
            current_pos = " ".join(current[3].get("pos", [])) if isinstance(current[3].get("pos"), (list, tuple)) else str(current[3].get("pos", ""))
            previous_pos = " ".join(previous[3].get("pos", [])) if isinstance(previous[3].get("pos"), (list, tuple)) else str(previous[3].get("pos", ""))
            if "動詞" in current_pos and "形容詞" in previous_pos:
                break
            is_suru_noun = (
                previous_kind == "other"
                and next_kind == "predicate"
                and str(current[3].get("base_form", current[3].get("lemma", ""))) in {"する", "だ", "です"}
            )
            if previous_kind != "predicate" and not is_suru_noun:
                break
            start = previous[1]
            current_index -= 1
        return start

    @classmethod
    def _extend_to_preceding_verb(
        cls,
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
        start: int,
    ) -> int:
        idx = next((i for i, (_, s, _, _) in enumerate(token_spans) if s == start), None)
        if idx is None:
            idx = next((i for i, (_, s, _, _) in enumerate(token_spans) if s >= start), None)
        if idx is None:
            return start
        curr = idx
        while curr > 0:
            prev = token_spans[curr - 1]
            prev_tok = prev[3]
            prev_text = prev[0]
            pos_str = " ".join(prev_tok.get("pos", [])) if isinstance(prev_tok.get("pos"), (list, tuple)) else str(prev_tok.get("pos", ""))
            if "動詞" in pos_str:
                start = prev[1]
                if curr > 1:
                    before_prev = token_spans[curr - 2]
                    if (
                        cls._token_kind(before_prev[3], before_prev[0]) == "other"
                        and str(prev_tok.get("base_form", prev_tok.get("lemma", ""))) == "する"
                    ):
                        start = before_prev[1]
                break
            elif prev_text in {"た", "ない", "なかった", "だ"} or "助動詞" in pos_str:
                start = prev[1]
                curr -= 1
            else:
                break
        return start

    @classmethod
    def _extend_to_preceding_predicate(
        cls,
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
        start: int,
    ) -> int:
        idx = next((i for i, (_, s, _, _) in enumerate(token_spans) if s == start), None)
        if idx is None:
            idx = next((i for i, (_, s, _, _) in enumerate(token_spans) if s >= start), None)
        if idx is None:
            return start
        curr = idx
        while curr > 0:
            prev = token_spans[curr - 1]
            prev_tok = prev[3]
            prev_text = prev[0]
            kind = cls._token_kind(prev_tok, prev_text)
            if kind == "predicate":
                start = prev[1]
                curr -= 1
                if curr > 0:
                    before_prev = token_spans[curr - 1]
                    if (
                        cls._token_kind(before_prev[3], before_prev[0]) == "other"
                        and str(prev_tok.get("base_form", prev_tok.get("lemma", ""))) == "する"
                    ):
                        start = before_prev[1]
                break
            else:
                break
        return start

    @staticmethod
    def _token_boundaries(
        morpheme_spans: list[tuple[str, int, int, dict[str, Any]]],
        start: int,
        end: int,
        pattern_key: str = "",
    ) -> bool:
        if not morpheme_spans:
            return True
        # Check start and end boundaries
        has_start = any(token_start == start for _, token_start, _, _ in morpheme_spans)
        has_end = any(token_end == end for _, _, token_end, _ in morpheme_spans)
        if not (has_start and has_end):
            return False

        # Reject match fully inside one morpheme whose lemma != pattern (kills まい in うまい, だ in です)
        base_pattern = pattern_key.split("(")[0].strip()
        pattern_candidates = {pattern_key, base_pattern, base_pattern.lstrip("〜~").strip()}
        if "/" in pattern_key:
            for part in pattern_key.split("/"):
                pattern_candidates.add(part.strip().lstrip("〜~").strip())
        for _, t_start, t_end, token in morpheme_spans:
            if t_start <= start and end <= t_end:
                m_lemma = token.get("lemma") or token.get("base_form") or ""
                m_surface = token.get("surface") or token.get("text", "")
                if m_lemma or m_surface:
                    if m_lemma not in pattern_candidates and m_surface not in pattern_candidates:
                        return False
        return True

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
            return [r"(?:ていなかった|ていない|ていた|ている)"]
        if spec.get("ambiguity_group") == "そうだ":
            stem = _JAPANESE + "+"
            return [f"{stem}そう(?:だ|です|で|な|に)"]
        regex = spec.get("regex")
        if isinstance(regex, str) and regex:
            return [regex]
        inflection_regex = self._inflection_regex(spec)
        if inflection_regex:
            return [inflection_regex]
        variants = spec.get("variants") or point.get("variants") or []
        regexes = [re.escape(value) for value in variants if isinstance(value, str) and value]
        return regexes

    def _point_data(
        self, point: dict[str, Any], spec: dict[str, Any]
    ) -> list[tuple[re.Pattern[str], bool]]:
        cache_key = id(point)
        cached = self._compiled_cache.get(cache_key)
        if cached is not None:
            return cached
        compiled: list[tuple[re.Pattern[str], bool]] = []
        for regex in self._regexes(point, spec):
            try:
                compiled.append((re.compile(regex), regex.startswith("[")))
            except re.error:
                continue
        self._compiled_cache[cache_key] = compiled
        return compiled

    @staticmethod
    def _bounded_fallback_start(raw_text: str, start: int, end: int | None = None) -> int:
        particles = set("はがをにへでとのも")
        while start > 0 and _JAPANESE_RE.match(raw_text[start - 1]):
            if raw_text[start - 1] in particles:
                break
            start -= 1
        if end is not None:
            for offset, char in enumerate(raw_text[start:end]):
                if char in particles:
                    start = start + offset + 1
        return start

    @staticmethod
    def _token_matches_morph_spec(token: dict[str, Any], item: dict[str, Any]) -> bool:
        if "surface" in item:
            exp = item["surface"]
            exps = [exp] if isinstance(exp, str) else list(exp)
            surf = token.get("surface") or token.get("text", "")
            if surf not in exps:
                return False
        if "lemma" in item:
            exp = item["lemma"]
            exps = [exp] if isinstance(exp, str) else list(exp)
            lemma = token.get("lemma") or token.get("base_form", "")
            if lemma not in exps:
                return False
        if "pos_prefix" in item:
            pref = item["pos_prefix"]
            prefs = [pref] if isinstance(pref, str) else list(pref)
            pos_val = token.get("pos", "")
            pos_str = " ".join(pos_val) if isinstance(pos_val, (list, tuple)) else str(pos_val)
            if not any(pos_str.startswith(p) or p in pos_str for p in prefs):
                return False
        if "form" in item:
            form = item["form"]
            token_form = token.get("form") or token.get("inflection_form") or ""
            pos_val = token.get("pos", "")
            pos_str = " ".join(pos_val) if isinstance(pos_val, (list, tuple)) else str(pos_val)
            if not (form in token_form or form in pos_str):
                return False
        return True

    def _match_morph_point(
        self,
        point: dict[str, Any],
        raw_text: str,
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
    ) -> list[MatchedGrammarSpan]:
        spec = point.get("matcher") or {}
        sequence = spec.get("sequence") or spec.get("pattern") or []
        if not sequence or not token_spans:
            return []

        matches: list[MatchedGrammarSpan] = []
        n_tokens = len(token_spans)

        def match_from(m_idx: int, s_idx: int) -> list[int]:
            if s_idx == len(sequence):
                return [m_idx]
            item = sequence[s_idx]
            is_optional = item.get("optional", False)
            ends: list[int] = []

            if m_idx < n_tokens and self._token_matches_morph_spec(token_spans[m_idx][3], item):
                ends.extend(match_from(m_idx + 1, s_idx + 1))

            if is_optional:
                ends.extend(match_from(m_idx, s_idx + 1))

            return ends

        for start_idx in range(n_tokens):
            end_indices = match_from(start_idx, 0)
            for end_idx in set(end_indices):
                if end_idx <= start_idx:
                    continue
                first_tok = token_spans[start_idx]
                last_tok = token_spans[end_idx - 1]
                m_start = first_tok[1]
                m_end = last_tok[2]

                # Span extends left only over the same predicate chain (stop at particles 助詞)
                if spec.get("extend_predicate", True):
                    m_start = self._anchored_start(token_spans, m_start, m_end)

                matches.append(self._candidate(
                    point, raw_text, m_start, m_end,
                    confidence=str(spec.get("confidence", "high")),
                    span_approx=False,
                ))
        return matches

    def _match_point(
        self,
        point: dict[str, Any],
        raw_text: str,
        token_spans: list[tuple[str, int, int, dict[str, Any]]],
        morpheme_spans: list[tuple[str, int, int, dict[str, Any]]] | None = None,
    ) -> list[MatchedGrammarSpan]:
        spec = point.get("matcher") or {}
        if not isinstance(spec, dict) or spec.get("match_mode") == "reference_only":
            return []
        span_approx = not bool(token_spans)
        matches: list[MatchedGrammarSpan] = []

        if spec.get("type") == "morph":
            morph_tokens = morpheme_spans or token_spans
            return self._match_morph_point(point, raw_text, morph_tokens)

        if spec.get("type") == "discontinuous":
            first = spec.get("first")
            second = spec.get("second")
            if not isinstance(first, str) or not isinstance(second, str):
                return []
            gap = int(spec.get("max_gap", 25))
            break_chars = spec.get("clause_break", "[、。！？]")
            allowed_gap = f"[^{break_chars[1:-1]}]" if break_chars.startswith("[") and break_chars.endswith("]") else f"[^{break_chars}]"
            pattern = f"(?P<a>{first})(?P<m>{allowed_gap}{{0,{gap}}}?)(?P<b>{second})"
            for match in re.finditer(pattern, raw_text):
                matches.append(self._candidate(
                    point, raw_text, match.start(), match.end(),
                    confidence=str(spec.get("confidence", "high")),
                    span_approx=span_approx,
                ))
            return matches

        guard_spans = morpheme_spans or token_spans
        compiled = self._point_data(point, spec)
        for pattern, starts_bracket in compiled:
            for match in pattern.finditer(raw_text):
                if spec.get("ambiguity_group") == "そうだ":
                    sou_match = re.search(r"そう(?:だ|です|で|な|に)", match.group())
                    prefix = match.group()[:sou_match.start()] if sou_match else match.group()[:-3]
                    is_plain = prefix.endswith(("る", "た", "ない", "だ", "かった", "いた", "した"))
                    if point["pattern_key"] == "そうだ(hearsay)" and not is_plain:
                        continue
                    if point["pattern_key"] == "そうだ(appearance)" and is_plain:
                        continue

                guards = None if spec.get("ambiguity_group") == "そうだ" else (
                    spec.get("guards") or point.get("guards")
                )
                if not self._guarded(match, raw_text, guards):
                    continue
                if guard_spans and not self._token_boundaries(
                    guard_spans, match.start(), match.end(), pattern_key=point.get("pattern_key", "")
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
                    sou_match = re.search(r"そう(?:だ|です|で|な|に)", match.group())
                    suffix_pos = (match.start() + sou_match.start()) if sou_match else (match.end() - 3)
                    start = self._grammar_start(raw_text, suffix_pos)

                if token_spans:
                    start = self._anchored_start(token_spans, start, match.end(), starts_bracket=starts_bracket)
                    if not any(
                        self._token_kind(token[3], token[0]) == "predicate"
                        for token in token_spans
                    ) and starts_bracket:
                        start = self._bounded_fallback_start(raw_text, start, match.end())

                    # Fix spans for ほうがいい/たほうがいい and はずがない
                    if "ほうがいい" in point.get("pattern_key", ""):
                        start = self._extend_to_preceding_verb(token_spans, start)
                    elif point.get("pattern_key") == "はずがない":
                        start = self._extend_to_preceding_predicate(token_spans, start)
                else:
                    start = self._bounded_fallback_start(
                        raw_text, start, match.end() if starts_bracket else None
                    )

                matches.append(self._candidate(
                    point, raw_text, start, match.end(),
                    confidence=str(spec.get("confidence", "high")), matched=matched,
                    span_approx=span_approx,
                ))
        return matches

    @staticmethod
    def _is_component_pattern(parent_key: str, child_key: str, parent_text: str, child_text: str) -> bool:
        child_base = child_key.split("(")[0].strip()
        parent_base = parent_key.split("(")[0].strip()
        if child_base in {"ば", "ない", "だ", "た", "ている", "ていた", "まい"}:
            return True
        if child_base in parent_base:
            return True
        return False

    def match_sentence(
        self, tokens: list[dict] | None = None, raw_text: str = "", show_basic_particles: bool = False, show_all: bool = False
    ) -> list[MatchedGrammarSpan]:
        candidates: list[MatchedGrammarSpan] = []
        points = self.reference.get_points()
        by_key = {point["pattern_key"]: point for point in points}

        active_tokens = tokens if (tokens is not None and len(tokens) > 0) else self._ensure_morpheme_tokens([], raw_text)
        token_spans = self._tokens(active_tokens, raw_text)

        # Build morpheme spans specifically for boundary guarding
        morpheme_tokens = self._ensure_morpheme_tokens(active_tokens, raw_text)
        morpheme_spans = self._tokens(morpheme_tokens, raw_text)

        for point in points:
            candidates.extend(self._match_point(point, raw_text, token_spans, morpheme_spans))

        if show_basic_particles:
            particle_tokens = active_tokens or [{"text": char} for char in raw_text]
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

        # Boundary adjustments for overlapping/connected grammar points:
        for a in candidates:
            if not a.pattern_key:
                continue
            for b in candidates:
                if b is a or not b.pattern_key:
                    continue
                if b.pattern_key == "のに" and a.start <= b.start < a.end < b.end:
                    b.start = a.end
                    b.text = raw_text[b.start:b.end]
                elif (
                    a.pattern_key in {"使役", "使役形", "受身", "受身形"}
                    and b.pattern_key in {"ていただく", "てくださる / ていただく", "てくださる"}
                    and a.start <= b.start < a.end < b.end
                ):
                    te_idx = raw_text.rfind("て", a.start, a.end)
                    if te_idx >= 0:
                        b.start = te_idx
                        b.text = raw_text[b.start:b.end]

        # Suppress contained weaker candidates: if span A strictly contains span B and B's pattern is a component
        if not show_all:
            suppressed: set[int] = set()
            for i, a in enumerate(candidates):
                for j, b in enumerate(candidates):
                    if i == j or j in suppressed:
                        continue
                    is_contained = (a.start <= b.start and b.end <= a.end) and (a.end - a.start > b.end - b.start)
                    if is_contained and self._is_component_pattern(a.pattern_key, b.pattern_key, a.text, b.text):
                        suppressed.add(j)
            candidates = [item for idx, item in enumerate(candidates) if idx not in suppressed]

        candidates.sort(key=lambda item: (-(item.end - item.start), item.start, item.pattern_key))
        occupied: list[tuple[int, int]] = []
        for item in candidates:
            item.also_possible = any(
                item.start < end and start < item.end for start, end in occupied
            )
            if not item.also_possible:
                occupied.append((item.start, item.end))
        return sorted(candidates, key=lambda item: (item.start, -(item.end - item.start), item.also_possible))
