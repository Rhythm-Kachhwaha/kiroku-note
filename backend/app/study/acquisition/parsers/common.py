"""
Shared Deterministic Parsing Utilities for JLPT Acquisition Parsers.
--------------------------------------------------------------------
Provides unified, zero-LLM helpers for:
- Blank, underline, and ruby markup normalization
- Choice prefix stripping (1./A./a./①/bullets/radio inputs) and choice image extraction
- Answer key parsing (numeric and A-D letter mappings) with duplicate detection
- Star arrangement (F2) derivation
- Mandatory linear invariant scanning and quarantine application
"""
from __future__ import annotations

import re
from typing import Any

from app.study.acquisition.crawler.url_filter import extract_level_and_section
from app.study.acquisition.parsers.invariants import (
    apply_invariant_quarantine,
    linear_scan_exercise,
)
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

FULL_WIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
LETTER_TO_ORDINAL = {"A": 1, "B": 2, "C": 3, "D": 4, "a": 1, "b": 2, "c": 3, "d": 4}
CIRCLED_TO_ORDINAL = {"①": 1, "②": 2, "③": 3, "④": 4}

BLANK_TOKEN_RAW_RE = re.compile(r"_{2,}|＿{2,}|\\_\\_+|（\s*）|\(\s*\)")
HTML_TAG_STRIP_RE = re.compile(r"</?[a-zA-Z][^>]*>")
CHOICE_PREFIX_RE = re.compile(
    r"^\s*(?:[-*+]\s+)?(?:([1-4１-４])[\.\)．:：\s]+|([A-Da-d])[\.\):：\s]+|([①②③④])\s*)"
)
IMAGE_INLINE_RE = re.compile(
    r'!\[(.*?)\]\((https?://[^\s\)]+)\)|<img[^>]*src=[\'"]([^\'"]+)[\'"][^>]*>',
    re.IGNORECASE,
)
AUDIO_INLINE_RE = re.compile(
    r'<audio[^>]*src=[\'"]([^\'"]+)[\'"]|<source[^>]*src=[\'"]([^\'"]+)[\'"]|\[[^\]]*\]\((https?://[^\s\)]+\.(?:mp3|wav|ogg|m4a))\)',
    re.IGNORECASE,
)
ANSWER_KEY_HEADER_COMMON_RE = re.compile(
    r"^\s*(?:#+\s*)?(?:\*\*)?(?:Answer\s*Key|Answers|Correct\s*Answers?|解答|正解表?)\s*[:：]?(?:\*\*)?\s*$",
    re.IGNORECASE,
)
ANSWER_KEY_LINE_COMMON_RE = re.compile(
    r"^\s*(?:Question\s*|Q|問)?\s*(\d+)\s*[:：\.\)]\s*([1-4１-４A-Da-d①②③④])(?:\s*(?:[\(（](.*?)[\)）]|[-=>]+\s*(.+)))?\s*$",
    re.IGNORECASE,
)
INLINE_ANSWER_RE = re.compile(
    r"^\s*(?:\*\*)?(?:Answer|Correct\s*Answer|正解)\s*[:：]\s*(?:\*\*)?\s*([1-4１-４A-Da-d①②③④])(?:\s*[\(（](.*?)[\)）])?",
    re.IGNORECASE,
)
QUESTION_LINE_RE = re.compile(
    r"^\s*(?:#+\s*)?(?:\*\*)?(?:(?:Question|Q|問)\s*(\d+)[\.．:\)]?|(\d+)[\.．\)]|(\d+)番)\s*(.*?)(?:\*\*)?\s*$",
    re.IGNORECASE,
)


