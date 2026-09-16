"""The sole boundary for Yomitan's local HTTP API."""
from __future__ import annotations

from dataclasses import dataclass, field
import json, os, re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_YOMITAN_ENDPOINT = "http://127.0.0.1:19633"
class YomitanError(Exception): pass
class YomitanUnavailableError(YomitanError): pass
class YomitanResponseError(YomitanError): pass

@dataclass(frozen=True)
class IdentifiedTerm:
    expression: str
    reading: str
    source_text: str
    deinflected_text: str


@dataclass(frozen=True)
class ExampleSentence:
    japanese: str
    translation: str | None = None
    reading: str | None = None
    source_dictionary: str | None = None


# Backward-compatibility alias
Example = ExampleSentence


@dataclass(frozen=True)
class PitchAccent:
    reading: str
    position: int
    pattern_name: str | None = None
    nasal_positions: list[int] = field(default_factory=list)
    devoice_positions: list[int] = field(default_factory=list)
    dictionary: str | None = None


@dataclass(frozen=True)
class FrequencyRank:
    dictionary: str
    frequency: int | float = 0
    display_value: str | None = None
    rank: int | None = None
    is_common: bool = False


@dataclass(frozen=True)
class DictionarySense:
    glosses: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    examples: list[ExampleSentence] = field(default_factory=list)
    parts_of_speech: list[str] = field(default_factory=list)
    field_tags: list[str] = field(default_factory=list)
    index: int = 1


# Backward-compatibility alias
Sense = DictionarySense


@dataclass(frozen=True)
class DictionaryEntry:
    dictionary: str
    is_primary: bool = False
    term: str = ""
    reading: str = ""
    parts_of_speech: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    senses: list[DictionarySense] = field(default_factory=list)
    dictionary_alias: str | None = None
    alt_terms: list[str] = field(default_factory=list)
    alt_readings: list[str] = field(default_factory=list)
    pitches: list[PitchAccent] = field(default_factory=list)
    frequencies: list[FrequencyRank] = field(default_factory=list)
    score: int = 0


@dataclass(frozen=True)
class KanjiEntry:
    character: str
    dictionary: str = "Unknown dictionary"
    onyomi: list[str] = field(default_factory=list)
    kunyomi: list[str] = field(default_factory=list)
    nanori: list[str] = field(default_factory=list)
    meanings: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    stats: dict[str, str] = field(default_factory=dict)
    dictionary_alias: str | None = None
    frequencies: list[FrequencyRank] = field(default_factory=list)


@dataclass(frozen=True)
class EnrichedTerm:
    expression: str
    reading: str
    source_text: str
    deinflected_text: str
    entries: list[DictionaryEntry] = field(default_factory=list)
    dictionary_error: str | None = None
    jlpt_level: str | None = None
    kanji_entries: list[KanjiEntry] = field(default_factory=list)

