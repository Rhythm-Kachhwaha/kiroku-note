"""
Deterministic Parser for Japanese JLPT Question Markup.
-------------------------------------------------------
Parses inline markup DSL into a structured AST:
- Plain Japanese text and punctuation preserved verbatim
- Ruby furigana: [base|reading]
- Underline: {u|...} (supports nested text and ruby)
- Blanks: {blank|anchor_key}
- Star marker: {star}

Strict safety & validation:
- Position-aware error reporting (line, column, offset, context)
- HTML tags (<tag>) are explicitly rejected to prevent injection
- Malformed delimiters and unsupported tags raise MarkupSyntaxError
- Backslash escaping supported: \\{, \\}, \\[, \\], \\|, \\\\
"""
from __future__ import annotations

import re
from typing import Optional

from app.study.markup.ast import (
    ASTNode,
    BlankNode,
    InlineChildNode,
    MarkupAST,
    RubyNode,
    StarNode,
    TextNode,
    UnderlineNode,
)
from app.study.markup.errors import MarkupSyntaxError

# Regex to detect suspicious HTML tags (e.g. <script>, <ruby>, </div>, <!-- -->)
_HTML_TAG_PATTERN = re.compile(r"<\s*[/!]?[a-zA-Z][^>]*>", re.IGNORECASE)


def _compute_line_col(text: str, offset: int) -> tuple[int, int]:
    """Compute 1-based (line, column) for a given 0-based offset."""
    line = 1
    col = 1
    for i, ch in enumerate(text):
        if i >= offset:
            break
        if ch == "\n":
            line += 1
            col = 1
        else:
            col += 1
    return line, col


def _make_snippet(text: str, start: int, max_len: int = 30) -> str:
    """Extract a contextual snippet for error messages."""
    return text[start : start + max_len]


