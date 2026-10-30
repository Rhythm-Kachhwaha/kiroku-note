"""
Validation Functions for Japanese Question Markup.
--------------------------------------------------
Validates AST structure, anchor completeness, star presence, and cross-references
against content group context.
"""
from __future__ import annotations

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
from app.study.markup.errors import MarkupValidationError
from app.study.markup.parser import parse_markup


def _unwrap_nodes(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> Sequence[ASTNode]:
    if isinstance(nodes_or_ast, MarkupAST):
        return nodes_or_ast.nodes
    return nodes_or_ast


def extract_anchors(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> list[str]:
    """Extract all blank anchor keys in order of appearance."""
    nodes = _unwrap_nodes(nodes_or_ast)
    anchors: list[str] = []
    for node in nodes:
        if isinstance(node, BlankNode):
            anchors.append(node.key)
        elif isinstance(node, UnderlineNode):
            # Underline cannot have blanks, but check anyway
            pass
    return anchors


def has_star(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> bool:
    """Return True if any StarNode exists in the AST."""
    nodes = _unwrap_nodes(nodes_or_ast)
    return any(isinstance(n, StarNode) for n in nodes)


def count_stars(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> int:
    """Return total count of StarNodes in the AST."""
    nodes = _unwrap_nodes(nodes_or_ast)
    return sum(1 for n in nodes if isinstance(n, StarNode))


def has_underline(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> bool:
    """Return True if any UnderlineNode exists in the AST."""
    nodes = _unwrap_nodes(nodes_or_ast)
    return any(isinstance(n, UnderlineNode) for n in nodes)


def has_blank(nodes_or_ast: Union[MarkupAST, Sequence[ASTNode]]) -> bool:
    """Return True if any BlankNode exists in the AST."""
    nodes = _unwrap_nodes(nodes_or_ast)
    return any(isinstance(n, BlankNode) for n in nodes)


def validate_group_anchors(
    part_markups: Sequence[str],
    declared_anchor_keys: Sequence[str],
) -> list[str]:
    """
    Validate that all anchors declared on a group revision exist in the part markups,
    and that all {blank|key} occurrences in part markups are uniquely declared.

    Returns the verified list of anchor keys in appearance order.
    Raises MarkupValidationError if an anchor is orphaned, missing, or duplicated.
    """
    found_anchors: list[str] = []
    seen_anchors: set[str] = set()

    for part_idx, markup in enumerate(part_markups):
        ast = parse_markup(markup)
        part_anchors = extract_anchors(ast)
        for key in part_anchors:
            if key in seen_anchors:
                raise MarkupValidationError(
                    f"Duplicate anchor key '{key}' found across group parts (part index {part_idx}).",
                    node_type="blank",
                    context=key,
                )
            seen_anchors.add(key)
            found_anchors.append(key)

    declared_set = set(declared_anchor_keys)
    found_set = set(found_anchors)

    # Check for anchors present in markup but missing in declared list
    undeclared = found_set - declared_set
    if undeclared:
        raise MarkupValidationError(
            f"Anchor(s) {sorted(undeclared)} exist in passage markup but are not registered in declared group anchors.",
            node_type="blank",
            context=str(sorted(undeclared)),
        )

    # Check for anchors declared in group anchors but not found in any part markup
    missing = declared_set - found_set
    if missing:
        raise MarkupValidationError(
            f"Declared group anchor(s) {sorted(missing)} do not appear in any passage part markup.",
            node_type="blank",
            context=str(sorted(missing)),
        )

    return found_anchors

