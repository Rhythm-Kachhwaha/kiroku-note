"""
Deterministic Parser for JapaneseTest4You Web Exercises.
---------------------------------------------------------
Decomposes raw markdown from JapaneseTest4You into:
- Questions with stems, choices, and blanks
- Reading passages with embedded diagrams and anchor blanks
- Source answer key claims with completed sentence rationales
- Full isolation of advertisements, Patreon links, and vocabulary glossaries

Enforces:
- 100% deterministic operation with zero AI/LLM calls
- Pristine preservation of Japanese kanji, hiragana, katakana, and punctuation
- Strict validation and warning collection without silent data loss
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.study.acquisition.crawler.url_filter import extract_level_and_section
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.models import (
    ParsedAnswerClaim,
    ParsedChoice,
    ParsedExercise,
    ParsedPassage,
    ParsedQuestion,
)

logger = logging.getLogger(__name__)

# Full-width to half-width digit map
FULL_WIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")

# Regex to detect passage headers, e.g. **Reading passage 1**
PASSAGE_HEADER_RE = re.compile(r"^\s*\*\*Reading passage\s*(\d+)\*\*\s*$", re.IGNORECASE)

# Regex to detect image links, e.g. ![](https://japanesetest4you.com/image/...)
IMAGE_MARKDOWN_RE = re.compile(r"!\[(.*?)\]\((https?://[^\s\)]+)\)")

# Regex to detect question number and stem, e.g. "1. あの人は..." or "1\\. あの人は..."
QUESTION_START_RE = re.compile(
    r"^\s*(?:(\d+)[\.．\\]+|問\s*(\d+)[\.．\s]*|Q(\d+)[\.．\s]*)\s*(.*?)$"
)

# Regex to detect answer key header, e.g. **Answer Key:**
ANSWER_KEY_HEADER_RE = re.compile(r"^\s*\*\*Answer\s*Key\s*:\s*\*\*\s*$", re.IGNORECASE)

# Regex to parse individual answer key line: "Question 1: 3 (rationale)" or "1: 4 (rationale)"
ANSWER_KEY_LINE_RE = re.compile(
    r"^\s*(?:Question\s*|問\s*)?(\d+)\s*[:：]\s*([1-4１-４])\s*(?:\((.*?)\))?\s*$",
    re.IGNORECASE,
)

# Section boundaries that signal end of test content
DISCARD_HEADERS = [
    re.compile(r"^\s*\*\*.*Kanji Lesson", re.IGNORECASE),
    re.compile(r"^\s*\*\*New words:", re.IGNORECASE),
    re.compile(r"^\s*\*\*Grammar points in this test:", re.IGNORECASE),
    re.compile(r"^\s*---+\s*$"),
    re.compile(r"Click here.*to download this test for offline viewing", re.IGNORECASE),
    re.compile(r"If you find any error in this post", re.IGNORECASE),
]

# Blank markers to normalize to {blank}
BLANK_RE = re.compile(r"_{3,}|＿{3,}|\\_\\_\\_")

# Anchor reference in stem: [ 1 ] には何を入れますか。 or 【1】
ANCHOR_REF_RE = re.compile(r"\[\s*(\d+)\s*\]|【\s*(\d+)\s*】")


def _is_discard_image(url: str) -> bool:
    """Return True if image is an advertisement or patron banner."""
    u_lower = url.lower()
    return "advertisement" in u_lower or "mainpage-ad" in u_lower or "patreon" in u_lower


def _normalize_passage_markup(text: str) -> str:
    """Normalize passage text blanks and escape stray brackets for Study Bank AST."""
    # Convert [ 1 ], [ 2 ], 【1】 to {blank|1}, {blank|2}
    norm = re.sub(r"\[\s*(\d+)\s*\]|【\s*(\d+)\s*】", r"{blank|\1}", text)
    # Escape any remaining ASCII square brackets that do not contain a pipe '|'
    def _escape_bracket(match: re.Match) -> str:
        inner = match.group(1)
        if "|" in inner:
            return f"[{inner}]"
        return f"\\[{inner}\\]"
    return re.sub(r"\[(.*?)\]", _escape_bracket, norm)


def _normalize_blank(text: str) -> str:
    """Normalize underscores to {blank} token and convert anchor brackets."""
    norm = BLANK_RE.sub("{blank}", text)
    # Convert [ 1 ] to 【1】 so it is safe Japanese bracket
    norm = re.sub(r"\[\s*(\d+)\s*\]", r"【\1】", norm)
    def _escape_bracket(match: re.Match) -> str:
        inner = match.group(1)
        if "|" in inner:
            return f"[{inner}]"
        return f"\\[{inner}\\]"
    return re.sub(r"\[(.*?)\]", _escape_bracket, norm)


class JapaneseTest4YouParser(BaseSourceParser):
    """Deterministic parser for JapaneseTest4You exercise markdown."""

    @property
    def source_name(self) -> str:
        return "JapaneseTest4You"

    def parse(self, raw_markdown: str, url: str = "", title: str = "") -> ParsedExercise:
        """Parse raw markdown into a validated ParsedExercise structure."""
        warnings: list[str] = []

        # 1. Resolve Title, Level, and Section
        resolved_title = title
        if not resolved_title:
            for line in raw_markdown.splitlines()[:5]:
                if line.startswith("Title: "):
                    resolved_title = line.replace("Title: ", "").strip()
                    break
                elif line.startswith("## "):
                    resolved_title = line.replace("## ", "").strip()
                    break

        resolved_title = resolved_title or "JapaneseTest4You Exercise"
        level, section = extract_level_and_section(url, resolved_title)
        level = level or "N4"

        # 2. Extract and parse Answer Key separately
        answer_claims: dict[int, ParsedAnswerClaim] = {}
        content_lines: list[str] = []
        in_answer_key = False

        for line in raw_markdown.splitlines():
            line_str = line.strip()

            if ANSWER_KEY_HEADER_RE.match(line_str):
                in_answer_key = True
                continue

            if in_answer_key:
                # Check for discard headers terminating answer key
                if any(dh.search(line_str) for dh in DISCARD_HEADERS):
                    in_answer_key = False
                    continue

                ak_match = ANSWER_KEY_LINE_RE.match(line_str)
                if ak_match:
                    q_num = int(ak_match.group(1))
                    claimed_ord_raw = ak_match.group(2).translate(FULL_WIDTH_DIGITS)
                    claimed_ord = int(claimed_ord_raw)
                    rationale = ak_match.group(3) or ""

                    answer_claims[q_num] = ParsedAnswerClaim(
                        question_number=q_num,
                        claimed_ordinal=claimed_ord,
                        rationale=rationale.strip(),
                    )
            else:
                content_lines.append(line)

        # 3. State Machine for Passages and Questions
        passages: list[ParsedPassage] = []
        questions: list[ParsedQuestion] = []

        current_passage: ParsedPassage | None = None
        current_question_num: int | None = None
        current_question_stem: str = ""
        current_question_images: list[str] = []
        current_choices: list[str] = []
        in_preamble = True

        idx = 0
        while idx < len(content_lines):
            line = content_lines[idx]
            stripped = line.strip()

            # Skip preamble metadata (Title, dates, Category tags)
            if in_preamble:
                if stripped.startswith("Title:") or stripped.startswith("URL:") or stripped.startswith("## "):
                    idx += 1
                    continue
                # Date or category tag lines
                if re.match(r"^[A-Z][a-z]+ \d{1,2}, \d{4}", stripped):
                    idx += 1
                    continue
                if not stripped:
                    idx += 1
                    continue
                in_preamble = False

            # Check for discard boundaries
            if any(dh.search(stripped) for dh in DISCARD_HEADERS):
                break

            # A. Check for Passage Header: **Reading passage 1**
            p_match = PASSAGE_HEADER_RE.match(stripped)
            if p_match:
                # Finalize any pending question
                if current_question_num is not None:
                    q_obj = self._build_question(
                        q_num=current_question_num,
                        raw_stem=current_question_stem,
                        choice_lines=current_choices,
                        passage_id=current_passage.passage_id if current_passage else None,
                        image_urls=current_question_images,
                        answer_claims=answer_claims,
                        warnings=warnings,
                    )
                    questions.append(q_obj)
                    current_question_num = None
                    current_choices = []
                    current_question_images = []

                p_num = p_match.group(1)
                current_passage = ParsedPassage(
                    passage_id=f"passage_{p_num}",
                    title=f"Reading passage {p_num}",
                    text="",
                    image_urls=[],
                )
                passages.append(current_passage)
                idx += 1
                continue

            # B. Check for Question Start: "1. あの人は..."
            q_match = QUESTION_START_RE.match(stripped)
            if q_match:
                # Finalize previous question if pending
                if current_question_num is not None:
                    q_obj = self._build_question(
                        q_num=current_question_num,
                        raw_stem=current_question_stem,
                        choice_lines=current_choices,
                        passage_id=current_passage.passage_id if current_passage else None,
                        image_urls=current_question_images,
                        answer_claims=answer_claims,
                        warnings=warnings,
                    )
                    questions.append(q_obj)

                # Initialize new question
                matched_num = q_match.group(1) or q_match.group(2) or q_match.group(3)
                current_question_num = int(matched_num)
                current_question_stem = q_match.group(4).strip()
                current_choices = []
                current_question_images = []
                idx += 1
                continue

            # C. Check for Images
            img_matches = IMAGE_MARKDOWN_RE.findall(stripped)
            if img_matches:
                for alt, img_url in img_matches:
                    if not _is_discard_image(img_url):
                        if current_question_num is not None:
                            current_question_images.append(img_url)
                        elif current_passage is not None:
                            current_passage.image_urls.append(img_url)
                idx += 1
                continue

            # D. Accumulate Choices (if inside a question)
            if current_question_num is not None:
                if stripped:
                    current_choices.append(stripped)
                idx += 1
                continue

            # E. Accumulate Passage Text (if inside a passage and not in a question)
            if current_passage is not None:
                if stripped:
                    if current_passage.text:
                        current_passage.text += "\n" + stripped
                    else:
                        current_passage.text = stripped
                idx += 1
                continue

            idx += 1

        # Finalize last pending question
        if current_question_num is not None:
            q_obj = self._build_question(
                q_num=current_question_num,
                raw_stem=current_question_stem,
                choice_lines=current_choices,
                passage_id=current_passage.passage_id if current_passage else None,
                image_urls=current_question_images,
                answer_claims=answer_claims,
                warnings=warnings,
            )
            questions.append(q_obj)

        # Cross-verify answer key choices against rationale
        for q in questions:
            if q.answer and q.choices:
                claimed_ord = q.answer.claimed_ordinal
                matching_choice = next((c for c in q.choices if c.ordinal == claimed_ord), None)
                if matching_choice and q.answer.rationale:
                    rat = q.answer.rationale
                    # Pattern: "=> text"
                    if "=>" in rat:
                        expected_text = rat.split("=>")[-1].strip()
                        if expected_text and matching_choice.text.strip() != expected_text:
                            q.answer.is_conflicted = True
                            warnings.append(
                                f"Question {q.question_number}: Answer key rationale text '{expected_text}' "
                                f"does not match choice {claimed_ord} text '{matching_choice.text}'."
                            )

        # Normalize passage markup (convert blanks and escape stray brackets)
        for p in passages:
            p.text = _normalize_passage_markup(p.text)

        return ParsedExercise(
            title=resolved_title,
            url=url,
            jlpt_level=level,
            section=section,
            passages=passages,
            questions=questions,
            answer_claims=answer_claims,
            warnings=warnings,
        )

    def _build_question(
        self,
        q_num: int,
        raw_stem: str,
        choice_lines: list[str],
        passage_id: str | None,
        image_urls: list[str],
        answer_claims: dict[int, ParsedAnswerClaim],
        warnings: list[str],
    ) -> ParsedQuestion:
        """Construct a validated ParsedQuestion instance."""
        norm_stem = _normalize_blank(raw_stem)

        # Detect anchor reference (e.g. "[ 1 ] には何を入れますか。")
        anchor_key = None
        anchor_match = ANCHOR_REF_RE.search(raw_stem)
        if anchor_match:
            anchor_key = anchor_match.group(1) or anchor_match.group(2)

        # Assign choice ordinals 1..4
        choices: list[ParsedChoice] = []
        for c_idx, line in enumerate(choice_lines, start=1):
            choices.append(
                ParsedChoice(
                    ordinal=c_idx,
                    label=str(c_idx),
                    text=line.strip(),
                )
            )

        if len(choices) != 4:
            warnings.append(
                f"Question {q_num}: Expected 4 choices, found {len(choices)}."
            )

        answer_claim = answer_claims.get(q_num)
        if not answer_claim:
            warnings.append(f"Question {q_num}: No matching answer key found in source page.")

        return ParsedQuestion(
            question_number=q_num,
            external_id=f"Q{q_num}",
            stem=norm_stem,
            choices=choices,
            answer=answer_claim,
            group_reference=passage_id,
            anchor_key=anchor_key,
            image_urls=image_urls,
        )

