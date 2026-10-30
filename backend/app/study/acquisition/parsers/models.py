"""
Data Models for Source-Specific Parsers in Study Bank Acquisition.
------------------------------------------------------------------
Represents extracted questions, choices, passages, and answer claims
before transformation into M3 IngestInput payloads.

Supports:
- Multimodal asset associations (diagram images and playable audio tracks)
- Scoped audio relationships (question-level, passage-level, shared, exercise-level)
- Star sentence ordering metadata (F2 family)
- Deterministic JLPT format classification
"""
from __future__ import annotations

import re
from typing import Any, Literal
from pydantic import BaseModel, Field

from app.study.formats import FORMAT_REGISTRY


class AudioAssociation(BaseModel):
    """
    Structured audio track reference and scope association.
    Preserves question-level, passage-level, shared, and exercise-level relationships.
    """
    track_url: str
    scope: Literal["question", "passage", "shared", "exercise"] = "question"
    target_id: str | None = None  # e.g. "Q1", "passage_1", or None if exercise-level
    asset_id: str | None = None   # SHA-256 content address if retrieved into MediaStore
    local_path: str | None = None # Storage path relative to media root
    mime_type: str = "audio/mpeg"
    status: Literal["remote_only", "retrieved", "failed"] = "remote_only"
    error_reason: str | None = None
    duration_ms: int | None = None


class StarArrangementMetadata(BaseModel):
    """
    Structured metadata for JLPT F2 sentence composition (star ordering).
    Preserves ★ position among blanks, choice fragments, and rationale derivation.
    """
    star_position: int  # 1-based index of ★ among blanks (e.g. 3 in ＿＿ ＿＿ ★ ＿＿)
    total_blanks: int = 4
    pre_stem: str = ""   # Context before the blanks
    post_stem: str = ""  # Context after the blanks
    fragments: list[str] = Field(default_factory=list)      # Choices 1..4 fragments
    derived_order: list[int] = Field(default_factory=list)  # Permutation order e.g. [2, 1, 4, 3]
    star_fragment: str = ""                                 # The winning choice fragment at ★


class ParsedChoice(BaseModel):
    """An individual choice extracted from an exercise."""
    ordinal: int
    label: str
    text: str


class ParsedAnswerClaim(BaseModel):
    """Answer claim extracted from exercise answer key section."""
    question_number: int
    claimed_ordinal: int
    rationale: str = ""
    is_conflicted: bool = False


class ParsedQuestion(BaseModel):
    """A single multiple-choice, fill-in-the-blank, or listening question."""
    question_number: int
    external_id: str
    stem: str
    choices: list[ParsedChoice] = Field(default_factory=list)
    answer: ParsedAnswerClaim | None = None
    group_reference: str | None = None
    anchor_key: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    audio: AudioAssociation | None = None
    audio_urls: list[str] = Field(default_factory=list)
    star_arrangement: StarArrangementMetadata | None = None
    format_code: str | None = None


class ParsedPassage(BaseModel):
    """A reading or context passage associated with one or more questions."""
    passage_id: str
    title: str = ""
    text: str = ""
    image_urls: list[str] = Field(default_factory=list)
    audio: AudioAssociation | None = None
    audio_urls: list[str] = Field(default_factory=list)


def _derive_format_code(level: str, section: str, q: ParsedQuestion) -> str | None:
    """
    Deterministically derive official JLPT format code from structural signals.
    Returns None if structure is ambiguous or unsupported.
    """
    if q.format_code and q.format_code in FORMAT_REGISTRY:
        return q.format_code

    has_audio = (q.audio is not None) or bool(q.audio_urls)

    # Choice count validation: official JLPT formats strictly enforce choice counts
    if q.choices:
        if has_audio and len(q.choices) not in (3, 4):
            return None
        elif not has_audio and len(q.choices) != 4:
            return None

    if q.star_arrangement is not None:
        return "sentence_composition"

    if has_audio:
        if len(q.choices) == 3:
            return "quick_response"
        # Check if choices are unprinted/diagrammatic labels (e.g. ['1', '2', '3', '4'])
        is_diagrammatic = all(c.text.strip().isdigit() for c in q.choices) if q.choices else True
        if is_diagrammatic:
            return "task_based_listening"
        return "key_points_listening"

    if q.group_reference:
        if q.anchor_key:
            return "text_grammar"
        return "comprehension_short"

    sec_lower = section.lower()
    if sec_lower in ("kanji",):
        # Check if choices are pure kana (Kanji reading) or kanji (Orthography)
        all_kana = all(re.fullmatch(r"[\u3040-\u309F\u30A0-\u30FF\s]+", c.text.strip()) for c in q.choices if c.text.strip()) if q.choices else True
        if all_kana:
            return "kanji_reading"
        return "orthography"

    if sec_lower in ("grammar", "bunpou"):
        return "sentential_grammar_1"

    if sec_lower in ("vocabulary", "vocab", "goi"):
        has_kanji_choice = any(bool(re.search(r"[\u4E00-\u9FFF]", c.text)) for c in q.choices) if q.choices else False
        if ("{u|" in q.stem or "___" in q.stem) and has_kanji_choice:
            return "orthography"
        if "使い方" in q.stem or "用法" in q.stem:
            return "usage"
        if "意味" in q.stem or "近い" in q.stem:
            return "paraphrases"
        return "contextual_expressions"

    if sec_lower in ("reading", "dokkai"):
        return "comprehension_short"

    if sec_lower in ("listening", "choukai"):
        return "task_based_listening"

    return None


