"""
Abstract Syntax Tree (AST) for Japanese JLPT Question Markup.
-------------------------------------------------------------
Defines strictly typed Pydantic models representing parsed inline markup nodes:
- TextNode: Plain Japanese text
- RubyNode: [base|reading] furigana annotations
- UnderlineNode: {u|...} underlined target text with inline children
- BlankNode: {blank|key} fill-in-the-blank target anchors
- StarNode: {star} target star marker for F2 sentence composition
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ASTBaseNode(BaseModel):
    """Base class for all markup AST nodes."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class TextNode(ASTBaseNode):
    """Plain text content preserving original Japanese characters and punctuation."""

    type: Literal["text"] = "text"
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v:
            raise ValueError("TextNode content must not be empty.")
        return v


class RubyNode(ASTBaseNode):
    """
    Furigana annotation [base|reading].
    Example: [漢字|かんじ]
    """

    type: Literal["ruby"] = "ruby"
    base: str
    reading: str

    @field_validator("base", "reading")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Ruby base and reading must not be empty.")
        return s


InlineChildNode = Annotated[
    Union[TextNode, RubyNode],
    Field(discriminator="type"),
]


class UnderlineNode(ASTBaseNode):
    """
    Underlined segment {u|...}.
    May contain plain text and ruby annotations.
    Example: {u|[山|やま]}
    """

    type: Literal["underline"] = "underline"
    children: list[InlineChildNode]

    @field_validator("children")
    @classmethod
    def validate_children(cls, v: list[InlineChildNode]) -> list[InlineChildNode]:
        if not v:
            raise ValueError("UnderlineNode children must not be empty.")
        return v


class BlankNode(ASTBaseNode):
    """
    Fill-in-the-blank target anchor {blank|key}.
    Example: {blank|35} or {blank|blank_35}
    """

    type: Literal["blank"] = "blank"
    key: str

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("BlankNode key must not be empty.")
        return s


class StarNode(ASTBaseNode):
    """
    Target star marker {star} for JLPT sentence composition (F2).
    """

    type: Literal["star"] = "star"


ASTNode = Annotated[
    Union[TextNode, RubyNode, UnderlineNode, BlankNode, StarNode],
    Field(discriminator="type"),
]


class MarkupAST(BaseModel):
    """Container holding the complete AST of a parsed markup string."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    raw_markup: str
    nodes: list[ASTNode]

