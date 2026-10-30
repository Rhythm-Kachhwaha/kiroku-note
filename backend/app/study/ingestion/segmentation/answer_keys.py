"""
Answer Key Parser for Extracting Source Answers.
------------------------------------------------
Extracts and normalizes correct answer declarations from inline stems,
trailing answer tables, or external key payloads without guessing.
"""
from __future__ import annotations

import re
from typing import Any

from app.study.ingestion.segmentation.patterns import (
    ANSWER_KEY_SECTION_RE,
    INLINE_ANSWER_RE,
    normalize_label,
)


class AnswerKeyParser:
    """Deterministic extractor and normalizer for answer keys."""

    @staticmethod
    def extract_inline_answer(text: str) -> tuple[str, int | None, str | None]:
        """
        Check for an inline answer in question text (e.g. '正解: 2').

        Returns:
            (cleaned_text_without_answer, correct_ordinal, raw_answer_string)
        """
        match = INLINE_ANSWER_RE.search(text)
        if not match:
            return text, None, None

        raw_val = match.group(1)
        normalized = normalize_label(raw_val)
        try:
            ordinal = int(normalized)
        except ValueError:
            ordinal = None

        # Clean answer declaration from text
        cleaned_text = text[:match.start()] + text[match.end():]
        cleaned_text = cleaned_text.strip()
        return cleaned_text, ordinal, raw_val

    @classmethod
    def parse_answer_key_section(cls, text: str) -> dict[str, int]:
        """
        Parse a dedicated answer key text section or block into a question_ref -> correct_ordinal map.

        Supported patterns:
        - 問1: 2, 問2: 4, 問3: 1
        - 1: 2, 2: 4, 3: 1
        - 1 - 2, 2 - 4, 3 - 1
        - 1-2  2-4  3-1
        - Q1: 2
        """
        result: dict[str, int] = {}
        # Find start of answer key section if present
        section_match = ANSWER_KEY_SECTION_RE.search(text)
        target_text = text[section_match.start():] if section_match else text

        # Pattern 1: 問1: 2 or Q1: 2 or 1: 2
        pair_pattern = re.compile(
            r"(?:問|Q)?\s*([0-9０-９]+)\s*[:：\-=\s]\s*([1-4１-４①-④アイウエ])",
            re.MULTILINE,
        )

        for match in pair_pattern.finditer(target_text):
            q_num_raw = match.group(1)
            ans_raw = match.group(2)

            q_num = normalize_label(q_num_raw)
            ans_norm = normalize_label(ans_raw)
            try:
                ans_ord = int(ans_norm)
                result[q_num] = ans_ord
            except ValueError:
                pass

        return result

    @classmethod
    def normalize_external_answer_key(cls, payload: dict[str, Any] | list[Any]) -> dict[str, int]:
        """Normalize an explicitly supplied answer key dict or list."""
        result: dict[str, int] = {}

        if isinstance(payload, dict):
            for k, v in payload.items():
                k_norm = normalize_label(str(k))
                v_norm = normalize_label(str(v))
                try:
                    result[k_norm] = int(v_norm)
                except ValueError:
                    pass

        elif isinstance(payload, list):
            for idx, item in enumerate(payload, start=1):
                v_norm = normalize_label(str(item))
                try:
                    result[str(idx)] = int(v_norm)
                except ValueError:
                    pass

        return result

