"""
Data Models for Source-Specific Parsers in Study Bank Acquisition.
------------------------------------------------------------------
Represents extracted questions, choices, passages, and answer claims
before transformation into M3 IngestInput payloads.
"""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


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
    """A single multiple-choice or fill-in-the-blank question."""
    question_number: int
    external_id: str
    stem: str
    choices: list[ParsedChoice] = Field(default_factory=list)
    answer: ParsedAnswerClaim | None = None
    group_reference: str | None = None
    anchor_key: str | None = None
    image_urls: list[str] = Field(default_factory=list)


class ParsedPassage(BaseModel):
    """A reading or context passage associated with one or more questions."""
    passage_id: str
    title: str = ""
    text: str = ""
    image_urls: list[str] = Field(default_factory=list)


class ParsedExercise(BaseModel):
    """Complete parsed output of an individual exercise page."""
    title: str
    url: str
    jlpt_level: str
    section: str
    passages: list[ParsedPassage] = Field(default_factory=list)
    questions: list[ParsedQuestion] = Field(default_factory=list)
    answer_claims: dict[int, ParsedAnswerClaim] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)

    def to_m3_structured_payload(self) -> dict[str, Any]:
        """
        Convert to M3-compliant dictionary for StructuredJsonInputAdapter.
        Conforms strictly to existing M3 Gate 1 ingestion contracts.
        """
        groups_payload: list[dict[str, Any]] = []
        for p in self.passages:
            assets = [{"kind": "diagram", "url": u} for u in p.image_urls]
            import re
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
        format_code = f"{self.jlpt_level}_{self.section.upper()}_CHOICE"

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
            },
        }

