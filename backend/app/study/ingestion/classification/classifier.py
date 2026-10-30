"""
Deterministic Question Format and Structural Family Classifier.
---------------------------------------------------------------
Classifies question candidates into one of the 20 authoritative JLPT formats
across families F1–F6 using deterministic instruction parsing and structural cues.
"""
from __future__ import annotations

import re
from typing import Any

from app.study.contracts.enums import (
    JlptLevel,
    QuestionCategory,
    StructuralFamily,
)
from app.study.formats import FORMAT_REGISTRY, FormatMetadata
from app.study.ingestion.models import CandidateClassification, QuestionDraft


# Mapping of instruction patterns to format codes and confidence
INSTRUCTION_RULE_MAP: list[tuple[re.Pattern, str, float]] = [
    # Vocabulary (F1)
    (re.compile(r"言葉の読み方|読み方として最もよいもの"), "kanji_reading", 1.0),
    (re.compile(r"漢字で書くとき|言葉を漢字で"), "orthography", 1.0),
    (re.compile(r"言葉の組み立て|語形成"), "word_formation", 1.0),
    (re.compile(r"意味が最も近いもの|言い換え"), "paraphrases", 1.0),
    (re.compile(r"使い方として最もよいもの|正しい使い方"), "usage", 1.0),
    (re.compile(r"文脈規定"), "contextual_expressions", 1.0),

    # Grammar (F1, F2, F4)
    (re.compile(r"文の組み立て|★に入る|★ に入る"), "sentence_composition", 1.0),
    (re.compile(r"文章の文法|文章全体の趣旨を踏まえて"), "text_grammar", 1.0),
    (re.compile(r"文法形式の判断"), "sentential_grammar_1", 1.0),

    # Reading (F3)
    (re.compile(r"短文読解|内容理解（短文）"), "comprehension_short", 1.0),
    (re.compile(r"中文読解|内容理解（中文）"), "comprehension_mid", 1.0),
    (re.compile(r"長文読解|内容理解（長文）"), "comprehension_long", 1.0),
    (re.compile(r"統合理解.*読解|比較読解"), "integrated_thematic_reading", 1.0),
    (re.compile(r"情報検索"), "information_retrieval", 1.0),

    # Listening (F5, F6)
    (re.compile(r"課題理解"), "task_based_listening", 1.0),
    (re.compile(r"ポイント理解"), "key_points_listening", 1.0),
    (re.compile(r"概要理解"), "general_outline_listening", 1.0),
    (re.compile(r"発話表現"), "verbal_expressions", 1.0),
    (re.compile(r"即時応答"), "quick_response", 1.0),
    (re.compile(r"統合理解.*聴解|音声.*統合"), "listening_integrated", 1.0),
]


