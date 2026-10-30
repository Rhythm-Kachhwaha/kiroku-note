"""
Serialization & Plain-Text Extraction for Markup AST.
-----------------------------------------------------
Converts parsed AST nodes back to canonical markup, plain-text representations,
and sanitized safe HTML fragments.
"""
from __future__ import annotations

import html
from typing import Sequence, Union

from app.study.markup.ast import (
    ASTNode,
    BlankNode,
    MarkupAST,
    RubyNode,
    StarNode,
    TextNode,
    UnderlineNode,
)


def _unwrap_nodes(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> Sequence[ASTNode]:
    if isinstance(nodes_or_ast, MarkupAST):
        return nodes_or_ast.nodes
    return nodes_or_ast


def to_markup(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> str:
    """
    Serialize AST nodes back into deterministic canonical markup DSL.
    Guarantees round-trip equality: to_markup(parse_markup(s)) == s for canonical markup.
    """
    nodes = _unwrap_nodes(nodes_or_ast)
    parts: list[str] = []

    for node in nodes:
        if isinstance(node, TextNode):
            parts.append(node.content)
        elif isinstance(node, RubyNode):
            parts.append(f"[{node.base}|{node.reading}]")
        elif isinstance(node, UnderlineNode):
            inner = to_markup(node.children)
            parts.append(f"{{u|{inner}}}")
        elif isinstance(node, BlankNode):
            parts.append(f"{{blank|{node.key}}}")
        elif isinstance(node, StarNode):
            parts.append("{star}")
        else:
            raise TypeError(f"Unknown AST node type: {type(node)}")

    return "".join(parts)


def to_plain_text(
    nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]],
    include_blank_key: bool = True,
) -> str:
    """
    Convert AST nodes to plain unformatted Japanese text.
    Furigana readings are stripped, retaining base text.
    Blanks render as '（ key ）' or '____'.
    Stars render as '★'.
    """
    nodes = _unwrap_nodes(nodes_or_ast)
    parts: list[str] = []

    for node in nodes:
        if isinstance(node, TextNode):
            parts.append(node.content)
        elif isinstance(node, RubyNode):
            parts.append(node.base)
        elif isinstance(node, UnderlineNode):
            parts.append(to_plain_text(node.children, include_blank_key=include_blank_key))
        elif isinstance(node, BlankNode):
            parts.append(f"（ {node.key} ）" if include_blank_key else " ____ ")
        elif isinstance(node, StarNode):
            parts.append("★")

    return "".join(parts)


def to_reading_text(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> str:
    """
    Convert AST nodes to reading text (ruby annotations replaced by their reading).
    Useful for phonetic search and pronunciation indices.
    """
    nodes = _unwrap_nodes(nodes_or_ast)
    parts: list[str] = []

    for node in nodes:
        if isinstance(node, TextNode):
            parts.append(node.content)
        elif isinstance(node, RubyNode):
            parts.append(node.reading)
        elif isinstance(node, UnderlineNode):
            parts.append(to_reading_text(node.children))
        elif isinstance(node, BlankNode):
            parts.append(f" {node.key} ")
        elif isinstance(node, StarNode):
            parts.append("★")

    return "".join(parts)


def to_safe_html(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> str:
    """
    Safely render AST nodes into sanitized HTML for presentation.
    All text contents are escaped via html.escape().
    """
    nodes = _unwrap_nodes(nodes_or_ast)
    parts: list[str] = []

    for node in nodes:
        if isinstance(node, TextNode):
            parts.append(html.escape(node.content))
        elif isinstance(node, RubyNode):
            base_esc = html.escape(node.base)
            rt_esc = html.escape(node.reading)
            parts.append(f"<ruby>{base_esc}<rt>{rt_esc}</rt></ruby>")
        elif isinstance(node, UnderlineNode):
            inner_html = to_safe_html(node.children)
            parts.append(f'<span class="study-target-underline">{inner_html}</span>')
        elif isinstance(node, BlankNode):
            key_esc = html.escape(node.key)
            parts.append(f'<span class="study-target-blank" data-anchor="{key_esc}">（ {key_esc} ）</span>')
        elif isinstance(node, StarNode):
            parts.append('<span class="study-target-star">★</span>')

    return "".join(parts)