class ParsedExercise(BaseModel):
    """Complete parsed output of an individual exercise page."""
    title: str
    url: str
    jlpt_level: str
    section: str
    passages: list[ParsedPassage] = Field(default_factory=list)
    questions: list[ParsedQuestion] = Field(default_factory=list)
    answer_claims: dict[int, ParsedAnswerClaim] = Field(default_factory=dict)
    audio_tracks: list[AudioAssociation] = Field(default_factory=list)
    audio_urls: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def to_m3_structured_payload(self) -> dict[str, Any]:
        """
        Convert to M3-compliant dictionary for StructuredJsonInputAdapter.
        Conforms strictly to existing M3 Gate 1 ingestion contracts while
        preserving media assets, star arrangement, and deterministic format codes.
        Stops strictly BEFORE M3 Gate 1 persistence or approval.
        """
        groups_payload: list[dict[str, Any]] = []
        for p in self.passages:
            assets: list[dict[str, Any]] = [{"kind": "diagram", "url": u} for u in p.image_urls]
            if p.audio:
                assets.append({
                    "kind": "audio",
                    "url": p.audio.track_url,
                    "asset_id": p.audio.asset_id,
                    "local_path": p.audio.local_path,
                    "status": p.audio.status,
                    "duration_ms": p.audio.duration_ms,
                })
            elif p.audio_urls:
                for u in p.audio_urls:
                    assets.append({"kind": "audio", "url": u})

            anchor_keys = re.findall(r"\{blank\|([^}]+)\}", p.text)
            anchors_data = [
                {"anchor_key": k, "ordinal": idx, "kind": "blank"}
                for idx, k in enumerate(anchor_keys, start=1)
            ]
            groups_payload.append({
                "id": p.passage_id,
                "title": p.title or f"Reading passage ({p.passage_id})",
                "group_type": "passage",
                "raw_body": p.text,
                "parts": [{"ordinal": 1, "role": "text", "markup": p.text}],
                "anchors": anchors_data,
                "attached_assets": assets,
            })

        questions_payload: list[dict[str, Any]] = []

        for q in self.questions:
            choices_data = [
                {
                    "ordinal": c.ordinal,
                    "label": c.label,
                    "text": c.text,
                }
                for c in q.choices
            ]

            ans_payload = None
            if q.answer:
                ans_payload = {
                    "ordinal": q.answer.claimed_ordinal,
                    "rationale": q.answer.rationale,
                }

            derived_code = _derive_format_code(self.jlpt_level, self.section, q)
            format_code = f"{self.jlpt_level}_{self.section.upper()}_CHOICE"

            q_assets: list[dict[str, Any]] = [{"kind": "diagram", "url": u} for u in q.image_urls]
            if q.audio:
                q_assets.append({
                    "kind": "audio",
                    "url": q.audio.track_url,
                    "asset_id": q.audio.asset_id,
                    "local_path": q.audio.local_path,
                    "status": q.audio.status,
                    "duration_ms": q.audio.duration_ms,
                })
            elif q.audio_urls:
                for u in q.audio_urls:
                    q_assets.append({"kind": "audio", "url": u})
            elif self.audio_tracks:
                for tr in self.audio_tracks:
                    if tr.scope in ("shared", "exercise"):
                        q_assets.append({
                            "kind": "audio",
                            "url": tr.track_url,
                            "asset_id": tr.asset_id,
                            "local_path": tr.local_path,
                            "status": tr.status,
                            "duration_ms": tr.duration_ms,
                        })

            q_meta: dict[str, Any] = {
                "official_format_code": derived_code,
            }
            if q.star_arrangement is not None:
                q_meta["star_arrangement"] = q.star_arrangement.model_dump()
            if not derived_code:
                q_meta["is_ambiguous_format"] = True

            effective_audio_urls = list(q.audio_urls)
            if q.audio and q.audio.track_url not in effective_audio_urls:
                effective_audio_urls.append(q.audio.track_url)

            questions_payload.append({
                "external_id": q.external_id,
                "format_code": format_code,
                "stem": q.stem,
                "instruction": "",
                "group_reference": q.group_reference,
                "anchor_key": q.anchor_key,
                "choices": choices_data,
                "answer": ans_payload,
                "image_urls": q.image_urls,
                "audio_urls": effective_audio_urls,
                "attached_assets": q_assets,
                "metadata": q_meta,
            })

        return {
            "source": {
                "name": "JapaneseTest4You",
                "source_type": "web_capture",
                "url": self.url,
                "citation": self.title,
                "license_or_permission": "Public educational web exercise",
                "level": self.jlpt_level,
            },
            "groups": groups_payload,
            "questions": questions_payload,
            "metadata": {
                "raw_warnings": self.warnings,
                "total_questions": len(self.questions),
                "total_passages": len(self.passages),
                "total_audio_tracks": len(self.audio_tracks),
            },
        }
