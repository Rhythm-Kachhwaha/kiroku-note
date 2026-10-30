"""
Shared Contract Models for Choices, Answers, Assets, and Content Groups.
------------------------------------------------------------------------
Implements strictly typed Pydantic models for relational components of questions
and passages, supporting text, image, and unprinted choice modes.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.study.contracts.enums import (
    AnswerOrigin,
    AssetRole,
    ChoiceMode,
    GroupKind,
    GroupPartRole,
    JlptLevel,
)
from app.study.markup.parser import parse_markup
from app.study.markup.validator import validate_group_anchors


class ContractBase(BaseModel):
    """Base model for all study contract entities."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ChoicePayload(ContractBase):
    """
    Relational choice model representing one distractor or answer option.
    Choice presentation modes:
    - text: text_markup is present and parsed.
    - image: choice is backed by an illustration or diagram asset.
    - unprinted: spoken choice in listening exams; text_markup is empty.
    """

    choice_key: str = Field(default="")
    ordinal: int = Field(..., gt=0)
    label: str = Field(default="")
    mode: ChoiceMode = Field(default=ChoiceMode.TEXT)
    text_markup: Optional[str] = None
    asset_id: Optional[int] = None
    asset_sha256: Optional[str] = None

    # Optional fields for source ingestion convenience
    fragment_order_position: Optional[int] = None
    is_correct: Optional[bool] = None
    answer_origin: Optional[AnswerOrigin] = None

    @model_validator(mode="before")
    @classmethod
    def populate_defaults_before(cls, data: dict) -> dict:
        if not isinstance(data, dict):
            return data
        data = dict(data)

        # Support alias display_label -> label
        if "display_label" in data:
            disp = data.pop("display_label")
            if not data.get("label"):
                data["label"] = str(disp)

        # Auto-generate choice_key if missing or empty
        ordinal = data.get("ordinal", 1)
        if not data.get("choice_key"):
            data["choice_key"] = f"choice_{ordinal}"

        # Auto-generate label if missing or empty
        if not data.get("label"):
            data["label"] = str(ordinal)

        return data

    @model_validator(mode="after")
    def validate_choice_mode_semantics(self) -> ChoicePayload:
        if self.mode == ChoiceMode.TEXT:
            if self.text_markup is None or not self.text_markup.strip():
                raise ValueError(
                    f"Choice {self.choice_key} is in 'text' mode, but text_markup is empty or missing. "
                    "Use mode='unprinted' if the choice is spoken-only without printed text."
                )
            if self.asset_id is not None or self.asset_sha256 is not None:
                raise ValueError(
                    f"Choice {self.choice_key} is in 'text' mode, but image assets were attached. "
                    "Use mode='image' for image choices."
                )
            # Verify markup is valid
            parse_markup(self.text_markup)

        elif self.mode == ChoiceMode.IMAGE:
            if self.asset_id is None and not self.asset_sha256:
                raise ValueError(
                    f"Choice {self.choice_key} is in 'image' mode, but neither asset_id nor asset_sha256 was provided."
                )

        elif self.mode == ChoiceMode.UNPRINTED:
            if self.text_markup and self.text_markup.strip():
                raise ValueError(
                    f"Choice {self.choice_key} is marked 'unprinted', but contains text_markup '{self.text_markup}'. "
                    "Unprinted choices must not contain printed text."
                )
            if self.asset_id is not None or self.asset_sha256 is not None:
                raise ValueError(
                    f"Choice {self.choice_key} is marked 'unprinted', but contains image assets."
                )

        return self


class AnswerPayload(ContractBase):
    """
    Canonical answer association referencing a choice_key.
    Stores origin of answer claim and optional rationale.
    """

    choice_key: str = Field(..., min_length=1)
    answer_origin: AnswerOrigin = Field(default=AnswerOrigin.SOURCE_EXPLICIT)
    rationale_markup: str = Field(default="")

    @model_validator(mode="after")
    def validate_rationale(self) -> AnswerPayload:
        if self.rationale_markup:
            parse_markup(self.rationale_markup)
        return self


class AssetRefPayload(ContractBase):
    """Reference to an audio, image, or diagram asset."""

    role: AssetRole
    asset_id: Optional[int] = None
    sha256: Optional[str] = None
    ordinal: int = Field(default=1, gt=0)
    is_required: bool = True

    @model_validator(mode="after")
    def validate_asset_identifier(self) -> AssetRefPayload:
        if self.asset_id is None and not self.sha256:
            raise ValueError("Asset reference must supply either asset_id or sha256.")
        return self


class GroupPartPayload(ContractBase):
    """Immutable ordered component of a group revision (e.g. Passage text or heading)."""

    ordinal: int = Field(..., gt=0)
    role: GroupPartRole = Field(default=GroupPartRole.TEXT)
    title: str = Field(default="")
    markup: str = Field(...)

    @model_validator(mode="after")
    def validate_part_markup(self) -> GroupPartPayload:
        parse_markup(self.markup)
        return self


class GroupAnchorPayload(ContractBase):
    """Named anchor (e.g. blank_35) defined in a passage revision."""

    anchor_key: str = Field(..., min_length=1)
    ordinal: int = Field(..., gt=0)
    display_label: str = Field(default="")
    kind: str = Field(default="blank")
    part_ordinal: int = Field(default=1, gt=0)

    @model_validator(mode="before")
    @classmethod
    def default_display_label(cls, data: dict) -> dict:
        if isinstance(data, dict):
            if not data.get("display_label") and data.get("anchor_key"):
                data["display_label"] = str(data["anchor_key"])
        return data


class GroupAssetRefPayload(ContractBase):
    """Asset reference associated with a group revision or specific part."""

    role: AssetRole
    asset_id: Optional[int] = None
    sha256: Optional[str] = None
    ordinal: int = Field(default=1, gt=0)
    is_required: bool = True
    part_ordinal: Optional[int] = None

    @model_validator(mode="after")
    def validate_asset_identifier(self) -> GroupAssetRefPayload:
        if self.asset_id is None and not self.sha256:
            raise ValueError("Group asset reference must supply either asset_id or sha256.")
        return self


class ContentGroupPayload(ContractBase):
    """
    Contract for a shared passage, audio context, or document set.
    Shared by multiple questions in F3, F4, and F6.
    """

    group_id: Optional[int] = None
    external_id: Optional[str] = None
    kind: GroupKind
    level: JlptLevel
    title: str = Field(default="")
    parts: list[GroupPartPayload] = Field(..., min_length=1)
    anchors: list[GroupAnchorPayload] = Field(default_factory=list)
    assets: list[GroupAssetRefPayload] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_group_structure(self) -> ContentGroupPayload:
        # Validate part ordinals are unique and sequential 1..N
        ordinals = [p.ordinal for p in self.parts]
        expected_ordinals = list(range(1, len(self.parts) + 1))
        if sorted(ordinals) != expected_ordinals:
            raise ValueError(
                f"Group parts ordinals must be sequential integers from 1 to {len(self.parts)}, got {ordinals}."
            )

        # Validate anchor keys are unique
        anchor_keys = [a.anchor_key for a in self.anchors]
        if len(anchor_keys) != len(set(anchor_keys)):
            raise ValueError(f"Duplicate anchor keys found in content group: {anchor_keys}.")

        # If anchors are declared, validate they exist in parts markup
        if self.anchors:
            part_markups = [p.markup for p in sorted(self.parts, key=lambda p: p.ordinal)]
            validate_group_anchors(part_markups, anchor_keys)

        return self