class MarkupParser:
    """
    Deterministic recursive-descent parser for Kiroku study markup DSL.
    """

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.length = len(raw)
        self.pos = 0

    def parse(self) -> MarkupAST:
        """Parse the raw markup into a MarkupAST container."""
        if not self.raw:
            return MarkupAST(raw_markup="", nodes=[])

        # Security check: Arbitrary HTML tags are strictly prohibited
        html_match = _HTML_TAG_PATTERN.search(self.raw)
        if html_match:
            start = html_match.start()
            line, col = _compute_line_col(self.raw, start)
            snippet = _make_snippet(self.raw, start, 25)
            raise MarkupSyntaxError(
                f"HTML tag '{html_match.group(0)}' is not permitted in markup. Use native markup syntax.",
                line=line,
                column=col,
                offset=start,
                snippet=snippet,
            )

        nodes: list[ASTNode] = []
        text_buf: list[str] = []

        def flush_text() -> None:
            if text_buf:
                content = "".join(text_buf)
                nodes.append(TextNode(content=content))
                text_buf.clear()

        while self.pos < self.length:
            ch = self.raw[self.pos]

            # Escaped character
            if ch == "\\":
                if self.pos + 1 < self.length:
                    next_ch = self.raw[self.pos + 1]
                    if next_ch in ("{", "}", "[", "]", "|", "\\"):
                        text_buf.append(next_ch)
                        self.pos += 2
                        continue
                # Standalone backslash
                text_buf.append(ch)
                self.pos += 1
                continue

            # Start of ruby furigana: [base|reading]
            if ch == "[":
                flush_text()
                ruby_node = self._parse_ruby()
                nodes.append(ruby_node)
                continue

            # Start of braced construct: {u|...}, {blank|key}, {star}
            if ch == "{":
                flush_text()
                braced_node = self._parse_braced()
                nodes.append(braced_node)
                continue

            # Unexpected closing bracket
            if ch == "]":
                line, col = _compute_line_col(self.raw, self.pos)
                snippet = _make_snippet(self.raw, self.pos)
                raise MarkupSyntaxError(
                    "Unexpected closing bracket ']' without matching open bracket",
                    line=line,
                    column=col,
                    offset=self.pos,
                    snippet=snippet,
                )

            # Unexpected closing brace
            if ch == "}":
                line, col = _compute_line_col(self.raw, self.pos)
                snippet = _make_snippet(self.raw, self.pos)
                raise MarkupSyntaxError(
                    "Unexpected closing brace '}' without matching open brace",
                    line=line,
                    column=col,
                    offset=self.pos,
                    snippet=snippet,
                )

            text_buf.append(ch)
            self.pos += 1

        flush_text()
        return MarkupAST(raw_markup=self.raw, nodes=nodes)

    def _parse_ruby(self) -> RubyNode:
        """
        Parse [base|reading].
        Precondition: self.raw[self.pos] == '['
        """
        start_pos = self.pos
        start_line, start_col = _compute_line_col(self.raw, start_pos)
        self.pos += 1  # Skip '['

        base_chars: list[str] = []
        reading_chars: list[str] = []
        pipe_found = False

        while self.pos < self.length:
            ch = self.raw[self.pos]

            # Check escape
            if ch == "\\":
                if self.pos + 1 < self.length:
                    next_ch = self.raw[self.pos + 1]
                    if next_ch in ("|", "]", "["):
                        target_list = reading_chars if pipe_found else base_chars
                        target_list.append(next_ch)
                        self.pos += 2
                        continue

            if ch == "[":
                line, col = _compute_line_col(self.raw, self.pos)
                snippet = _make_snippet(self.raw, self.pos)
                raise MarkupSyntaxError(
                    "Nested '[' inside ruby annotation is not allowed",
                    line=line,
                    column=col,
                    offset=self.pos,
                    snippet=snippet,
                )

            if ch == "{" or ch == "}":
                line, col = _compute_line_col(self.raw, self.pos)
                snippet = _make_snippet(self.raw, self.pos)
                raise MarkupSyntaxError(
                    "Braced tags inside ruby annotation are not allowed",
                    line=line,
                    column=col,
                    offset=self.pos,
                    snippet=snippet,
                )

            if ch == "|":
                if pipe_found:
                    line, col = _compute_line_col(self.raw, self.pos)
                    snippet = _make_snippet(self.raw, self.pos)
                    raise MarkupSyntaxError(
                        "Multiple '|' delimiters inside single ruby annotation",
                        line=line,
                        column=col,
                        offset=self.pos,
                        snippet=snippet,
                    )
                pipe_found = True
                self.pos += 1
                continue

            if ch == "]":
                self.pos += 1  # consume ']'
                if not pipe_found:
                    snippet = _make_snippet(self.raw, start_pos)
                    raise MarkupSyntaxError(
                        "Malformed ruby structure: missing '|' delimiter between base text and reading",
                        line=start_line,
                        column=start_col,
                        offset=start_pos,
                        snippet=snippet,
                    )

                base = "".join(base_chars).strip()
                reading = "".join(reading_chars).strip()

                if not base:
                    snippet = _make_snippet(self.raw, start_pos)
                    raise MarkupSyntaxError(
                        "Invalid ruby structure: base text cannot be empty",
                        line=start_line,
                        column=start_col,
                        offset=start_pos,
                        snippet=snippet,
                    )
                if not reading:
                    snippet = _make_snippet(self.raw, start_pos)
                    raise MarkupSyntaxError(
                        "Invalid ruby structure: reading cannot be empty",
                        line=start_line,
                        column=start_col,
                        offset=start_pos,
                        snippet=snippet,
                    )

                return RubyNode(base=base, reading=reading)

            if pipe_found:
                reading_chars.append(ch)
            else:
                base_chars.append(ch)
            self.pos += 1

        # Reached EOF without closing ']'
        snippet = _make_snippet(self.raw, start_pos)
        raise MarkupSyntaxError(
            "Unclosed ruby bracket '['",
            line=start_line,
            column=start_col,
            offset=start_pos,
            snippet=snippet,
        )

    def _parse_braced(self) -> ASTNode:
        """
        Parse {u|...}, {blank|key}, or {star}.
        Precondition: self.raw[self.pos] == '{'
        """
        start_pos = self.pos
        start_line, start_col = _compute_line_col(self.raw, start_pos)
        self.pos += 1  # Skip '{'

        # Find the tag name up to '|' or '}'
        tag_chars: list[str] = []
        while self.pos < self.length and self.raw[self.pos] not in ("|", "}", "\n"):
            tag_chars.append(self.raw[self.pos])
            self.pos += 1

        if self.pos >= self.length:
            snippet = _make_snippet(self.raw, start_pos)
            raise MarkupSyntaxError(
                "Unclosed brace '{'",
                line=start_line,
                column=start_col,
                offset=start_pos,
                snippet=snippet,
            )

        tag = "".join(tag_chars).strip()
        delimiter = self.raw[self.pos]

        # Case 1: {star}
        if tag == "star":
            if delimiter == "}":
                self.pos += 1  # consume '}'
                return StarNode()
            if delimiter == "|":
                # Handle possible {star|} with empty argument
                self.pos += 1
                while self.pos < self.length and self.raw[self.pos] != "}":
                    self.pos += 1
                if self.pos < self.length and self.raw[self.pos] == "}":
                    self.pos += 1
                    return StarNode()
                snippet = _make_snippet(self.raw, start_pos)
                raise MarkupSyntaxError(
                    "Unclosed '{star}' tag",
                    line=start_line,
                    column=start_col,
                    offset=start_pos,
                    snippet=snippet,
                )

        # Case 2: {u|...}
        if tag == "u":
            if delimiter != "|":
                snippet = _make_snippet(self.raw, start_pos)
                raise MarkupSyntaxError(
                    "Malformed underline tag: expected '{u|...}'",
                    line=start_line,
                    column=start_col,
                    offset=start_pos,
                    snippet=snippet,
                )
            self.pos += 1  # consume '|'
            children = self._parse_underline_body(start_pos)
            return UnderlineNode(children=children)

        # Case 3: {blank|key}
        if tag == "blank":
            if delimiter != "|":
                snippet = _make_snippet(self.raw, start_pos)
                raise MarkupSyntaxError(
                    "Malformed blank tag: expected '{blank|key}'",
                    line=start_line,
                    column=start_col,
                    offset=start_pos,
                    snippet=snippet,
                )
            self.pos += 1  # consume '|'
            key_chars: list[str] = []
            while self.pos < self.length and self.raw[self.pos] != "}":
                key_chars.append(self.raw[self.pos])
                self.pos += 1

            if self.pos >= self.length:
                snippet = _make_snippet(self.raw, start_pos)
                raise MarkupSyntaxError(
                    "Unclosed '{blank|' tag",
                    line=start_line,
                    column=start_col,
                    offset=start_pos,
                    snippet=snippet,
                )
            self.pos += 1  # consume '}'

            key = "".join(key_chars).strip()
            if not key:
                snippet = _make_snippet(self.raw, start_pos)
                raise MarkupSyntaxError(
                    "Invalid blank structure: anchor key cannot be empty",
                    line=start_line,
                    column=start_col,
                    offset=start_pos,
                    snippet=snippet,
                )
            return BlankNode(key=key)

        # Any unrecognized tag
        snippet = _make_snippet(self.raw, start_pos)
        raise MarkupSyntaxError(
            f"Unsupported markup tag '{tag}'. Supported tags are 'u', 'blank', and 'star'.",
            line=start_line,
            column=start_col,
            offset=start_pos,
            snippet=snippet,
        )

    def _parse_underline_body(self, tag_start_pos: int) -> list[InlineChildNode]:
        """
        Parse children inside {u|...} until closing '}'.
        Permits text and ruby nodes. Rejects nested underlines.
        """
        children: list[InlineChildNode] = []
        text_buf: list[str] = []

        def flush_child_text() -> None:
            if text_buf:
                children.append(TextNode(content="".join(text_buf)))
                text_buf.clear()

        while self.pos < self.length:
            ch = self.raw[self.pos]

            if ch == "\\":
                if self.pos + 1 < self.length:
                    next_ch = self.raw[self.pos + 1]
                    if next_ch in ("}", "{", "[", "]", "|", "\\"):
                        text_buf.append(next_ch)
                        self.pos += 2
                        continue
                text_buf.append(ch)
                self.pos += 1
                continue

            if ch == "}":
                self.pos += 1  # consume '}'
                flush_child_text()
                if not children:
                    line, col = _compute_line_col(self.raw, tag_start_pos)
                    snippet = _make_snippet(self.raw, tag_start_pos)
                    raise MarkupSyntaxError(
                        "Underline tag '{u|}' cannot be empty",
                        line=line,
                        column=col,
                        offset=tag_start_pos,
                        snippet=snippet,
                    )
                return children

            if ch == "{":
                line, col = _compute_line_col(self.raw, self.pos)
                snippet = _make_snippet(self.raw, self.pos)
                raise MarkupSyntaxError(
                    "Nested braced tags inside underline '{u|...}' are not allowed",
                    line=line,
                    column=col,
                    offset=self.pos,
                    snippet=snippet,
                )

            if ch == "[":
                flush_child_text()
                ruby_node = self._parse_ruby()
                children.append(ruby_node)
                continue

            text_buf.append(ch)
            self.pos += 1

        # Reached EOF without '}'
        line, col = _compute_line_col(self.raw, tag_start_pos)
        snippet = _make_snippet(self.raw, tag_start_pos)
        raise MarkupSyntaxError(
            "Unclosed underline tag '{u|'",
            line=line,
            column=col,
            offset=tag_start_pos,
            snippet=snippet,
        )


def parse_markup(text: str) -> MarkupAST:
    """
    Parse a question markup string into a MarkupAST.
    Raises MarkupSyntaxError if syntax is invalid or delimiters are unclosed.
    """
    parser = MarkupParser(text)
    return parser.parse()

