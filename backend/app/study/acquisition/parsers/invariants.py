"""
Hardened Parser AST & Verification Invariants (Anti-False-Key Rules).
---------------------------------------------------------------------
Enforces strict structural, numbering, answer-mapping, blank-marker, choice,
cleanliness, passage, and listening media invariants across all source parsers.

Guarantees:
- Full linear scan across every question without early stop
- Zero silent duplicate-number or off-by-one answer key corruption
- Automatic quarantine of any exercise or question with violations or parser warnings
"""
from __future__ import annotations

from collections import Counter
import re
from typing import Literal, Sequence

from pydantic import BaseModel, Field

from app.study.acquisition.parsers.models import ParsedExercise, ParsedPassage, ParsedQuestion
from app.study.formats import FORMAT_REGISTRY


HTML_RESIDUE_RE = re.compile(
    r"</?(?:p|div|span|strong|b|em|i|u|ins|a|img|audio|source|input|script|style|br|table|tr|td|th|h\d|details|summary)\b[^>]*>",
    re.IGNORECASE,
)
MARKDOWN_RESIDUE_RE = re.compile(r"\*\*|!\[[^\]]*\]\(|\[[^\]]+\]\(https?://|&nbsp;|&amp;|\(cid:|\ufffd", re.IGNORECASE)
BLANK_TOKEN_RE = re.compile(r"\{blank(?:\|[^}]+)?\}")

LISTENING_FORMATS = frozenset({
    "task_based_listening",
    "key_points_listening",
    "points_comprehension",
    "quick_response",
    "integrated_listening",
})


class InvariantViolation(BaseModel):
    """Single deterministic invariant violation recorded during linear scan."""

    code: str
    severity: Literal["error", "warning"] = "error"
    question_number: int | None = None
    external_id: str | None = None
    field: str = ""
    message: str


class InvariantScanReport(BaseModel):
    """Complete linear-scan invariant report for one ParsedExercise."""

    source_name: str = ""
    url: str = ""
    total_questions: int = 0
    passed: bool = True
    quarantined: bool = False
    violations: list[InvariantViolation] = Field(default_factory=list)
    quarantined_question_numbers: list[int] = Field(default_factory=list)
    per_question_violations: dict[int, list[InvariantViolation]] = Field(default_factory=dict)


class SourceScanReport(BaseModel):
    """Aggregate linear-scan invariant report across a batch of exercises."""

    total_exercises: int = 0
    passed_exercises: int = 0
    quarantined_exercises: int = 0
    total_questions: int = 0
    total_violations: int = 0
    passed: bool = True
    reports: list[InvariantScanReport] = Field(default_factory=list)


def _has_residue(text: str) -> bool:
    if not text:
        return False
    return bool(HTML_RESIDUE_RE.search(text) or MARKDOWN_RESIDUE_RE.search(text))


def _is_listening_question(exercise: ParsedExercise, q: ParsedQuestion) -> bool:
    if q.format_code in LISTENING_FORMATS:
        return True
    if exercise.section.lower() in ("listening", "choukai"):
        return True
    return q.audio is not None or bool(q.audio_urls)


