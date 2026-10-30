"""
Deterministic Parser for JapaneseTest4You Web Exercises.
---------------------------------------------------------
Decomposes raw markdown / HTML from JapaneseTest4You into:
- Questions with stems, choices, and blanks
- Reading passages with embedded diagrams and anchor blanks
- Structured audio tracks with question-level, passage-level, and shared relationships
- Star sentence ordering (F2) with ★ position and permutation derivation
- Source answer key claims with multi-format rationale cross-verification
- Deterministic classification into the 20 official JLPT formats
- Full isolation of advertisements, Patreon links, and vocabulary glossaries

Enforces:
- 100% deterministic operation with zero AI/LLM calls
- Pristine preservation of Japanese kanji, hiragana, katakana, and punctuation
- Strict validation and warning collection without silent data loss
- Zero database writes (all local media retrieval stored content-addressed in MediaStore without DB)
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.study.acquisition.crawler.url_filter import extract_level_and_section
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.models import (
    AudioAssociation,
    ParsedAnswerClaim,
    ParsedChoice,
    ParsedExercise,
    ParsedPassage,
    ParsedQuestion,
    StarArrangementMetadata,
    _derive_format_code,
)

logger = logging.getLogger(__name__)

# Full-width to half-width digit map
FULL_WIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")

# Passage header variations
PASSAGE_HEADER_RE = re.compile(
    r"^\s*(?:\*\*)?(?:Reading\s*Passage|Passage|本文)\s*(\d+)[\.:\*\s]*",
    re.IGNORECASE,
)

# Audio link and tag patterns
AUDIO_SRC_RE = re.compile(
    r'<audio[^>]*src=[\'"]([^\'"]+)[\'"]|<source[^>]*src=[\'"]([^\'"]+)[\'"]|\[(?:Audio(?:\s+Track)?(?:\s+\d+)?|audio)\]\((https?://[^\s\)]+\.mp3)\)',
    re.IGNORECASE,
)

# Image markdown and HTML patterns
IMAGE_RE = re.compile(
    r'!\[(.*?)\]\((https?://[^\s\)]+)\)|<img[^>]*src=[\'"]([^\'"]+)[\'"]',
    re.IGNORECASE,
)

# Question start patterns (Markdown and HTML)
QUESTION_START_RE = re.compile(
    r"^\s*(?:\*\*)?(?:(?:Question|問)\s*(\d+)[\.．:]?|(\d+)[\.．\\]+|Q(\d+)[\.．\s]*)\s*(?:Question\s*\d+[\.．\s]*)?(.*?)(?:\*\*)?$",
    re.IGNORECASE,
)

# Radio choice input in HTML: <input ... type="radio" ...> Choice text
RADIO_CHOICE_RE = re.compile(
    r'<input[^>]*type=[\'"]radio[\'"][^>]*>\s*([^<\n]+)',
    re.IGNORECASE,
)

# Answer Key headers
ANSWER_KEY_HEADER_RE = re.compile(
    r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?Answer\s*Key\s*[:：]?(?:\*\*)?(?:</\w+>)?\s*$",
    re.IGNORECASE,
)

# Answer key item pattern
ANSWER_KEY_ITEM_RE = re.compile(
    r"(?:Question\s*|問\s*)?(\d+)\s*[:：]\s*([1-4１-４])(?:\s*(?:[\(（](.*?)[\)）]|=>\s*([^<\n]+)))?",
    re.IGNORECASE,
)

# Section boundaries that signal end of test content
DISCARD_HEADERS = [
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?.*Kanji Lesson", re.IGNORECASE),
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?New words:", re.IGNORECASE),
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?Grammar points in this test:", re.IGNORECASE),
    re.compile(r"Click here.*to download this test for offline viewing", re.IGNORECASE),
    re.compile(r"If you find any error in this post", re.IGNORECASE),
]

POST_ANSWER_KEY_TERMINATORS = [
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?.*Kanji Lesson", re.IGNORECASE),
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?New words:", re.IGNORECASE),
    re.compile(r"^\s*(?:<\w+[^>]*>)?(?:\*\*)?Grammar points in this test:", re.IGNORECASE),
    re.compile(r'<hr\s*class="wp-block-separator', re.IGNORECASE),
    re.compile(r"Click here.*to download this test for offline viewing", re.IGNORECASE),
    re.compile(r"If you find any error in this post", re.IGNORECASE),
]

# Blank markers to normalize to {blank}
BLANK_RE = re.compile(r"_{3,}|＿{3,}|\\_\\_\\_")

# Anchor reference in stem: [ 1 ] には何を入れますか。 or 【1】
ANCHOR_REF_RE = re.compile(r"\[\s*(\d+)\s*\]|【\s*(\d+)\s*】")


def _is_discard_image(url: str) -> bool:
    """Return True if image is an advertisement, banner, or logo."""
    u_lower = url.lower()
    return any(
        k in u_lower
        for k in ["advertisement", "mainpage-ad", "patreon", "statcounter", "avatar", "icon"]
    )


def _normalize_passage_markup(text: str) -> str:
    """Normalize passage text blanks and escape stray brackets for Study Bank AST."""
    norm = re.sub(r"\[\s*(\d+)\s*\]|【\s*(\d+)\s*】", r"{blank|\1}", text)

    def _escape_bracket(match: re.Match) -> str:
        inner = match.group(1)
        if "|" in inner:
            return f"[{inner}]"
        return f"\\[{inner}\\]"

    return re.sub(r"\[(.*?)\]", _escape_bracket, norm)


def _normalize_blank(text: str) -> str:
    """Normalize underscores to {blank} token and convert anchor brackets."""
    norm = BLANK_RE.sub("{blank}", text)
    norm = re.sub(r"\[\s*(\d+)\s*\]", r"【\1】", norm)

    def _escape_bracket(match: re.Match) -> str:
        inner = match.group(1)
        if "|" in inner:
            return f"[{inner}]"
        return f"\\[{inner}\\]"

    return re.sub(r"\[(.*?)\]", _escape_bracket, norm)


class JapaneseTest4YouParser(BaseSourceParser):
    """Deterministic parser for JapaneseTest4You exercise pages across all formats."""

    def __init__(self, downloader: AssetDownloader | None = None) -> None:
        self._downloader = downloader

    @property
    def source_name(self) -> str:
        return "JapaneseTest4You"

    def parse(
        self,
        raw_markdown: str,
        url: str = "",
        title: str = "",
        retrieve_media: bool = False,
    ) -> ParsedExercise:
        """Parse raw markdown/HTML into a validated ParsedExercise structure."""
        warnings: list[str] = []

        # Preprocess input: convert <br> to newlines
        normalized_content = re.sub(r"<br\s*/?>", "\n", raw_markdown, flags=re.IGNORECASE)

        # 1. Resolve Title, Level, and Section
        resolved_title = title
        if not resolved_title:
            for line in normalized_content.splitlines()[:10]:
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

        for line in normalized_content.splitlines():
            line_str = line.strip()
            unwrapped_line = re.sub(
                r"</?(?:p|div|figure|strong|b|span|h\d)[^>]*>",
                "",
                line_str,
                flags=re.IGNORECASE,
            ).strip()

            if ANSWER_KEY_HEADER_RE.match(unwrapped_line) or ANSWER_KEY_HEADER_RE.match(line_str):
                in_answer_key = True
                continue

            if in_answer_key:
                # Discard headers terminate answer key and test content
                if any(dh.search(line_str) or dh.search(unwrapped_line) for dh in DISCARD_HEADERS):
                    break

                for ak_match in ANSWER_KEY_ITEM_RE.finditer(unwrapped_line):
                    q_num = int(ak_match.group(1))
                    claimed_ord_raw = ak_match.group(2).translate(FULL_WIDTH_DIGITS)
                    claimed_ord = int(claimed_ord_raw)
                    rationale = (ak_match.group(3) or ak_match.group(4) or "").strip()

                    answer_claims[q_num] = ParsedAnswerClaim(
                        question_number=q_num,
                        claimed_ordinal=claimed_ord,
                        rationale=rationale,
                    )
            else:
                if any(dh.search(line_str) or dh.search(unwrapped_line) for dh in DISCARD_HEADERS):
                    break
                content_lines.append(line)

        # 3. State Machine for Passages, Audio, and Questions
        passages: list[ParsedPassage] = []
        questions: list[ParsedQuestion] = []
        exercise_audio_tracks: list[AudioAssociation] = []

        current_passage: ParsedPassage | None = None
        current_question_num: int | None = None
        current_question_stem: str = ""
        current_question_images: list[str] = []
        current_question_audio: AudioAssociation | None = None
        shared_exercise_audio: AudioAssociation | None = None
        current_choices: list[str] = []
        last_context_sentence: str = ""
        in_preamble = True

        idx = 0
        while idx < len(content_lines):
            line = content_lines[idx]
            stripped = line.strip()
            # Clean outer non-semantic HTML wrappers (p, div, figure, strong, span)
            unwrapped = re.sub(
                r"</?(?:p|div|figure|strong|b|span|h\d)[^>]*>",
                "",
                stripped,
                flags=re.IGNORECASE,
            ).strip()

            # Skip preamble metadata
            if in_preamble:
                if stripped.startswith("Title:") or stripped.startswith("URL:") or stripped.startswith("## "):
                    idx += 1
                    continue
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

            # A. Check for Audio Tags
            audio_matches = AUDIO_SRC_RE.findall(stripped)
            if audio_matches:
                # If current question already has audio or choices, finalize it before adopting new audio
                if current_question_num is not None and (current_question_audio is not None or current_choices):
                    q_obj = self._build_question(
                        q_num=current_question_num,
                        raw_stem=current_question_stem,
                        choice_lines=current_choices,
                        passage_id=current_passage.passage_id if current_passage else None,
                        image_urls=current_question_images,
                        audio_assoc=current_question_audio or shared_exercise_audio,
                        answer_claims=answer_claims,
                        context_sentence=last_context_sentence,
                        warnings=warnings,
                        level=level,
                        section=section,
                    )
                    questions.append(q_obj)
                    current_question_num = None
                    current_choices = []
                    current_question_images = []
                    current_question_audio = None

                for match_tuple in audio_matches:
                    audio_url = next((m for m in match_tuple if m), None)
                    if audio_url:
                        if current_question_num is not None:
                            scope = "question"
                            target_id = f"Q{current_question_num}"
                        elif current_passage is not None:
                            scope = "passage"
                            target_id = current_passage.passage_id
                        else:
                            scope = "shared"
                            target_id = None

                        assoc = AudioAssociation(
                            track_url=audio_url,
                            scope=scope,
                            target_id=target_id,
                        )

                        # Attempt media retrieval if requested and downloader present
                        if retrieve_media and self._downloader:
                            try:
                                d_res = self._downloader.download_asset(audio_url, conn=None, kind="audio")
                                assoc.status = "retrieved"
                                assoc.asset_id = d_res["asset_id"]
                                assoc.local_path = d_res["relative_path"]
                                assoc.mime_type = d_res["mime_type"]
                                assoc.duration_ms = d_res.get("duration_ms")
                            except Exception as ex:
                                assoc.status = "failed"
                                assoc.error_reason = str(ex)
                                warnings.append(f"Failed to retrieve audio track {audio_url}: {ex}")

                        exercise_audio_tracks.append(assoc)

                        if current_question_num is not None:
                            current_question_audio = assoc
                        elif current_passage is not None:
                            current_passage.audio = assoc
                            current_passage.audio_urls.append(audio_url)
                        else:
                            current_question_audio = assoc
                            shared_exercise_audio = assoc

                idx += 1
                continue

            # B. Check for Passage Header: **Reading passage 1**
            p_match = PASSAGE_HEADER_RE.match(unwrapped) or PASSAGE_HEADER_RE.match(stripped)
            if p_match:
                if current_question_num is not None:
                    q_obj = self._build_question(
                        q_num=current_question_num,
                        raw_stem=current_question_stem,
                        choice_lines=current_choices,
                        passage_id=current_passage.passage_id if current_passage else None,
                        image_urls=current_question_images,
                        audio_assoc=current_question_audio or shared_exercise_audio,
                        answer_claims=answer_claims,
                        context_sentence=last_context_sentence,
                        warnings=warnings,
                        level=level,
                        section=section,
                    )
                    questions.append(q_obj)
                    current_question_num = None
                    current_choices = []
                    current_question_images = []
                    current_question_audio = None

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

            # C. Check for Question Start: "1. あの人は..." or "<strong>1. Question 1</strong>"
            is_radio_line = "<input" in stripped.lower() and "radio" in stripped.lower()
            q_match = None
            if not is_radio_line:
                q_match = QUESTION_START_RE.match(unwrapped) or QUESTION_START_RE.match(stripped)

            if q_match:
                if current_question_num is not None:
                    q_obj = self._build_question(
                        q_num=current_question_num,
                        raw_stem=current_question_stem,
                        choice_lines=current_choices,
                        passage_id=current_passage.passage_id if current_passage else None,
                        image_urls=current_question_images,
                        audio_assoc=current_question_audio or shared_exercise_audio,
                        answer_claims=answer_claims,
                        context_sentence=last_context_sentence,
                        warnings=warnings,
                        level=level,
                        section=section,
                    )
                    questions.append(q_obj)

                # Initialize new question
                matched_num = q_match.group(1) or q_match.group(2) or q_match.group(3)
                current_question_num = int(matched_num)
                stem_raw = q_match.group(4).strip() if q_match.group(4) else ""
                current_question_stem = stem_raw
                current_choices = []
                current_question_images = []
                if current_question_audio and current_question_audio.scope == "shared":
                    current_question_audio.scope = "question"
                    current_question_audio.target_id = f"Q{current_question_num}"

                if current_question_audio:
                    last_seen_audio = current_question_audio
                current_question_audio = None

                idx += 1
                continue

            # D. Check for Images
            img_matches = IMAGE_RE.findall(stripped)
            if img_matches:
                for alt_md, url_md, url_html in img_matches:
                    img_url = url_md or url_html
                    if img_url and not _is_discard_image(img_url):
                        if current_question_num is not None:
                            current_question_images.append(img_url)
                        elif current_passage is not None:
                            current_passage.image_urls.append(img_url)
                idx += 1
                continue

            # E. Check for HTML Radio Button Choices: <input type="radio"> choice
            radio_matches = RADIO_CHOICE_RE.findall(stripped)
            if radio_matches and current_question_num is not None:
                for r_text in radio_matches:
                    clean_choice = re.sub(r"</?[a-zA-Z][^>]*>", "", r_text).strip()
                    if clean_choice:
                        current_choices.append(clean_choice)
                idx += 1
                continue

            # F. Check for standalone context sentence before subquestions (e.g. in Kanji tests)
            if current_question_num is None and current_passage is None and stripped.endswith("。"):
                last_context_sentence = unwrapped or stripped
                idx += 1
                continue

            # G. Accumulate Choices (if inside a question)
            if current_question_num is not None:
                if stripped:
                    clean_line = re.sub(r"</?[a-zA-Z][^>]*>", "", stripped).strip()
                    if clean_line:
                        current_choices.append(clean_line)
                idx += 1
                continue

            # H. Accumulate Passage Text (if inside a passage and not in a question)
            if current_passage is not None:
                if stripped:
                    clean_passage_line = unwrapped or stripped
                    if current_passage.text:
                        current_passage.text += "\n" + clean_passage_line
                    else:
                        current_passage.text = clean_passage_line
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
                audio_assoc=current_question_audio or shared_exercise_audio,
                answer_claims=answer_claims,
                context_sentence=last_context_sentence,
                warnings=warnings,
                level=level,
                section=section,
            )
            questions.append(q_obj)

        # Cross-verify answer claims against rationales
        for q in questions:
            if q.answer and q.choices:
                claimed_ord = q.answer.claimed_ordinal
                matching_choice = next((c for c in q.choices if c.ordinal == claimed_ord), None)
                if matching_choice and q.answer.rationale:
                    rat = q.answer.rationale
                    # Pattern 1: "=> text"
                    if "=>" in rat:
                        expected_text = rat.split("=>")[-1].strip()
                        if expected_text and matching_choice.text.strip() != expected_text:
                            q.answer.is_conflicted = True
                            warnings.append(
                                f"Question {q.question_number}: Answer key rationale text '{expected_text}' "
                                f"does not match choice {claimed_ord} text '{matching_choice.text}'."
                            )
                    # Pattern 2: "Target: reading" e.g. "来月: らいげつ"
                    elif ":" in rat:
                        expected_text = rat.split(":")[-1].strip()
                        if expected_text and matching_choice.text.strip() != expected_text:
                            q.answer.is_conflicted = True
                            warnings.append(
                                f"Question {q.question_number}: Answer key reading text '{expected_text}' "
                                f"does not match choice {claimed_ord} text '{matching_choice.text}'."
                            )
                    # Pattern 3: Full sentence - choice text should appear in rationale
                    elif len(rat) > len(matching_choice.text) and matching_choice.text not in rat:
                        if any(c.text in rat for c in q.choices if c.ordinal != claimed_ord):
                            q.answer.is_conflicted = True
                            warnings.append(
                                f"Question {q.question_number}: Rationale '{rat}' matches a different choice than claimed {claimed_ord}."
                            )

        # Normalize passage markup
        for p in passages:
            p.text = _normalize_passage_markup(p.text)

        all_audio_urls = [t.track_url for t in exercise_audio_tracks]

        return ParsedExercise(
            title=resolved_title,
            url=url,
            jlpt_level=level,
            section=section,
            passages=passages,
            questions=questions,
            answer_claims=answer_claims,
            audio_tracks=exercise_audio_tracks,
            audio_urls=all_audio_urls,
            warnings=warnings,
        )

    def _build_question(
        self,
        q_num: int,
        raw_stem: str,
        choice_lines: list[str],
        passage_id: str | None,
        image_urls: list[str],
        audio_assoc: AudioAssociation | None,
        answer_claims: dict[int, ParsedAnswerClaim],
        context_sentence: str,
        warnings: list[str],
        level: str,
        section: str,
    ) -> ParsedQuestion:
        """Construct a validated ParsedQuestion instance with format & star derivation."""
        # Detect target word in Kanji tests when 5 lines follow question stem
        actual_choice_lines = choice_lines
        extracted_target = ""
        if len(choice_lines) == 5:
            first_line = choice_lines[0].strip()
            if len(first_line) <= 12 and not first_line.isdigit():
                extracted_target = first_line
                actual_choice_lines = choice_lines[1:]

        # Stem normalization and context handling
        effective_stem = raw_stem
        if not effective_stem and image_urls and not passage_id:
            effective_stem = f"Question {q_num}"
        elif extracted_target:
            if effective_stem:
                effective_stem = f"{effective_stem} 【{extracted_target}】"
            else:
                effective_stem = extracted_target
        elif context_sentence and len(effective_stem) <= 10 and not passage_id:
            effective_stem = f"【{context_sentence}】 {effective_stem}"

        norm_stem = _normalize_blank(effective_stem)

        # Anchor reference detection ([ 1 ] には何を入れますか。)
        anchor_key = None
        anchor_match = ANCHOR_REF_RE.search(raw_stem)
        if anchor_match:
            anchor_key = anchor_match.group(1) or anchor_match.group(2)

        # Assign choices 1..4
        choices: list[ParsedChoice] = []
        for c_idx, line in enumerate(actual_choice_lines, start=1):
            choices.append(
                ParsedChoice(
                    ordinal=c_idx,
                    label=str(c_idx),
                    text=line.strip(),
                )
            )

        # Star sentence ordering detection (F2 family)
        star_meta: StarArrangementMetadata | None = None
        if "★" in norm_stem or "☆" in norm_stem:
            star_meta = self._parse_star_arrangement(norm_stem, choices, answer_claims.get(q_num))

        # Choice count check & format classification
        has_audio = (audio_assoc is not None)
        if len(choices) != 4 and not (has_audio and len(choices) in (3, 4)):
            warnings.append(
                f"Question {q_num}: Expected 4 choices, found {len(choices)}."
            )

        answer_claim = answer_claims.get(q_num)
        if not answer_claim:
            warnings.append(f"Question {q_num}: No matching answer key found in source page.")

        q_audio_urls = [audio_assoc.track_url] if audio_assoc else []

        pq = ParsedQuestion(
            question_number=q_num,
            external_id=f"Q{q_num}",
            stem=norm_stem,
            choices=choices,
            answer=answer_claim,
            group_reference=passage_id,
            anchor_key=anchor_key,
            image_urls=image_urls,
            audio=audio_assoc,
            audio_urls=q_audio_urls,
            star_arrangement=star_meta,
        )

        # Deterministic format classification
        derived_format = _derive_format_code(level, section, pq)
        if not derived_format:
            warnings.append(f"Question {q_num}: Ambiguous or unsupported structure for format classification.")
        pq.format_code = derived_format

        return pq

    def _parse_star_arrangement(
        self,
        stem: str,
        choices: list[ParsedChoice],
        answer_claim: ParsedAnswerClaim | None,
    ) -> StarArrangementMetadata | None:
        """Parse JLPT F2 sentence composition (star ordering) structure."""
        tokens = re.split(r"(\{blank\}|★|☆)", stem)
        blank_or_star = [t for t in tokens if t in ("{blank}", "★", "☆")]
        if "★" not in blank_or_star and "☆" not in blank_or_star:
            return None

        star_idx = -1
        for idx, t in enumerate(blank_or_star, start=1):
            if t in ("★", "☆"):
                star_idx = idx
                break

        # Context before and after the arrangement segment
        star_pos_char = stem.find("★") if "★" in stem else stem.find("☆")
        pre_stem = stem[:star_pos_char].replace("{blank}", "").strip()
        post_stem = stem[star_pos_char + 1:].replace("{blank}", "").strip()

        fragments = [c.text for c in choices]
        derived_order: list[int] = []
        star_frag = ""

        # If answer key contains full sentence rationale, derive permutation
        if answer_claim and answer_claim.rationale:
            rat = answer_claim.rationale
            matched_indices = []
            for frag in fragments:
                pos = rat.find(frag)
                if pos != -1:
                    matched_indices.append((pos, frag))
            if len(matched_indices) == len(fragments):
                matched_indices.sort(key=lambda x: x[0])
                derived_order = [fragments.index(item[1]) + 1 for item in matched_indices]
                if 1 <= star_idx <= len(derived_order):
                    winning_choice_ord = derived_order[star_idx - 1]
                    star_frag = fragments[winning_choice_ord - 1]

        return StarArrangementMetadata(
            star_position=star_idx,
            total_blanks=len(blank_or_star) or 4,
            pre_stem=pre_stem,
            post_stem=post_stem,
            fragments=fragments,
            derived_order=derived_order,
            star_fragment=star_frag,
        )
