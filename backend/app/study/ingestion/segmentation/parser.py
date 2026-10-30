"""
Deterministic Text and Document Segmenter.
------------------------------------------
Decomposes extracted document text into structured QuestionDraft and GroupDraft
entities by identifying problem headers, instructions, passages, question stems,
choices, and answer references.
"""
from __future__ import annotations

import re
from typing import Any

from app.study.contracts.enums import ChoiceMode
from app.study.ingestion.models import (
    ChoiceDraft,
    ExtractedDocument,
    GroupDraft,
    QuestionDraft,
)
from app.study.ingestion.segmentation.answer_keys import AnswerKeyParser
from app.study.ingestion.segmentation.patterns import (
    ANSWER_KEY_SECTION_RE,
    BLANK_ANCHOR_RE,
    CIRCLED_CHOICE_SPLIT_RE,
    FULL_WIDTH_DIGITS,
    INLINE_ANSWER_RE,
    INSTRUCTION_CUES,
    KATAKANA_CHOICE_SPLIT_RE,
    NUMBERED_CHOICE_LINE_RE,
    PAREN_CHOICE_SPLIT_RE,
    QUESTION_START_RE,
    SECTION_HEADER_RE,
    STAR_MARKER_RE,
    UNDERLINE_RAW_RE,
    normalize_label,
)