def linear_scan_exercise(
    exercise: ParsedExercise,
    *,
    require_audio_duration: bool = False,
    require_listening_transcript: bool = True,
) -> InvariantScanReport:
    """
    Perform a complete linear scan across EVERY question in a ParsedExercise.
    Never stops early on the first violation; returns a full violation report.
    """
    violations: list[InvariantViolation] = []
    per_q: dict[int, list[InvariantViolation]] = {}

    def _add(v: InvariantViolation) -> None:
        violations.append(v)
        if v.question_number is not None:
            per_q.setdefault(v.question_number, []).append(v)

    questions = exercise.questions
    passage_map: dict[str, ParsedPassage] = {p.passage_id: p for p in exercise.passages}

    if not questions:
        _add(
            InvariantViolation(
                code="NO_QUESTIONS_PARSED",
                severity="error",
                field="questions",
                message="Exercise yielded zero parsed questions.",
            )
        )

    # 1. Unique contiguous numbering 1..N
    q_numbers = [q.question_number for q in questions]
    num_counts = Counter(q_numbers)
    duplicate_nums = {num for num, cnt in num_counts.items() if cnt > 1}
    for dup_num in sorted(duplicate_nums):
        _add(
            InvariantViolation(
                code="DUPLICATE_QUESTION_NUMBER",
                severity="error",
                question_number=dup_num,
                field="question_number",
                message=f"Duplicate question number {dup_num} appears {num_counts[dup_num]} times.",
            )
        )

    if questions:
        expected_nums = list(range(1, len(questions) + 1))
        if q_numbers != expected_nums:
            missing_nums = sorted(set(expected_nums) - set(q_numbers))
            unexpected_nums = sorted(set(q_numbers) - set(expected_nums))
            _add(
                InvariantViolation(
                    code="NON_CONTIGUOUS_NUMBERING",
                    severity="error",
                    field="questions",
                    message=(
                        f"Question numbering is not contiguous 1..{len(questions)}: "
                        f"got {q_numbers}, missing={missing_nums}, unexpected={unexpected_nums}."
                    ),
                )
            )

    # 2. Check orphan answer keys in answer_claims
    parsed_q_num_set = set(q_numbers)
    for ak_num in sorted(exercise.answer_claims.keys()):
        if ak_num not in parsed_q_num_set:
            _add(
                InvariantViolation(
                    code="ORPHAN_ANSWER_KEY",
                    severity="error",
                    question_number=ak_num,
                    field="answer_claims",
                    message=f"Orphan answer key for Question {ak_num} has no matching parsed question.",
                )
            )

    # 3. Inspect EVERY question without early return
    for q in questions:
        qn = q.question_number
        eid = q.external_id

        # 3a. Stem cleanliness
        if not q.stem or not q.stem.strip():
            _add(
                InvariantViolation(
                    code="EMPTY_STEM",
                    severity="error",
                    question_number=qn,
                    external_id=eid,
                    field="stem",
                    message=f"Question {qn}: Stem is empty.",
                )
            )
        elif _has_residue(q.stem):
            _add(
                InvariantViolation(
                    code="HTML_MARKDOWN_RESIDUE",
                    severity="error",
                    question_number=qn,
                    external_id=eid,
                    field="stem",
                    message=f"Question {qn}: Lingering HTML or markdown residue detected in stem.",
                )
            )

        # 3b. Choice count, emptiness, uniqueness, and cleanliness
        expected_min, expected_max = (3, 4) if _is_listening_question(exercise, q) else (4, 4)
        if q.format_code and q.format_code in FORMAT_REGISTRY:
            fmt_meta = FORMAT_REGISTRY[q.format_code]
            expected_min = fmt_meta.min_choices
            expected_max = fmt_meta.max_choices

        if not (expected_min <= len(q.choices) <= expected_max):
            _add(
                InvariantViolation(
                    code="INVALID_CHOICE_COUNT",
                    severity="error",
                    question_number=qn,
                    external_id=eid,
                    field="choices",
                    message=(
                        f"Question {qn}: Expected {expected_min}..{expected_max} choices, "
                        f"found {len(q.choices)}."
                    ),
                )
            )

        seen_choice_keys: set[tuple[str, str]] = set()
        for c in q.choices:
            c_text = c.text.strip()
            c_img = (c.image_url or "").strip()
            if not c_text and not c_img:
                _add(
                    InvariantViolation(
                        code="EMPTY_CHOICE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field=f"choices[{c.ordinal}]",
                        message=f"Question {qn}: Choice {c.ordinal} is empty.",
                    )
                )
            if _has_residue(c_text):
                _add(
                    InvariantViolation(
                        code="HTML_MARKDOWN_RESIDUE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field=f"choices[{c.ordinal}]",
                        message=f"Question {qn}: Lingering HTML or markdown residue in choice {c.ordinal}.",
                    )
                )
            dedup_key = (c_text, c_img)
            if (c_text or c_img) and dedup_key in seen_choice_keys:
                _add(
                    InvariantViolation(
                        code="DUPLICATE_CHOICE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field=f"choices[{c.ordinal}]",
                        message=f"Question {qn}: Duplicate choice content '{c_text or c_img}'.",
                    )
                )
            seen_choice_keys.add(dedup_key)

        # 3c. Answer key 1-to-1 and range checks
        if q.answer is None:
            _add(
                InvariantViolation(
                    code="MISSING_ANSWER_KEY",
                    severity="error",
                    question_number=qn,
                    external_id=eid,
                    field="answer",
                    message=f"Question {qn}: Missing answer key.",
                )
            )
        else:
            if q.answer.question_number != qn:
                _add(
                    InvariantViolation(
                        code="ANSWER_NUMBER_MISMATCH",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="answer.question_number",
                        message=(
                            f"Question {qn}: Answer claim number {q.answer.question_number} "
                            f"does not match question number {qn}."
                        ),
                    )
                )
            if not (1 <= q.answer.claimed_ordinal <= len(q.choices)):
                _add(
                    InvariantViolation(
                        code="ANSWER_OUT_OF_RANGE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="answer.claimed_ordinal",
                        message=(
                            f"Question {qn}: Claimed answer ordinal {q.answer.claimed_ordinal} "
                            f"is outside 1..{len(q.choices)}."
                        ),
                    )
                )
            if q.answer.is_conflicted:
                _add(
                    InvariantViolation(
                        code="ANSWER_CONFLICT",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="answer.is_conflicted",
                        message=f"Question {qn}: Answer key is flagged as conflicted.",
                    )
                )

        # 3d. Blank marker verification for blank-style formats
        if q.format_code in ("sentential_grammar_1", "contextual_expressions"):
            if not BLANK_TOKEN_RE.search(q.stem):
                _add(
                    InvariantViolation(
                        code="MISSING_BLANK_MARKER",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="stem",
                        message=(
                            f"Question {qn}: Format '{q.format_code}' requires a {{blank}} marker in stem."
                        ),
                    )
                )
        elif q.format_code == "sentence_composition" or q.star_arrangement is not None:
            has_star = ("★" in q.stem) or ("☆" in q.stem) or ("{star}" in q.stem)
            has_blank = bool(BLANK_TOKEN_RE.search(q.stem))
            if not has_star or not has_blank:
                _add(
                    InvariantViolation(
                        code="MISSING_BLANK_MARKER",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="stem",
                        message=(
                            f"Question {qn}: Sentence composition requires both star (★) and {{blank}} markers."
                        ),
                    )
                )

        # 3e. Passage & anchor checks
        if q.group_reference:
            passage = passage_map.get(q.group_reference)
            if passage is None or (not passage.text.strip() and not passage.image_urls and not passage.audio and not passage.audio_urls):
                _add(
                    InvariantViolation(
                        code="MISSING_PASSAGE_REFERENCE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="group_reference",
                        message=f"Question {qn}: Referenced passage '{q.group_reference}' is missing or empty.",
                    )
                )
            elif q.format_code == "text_grammar":
                if not q.anchor_key:
                    _add(
                        InvariantViolation(
                            code="MISSING_BLANK_MARKER",
                            severity="error",
                            question_number=qn,
                            external_id=eid,
                            field="anchor_key",
                            message=f"Question {qn}: text_grammar requires an anchor_key.",
                        )
                    )
                else:
                    expected_anchor = f"{{blank|{q.anchor_key}}}"
                    raw_anchor_md = f"[{q.anchor_key}]"
                    if expected_anchor not in passage.text and raw_anchor_md not in passage.text:
                        _add(
                            InvariantViolation(
                                code="MISSING_ANCHOR_IN_PASSAGE",
                                severity="error",
                                question_number=qn,
                                external_id=eid,
                                field="anchor_key",
                                message=(
                                    f"Question {qn}: Anchor {expected_anchor} not found in passage '{passage.passage_id}'."
                                ),
                            )
                        )

        # 3f. Referenced images check
        for idx_img, img_url in enumerate(q.image_urls, start=1):
            if not img_url or not img_url.strip():
                _add(
                    InvariantViolation(
                        code="EMPTY_IMAGE_REF",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field=f"image_urls[{idx_img - 1}]",
                        message=f"Question {qn}: Empty image URL reference.",
                    )
                )

        # 3g. Listening checks
        if _is_listening_question(exercise, q):
            passage = passage_map.get(q.group_reference) if q.group_reference else None
            has_q_audio = (q.audio is not None and bool(q.audio.track_url.strip())) or any(
                u.strip() for u in q.audio_urls
            )
            has_p_audio = passage is not None and (
                (passage.audio is not None and bool(passage.audio.track_url.strip()))
                or any(u.strip() for u in passage.audio_urls)
            )
            has_shared_audio = any(
                tr.scope in ("shared", "exercise") and bool(tr.track_url.strip())
                for tr in exercise.audio_tracks
            )
            if not (has_q_audio or has_p_audio or has_shared_audio):
                _add(
                    InvariantViolation(
                        code="MISSING_AUDIO",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="audio",
                        message=f"Question {qn}: Listening item has no resolved audio track.",
                    )
                )
            elif q.audio is not None:
                if q.audio.status == "failed":
                    _add(
                        InvariantViolation(
                            code="AUDIO_RETRIEVAL_FAILED",
                            severity="error",
                            question_number=qn,
                            external_id=eid,
                            field="audio",
                            message=f"Question {qn}: Audio retrieval failed ({q.audio.error_reason}).",
                        )
                    )
                if q.audio.duration_ms is not None and q.audio.duration_ms <= 0:
                    _add(
                        InvariantViolation(
                            code="INVALID_AUDIO_DURATION",
                            severity="error",
                            question_number=qn,
                            external_id=eid,
                            field="audio.duration_ms",
                            message=f"Question {qn}: Invalid audio duration {q.audio.duration_ms}ms.",
                        )
                    )
                elif require_audio_duration and q.audio.duration_ms is None:
                    _add(
                        InvariantViolation(
                            code="MISSING_AUDIO_DURATION",
                            severity="warning",
                            question_number=qn,
                            external_id=eid,
                            field="audio.duration_ms",
                            message=f"Question {qn}: Audio duration has not been verified yet.",
                        )
                    )
            if require_listening_transcript and not (q.transcript and q.transcript.strip()):
                _add(
                    InvariantViolation(
                        code="MISSING_TRANSCRIPT",
                        severity="warning",
                        question_number=qn,
                        external_id=eid,
                        field="transcript",
                        message=f"Question {qn}: Listening item has no transcript attached.",
                    )
                )
            has_q_image = any(u.strip() for u in q.image_urls)
            has_choice_image = any(c.image_url and c.image_url.strip() for c in q.choices)
            has_p_image = passage is not None and any(u.strip() for u in passage.image_urls)
            is_numeric_only_choices = bool(q.choices) and all(c.text.strip().isdigit() for c in q.choices)
            if q.format_code == "task_based_listening" and not (has_q_image or has_choice_image or has_p_image):
                if is_numeric_only_choices or not q.choices:
                    _add(
                        InvariantViolation(
                            code="MISSING_LISTENING_IMAGE",
                            severity="error",
                            question_number=qn,
                            external_id=eid,
                            field="image_urls",
                            message=(
                                f"Question {qn}: Diagrammatic listening item (task_based_listening) "
                                "has no attached diagram or choice images."
                            ),
                        )
                    )
            elif has_choice_image and any(
                not (c.image_url and c.image_url.strip()) and (not c.text.strip() or c.text.strip().isdigit())
                for c in q.choices
            ):
                _add(
                    InvariantViolation(
                        code="MISSING_LISTENING_IMAGE",
                        severity="error",
                        question_number=qn,
                        external_id=eid,
                        field="choices",
                        message=f"Question {qn}: Picture-choice listening item is missing choice images.",
                    )
                )

    # 4. Parser warnings / fidelity flags quarantine check
    if exercise.warnings or exercise.fidelity_flags:
        _add(
            InvariantViolation(
                code="PARSER_WARNING",
                severity="warning",
                field="warnings",
                message=(
                    f"Parser reported {len(exercise.warnings)} warning(s) and "
                    f"{len(exercise.fidelity_flags)} fidelity flag(s)."
                ),
            )
        )

    quarantined = len(violations) > 0
    return InvariantScanReport(
        source_name=exercise.source_name,
        url=exercise.url,
        total_questions=len(questions),
        passed=not quarantined,
        quarantined=quarantined,
        violations=violations,
        quarantined_question_numbers=sorted(per_q.keys()),
        per_question_violations=per_q,
    )