class YomitanService:
    def __init__(self, endpoint: str | None = None, timeout_seconds: float = 3.0):
        self._endpoint = (endpoint or os.getenv("YOMITAN_ENDPOINT") or DEFAULT_YOMITAN_ENDPOINT).rstrip("/")
        self._timeout_seconds = timeout_seconds

    def identify(self, text: str) -> IdentifiedTerm:
        return self.normalize_tokenize_response(self._post_json("/tokenize", {"text": text, "scanLength": 16, "parser": "scanning-parser"}), text)

    def enrich(self, term: IdentifiedTerm) -> EnrichedTerm:
        term_error: str | None = None
        entries: list[DictionaryEntry] = []
        try:
            entries = self.normalize_term_entries_response(self._post_json("/termEntries", {"term": term.expression}))
        except YomitanError as error:
            term_error = str(error)

        kanji_entries: list[KanjiEntry] = []
        has_kanji = any(
            "\u4e00" <= ch <= "\u9fff"
            or "\u3400" <= ch <= "\u4dbf"
            or "\uf900" <= ch <= "\ufaff"
            for ch in term.expression
        )
        if has_kanji:
            try:
                raw_kanji = self._post_json("/kanjiEntries", {"character": term.expression})
                kanji_entries = self.normalize_kanji_entries_response(raw_kanji)
            except Exception:
                pass

        has_usable_terms = any(s.glosses for entry in entries for s in entry.senses)
        has_usable_kanji = any(k.meanings or k.onyomi or k.kunyomi for k in kanji_entries)

        if has_usable_terms or has_usable_kanji:
            error = None
        elif term_error:
            error = term_error
        else:
            error = "Dictionary returned no usable definitions."

        # Resolve modern JLPT level from entry tags if available
        jlpt_level = None
        for entry in entries:
            for tag in entry.tags:
                t = str(tag).strip()
                if m := re.match(r"^jlpt-n([1-5])$", t, re.IGNORECASE):
                    jlpt_level = f"N{m.group(1)}"
                    break
                if m := re.match(r"^n([1-5])$", t, re.IGNORECASE):
                    jlpt_level = f"N{m.group(1)}"
                    break
            if jlpt_level:
                break

        return EnrichedTerm(
            expression=term.expression,
            reading=term.reading,
            source_text=term.source_text,
            deinflected_text=term.deinflected_text,
            entries=entries,
            dictionary_error=error,
            jlpt_level=jlpt_level,
            kanji_entries=kanji_entries,
        )

    def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        request = Request(f"{self._endpoint}{path}", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response: return json.loads(response.read().decode())
        except HTTPError as error: raise YomitanResponseError("Yomitan returned an invalid dictionary response.") from error
        except (URLError, TimeoutError, OSError) as error: raise YomitanUnavailableError("Yomitan is unavailable. Start Yomitan and try again.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error: raise YomitanResponseError("Yomitan returned an invalid response.") from error

    @staticmethod
    def normalize_tokenize_response(payload: Any, source_text: str = "") -> IdentifiedTerm:
        if not isinstance(payload, list): raise YomitanResponseError("Yomitan returned an invalid response.")
        first_text_fallback: IdentifiedTerm | None = None
        for result in payload:
            for segment in result.get("content", []) if isinstance(result, dict) else []:
                for token in segment if isinstance(segment, list) else []:
                    if not isinstance(token, dict): continue
                    headword = YomitanService._first_headword(token)
                    if headword:
                        term, reading, source, deinflected = headword
                        return IdentifiedTerm(term, reading, source or source_text.strip() or term, deinflected or term)
                    text, reading = token.get("text"), token.get("reading", "")
                    if first_text_fallback is None and isinstance(text, str) and text.strip() and isinstance(reading, str):
                        if any("\u3040" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff" or ch == "\u3005" for ch in text):
                            first_text_fallback = IdentifiedTerm(text.strip(), reading.strip(), source_text.strip() or text.strip(), text.strip())
        if first_text_fallback is not None:
            return first_text_fallback
        raise YomitanResponseError("Yomitan could not identify a Japanese term in this selection.")

    @staticmethod
    def _first_headword(token: dict[str, Any]) -> tuple[str, str, str, str] | None:
        for group in token.get("headwords", []) if isinstance(token.get("headwords"), list) else []:
            for headword in group if isinstance(group, list) else []:
                if not isinstance(headword, dict) or not isinstance(headword.get("term"), str): continue
                source = next((item for item in headword.get("sources", []) if isinstance(item, dict)), {})
                return (headword["term"].strip(), str(headword.get("reading", "")).strip(), str(source.get("originalText", "")).strip(), str(source.get("deinflectedText", "")).strip())
        return None

    MAX_AST_DEPTH = 32

    @staticmethod
    def normalize_term_entries_response(payload: Any) -> list[DictionaryEntry]:
        if not isinstance(payload, dict):
            raise YomitanResponseError("Yomitan returned an invalid dictionary response.")
        raw_entries = payload.get("dictionaryEntries")
        if not isinstance(raw_entries, list):
            raise YomitanResponseError("Yomitan returned an invalid dictionary response.")
        normalized: list[DictionaryEntry] = []
        for raw in raw_entries:
            if not isinstance(raw, dict):
                continue
            try:
                headwords = raw.get("headwords") if isinstance(raw.get("headwords"), list) else []
                root_primary = bool(raw.get("isPrimary", False))
                root_score = int(raw.get("score") or 0)
                root_pitches = YomitanService._extract_pitches(raw)
                root_frequencies = YomitanService._extract_frequencies(raw)

                definitions = raw.get("definitions") if isinstance(raw.get("definitions"), list) else []
                for definition in definitions:
                    if not isinstance(definition, dict):
                        continue
                    dict_name = str(definition.get("dictionary") or "Unknown dictionary")
                    dict_alias = str(definition["dictionaryAlias"]) if definition.get("dictionaryAlias") else None
                    is_primary = bool(definition.get("isPrimary", root_primary))
                    score = int(definition.get("score") or root_score)
                    term, reading = YomitanService._definition_headword(definition, headwords)
                    alt_terms, alt_readings = YomitanService._alt_headwords(headwords, term, reading)
                    tags = YomitanService._tag_names(definition.get("tags"))
                    pitches = YomitanService._extract_pitches(definition) or root_pitches
                    frequencies = YomitanService._extract_frequencies(definition) or root_frequencies
                    senses, entry_pos = YomitanService._definition_senses(definition, dict_name)

                    entry = DictionaryEntry(
                        dictionary=dict_name,
                        is_primary=is_primary,
                        term=term,
                        reading=reading,
                        parts_of_speech=entry_pos,
                        tags=tags,
                        senses=senses,
                        dictionary_alias=dict_alias,
                        alt_terms=alt_terms,
                        alt_readings=alt_readings,
                        pitches=pitches,
                        frequencies=frequencies,
                        score=score,
                    )
                    normalized.append(entry)
            except Exception:
                continue
        return normalized

    @staticmethod
    def _definition_headword(definition: dict[str, Any], headwords: list[Any]) -> tuple[str, str]:
        indices = definition.get("headwordIndices") if isinstance(definition.get("headwordIndices"), list) else []
        for index in indices + list(range(len(headwords))):
            if isinstance(index, int) and 0 <= index < len(headwords) and isinstance(headwords[index], dict):
                item = headwords[index]
                return str(item.get("term", "")).strip(), str(item.get("reading", "")).strip()
        return "", ""

    @staticmethod
    def _alt_headwords(headwords: list[Any], primary_term: str, primary_reading: str) -> tuple[list[str], list[str]]:
        alt_terms: list[str] = []
        alt_readings: list[str] = []
        for hw in headwords:
            if not isinstance(hw, dict):
                continue
            term = str(hw.get("term", "")).strip()
            reading = str(hw.get("reading", "")).strip()
            if term and term != primary_term and term not in alt_terms:
                alt_terms.append(term)
            if reading and reading != primary_reading and reading not in alt_readings:
                alt_readings.append(reading)
        return alt_terms, alt_readings

    @staticmethod
    def _extract_pitches(source: dict[str, Any]) -> list[PitchAccent]:
        results: list[PitchAccent] = []
        candidates = []
        if isinstance(source.get("pitches"), list):
            candidates.extend(source["pitches"])
        if isinstance(source.get("pronunciations"), list):
            candidates.extend(source["pronunciations"])

        for item in candidates:
            if not isinstance(item, dict):
                continue
            dict_name = str(item.get("dictionary") or item.get("dictionaryAlias") or "") or None
            reading = str(item.get("reading", "")).strip()

            sub_pitches = item.get("pitches") if isinstance(item.get("pitches"), list) else []
            if sub_pitches:
                for sp in sub_pitches:
                    if isinstance(sp, dict) and "position" in sp:
                        try:
                            pos = int(sp["position"])
                            pat = YomitanService._pitch_pattern_name(pos, len(reading))
                            nasal = [int(x) for x in sp.get("nasalPositions", []) if isinstance(x, (int, str))]
                            devoice = [int(x) for x in sp.get("devoicePositions", []) if isinstance(x, (int, str))]
                            results.append(PitchAccent(
                                reading=reading,
                                position=pos,
                                pattern_name=pat,
                                nasal_positions=nasal,
                                devoice_positions=devoice,
                                dictionary=dict_name,
                            ))
                        except (ValueError, TypeError):
                            continue
            elif "position" in item:
                try:
                    pos = int(item["position"])
                    pat = YomitanService._pitch_pattern_name(pos, len(reading))
                    nasal = [int(x) for x in item.get("nasalPositions", []) if isinstance(x, (int, str))]
                    devoice = [int(x) for x in item.get("devoicePositions", []) if isinstance(x, (int, str))]
                    results.append(PitchAccent(
                        reading=reading,
                        position=pos,
                        pattern_name=pat,
                        nasal_positions=nasal,
                        devoice_positions=devoice,
                        dictionary=dict_name,
                    ))
                except (ValueError, TypeError):
                    continue
        return results

    @staticmethod
    def _pitch_pattern_name(position: int, mora_count: int = 0) -> str:
        if position == 0:
            return "heiban"
        elif position == 1:
            return "atamadaka"
        elif mora_count > 0 and position == mora_count:
            return "odaka"
        else:
            return "nakadaka"

    @staticmethod
    def _extract_frequencies(source: dict[str, Any]) -> list[FrequencyRank]:
        results: list[FrequencyRank] = []
        freq_list = source.get("frequencies") if isinstance(source.get("frequencies"), list) else []
        for item in freq_list:
            if not isinstance(item, dict):
                continue
            dict_name = str(item.get("dictionary") or item.get("dictionaryAlias") or "Unknown")
            raw_freq = item.get("frequency") if item.get("frequency") is not None else item.get("value")
            freq_val: int | float = 0
            if isinstance(raw_freq, (int, float)):
                freq_val = raw_freq
            elif isinstance(raw_freq, str) and raw_freq.isdigit():
                freq_val = int(raw_freq)

            disp = str(item["displayValue"]).strip() if item.get("displayValue") is not None else (str(freq_val) if freq_val else None)

            raw_rank = item.get("rank")
            rank_val: int | None = None
            if isinstance(raw_rank, int):
                rank_val = raw_rank
            elif isinstance(freq_val, int) and freq_val > 0:
                rank_val = freq_val

            is_common = bool(item.get("isCommon") or (rank_val is not None and rank_val <= 10000) or (disp and "★" in disp))
            results.append(FrequencyRank(
                dictionary=dict_name,
                frequency=freq_val,
                display_value=disp,
                rank=rank_val,
                is_common=is_common,
            ))
        return results

    @staticmethod
    def _definition_senses(definition: dict[str, Any], source_dict: str = "") -> tuple[list[DictionarySense], list[str]]:
        senses: list[DictionarySense] = []
        all_pos: list[str] = []
        entries_list = definition.get("entries") if isinstance(definition.get("entries"), list) else []

        for item in entries_list:
            if isinstance(item, str):
                if text := item.strip():
                    senses.append(DictionarySense(glosses=[text], index=len(senses) + 1))
            elif isinstance(item, dict):
                content = item.get("content") if "content" in item else item
                groups = YomitanService._find_marked(content, "sense-group")
                if groups:
                    for group in groups:
                        group_pos = YomitanService._marked_texts(group, "part-of-speech-info", exclude_marker="sense")
                        all_pos.extend(group_pos)
                        group_tags = (
                            YomitanService._marked_texts(group, "misc-info", exclude_marker="sense")
                            + YomitanService._marked_texts(group, "dialect-info", exclude_marker="sense")
                        )
                        group_field_tags = YomitanService._marked_texts(group, "field-info", exclude_marker="sense")

                        raw_senses = YomitanService._find_marked(group.get("content"), "sense")
                        for raw_sense in raw_senses:
                            sense = YomitanService._normalize_sense(
                                raw_sense,
                                inherited_pos=group_pos,
                                inherited_tags=group_tags,
                                inherited_fields=group_field_tags,
                                sense_index=len(senses) + 1,
                                source_dict=source_dict,
                            )
                            if sense.glosses or sense.notes or sense.examples:
                                senses.append(sense)
                else:
                    direct_senses = YomitanService._find_marked(content, "sense")
                    if direct_senses:
                        for raw_sense in direct_senses:
                            sense = YomitanService._normalize_sense(
                                raw_sense,
                                sense_index=len(senses) + 1,
                                source_dict=source_dict,
                            )
                            if sense.glosses or sense.notes or sense.examples:
                                senses.append(sense)
                    else:
                        sense = YomitanService._normalize_sense(
                            {"content": content},
                            sense_index=len(senses) + 1,
                            source_dict=source_dict,
                        )
                        if sense.glosses or sense.notes or sense.examples:
                            senses.append(sense)

        for s in senses:
            all_pos.extend(s.parts_of_speech)

        return senses, YomitanService._unique(all_pos)

    @staticmethod
    def _normalize_sense(
        node: dict[str, Any],
        inherited_pos: list[str] | None = None,
        inherited_tags: list[str] | None = None,
        inherited_fields: list[str] | None = None,
        sense_index: int = 1,
        source_dict: str = "",
    ) -> DictionarySense:
        content = node.get("content")
        glosses: list[str] = []
        notes: list[str] = []
        examples: list[ExampleSentence] = []

        pos = list(inherited_pos or [])
        pos.extend(YomitanService._marked_texts(content, "part-of-speech-info"))

        tags = list(inherited_tags or [])
        tags.extend(YomitanService._marked_texts(content, "misc-info"))
        tags.extend(YomitanService._marked_texts(content, "dialect-info"))

        field_tags = list(inherited_fields or [])
        field_tags.extend(YomitanService._marked_texts(content, "field-info"))

        for glossary in YomitanService._find_marked(content, "glossary"):
            values = glossary.get("content")
            items = values if isinstance(values, list) else [values]
            for value in items:
                if text := YomitanService._plain_text(value):
                    glosses.append(text)

        if not glosses:
            if text := YomitanService._plain_text(content):
                glosses.append(text)

        for marker in ("note", "sense-note", "see-also", "reference", "xref"):
            notes.extend(YomitanService._marked_texts(content, marker, contains=True))

        for raw in YomitanService._find_marked(content, "example-sentence", contains=True):
            ex_content = raw.get("content")
            raw_a = YomitanService._first_marked_node(ex_content, "example-sentence-a")
            raw_b = YomitanService._first_marked_node(ex_content, "example-sentence-b")

            clean_jp = YomitanService._extract_text(raw_a.get("content") if isinstance(raw_a, dict) else raw_a, include_rt=False)
            ruby_jp = YomitanService._extract_text(raw_a.get("content") if isinstance(raw_a, dict) else raw_a, include_rt=True)
            translation = YomitanService._extract_text(raw_b.get("content") if isinstance(raw_b, dict) else raw_b, include_rt=False)

            if clean_jp:
                examples.append(ExampleSentence(
                    japanese=clean_jp,
                    translation=translation or None,
                    reading=ruby_jp if ruby_jp != clean_jp else None,
                    source_dictionary=source_dict or None,
                ))

        return DictionarySense(
            glosses=YomitanService._unique(glosses),
            tags=YomitanService._unique(tags),
            notes=YomitanService._unique(notes),
            examples=YomitanService._unique_examples(examples),
            parts_of_speech=YomitanService._unique(pos),
            field_tags=YomitanService._unique(field_tags),
            index=sense_index,
        )

    @staticmethod
    def _find_marked(
        value: Any,
        marker: str,
        contains: bool = False,
        exclude_marker: str | None = None,
        depth: int = 0,
    ) -> list[dict[str, Any]]:
        if depth > YomitanService.MAX_AST_DEPTH:
            return []
        found: list[dict[str, Any]] = []
        if isinstance(value, list):
            for item in value:
                found.extend(YomitanService._find_marked(item, marker, contains, exclude_marker, depth + 1))
        elif isinstance(value, dict):
            current = YomitanService._marker(value)
            if exclude_marker and (exclude_marker in current if contains else current == exclude_marker):
                return []
            if (marker in current) if contains else (current == marker):
                found.append(value)
            found.extend(YomitanService._find_marked(value.get("content"), marker, contains, exclude_marker, depth + 1))
        return found

    @staticmethod
    def _first_marked_node(
        value: Any,
        marker: str,
        contains: bool = False,
        exclude_marker: str | None = None,
        depth: int = 0,
    ) -> dict[str, Any] | None:
        nodes = YomitanService._find_marked(value, marker, contains=contains, exclude_marker=exclude_marker, depth=depth)
        return nodes[0] if nodes else None

    @staticmethod
    def _marker(node: dict[str, Any]) -> str:
        data = node.get("data")
        return str(data.get("content", "")).lower() if isinstance(data, dict) else ""

    @staticmethod
    def _marked_texts(value: Any, marker: str, contains: bool = False, exclude_marker: str | None = None) -> list[str]:
        return [
            text
            for item in YomitanService._find_marked(value, marker, contains, exclude_marker=exclude_marker)
            if (text := YomitanService._extract_text(item.get("content"), include_rt=False))
        ]

    @staticmethod
    def _first_marked_text(value: Any, marker: str, exclude_marker: str | None = None) -> str:
        texts = YomitanService._marked_texts(value, marker, exclude_marker=exclude_marker)
        return texts[0] if texts else ""

    @staticmethod
    def _plain_text(value: Any, depth: int = 0) -> str:
        return YomitanService._extract_text(value, include_rt=False, depth=depth)

    @staticmethod
    def _extract_text(value: Any, include_rt: bool = False, depth: int = 0) -> str:
        if depth > YomitanService.MAX_AST_DEPTH:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, list):
            parts = [YomitanService._extract_text(item, include_rt, depth + 1) for item in value]
            return "".join(p for p in parts if p).strip()
        if isinstance(value, dict):
            tag = value.get("tag")
            if not include_rt and tag == "rt":
                return ""
            if include_rt and tag == "rt":
                rt_text = YomitanService._extract_text(value.get("content"), include_rt, depth + 1)
                return f"[{rt_text}]"
            return YomitanService._extract_text(value.get("content"), include_rt, depth + 1)
        return ""

    @staticmethod
    def _tag_names(value: Any) -> list[str]:
        return YomitanService._unique([str(item.get("name", "")) for item in value if isinstance(item, dict)]) if isinstance(value, list) else []

    @staticmethod
    def _unique(values: list[str]) -> list[str]:
        return list(dict.fromkeys(value for value in values if value and value.strip()))

    @staticmethod
    def _unique_examples(values: list[ExampleSentence]) -> list[ExampleSentence]:
        seen = set()
        unique = []
        for item in values:
            key = (item.japanese, item.translation, item.reading)
            if key not in seen:
                seen.add(key)
                unique.append(item)
        return unique

    @staticmethod
    def normalize_kanji_entries_response(payload: Any) -> list[KanjiEntry]:
        if not isinstance(payload, list):
            return []
        normalized: list[KanjiEntry] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            try:
                char = str(raw.get("character", "")).strip()
                if not char:
                    continue
                dict_name = str(raw.get("dictionary") or "Unknown dictionary")
                dict_alias = str(raw["dictionaryAlias"]) if raw.get("dictionaryAlias") else None

                onyomi = YomitanService._unique([str(x).strip() for x in raw.get("onyomi", []) if isinstance(x, (str, int))])
                kunyomi = YomitanService._unique([str(x).strip() for x in raw.get("kunyomi", []) if isinstance(x, (str, int))])
                nanori = YomitanService._unique([str(x).strip() for x in raw.get("nanori", []) if isinstance(x, (str, int))])

                raw_defs = raw.get("definitions") or raw.get("meanings") or []
                meanings: list[str] = []
                if isinstance(raw_defs, list):
                    for item in raw_defs:
                        if isinstance(item, str) and item.strip():
                            meanings.append(item.strip())
                        elif isinstance(item, dict):
                            if text := YomitanService._plain_text(item):
                                meanings.append(text)
                elif isinstance(raw_defs, str) and raw_defs.strip():
                    meanings.append(raw_defs.strip())

                tags = YomitanService._tag_names(raw.get("tags"))

                stats: dict[str, str] = {}
                raw_stats = raw.get("stats")
                if isinstance(raw_stats, dict):
                    for cat, stat_items in raw_stats.items():
                        if isinstance(stat_items, list):
                            for s in stat_items:
                                if isinstance(s, dict) and "name" in s and "value" in s:
                                    stats[str(s["name"])] = str(s["value"])

                frequencies = YomitanService._extract_frequencies(raw)

                entry = KanjiEntry(
                    character=char,
                    dictionary=dict_name,
                    onyomi=onyomi,
                    kunyomi=kunyomi,
                    nanori=nanori,
                    meanings=YomitanService._unique(meanings),
                    tags=tags,
                    stats=stats,
                    dictionary_alias=dict_alias,
                    frequencies=frequencies,
                )
                normalized.append(entry)
            except Exception:
                continue
        return normalized