class TextSegmenter:
    """Deterministic segmenter converting extracted text into candidate drafts."""

    def __init__(self) -> None:
        self._answer_key_parser = AnswerKeyParser()

    def segment(self, doc: ExtractedDocument) -> tuple[list[QuestionDraft], list[GroupDraft]]:
        """
        Segment an ExtractedDocument into QuestionDraft and GroupDraft lists.
        """
        # 1. If structured JSON was already provided in metadata, unpack directly
        if doc.metadata.get("raw_questions") or doc.metadata.get("raw_groups"):
            return self._segment_from_structured_metadata(doc)

        # 2. Extract separate answer key if present at document end
        ak_match = ANSWER_KEY_SECTION_RE.search(doc.raw_text)
        answer_key: dict[str, int] = {}
        if ak_match:
            answer_key = self._answer_key_parser.parse_answer_key_section(doc.raw_text)
            text_for_parsing = doc.raw_text[:ak_match.start()].strip()
        else:
            text_for_parsing = doc.raw_text

        if doc.metadata.get("answers"):
            external_answers = self._answer_key_parser.normalize_external_answer_key(doc.metadata["answers"])
            answer_key.update(external_answers)

        # 3. Parse by sections and problem blocks
        return self._segment_raw_text(text_for_parsing, doc, answer_key)

    def _segment_from_structured_metadata(
        self,
        doc: ExtractedDocument,
    ) -> tuple[list[QuestionDraft], list[GroupDraft]]:
        """Segment directly from structured JSON payloads."""
        questions: list[QuestionDraft] = []
        groups: list[GroupDraft] = []

        # Parse raw groups
        raw_groups = doc.metadata.get("raw_groups", [])
        for g_idx, g_dict in enumerate(raw_groups, start=1):
            g_ref = g_dict.get("id") or g_dict.get("external_id") or f"group_{g_idx}"
            raw_body = g_dict.get("body_markup") or g_dict.get("raw_body") or g_dict.get("text") or ""
            parts = g_dict.get("parts", [])
            if not parts and raw_body:
                parts = [{"ordinal": 1, "role": "text", "markup": raw_body}]

            anchors = g_dict.get("anchors", [])
            groups.append(
                GroupDraft(
                    draft_id=str(g_ref),
                    group_type=g_dict.get("group_type") or g_dict.get("kind", "passage"),
                    title=g_dict.get("title", ""),
                    raw_body=raw_body,
                    parts=parts,
                    anchors=anchors,
                    page_number=g_dict.get("page_number", 1),
                    raw_source_text=str(g_dict),
                )
            )

        # Parse raw questions
        raw_questions = doc.metadata.get("raw_questions", [])
        for q_idx, q_dict in enumerate(raw_questions, start=1):
            stem = q_dict.get("prompt_markup") or q_dict.get("stem_markup") or q_dict.get("stem") or ""
            instruction = q_dict.get("instruction_text") or q_dict.get("instruction") or ""

            # Parse choices
            choices_draft: list[ChoiceDraft] = []
            raw_choices = q_dict.get("choices", [])
            for c_idx, c_item in enumerate(raw_choices, start=1):
                if isinstance(c_item, dict):
                    mode_val = c_item.get("mode", ChoiceMode.TEXT)
                    if isinstance(mode_val, str):
                        try:
                            mode_val = ChoiceMode(mode_val.lower())
                        except ValueError:
                            mode_val = ChoiceMode.TEXT

                    choices_draft.append(
                        ChoiceDraft(
                            ordinal=c_item.get("ordinal", c_idx),
                            label=str(c_item.get("label", c_idx)),
                            text=c_item.get("text_markup") or c_item.get("text") or "",
                            mode=mode_val,
                            asset_id=c_item.get("asset_id"),
                        )
                    )
                elif isinstance(c_item, str):
                    choices_draft.append(
                        ChoiceDraft(
                            ordinal=c_idx,
                            label=str(c_idx),
                            text=c_item,
                            mode=ChoiceMode.TEXT,
                        )
                    )

            # Determine answer claim
            ans_val = q_dict.get("answer")
            ans_key: str | int | None = None
            if isinstance(ans_val, dict):
                ans_key = ans_val.get("choice_key") or ans_val.get("choice_id") or ans_val.get("ordinal")
            elif isinstance(ans_val, (str, int)):
                ans_key = ans_val

            # Also check if choice has is_correct = True
            if ans_key is None:
                for c_item in raw_choices:
                    if isinstance(c_item, dict) and c_item.get("is_correct"):
                        ans_key = c_item.get("ordinal") or c_item.get("label") or c_item.get("choice_key")
                        break

            q_id = q_dict.get("id") or q_dict.get("external_id") or f"q_{q_idx}"
            questions.append(
                QuestionDraft(
                    draft_id=str(q_id),
                    section_header=q_dict.get("format_code", ""),
                    instruction_text=instruction,
                    raw_stem=stem,
                    raw_choices=choices_draft,
                    source_answer_key=ans_key,
                    group_reference=q_dict.get("content_group_id") or q_dict.get("group_reference"),
                    group_ordinal=q_dict.get("group_ordinal"),
                    anchor_key=q_dict.get("anchor_key"),
                    page_number=q_dict.get("page_number", 1),
                    raw_source_text=str(q_dict),
                )
            )

        return questions, groups

    def _segment_raw_text(
        self,
        text: str,
        doc: ExtractedDocument,
        answer_key: dict[str, int],
    ) -> tuple[list[QuestionDraft], list[GroupDraft]]:
        """Segment raw unformatted or semi-formatted text lines."""
        questions: list[QuestionDraft] = []
        groups: list[GroupDraft] = []

        lines = text.split("\n")
        current_section = ""
        current_instruction = ""
        current_passage_lines: list[str] = []
        current_group: GroupDraft | None = None
        in_passage = False

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                continue

            # Check for section header (e.g. 問題1, 問題2)
            sec_match = SECTION_HEADER_RE.match(line)
            if sec_match:
                current_section = line
                # If there's following instruction on same or next line, grab it
                after_header = line[sec_match.end():].strip()
                if after_header and any(cue in after_header for cue in INSTRUCTION_CUES):
                    current_instruction = after_header
                elif i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if any(cue in next_line for cue in INSTRUCTION_CUES):
                        current_instruction = next_line
                        i += 1
                i += 1
                continue

            # Check for passage start cue
            if ("次の文章を読んで" in line or "【文章】" in line or "〔文章〕" in line) and not in_passage:
                in_passage = True
                current_instruction = line
                passage_title = line
                current_passage_lines = []
                g_id = f"passage_{len(groups) + 1}"
                current_group = GroupDraft(
                    draft_id=g_id,
                    group_type="passage",
                    title=passage_title,
                    raw_body="",
                    parts=[],
                    anchors=[],
                    page_number=1,
                )
                groups.append(current_group)
                i += 1
                continue

            # Check if this line starts a question (e.g. "1 ", "問1", "（1）")
            q_match = QUESTION_START_RE.match(line)
            is_choice_line = False
            if q_match:
                rest = line[q_match.end():].strip()
                if self._contains_multiple_choices(line) and not self._contains_multiple_choices(rest):
                    is_choice_line = True

            if q_match and not is_choice_line and not INLINE_ANSWER_RE.search(line):
                # If we were collecting passage lines, finalize the passage body
                if in_passage and current_group and not current_group.raw_body:
                    body = "\n".join(current_passage_lines).strip()
                    body = re.sub(r"\[\s*([0-9０-９]+)\s*\]", r"{blank|\1}", body)
                    current_group.raw_body = body
                    # Extract any blank anchors from passage body (e.g. [ 25 ] or 【35】)
                    anchors = self._extract_passage_anchors(body)
                    current_group.anchors = anchors
                    current_group.parts = [{"ordinal": 1, "role": "text", "markup": body}]

                # Parse this question block
                q_draft, next_i = self._parse_question_block(
                    lines, i, current_section, current_instruction, current_group, answer_key, questions
                )
                if q_draft:
                    questions.append(q_draft)
                i = next_i
                continue

            # If inside passage and not yet a question, accumulate into passage lines
            if in_passage and current_group and not current_group.raw_body:
                current_passage_lines.append(line)

            i += 1

        # Finalize passage if loop ended
        if in_passage and current_group and not current_group.raw_body and current_passage_lines:
            body = "\n".join(current_passage_lines).strip()
            body = re.sub(r"\[\s*([0-9０-９]+)\s*\]", r"{blank|\1}", body)
            current_group.raw_body = body
            current_group.anchors = self._extract_passage_anchors(body)
            current_group.parts = [{"ordinal": 1, "role": "text", "markup": body}]

        return questions, groups

    def _contains_multiple_choices(self, line: str) -> bool:
        """Check if a line contains multiple choice markers (e.g. 1 ... 2 ... or ① ... ② ...)."""
        circled = re.findall(r"[①②③④]", line)
        if len(circled) >= 2:
            return True

        parens = re.findall(r"[（\(][1-4１-４][）\)]", line)
        if len(parens) >= 2:
            return True

        nums = re.findall(r"(?:^|[\s\t]+)[1-4１-４][\.．、\s]", line)
        if len(nums) >= 2:
            return True

        katakana = re.findall(r"(?:^|[\s\t]+)[アイウエあいうえ][\.．、\s]", line)
        if len(katakana) >= 2:
            return True

        return False

    def _is_new_question_start(
        self,
        line: str,
        current_q_num: str,
        found_choices: bool,
        choices_count: int,
        choices_complete: bool = False,
        has_answer: bool = False,
    ) -> bool:
        """Determine if a line starts a new question vs choices or answer."""
        if INLINE_ANSWER_RE.search(line):
            return False

        q_match = QUESTION_START_RE.match(line)
        if not q_match:
            return False

        rest = line[q_match.end():].strip()
        if self._contains_multiple_choices(line) and not self._contains_multiple_choices(rest):
            return False

        next_raw_num = q_match.group(1) or q_match.group(2) or q_match.group(3) or ""
        next_num = normalize_label(next_raw_num)

        if has_answer:
            return True

        if line.startswith("問") or line.startswith("Q") or line.startswith("【問") or "（" in line[:3] or "(" in line[:3]:
            if not found_choices and next_num == "1" and current_q_num:
                return False
            return True

        if found_choices and not choices_complete and choices_count < 4 and next_num in ("2", "3", "4"):
            return False

        if not found_choices and next_num in ("1", current_q_num):
            return False

        return True

    def _parse_question_block(
        self,
        lines: list[str],
        start_idx: int,
        section_header: str,
        instruction: str,
        current_group: GroupDraft | None,
        answer_key: dict[str, int],
        questions_so_far: list[QuestionDraft] | None = None,
    ) -> tuple[QuestionDraft | None, int]:
        """Parse question stem, choices, and answer from a sequence of lines."""
        start_line = lines[start_idx].strip()
        q_match = QUESTION_START_RE.match(start_line)
        if not q_match:
            return None, start_idx + 1

        # Determine question label / number
        raw_num = q_match.group(1) or q_match.group(2) or q_match.group(3) or "1"
        q_num = normalize_label(raw_num)

        # Initial stem text (after question number)
        initial_stem = start_line[q_match.end():].strip()
        stem_parts: list[str] = []
        choice_lines: list[str] = []
        raw_lines = [start_line]
        source_answer: int | None = None

        # If initial_stem itself already contains multiple choices (e.g. "25 1 なぜなら 2 だから...")
        if self._contains_multiple_choices(initial_stem):
            choice_lines.append(initial_stem)
            found_choices = True
            stem_parts.append(f"{{blank|{q_num}}}")
        elif initial_stem:
            stem_parts.append(initial_stem)
            found_choices = False
        else:
            found_choices = False

        curr_idx = start_idx + 1

        while curr_idx < len(lines):
            line = lines[curr_idx].strip()
            if not line:
                curr_idx += 1
                continue

            # Check if this line is an inline answer (e.g. 正解: 2)
            cleaned_ans, ans_ord, _ = self._answer_key_parser.extract_inline_answer(line)
            if ans_ord is not None:
                source_answer = ans_ord
                raw_lines.append(line)
                curr_idx += 1
                continue

            # Stop if next section begins
            if SECTION_HEADER_RE.match(line):
                break

            # Stop if passage marker begins
            if "次の文章を読んで" in line or "【文章】" in line or "〔文章〕" in line:
                break

            # Determine if choices are complete
            choices_complete = any(
                self._contains_multiple_choices(cl) or bool(CIRCLED_CHOICE_SPLIT_RE.search(cl))
                for cl in choice_lines
            ) or len(choice_lines) >= 4

            # Stop if next question begins
            if self._is_new_question_start(
                line,
                q_num,
                found_choices,
                len(choice_lines),
                choices_complete=choices_complete,
                has_answer=(source_answer is not None),
            ):
                break

            # Check if line contains choices
            if self._contains_choices(line):
                found_choices = True
                choice_lines.append(line)
            elif found_choices:
                # Continuation of choices
                choice_lines.append(line)
            else:
                # Continuation of stem
                stem_parts.append(line)

            raw_lines.append(line)
            curr_idx += 1

        full_stem = " ".join(stem_parts).strip()
        full_raw_text = "\n".join(raw_lines)

        # Extract inline answer if present in choice lines
        for idx_cl, cl in enumerate(choice_lines):
            cleaned_cl, ans_ord, _ = self._answer_key_parser.extract_inline_answer(cl)
            if ans_ord is not None:
                source_answer = ans_ord
                choice_lines[idx_cl] = cleaned_cl

        # Extract inline answer if present in stem
        cleaned_stem, inline_ans, _ = self._answer_key_parser.extract_inline_answer(full_stem)
        if inline_ans is not None:
            source_answer = inline_ans
        final_stem = cleaned_stem

        # Parse choices from choice_lines or from stem if choices were inline
        choices = self._parse_choices(choice_lines, final_stem)
        if choices and not choice_lines:
            # If choices were extracted from stem, strip them from stem
            final_stem = self._strip_inline_choices_from_stem(final_stem)

        # Normalize raw underlines like ___漢字___ or ＿＿漢字＿＿ into {u|漢字}
        final_stem = self._normalize_underlines(final_stem)

        # Star marker normalization for F2
        if STAR_MARKER_RE.search(final_stem):
            final_stem = STAR_MARKER_RE.sub("{star}", final_stem)

        # Determine source answer (fallback to external answer key if not found inline)
        if source_answer is None:
            source_answer = answer_key.get(q_num)

        # Check for anchor key (e.g. blank number in F4)
        anchor_key = None
        if current_group:
            blank_match = BLANK_ANCHOR_RE.search(final_stem)
            if blank_match:
                anchor_key = blank_match.group(1) or blank_match.group(2) or blank_match.group(3) or blank_match.group(4)
            else:
                anchor_key = q_num

        # Track group ordinal
        grp_ord = None
        if current_group:
            existing_in_group = sum(1 for q in (questions_so_far or []) if q.group_reference == current_group.draft_id)
            grp_ord = existing_in_group + 1

        q_draft = QuestionDraft(
            draft_id=f"q_{q_num}_{start_idx}",
            section_header=section_header,
            instruction_text=instruction,
            raw_stem=final_stem,
            raw_choices=choices,
            source_answer_key=source_answer,
            group_reference=current_group.draft_id if current_group else None,
            group_ordinal=grp_ord,
            anchor_key=anchor_key,
            line_number=start_idx + 1,
            raw_source_text=full_raw_text,
        )

        return q_draft, curr_idx

    def _contains_choices(self, line: str) -> bool:
        """Check if a line looks like it contains choices (1..4, ①..④, etc.)."""
        if CIRCLED_CHOICE_SPLIT_RE.search(line):
            return True
        if PAREN_CHOICE_SPLIT_RE.search(line):
            return True
        if NUMBERED_CHOICE_LINE_RE.match(line):
            return True
        if KATAKANA_CHOICE_SPLIT_RE.search(line):
            return True
        return False

    def _parse_choices(self, choice_lines: list[str], stem_text: str) -> list[ChoiceDraft]:
        """Parse choices from explicit choice lines or from inline stem choices."""
        combined_text = "\n".join(choice_lines).strip()
        if not combined_text:
            combined_text = stem_text

        choices: list[ChoiceDraft] = []

        # Strategy A: Circled digits (①..④)
        if "①" in combined_text:
            parts = CIRCLED_CHOICE_SPLIT_RE.split(combined_text)
            # parts will alternate: [preamble, marker1, text1, marker2, text2, ...]
            for idx in range(1, len(parts), 2):
                marker = parts[idx]
                c_text = parts[idx + 1].strip() if (idx + 1) < len(parts) else ""
                ord_val = int(normalize_label(marker))
                choices.append(
                    ChoiceDraft(
                        ordinal=ord_val,
                        label=str(ord_val),
                        text=self._clean_choice_text(c_text),
                        mode=ChoiceMode.TEXT,
                    )
                )
            if len(choices) >= 2:
                return sorted(choices, key=lambda c: c.ordinal)

        # Strategy B: Parenthesized numbers ((1)..(4) or （１）..（４）)
        if re.search(r"[（\(][1-4１-４][）\)]", combined_text):
            parts = PAREN_CHOICE_SPLIT_RE.split(combined_text)
            for idx in range(1, len(parts), 2):
                marker = parts[idx]
                c_text = parts[idx + 1].strip() if (idx + 1) < len(parts) else ""
                ord_val = int(normalize_label(marker))
                choices.append(
                    ChoiceDraft(
                        ordinal=ord_val,
                        label=str(ord_val),
                        text=self._clean_choice_text(c_text),
                        mode=ChoiceMode.TEXT,
                    )
                )
            if len(choices) >= 2:
                return sorted(choices, key=lambda c: c.ordinal)

        # Strategy C: Line-by-line numbers: "1. foo", "2. bar"
        numbered_lines = re.findall(r"^\s*([1-4１-４])[\.．、\s]\s*(.*?)$", combined_text, re.MULTILINE)
        if len(numbered_lines) >= 2:
            for num_raw, c_text in numbered_lines:
                ord_val = int(normalize_label(num_raw))
                choices.append(
                    ChoiceDraft(
                        ordinal=ord_val,
                        label=str(ord_val),
                        text=self._clean_choice_text(c_text),
                        mode=ChoiceMode.TEXT,
                    )
                )
            return sorted(choices, key=lambda c: c.ordinal)

        # Strategy D: Inline numbers separated by spaces: "1 foo  2 bar  3 baz  4 qux"
        inline_pattern = re.compile(r"(?:^|[\s\t]+)([1-4１-４])[\.．、\s]\s*(.*?)(?=(?:[\s\t]+[1-4１-４][\.．、\s])|$)")
        inline_matches = inline_pattern.findall(combined_text)
        if len(inline_matches) >= 2:
            for num_raw, c_text in inline_matches:
                ord_val = int(normalize_label(num_raw))
                choices.append(
                    ChoiceDraft(
                        ordinal=ord_val,
                        label=str(ord_val),
                        text=self._clean_choice_text(c_text),
                        mode=ChoiceMode.TEXT,
                    )
                )
            return sorted(choices, key=lambda c: c.ordinal)

        return choices

    def _strip_inline_choices_from_stem(self, stem: str) -> str:
        """Strip trailing inline choices from stem text."""
        # Find earliest occurrence of ① or (1) or "1 "
        m = re.search(r"(?:①|[（\(]1[）\)]|[\s\t]+1[\.．、\s])", stem)
        if m:
            return stem[:m.start()].strip()
        return stem

    def _clean_choice_text(self, text: str) -> str:
        """Clean whitespace and trailing answer cues from choice text."""
        cleaned, _, _ = self._answer_key_parser.extract_inline_answer(text)
        return cleaned.strip()

    def _normalize_underlines(self, stem: str) -> str:
        """Convert raw underlines like ___漢字___ or ＿＿漢字＿＿ to {u|漢字}."""
        return UNDERLINE_RAW_RE.sub(r"{u|\1}", stem)

    def _extract_passage_anchors(self, body: str) -> list[dict[str, Any]]:
        """Extract blank anchors from reading/grammar passages (e.g. [ 25 ] or 【35】)."""
        anchors: list[dict[str, Any]] = []
        matches = BLANK_ANCHOR_RE.finditer(body)
        for idx, m in enumerate(matches, start=1):
            key = m.group(1) or m.group(2) or m.group(3) or m.group(4) or str(idx)
            anchors.append({
                "ordinal": idx,
                "anchor_key": normalize_label(key),
                "kind": "blank",
            })
        return anchors