class FormatClassifier:
    """Classifies question drafts into authoritative JLPT formats and families."""

    def classify(
        self,
        draft: QuestionDraft,
        default_level: JlptLevel | None = None,
        has_audio: bool = False,
        group_type: str | None = None,
    ) -> CandidateClassification:
        """
        Classify a question draft based on instruction text, section header,
        structural characteristics, and registry constraints.
        """
        matched_rules: list[str] = []

        # 1. Determine JLPT level
        level = self._resolve_level(draft, default_level)

        # 2. Check if format_code was explicitly provided (e.g. in JSON or section header)
        if draft.section_header and draft.section_header in FORMAT_REGISTRY:
            fmt_code = draft.section_header
            matched_rules.append(f"explicit_format_header:{fmt_code}")
            return self._build_classification(fmt_code, level, 1.0, "Explicit format code in header", matched_rules)

        # 3. Check instruction cues
        combined_header = f"{draft.section_header} {draft.instruction_text}".strip()
        for pattern, fmt_code, conf in INSTRUCTION_RULE_MAP:
            if pattern.search(combined_header):
                matched_rules.append(f"instruction_match:{pattern.pattern}")
                # Verify level compatibility
                fmt_meta = FORMAT_REGISTRY[fmt_code]
                if level.value in fmt_meta.allowed_levels:
                    return self._build_classification(
                        fmt_code, level, conf, f"Matched instruction pattern: {pattern.pattern}", matched_rules
                    )
                else:
                    # e.g. word_formation on N3 -> fallback to contextual_expressions
                    fallback_code = self._resolve_level_fallback(fmt_code, level)
                    matched_rules.append(f"level_incompatible_fallback:{fmt_code}->{fallback_code}")
                    return self._build_classification(
                        fallback_code, level, 0.75, f"Level {level.value} incompatible with {fmt_code}, fell back to {fallback_code}", matched_rules
                    )

        # 4. Structural cues: Sentence Composition (F2) with {star}
        if "{star}" in draft.raw_stem or "★" in draft.raw_stem or "☆" in draft.raw_stem:
            matched_rules.append("structural_star_marker")
            return self._build_classification(
                "sentence_composition", level, 0.95, "Stem contains sentence composition star marker", matched_rules
            )

        # 5. Structural cues: Text Grammar (F4) with blank anchor in passage
        if draft.group_reference and draft.anchor_key and group_type == "passage":
            # Check if instruction or section hints at grammar
            if "文法" in combined_header or "grammar" in combined_header.lower():
                matched_rules.append("group_blank_anchor_grammar")
                return self._build_classification(
                    "text_grammar", level, 0.9, "Question references blank anchor in text grammar passage", matched_rules
                )

        # 6. Reading comprehension (F3) if part of a passage
        if draft.group_reference and group_type in ("passage", "integrated_passage", "document_set"):
            matched_rules.append("passage_reading_question")
            # Default to short reading unless specified
            return self._build_classification(
                "comprehension_short", level, 0.8, "Question associated with reading passage", matched_rules
            )

        # 7. Listening cues (F5, F6)
        if has_audio or "listening" in combined_header.lower() or "聴解" in combined_header:
            matched_rules.append("audio_listening_cues")
            if draft.group_reference and group_type == "audio_context":
                return self._build_classification(
                    "listening_integrated", level, 0.9, "Audio context group listening question", matched_rules
                )
            if len(draft.raw_choices) == 3:
                return self._build_classification(
                    "quick_response", level, 0.85, "Listening question with 3 choices", matched_rules
                )
            return self._build_classification(
                "task_based_listening", level, 0.8, "Individual audio listening question", matched_rules
            )

        # 8. Section cues from header (grammar, vocabulary, kanji)
        sec_h = combined_header.lower()
        if "grammar" in sec_h or "bunpou" in sec_h or "文法" in combined_header:
            matched_rules.append("header_grammar_sentential")
            return self._build_classification(
                "sentential_grammar_1", level, 0.75, "Section indicates grammar format", matched_rules
            )
        if "vocab" in sec_h or "goi" in sec_h or "語彙" in combined_header:
            has_kanji = any(bool(re.search(r"[\u4E00-\u9FFF]", c.text)) for c in draft.raw_choices if c.text)
            if ("{u|" in draft.raw_stem or "___" in draft.raw_stem) and has_kanji:
                matched_rules.append("header_vocab_orthography")
                return self._build_classification(
                    "orthography", level, 0.75, "Vocab section with kanji choices", matched_rules
                )
            matched_rules.append("header_vocab_contextual")
            return self._build_classification(
                "contextual_expressions", level, 0.75, "Section indicates vocabulary contextual expressions", matched_rules
            )
        if "kanji" in sec_h or "漢字" in combined_header:
            has_kanji = any(bool(re.search(r"[\u4E00-\u9FFF]", c.text)) for c in draft.raw_choices if c.text)
            if has_kanji:
                matched_rules.append("header_kanji_orthography")
                return self._build_classification(
                    "orthography", level, 0.75, "Kanji section with kanji choices", matched_rules
                )
            matched_rules.append("header_kanji_reading")
            return self._build_classification(
                "kanji_reading", level, 0.75, "Kanji section with kana reading choices", matched_rules
            )

        # 9. Vocabulary vs Grammar (F1) fallback
        if "{u|" in draft.raw_stem or "___" in draft.raw_stem:
            # Underline target
            # If choices are all kana -> likely kanji_reading
            all_kana = all(
                bool(re.match(r"^[\u3040-\u309F\u30A0-\u30FF\s]+$", c.text.strip()))
                for c in draft.raw_choices
                if c.text
            )
            all_kanji = all(
                bool(re.search(r"[\u4E00-\u9FFF]", c.text))
                for c in draft.raw_choices
                if c.text
            )

            if all_kana and draft.raw_choices:
                matched_rules.append("underline_with_kana_choices")
                return self._build_classification(
                    "kanji_reading", level, 0.85, "Underline prompt with kana choices", matched_rules
                )
            elif all_kanji and draft.raw_choices and level in (JlptLevel.N2, JlptLevel.N3, JlptLevel.N4, JlptLevel.N5):
                matched_rules.append("underline_with_kanji_choices")
                return self._build_classification(
                    "orthography", level, 0.85, "Underline prompt with kanji choices", matched_rules
                )
            else:
                matched_rules.append("underline_generic_contextual")
                return self._build_classification(
                    "contextual_expressions", level, 0.7, "Underline prompt with general vocabulary choices", matched_rules
                )

        # 9. Generic blank ( ) -> sentential_grammar_1 or contextual_expressions
        if "（" in draft.raw_stem or "(" in draft.raw_stem or "___" in draft.raw_stem:
            matched_rules.append("blank_stem_fallback")
            return self._build_classification(
                "sentential_grammar_1", level, 0.65, "Stem contains blank target, defaulted to grammar", matched_rules
            )

        # 10. Fallback: Kanji reading with low confidence
        matched_rules.append("generic_fallback")
        return self._build_classification(
            "kanji_reading", level, 0.4, "Could not confidently classify question format", matched_rules
        )

    def _resolve_level(self, draft: QuestionDraft, default_level: JlptLevel | None) -> JlptLevel:
        """Resolve JLPT level from draft text or default."""
        if default_level is not None:
            return default_level

        text_to_search = f"{draft.section_header} {draft.instruction_text}"
        match = re.search(r"\b(N[1-5])\b", text_to_search, re.IGNORECASE)
        if match:
            lvl_str = match.group(1).upper()
            try:
                return JlptLevel(lvl_str)
            except ValueError:
                pass

        return JlptLevel.N5  # safe default

    def _resolve_level_fallback(self, fmt_code: str, level: JlptLevel) -> str:
        """Resolve fallback format if level does not support desired format."""
        if fmt_code == "word_formation":
            return "contextual_expressions"
        if fmt_code == "comprehension_long" and level.value not in FORMAT_REGISTRY["comprehension_long"].allowed_levels:
            return "comprehension_mid"
        if fmt_code == "integrated_thematic_reading" and level.value not in FORMAT_REGISTRY["integrated_thematic_reading"].allowed_levels:
            return "comprehension_mid"
        if fmt_code == "listening_integrated" and level.value not in FORMAT_REGISTRY["listening_integrated"].allowed_levels:
            return "task_based_listening"
        return "contextual_expressions"

    def _build_classification(
        self,
        format_code: str,
        level: JlptLevel,
        confidence: float,
        reasoning: str,
        matched_rules: list[str],
    ) -> CandidateClassification:
        meta = FORMAT_REGISTRY[format_code]
        return CandidateClassification(
            format_code=format_code,
            structural_family=StructuralFamily(meta.structural_family),
            category=QuestionCategory(meta.category),
            level=level,
            confidence=confidence,
            reasoning=reasoning,
            matched_rules=matched_rules,
        )