def apply_invariant_quarantine(
    exercise: ParsedExercise,
    report: InvariantScanReport,
) -> InvariantScanReport:
    """Apply scan report violations onto ParsedExercise and mark affected items quarantined."""
    exercise.invariant_violations = [v.model_dump() for v in report.violations]
    exercise.quarantined = report.quarantined

    for v in report.violations:
        if v.code not in ("PARSER_WARNING",):
            flag_slug = v.code.lower()
            if flag_slug not in exercise.fidelity_flags:
                exercise.fidelity_flags.append(flag_slug)
            if v.message not in exercise.warnings:
                exercise.warnings.append(v.message)

    exercise.fidelity_flags = sorted(set(exercise.fidelity_flags))

    for q in exercise.questions:
        q_viols = report.per_question_violations.get(q.question_number, [])
        if q_viols or report.quarantined:
            if q_viols:
                q.is_quarantined = True
                q.quarantine_reasons = sorted({v.code for v in q_viols})
                if q.answer is not None and any(v.severity == "error" for v in q_viols):
                    q.answer.is_conflicted = True
    return report


def linear_scan_source(
    exercises: Sequence[ParsedExercise],
    *,
    require_audio_duration: bool = False,
    require_listening_transcript: bool = True,
) -> SourceScanReport:
    """Run linear_scan_exercise across all parsed exercises from a source without early stop."""
    reports = [
        linear_scan_exercise(
            ex,
            require_audio_duration=require_audio_duration,
            require_listening_transcript=require_listening_transcript,
        )
        for ex in exercises
    ]
    total_q = sum(r.total_questions for r in reports)
    total_v = sum(len(r.violations) for r in reports)
    quarantined_ex = sum(1 for r in reports if r.quarantined)
    passed_ex = len(reports) - quarantined_ex
    return SourceScanReport(
        total_exercises=len(reports),
        passed_exercises=passed_ex,
        quarantined_exercises=quarantined_ex,
        total_questions=total_q,
        total_violations=total_v,
        passed=quarantined_ex == 0,
        reports=reports,
    )
