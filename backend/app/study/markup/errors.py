"""
Markup Parsing & Syntax Errors.
-------------------------------
Provides structured, position-aware exceptions for markup parsing and validation.
"""
from __future__ import annotations

from typing import Optional


class MarkupError(Exception):
    """Base exception for all markup errors."""


class MarkupSyntaxError(MarkupError):
    """
    Raised when markup cannot be parsed due to syntax or delimiter errors.
    Carries 1-based line and column, 0-based offset, and contextual snippet.
    """

    def __init__(
        self,
        message: str,
        line: int = 1,
        column: int = 1,
        offset: int = 0,
        snippet: Optional[str] = None,
    ) -> None:
        self.message = message
        self.line = line
        self.column = column
        self.offset = offset
        self.snippet = snippet

        details = f"at line {line}, column {column} (offset {offset})"
        if snippet:
            full_msg = f"{message} {details}: {snippet!r}"
        else:
            full_msg = f"{message} {details}"
        super().__init__(full_msg)


class MarkupValidationError(MarkupError):
    """Raised when markup is syntactically well-formed but violates domain constraints."""

    def __init__(self, message: str, node_type: Optional[str] = None, context: Optional[str] = None) -> None:
        self.message = message
        self.node_type = node_type
        self.context = context
        full_msg = f"{message} (node: {node_type}, context: {context})" if context else message
        super().__init__(full_msg)

