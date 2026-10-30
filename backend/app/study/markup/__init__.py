"""
Kiroku Study Markup Subsystem.
------------------------------
Deterministic parser, AST, validation, and serialization for JLPT question markup DSL.
"""
from __future__ import annotations

from app.study.markup.ast import (
    ASTBaseNode,
    ASTNode,
    BlankNode,
    InlineChildNode,
    MarkupAST,
    RubyNode,
    StarNode,
    TextNode,
    UnderlineNode,
)
from app.study.markup.errors import (
    MarkupError,
    MarkupSyntaxError,
    MarkupValidationError,
)
from app.study.markup.parser import (
    MarkupParser,
    parse_markup,
)
from app.study.markup.serializer import (
    to_markup,
    to_plain_text,
    to_reading_text,
    to_safe_html,
)
from app.study.markup.validator import (
    count_stars,
    extract_anchors,
    has_blank,
    has_star,
    has_underline,
    validate_group_anchors,
)

__all__ = [
    "ASTBaseNode",
    "ASTNode",
    "BlankNode",
    "InlineChildNode",
    "MarkupAST",
    "MarkupError",
    "MarkupParser",
    "MarkupSyntaxError",
    "MarkupValidationError",
    "RubyNode",
    "StarNode",
    "TextNode",
    "UnderlineNode",
    "count_stars",
    "extract_anchors",
    "has_blank",
    "has_star",
    "has_underline",
    "parse_markup",
    "to_markup",
    "to_plain_text",
    "to_reading_text",
    "to_safe_html",
    "validate_group_anchors",
]

