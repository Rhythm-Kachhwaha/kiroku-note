"""
normalizer.py -- Unified dictionary AST parser, sense normalizer, and meaning synthesizer.

Single-sources AST traversal, parts-of-speech extraction, cross-reference parsing,
and default meaning synthesis across local Yomitan and cloud queue backends.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

from .lookup import TermHeadwordGroup

MAX_AST_DEPTH = 32

DISFAVORED_TAGS = {
    "vulgar",
    "slang",
    "derogatory",
    "obscure",
    "rare",
    "archaic",
    "crude",
    "sensitive",
}


@dataclass(frozen=True)
class CrossReference:
    target_term: str
    display_text: str
    target_reading: str | None = None
    target_sense_index: int | None = None


@dataclass(frozen=True)
class ExampleSentence:
    japanese: str
    translation: str | None = None
    reading: str | None = None
    source_dictionary: str | None = None


@dataclass(frozen=True)
class DictionarySense:
    glosses: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    examples: list[ExampleSentence] = field(default_factory=list)
    parts_of_speech: list[str] = field(default_factory=list)
    field_tags: list[str] = field(default_factory=list)
    cross_references: list[CrossReference] = field(default_factory=list)
    index: int = 1
    group_index: int = 1


def extract_text_from_node(value: Any, include_rt: bool = False, depth: int = 0, join_char: str = "") -> str:
    """Recursively extract plain text from Yomitan/Jitendex AST node."""
    if depth > MAX_AST_DEPTH:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    if isinstance(value, list):
        parts = [extract_text_from_node(item, include_rt, depth + 1, join_char) for item in value]
        return join_char.join(p for p in parts if p).strip()
    if isinstance(value, dict):
        tag = value.get("tag")
        if not include_rt and tag in ("rt", "rp"):
            return ""
        if include_rt and tag == "rt":
            rt_text = extract_text_from_node(value.get("content"), include_rt, depth + 1, join_char)
            return f"[{rt_text}]"
        return extract_text_from_node(value.get("content"), include_rt, depth + 1, join_char)
    return ""


def find_marked_nodes(
    value: Any,
    marker: str,
    contains: bool = False,
    exclude_marker: str | None = None,
    depth: int = 0,
) -> list[dict[str, Any]]:
    """Locate nodes tagged with data.content matching marker."""
    if depth > MAX_AST_DEPTH:
        return []
    found: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            found.extend(find_marked_nodes(item, marker, contains, exclude_marker, depth + 1))
    elif isinstance(value, dict):
        data = value.get("data")
        current = str(data.get("content", "")).lower() if isinstance(data, dict) else ""
        if exclude_marker and (exclude_marker in current if contains else current == exclude_marker):
            return []
        if (marker in current) if contains else (current == marker):
            found.append(value)
        found.extend(find_marked_nodes(value.get("content"), marker, contains, exclude_marker, depth + 1))
    return found


def marked_texts(value: Any, marker: str, contains: bool = False, exclude_marker: str | None = None) -> list[str]:
    """Extract plain text of all nodes matching data.content marker."""
    results: list[str] = []
    for item in find_marked_nodes(value, marker, contains, exclude_marker=exclude_marker):
        text = extract_text_from_node(item.get("content"), include_rt=False)
        if text and text not in results:
            results.append(text)
    return results


def find_by_tag(value: Any, tag_name: str, depth: int = 0) -> list[dict[str, Any]]:
    """Locate nodes with matching HTML tag recursively."""
    if depth > MAX_AST_DEPTH:
        return []
    found: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            found.extend(find_by_tag(item, tag_name, depth + 1))
    elif isinstance(value, dict):
        if value.get("tag") == tag_name:
            found.append(value)
        found.extend(find_by_tag(value.get("content"), tag_name, depth + 1))
    return found


def extract_cross_reference(node: dict[str, Any]) -> CrossReference | None:
    """Parse structured cross reference AST node into CrossReference."""
    a_nodes = find_by_tag(node, "a")
    target_term = ""
    target_reading: str | None = None

    if a_nodes:
        a_node = a_nodes[0]
        target_term = extract_text_from_node(a_node.get("content"), include_rt=False)
        href = str(a_node.get("href") or "")
        if href:
            parsed_qs = parse_qs(urlparse(href).query)
            if not target_term and parsed_qs.get("query"):
                target_term = parsed_qs["query"][0].strip()
            if parsed_qs.get("primary_reading"):
                target_reading = parsed_qs["primary_reading"][0].strip() or None

        if not target_reading:
            rt_nodes = find_by_tag(a_node, "rt")
            if rt_nodes:
                rt_text = "".join(extract_text_from_node(rt.get("content"), include_rt=False) for rt in rt_nodes).strip()
                if rt_text:
                    target_reading = rt_text

    label = marked_texts(node, "reference-label")
    glossary = marked_texts(node, "xref-glossary")

    if not target_term:
        plain = extract_text_from_node(node)
        if not plain:
            return None
        target_term = plain

    parts: list[str] = []
    if label:
        parts.append(label[0])
    if target_term:
        parts.append(target_term)
    if glossary:
        parts.append(glossary[0])

    display_text = " ".join(parts).strip() or target_term

    return CrossReference(
        target_term=target_term,
        display_text=display_text,
        target_reading=target_reading,
        target_sense_index=None,
    )


def extract_senses_from_glossary(
    glossary_items: Any,
    source_dict: str = "Jitendex",
) -> tuple[list[DictionarySense], list[str]]:
    """
    Parse Jitendex / Yomitan structured glossary AST into structured DictionarySense objects
    grouped by sense-group, preserving real parts-of-speech, tags, notes, xrefs, and examples.
    """
    senses: list[DictionarySense] = []
    all_pos: list[str] = []
    if not isinstance(glossary_items, list):
        glossary_items = [glossary_items]

    group_counter = 0

    for item in glossary_items:
        if isinstance(item, str):
            if text := item.strip():
                senses.append(DictionarySense(glosses=[text], index=len(senses) + 1, group_index=1))
        elif isinstance(item, dict):
            content = item.get("content") if "content" in item else item
            groups = find_marked_nodes(content, "sense-group")
            if groups:
                for group in groups:
                    group_counter += 1
                    group_pos = marked_texts(group, "part-of-speech-info", exclude_marker="sense")
                    all_pos.extend(group_pos)
                    group_tags = (
                        marked_texts(group, "misc-info", exclude_marker="sense")
                        + marked_texts(group, "dialect-info", exclude_marker="sense")
                    )
                    group_field_tags = marked_texts(group, "field-info", exclude_marker="sense")

                    raw_senses = find_marked_nodes(group.get("content"), "sense")
                    for raw_sense in raw_senses:
                        sense = _normalize_sense_node(
                            raw_sense,
                            inherited_pos=group_pos,
                            inherited_tags=group_tags,
                            inherited_fields=group_field_tags,
                            sense_index=len(senses) + 1,
                            group_index=group_counter,
                            source_dict=source_dict,
                        )
                        if sense.glosses or sense.notes or sense.examples:
                            senses.append(sense)
            else:
                direct_senses = find_marked_nodes(content, "sense")
                if direct_senses:
                    group_counter += 1
                    for raw_sense in direct_senses:
                        sense = _normalize_sense_node(
                            raw_sense,
                            sense_index=len(senses) + 1,
                            group_index=group_counter,
                            source_dict=source_dict,
                        )
                        if sense.glosses or sense.notes or sense.examples:
                            senses.append(sense)
                else:
                    group_counter += 1
                    sense = _normalize_sense_node(
                        {"content": content},
                        sense_index=len(senses) + 1,
                        group_index=group_counter,
                        source_dict=source_dict,
                    )
                    if sense.glosses or sense.notes or sense.examples:
                        senses.append(sense)

    for s in senses:
        all_pos.extend(s.parts_of_speech)

    unique_pos = list(dict.fromkeys(p for p in all_pos if p and p.strip()))
    return senses, unique_pos


def _normalize_sense_node(
    node: dict[str, Any],
    inherited_pos: list[str] | None = None,
    inherited_tags: list[str] | None = None,
    inherited_fields: list[str] | None = None,
    sense_index: int = 1,
    group_index: int = 1,
    source_dict: str = "",
) -> DictionarySense:
    content = node.get("content")
    glosses: list[str] = []
    notes: list[str] = []
    examples: list[ExampleSentence] = []

    pos = list(inherited_pos or [])
    pos.extend(marked_texts(content, "part-of-speech-info"))

    tags = list(inherited_tags or [])
    tags.extend(marked_texts(content, "misc-info"))
    tags.extend(marked_texts(content, "dialect-info"))

    field_tags = list(inherited_fields or [])
    field_tags.extend(marked_texts(content, "field-info"))

    for glossary in find_marked_nodes(content, "glossary"):
        values = glossary.get("content")
        items = values if isinstance(values, list) else [values]
        for value in items:
            if text := extract_text_from_node(value, include_rt=False):
                if text not in glosses:
                    glosses.append(text)

    if not glosses:
        if text := extract_text_from_node(content, include_rt=False):
            if text not in glosses:
                glosses.append(text)

    for marker in ("note", "sense-note"):
        for n in marked_texts(content, marker, contains=True):
            if n not in notes:
                notes.append(n)

    cross_references: list[CrossReference] = []
    for raw_xref in (find_marked_nodes(content, "see-also") + find_marked_nodes(content, "reference") + find_marked_nodes(content, "xref")):
        xref_obj = extract_cross_reference(raw_xref)
        if xref_obj and xref_obj not in cross_references:
            cross_references.append(xref_obj)

    for raw in find_marked_nodes(content, "example-sentence", contains=True):
        ex_content = raw.get("content")
        raw_a = find_marked_nodes(ex_content, "example-sentence-a")
        raw_b = find_marked_nodes(ex_content, "example-sentence-b")

        clean_jp = extract_text_from_node(raw_a[0].get("content") if raw_a and isinstance(raw_a[0], dict) else (raw_a[0] if raw_a else ""), include_rt=False)
        ruby_jp = extract_text_from_node(raw_a[0].get("content") if raw_a and isinstance(raw_a[0], dict) else (raw_a[0] if raw_a else ""), include_rt=True)
        translation = extract_text_from_node(raw_b[0].get("content") if raw_b and isinstance(raw_b[0], dict) else (raw_b[0] if raw_b else ""), include_rt=False)
        if translation:
            translation = re.sub(r"\[\d+\]", "", translation).strip()

        if clean_jp:
            ex = ExampleSentence(
                japanese=clean_jp,
                translation=translation or None,
                reading=ruby_jp if ruby_jp != clean_jp else None,
                source_dictionary=source_dict or None,
            )
            if ex not in examples:
                examples.append(ex)

    return DictionarySense(
        glosses=glosses,
        tags=list(dict.fromkeys(tags)),
        notes=list(dict.fromkeys(notes)),
        examples=examples,
        parts_of_speech=list(dict.fromkeys(pos)),
        field_tags=list(dict.fromkeys(field_tags)),
        cross_references=cross_references,
        index=sense_index,
        group_index=group_index,
    )


def synthesize_default_meaning(
    target: list[Any],
    max_senses: int = 5,
    exclude_disfavored: bool = True,
    kanji_entries: list[Any] | None = None,
) -> str:
    """
    Synthesize a clean, multi-sense default meaning string for card creation.
    Accepts either a list of DictionarySense objects OR a list of DictionaryEntry objects.
    - Excludes vulgar/slang/obscure senses unless no other senses exist.
    - Prioritizes early sense-groups.
    - Deduplicates identical or case-insensitive gloss sets.
    - Formats as numbered lines for polysemous words or single line for single sense.
    """
    if not target:
        if kanji_entries:
            for k in kanji_entries:
                meanings = k.meanings if hasattr(k, "meanings") else (k.get("meanings") if isinstance(k, dict) else [])
                if meanings:
                    return ", ".join(meanings)
        return ""

    # Check if target is a list of DictionaryEntry objects
    if hasattr(target[0], "senses"):
        # Select target entry (primary with glosses or first with glosses)
        target_entry = next(
            (e for e in target if getattr(e, "is_primary", False) and any(any(g.strip() for g in s.glosses) for s in e.senses)),
            next((e for e in target if any(any(g.strip() for g in s.glosses) for s in e.senses)), None),
        )
        if not target_entry:
            if kanji_entries:
                for k in kanji_entries:
                    meanings = k.meanings if hasattr(k, "meanings") else (k.get("meanings") if isinstance(k, dict) else [])
                    if meanings:
                        return ", ".join(meanings)
            return ""
        senses = target_entry.senses
    else:
        senses = target

    eligible = senses
    if exclude_disfavored:
        filtered = [
            s for s in senses
            if not any(str(t).lower() in DISFAVORED_TAGS for t in getattr(s, "tags", []))
        ]
        if filtered:
            eligible = filtered

    # Further prioritize group 1 if it has rich glosses
    group1 = [s for s in eligible if getattr(s, "group_index", 1) == 1]
    candidates = group1 if group1 else eligible

    valid_senses: list[list[str]] = []
    seen_gloss_sets: list[set[str]] = []

    for sense in candidates:
        clean_glosses = [g.strip() for g in sense.glosses if g and g.strip()]
        if not clean_glosses:
            continue
        gloss_set = {g.lower() for g in clean_glosses}
        if gloss_set in seen_gloss_sets:
            continue
        seen_gloss_sets.append(gloss_set)
        valid_senses.append(clean_glosses[:4])  # Cap 4 glosses per sense
        if len(valid_senses) >= max_senses:
            break

    if not valid_senses:
        if kanji_entries:
            for k in kanji_entries:
                meanings = k.meanings if hasattr(k, "meanings") else (k.get("meanings") if isinstance(k, dict) else [])
                if meanings:
                    return ", ".join(meanings)
        return ""

    if len(valid_senses) == 1:
        return ", ".join(valid_senses[0])

    lines: list[str] = []
    for idx, g_list in enumerate(valid_senses, 1):
        lines.append(f"{idx}. {', '.join(g_list)}")
    return "\n".join(lines)


def format_normalized_entry(
    group: TermHeadwordGroup,
    jlpt_level: str | None = None,
    kanji_entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Format a TermHeadwordGroup into a comprehensive, API-ready dictionary response
    including structured senses, real parts-of-speech, and synthesized default meaning.
    """
    all_senses: list[DictionarySense] = []
    all_pos: list[str] = []

    for d in group.definitions:
        senses, pos_list = extract_senses_from_glossary(d.glossary, source_dict=d.dictionary)
        all_senses.extend(senses)
        all_pos.extend(pos_list)

    unique_pos = list(dict.fromkeys(p for p in all_pos if p and p.strip()))

    # Build plain gloss list for backward-compatibility
    plain_glosses: list[str] = []
    for s in all_senses:
        for g in s.glosses:
            if g not in plain_glosses:
                plain_glosses.append(g)

    # Collect examples
    all_examples: list[dict[str, str]] = []
    for s in all_senses:
        for ex in s.examples:
            ex_dict = {"japanese": ex.japanese, "translation": ex.translation or ""}
            if ex_dict not in all_examples:
                all_examples.append(ex_dict)

    default_meaning = synthesize_default_meaning(all_senses)
    first_rules = group.definitions[0].rules if group.definitions else ""

    formatted_senses = [
        {
            "index": s.index,
            "group_index": s.group_index,
            "pos": s.parts_of_speech,
            "misc": s.tags,
            "glosses": s.glosses,
            "notes": s.notes,
            "xrefs": [
                {
                    "target_term": xr.target_term,
                    "display_text": xr.display_text,
                    "target_reading": xr.target_reading,
                }
                for xr in s.cross_references
            ],
            "examples": [
                {
                    "japanese": ex.japanese,
                    "translation": ex.translation or "",
                    "reading": ex.reading or "",
                }
                for ex in s.examples
            ],
        }
        for s in all_senses
    ]

    return {
        "expression": group.term,
        "reading": group.reading,
        "source": group.source,
        "deinflected": group.term,
        "rules": first_rules,
        "jlpt_level": jlpt_level,
        "parts_of_speech": unique_pos,
        "meanings": plain_glosses,
        "default_meaning": default_meaning,
        "senses": formatted_senses,
        "kanji_entries": kanji_entries or [],
        "example_sentence": all_examples[0]["japanese"] if all_examples else "",
        "example_translation": all_examples[0]["translation"] if all_examples else "",
        "examples": all_examples,
    }