def normalize_study_markup(text: str) -> str:
    """Convert unambiguous ruby/underline/blank source patterns to Kiroku markup."""
    normalized = re.sub(
        r"<ruby[^>]*>\s*<rb[^>]*>(.*?)</rb>\s*<rt[^>]*>(.*?)</rt>\s*</ruby>",
        r"[\1|\2]",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    normalized = re.sub(
        r"<(?:u|ins)[^>]*>(.*?)</(?:u|ins)>",
        r"{u|\1}",
        normalized,
        flags=re.IGNORECASE | re.DOTALL,
    )
    normalized = BLANK_TOKEN_RAW_RE.sub("{blank}", normalized)
    normalized = re.sub(r"\[\s*(\d+)\s*\]", r"【\1】", normalized)
    # Strip any remaining inline HTML tags cleanly
    normalized = HTML_TAG_STRIP_RE.sub("", normalized)
    return normalized.strip()


def normalize_answer_token(token: str) -> int | None:
    """Map '1'..'4', fullwidth digits, 'A'..'D', or '①'..'④' to ordinal 1..4."""
    clean = token.strip().translate(FULL_WIDTH_DIGITS)
    if clean in ("1", "2", "3", "4"):
        return int(clean)
    if clean in LETTER_TO_ORDINAL:
        return LETTER_TO_ORDINAL[clean]
    if clean in CIRCLED_TO_ORDINAL:
        return CIRCLED_TO_ORDINAL[clean]
    return None


def parse_choice_line(line: str, ordinal_fallback: int) -> ParsedChoice | None:
    """Parse a choice line, supporting optional A-D/1-4 prefixes and inline image URLs."""
    stripped = line.strip()
    if not stripped:
        return None

    img_matches = IMAGE_INLINE_RE.findall(stripped)
    image_url = ""
    alt_text = ""
    if img_matches:
        alt_md, url_md, url_html = img_matches[0]
        image_url = (url_md or url_html or "").strip()
        alt_text = (alt_md or "").strip()

    # Remove image markup before extracting text label
    text_without_img = IMAGE_INLINE_RE.sub("", stripped).strip()
    text_without_img = HTML_TAG_STRIP_RE.sub("", text_without_img).strip()

    m = CHOICE_PREFIX_RE.match(text_without_img)
    ordinal = ordinal_fallback
    clean_text = text_without_img
    if m:
        raw_tok = m.group(1) or m.group(2) or m.group(3)
        parsed_ord = normalize_answer_token(raw_tok)
        if parsed_ord is not None:
            ordinal = parsed_ord
        clean_text = text_without_img[m.end():].strip()
    elif clean_text.startswith(("- ", "* ", "+ ")):
        clean_text = clean_text[2:].strip()

    if not clean_text and image_url:
        clean_text = alt_text or str(ordinal)

    if not clean_text and not image_url:
        return None

    return ParsedChoice(
        ordinal=ordinal,
        label=str(ordinal),
        text=clean_text,
        image_url=image_url or None,
    )


def derive_star_metadata(
    stem: str,
    choices: list[ParsedChoice],
    answer_claim: ParsedAnswerClaim | None,
) -> StarArrangementMetadata | None:
    """Extract F2 star-arrangement metadata if ★ or ☆ appears in stem."""
    if "★" not in stem and "☆" not in stem:
        return None
    tokens = re.split(r"(\{blank\}|★|☆)", stem)
    blank_or_star = [t for t in tokens if t in ("{blank}", "★", "☆")]
    star_idx = 1
    for idx, t in enumerate(blank_or_star, start=1):
        if t in ("★", "☆"):
            star_idx = idx
            break
    star_pos = stem.find("★") if "★" in stem else stem.find("☆")
    pre_stem = stem[:star_pos].replace("{blank}", "").strip()
    post_stem = stem[star_pos + 1 :].replace("{blank}", "").strip()
    fragments = [c.text for c in choices]
    derived_order: list[int] = []
    star_frag = ""
    if answer_claim and answer_claim.rationale:
        rat = answer_claim.rationale
        matched = [(rat.find(frag), frag) for frag in fragments if frag and rat.find(frag) != -1]
        if len(matched) == len(fragments):
            matched.sort(key=lambda x: x[0])
            derived_order = [fragments.index(item[1]) + 1 for item in matched]
            if 1 <= star_idx <= len(derived_order):
                star_frag = fragments[derived_order[star_idx - 1] - 1]
    return StarArrangementMetadata(
        star_position=star_idx,
        total_blanks=len(blank_or_star) or 4,
        pre_stem=pre_stem,
        post_stem=post_stem,
        fragments=fragments,
        derived_order=derived_order,
        star_fragment=star_frag,
    )


def parse_quiz_markdown(
    raw_markdown: str,
    *,
    source_name: str,
    url: str = "",
    title: str = "",
    default_level: str = "N4",
    require_listening_transcript: bool = True,
) -> ParsedExercise:
    """
    Shared deterministic parser for structured JLPT quiz pages (Coto, GyanMirai,
    NihongoMaster, NihongoPro, JLPT Official text/markdown).
    """
    warnings: list[str] = []
    fidelity_flags: set[str] = set()

    normalized_raw = re.sub(r"<br\s*/?>", "\n", raw_markdown, flags=re.IGNORECASE)
    resolved_title = title
    if not resolved_title:
        for line in normalized_raw.splitlines()[:12]:
            stripped = line.strip()
            if stripped.startswith("Title:"):
                resolved_title = stripped.replace("Title:", "", 1).strip()
                break
            if stripped.startswith("# "):
                resolved_title = stripped.lstrip("# ").strip()
                break
            if stripped.startswith("## "):
                resolved_title = stripped.lstrip("# ").strip()
                break
    resolved_title = resolved_title or f"{source_name} Exercise"

    level, section = extract_level_and_section(url, resolved_title)
    level = level or default_level

    # 1. Extract Answer Key section and hidden transcript blocks
    answer_claims: dict[int, ParsedAnswerClaim] = {}
    content_lines: list[str] = []
    in_answer_key = False

    for line in normalized_raw.splitlines():
        stripped = line.strip()
        plain_check = HTML_TAG_STRIP_RE.sub("", stripped).strip()
        if ANSWER_KEY_HEADER_COMMON_RE.match(plain_check) or ANSWER_KEY_HEADER_COMMON_RE.match(stripped):
            in_answer_key = True
            continue
        if in_answer_key:
            ak_m = ANSWER_KEY_LINE_COMMON_RE.match(plain_check)
            if ak_m:
                q_num = int(ak_m.group(1))
                ord_val = normalize_answer_token(ak_m.group(2))
                if ord_val is not None:
                    rationale = (ak_m.group(3) or ak_m.group(4) or "").strip()
                    if q_num in answer_claims:
                        answer_claims[q_num].is_conflicted = True
                        warnings.append(f"Duplicate answer key entry for Question {q_num}.")
                        fidelity_flags.add("duplicate_answer_key")
                    else:
                        answer_claims[q_num] = ParsedAnswerClaim(
                            question_number=q_num,
                            claimed_ordinal=ord_val,
                            rationale=rationale,
                        )
            continue
        content_lines.append(line)

    # 2. Extract transcript blocks (details / [Transcript] / <!-- transcript: ... -->)
    transcripts_by_q: dict[int, str] = {}
    exercise_transcript: str | None = None
    filtered_lines: list[str] = []
    in_transcript_block = False
    transcript_buf: list[str] = []
    transcript_target_q: int | None = None

    explicit_q_re = re.compile(
        r"^\s*(?:#+\s*)?(?:\*\*)?(?:(?:Question|Q|問)\s*(\d+)|(\d+)番)",
        re.IGNORECASE,
    )

    def _find_transcript_target_q(lines_so_far: list[str]) -> int | None:
        for prev in reversed(lines_so_far):
            stripped_prev = HTML_TAG_STRIP_RE.sub("", prev).strip()
            if not stripped_prev:
                continue
            em = explicit_q_re.match(stripped_prev)
            if em:
                return int(em.group(1) or em.group(2))
        return None

    for line in content_lines:
        stripped = line.strip()
        lower = stripped.lower()

        if "<details" in lower or re.match(r"^(?:\*\*)?(?:transcript|script|スクリプト)\s*[:：]?(?:\*\*)?$", lower):
            in_transcript_block = True
            transcript_buf = []
            transcript_target_q = _find_transcript_target_q(filtered_lines)
            continue

        if in_transcript_block:
            if "</details>" in lower or stripped == "[/Transcript]":
                in_transcript_block = False
                joined = HTML_TAG_STRIP_RE.sub("", "\n".join(transcript_buf)).strip()
                if joined:
                    if transcript_target_q is not None:
                        transcripts_by_q[transcript_target_q] = joined
                    else:
                        exercise_transcript = joined
                continue
            if "<summary" in lower:
                continue
            transcript_buf.append(stripped)
            continue

        inline_tr = re.match(
            r"^(?:<!--\s*transcript\s*:\s*(.*?)\s*-->|(?:\*\*)?(?:transcript|script|スクリプト)\s*[:：]\s*(?:\*\*)?\s*(.+))$",
            stripped,
            re.IGNORECASE,
        )
        if inline_tr:
            tr_text = (inline_tr.group(1) or inline_tr.group(2) or "").strip()
            if tr_text:
                target_q = _find_transcript_target_q(filtered_lines)
                if target_q is not None:
                    transcripts_by_q[target_q] = tr_text
                else:
                    exercise_transcript = tr_text
            continue

        filtered_lines.append(line)

    if in_transcript_block and transcript_buf:
        joined = HTML_TAG_STRIP_RE.sub("", "\n".join(transcript_buf)).strip()
        if joined:
            if transcript_target_q is not None:
                transcripts_by_q[transcript_target_q] = joined
            else:
                exercise_transcript = joined

    # 3. Parse questions, choices, passages, media
    questions: list[ParsedQuestion] = []
    passages: list[ParsedPassage] = []
    audio_tracks: list[AudioAssociation] = []

    current_q_num: int | None = None
    current_stem = ""
    current_choice_lines: list[str] = []
    current_images: list[str] = []
    current_audio: AudioAssociation | None = None
    shared_audio: AudioAssociation | None = None
    current_passage: ParsedPassage | None = None
    inline_answers: dict[int, ParsedAnswerClaim] = {}

    def _flush_question() -> None:
        nonlocal current_q_num, current_stem, current_choice_lines, current_images, current_audio
        if current_q_num is None:
            return
        choices: list[ParsedChoice] = []
        q_imgs = list(current_images)
        for idx_c, raw_c in enumerate(current_choice_lines, start=1):
            parsed_c = parse_choice_line(raw_c, ordinal_fallback=len(choices) + 1)
            if parsed_c is not None:
                choices.append(parsed_c)
                if parsed_c.image_url and parsed_c.image_url not in q_imgs:
                    q_imgs.append(parsed_c.image_url)

        raw_claim = inline_answers.get(current_q_num) or answer_claims.get(current_q_num)
        claim = raw_claim.model_copy(deep=True) if raw_claim is not None else None
        norm_stem = normalize_study_markup(current_stem)
        if not norm_stem and (q_imgs or current_audio or shared_audio):
            norm_stem = f"Question {current_q_num}"

        eff_audio = current_audio or shared_audio
        q_audio_urls = [eff_audio.track_url] if eff_audio else []
        transcript_text = transcripts_by_q.get(current_q_num) or (exercise_transcript if eff_audio else None)
        star_meta = derive_star_metadata(norm_stem, choices, claim)

        pq = ParsedQuestion(
            question_number=current_q_num,
            external_id=f"Q{current_q_num}",
            stem=norm_stem,
            choices=choices,
            answer=claim,
            group_reference=current_passage.passage_id if current_passage else None,
            image_urls=q_imgs,
            audio=eff_audio,
            audio_urls=q_audio_urls,
            star_arrangement=star_meta,
            transcript=transcript_text,
            transcript_hidden_until_submit=bool(transcript_text),
        )
        pq.format_code = _derive_format_code(level, section, pq)
        questions.append(pq)

        current_q_num = None
        current_stem = ""
        current_choice_lines = []
        current_images = []
        current_audio = None

    for raw_line in filtered_lines:
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped.startswith(("Title:", "URL:")):
            continue
        if current_q_num is None and stripped.startswith(("# ", "## ")):
            continue

        # Passage header
        p_m = re.match(r"^\s*(?:\*\*)?(?:Reading\s*Passage|Passage|本文)\s*(\d+)[:\.\*\s]*$", HTML_TAG_STRIP_RE.sub("", stripped), re.IGNORECASE)
        if p_m:
            _flush_question()
            pid = f"passage_{p_m.group(1)}"
            current_passage = ParsedPassage(passage_id=pid, title=f"Reading passage {p_m.group(1)}")
            passages.append(current_passage)
            continue

        # Audio line
        audio_matches = AUDIO_INLINE_RE.findall(stripped)
        if audio_matches:
            for match_tuple in audio_matches:
                track_url = next((m for m in match_tuple if m), "")
                if track_url:
                    scope = "question" if current_q_num is not None else ("passage" if current_passage else "shared")
                    target_id = f"Q{current_q_num}" if current_q_num is not None else (current_passage.passage_id if current_passage else None)
                    assoc = AudioAssociation(track_url=track_url, scope=scope, target_id=target_id)
                    audio_tracks.append(assoc)
                    if current_q_num is not None:
                        current_audio = assoc
                    elif current_passage is not None:
                        current_passage.audio = assoc
                        current_passage.audio_urls.append(track_url)
                    else:
                        shared_audio = assoc
            continue

        # Inline answer line inside question block
        if current_q_num is not None:
            ia_m = INLINE_ANSWER_RE.match(HTML_TAG_STRIP_RE.sub("", stripped))
            if ia_m:
                ord_v = normalize_answer_token(ia_m.group(1))
                if ord_v is not None:
                    prior_inline = inline_answers.get(current_q_num)
                    prior_key = answer_claims.get(current_q_num)
                    conflicted = False
                    if prior_inline is not None:
                        conflicted = prior_inline.is_conflicted or (prior_inline.claimed_ordinal != ord_v)
                        warnings.append(f"Duplicate inline answer entry for Question {current_q_num}.")
                        fidelity_flags.add("duplicate_answer_key")
                    if prior_key is not None and (prior_key.is_conflicted or prior_key.claimed_ordinal != ord_v):
                        conflicted = True
                        warnings.append(
                            f"Conflicting inline answer ({ord_v}) and Answer Key ({prior_key.claimed_ordinal}) "
                            f"for Question {current_q_num}."
                        )
                        fidelity_flags.add("conflicting_answer_key")
                    inline_answers[current_q_num] = ParsedAnswerClaim(
                        question_number=current_q_num,
                        claimed_ordinal=ord_v,
                        rationale=(ia_m.group(2) or "").strip(),
                        is_conflicted=conflicted,
                    )
                continue

        # Question header (skip if line is purely a choice with image or radio input)
        is_choice_img = bool(IMAGE_INLINE_RE.search(stripped)) and bool(CHOICE_PREFIX_RE.match(HTML_TAG_STRIP_RE.sub("", stripped)))
        is_radio = "<input" in stripped.lower()
        plain = HTML_TAG_STRIP_RE.sub("", stripped).strip()
        q_m = None
        if not is_choice_img and not is_radio:
            # Distinguish "1. choice text" inside a question (when choices are 1. a / 2. b / 3. c / 4. d)
            # from a new question start!
            q_m = QUESTION_LINE_RE.match(plain)
            if q_m and current_q_num is not None:
                matched_num = int(q_m.group(1) or q_m.group(2) or q_m.group(3))
                # If we have <4 choices and line uses bare "N. text" where N == len(choices)+1 (and N <= 4),
                # treat as a numbered choice rather than a new question unless "Question"/"Q"/"問" prefix was used.
                explicit_q_prefix = q_m.group(1) is not None or q_m.group(3) is not None
                if not explicit_q_prefix and len(current_choice_lines) < 4 and matched_num == len(current_choice_lines) + 1:
                    q_m = None

        if q_m:
            _flush_question()
            matched_num = int(q_m.group(1) or q_m.group(2) or q_m.group(3))
            current_q_num = matched_num
            current_stem = (q_m.group(4) or "").strip()
            continue

        # Standalone image inside question/passage
        img_matches = IMAGE_INLINE_RE.findall(stripped)
        if img_matches and not CHOICE_PREFIX_RE.match(plain):
            for alt_md, url_md, url_html in img_matches:
                img_u = (url_md or url_html or "").strip()
                if img_u:
                    if current_q_num is not None:
                        # In listening picture choice exercises, standalone images after question can be picture choices
                        if not current_choice_lines and not current_stem:
                            current_images.append(img_u)
                        elif section == "listening" and len(current_choice_lines) < 4:
                            current_choice_lines.append(stripped)
                        else:
                            current_images.append(img_u)
                    elif current_passage is not None:
                        current_passage.image_urls.append(img_u)
            continue

        if current_q_num is not None:
            # Lines before choices arrive belong to the stem unless they look like choices/bullets/images.
            if (
                not current_choice_lines
                and not current_stem
                and not CHOICE_PREFIX_RE.match(plain)
                and not stripped.startswith(("- ", "* "))
                and not is_radio
                and not IMAGE_INLINE_RE.search(stripped)
            ):
                current_stem = stripped
            else:
                current_choice_lines.append(stripped)
        elif current_passage is not None:
            norm_p = normalize_study_markup(stripped)
            current_passage.text = f"{current_passage.text}\n{norm_p}".strip() if current_passage.text else norm_p

    _flush_question()

    # Merge inline answers into answer_claims
    all_claims = {**answer_claims, **inline_answers}

    exercise = ParsedExercise(
        title=resolved_title,
        url=url,
        jlpt_level=level,
        section=section,
        source_name=source_name,
        passages=passages,
        questions=questions,
        answer_claims=all_claims,
        audio_tracks=audio_tracks,
        audio_urls=[t.track_url for t in audio_tracks],
        warnings=warnings,
        fidelity_flags=sorted(fidelity_flags),
    )
    scan_report = linear_scan_exercise(
        exercise,
        require_listening_transcript=require_listening_transcript,
    )
    apply_invariant_quarantine(exercise, scan_report)
    return exercise
