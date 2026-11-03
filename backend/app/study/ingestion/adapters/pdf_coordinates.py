"""Coordinate-aware extraction helpers for selectable-text PDFs."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from app.study.ingestion.models import ExtractedLine, ExtractedPage, ExtractedTextSpan


@dataclass(frozen=True)
class VectorLine:
    """A stroked horizontal or vertical PDF path segment."""

    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def horizontal(self) -> bool:
        return abs(self.y2 - self.y1) <= 1.5


def _bbox(span: ExtractedTextSpan) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = span.bbox
    return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)


def _span_direction(tm: Sequence[float]) -> str:
    if len(tm) >= 4 and abs(float(tm[1])) > abs(float(tm[0])):
        return "vertical"
    return "horizontal"


def collect_spans(
    text: str,
    cm: Sequence[float],
    tm: Sequence[float],
    font_size: float,
    page_number: int,
    page_height: float,
) -> ExtractedTextSpan | None:
    """Convert a PDF visitor callback into a normalized text span."""
    if not text or not text.strip() or len(tm) < 6:
        return None
    x = float(tm[4])
    y = float(tm[5])
    size = abs(float(font_size)) or 1.0
    direction = _span_direction(tm)
    if direction == "vertical":
        bbox = (x - size / 2, y, x + size / 2, y + max(size, len(text) * size))
    else:
        width = max(size * 0.45, len(text) * size * 0.5)
        bbox = (x, y, x + width, y + size)
    return ExtractedTextSpan(
        text=text,
        bbox=bbox,
        font_size=size,
        direction=direction,
        page_number=page_number,
        metadata={"page_height": page_height, "transform": list(cm) if cm else []},
    )


def order_lines(
    spans: Iterable[ExtractedTextSpan],
    *,
    page_width: float,
    page_height: float,
) -> list[ExtractedLine]:
    """Group spans into lines and apply stable column/direction ordering."""
    remaining = list(spans)
    lines: list[list[ExtractedTextSpan]] = []
    while remaining:
        seed = remaining.pop(0)
        sx1, sy1, sx2, sy2 = _bbox(seed)
        tolerance = max(2.0, seed.font_size * 0.55)
        group = [seed]
        matched: list[ExtractedTextSpan] = []
        for candidate in remaining:
            cx1, cy1, cx2, cy2 = _bbox(candidate)
            same_direction = candidate.direction == seed.direction
            if seed.direction == "vertical":
                aligned = abs((sx1 + sx2) / 2 - (cx1 + cx2) / 2) <= tolerance
            else:
                aligned = (
                    abs((sy1 + sy2) / 2 - (cy1 + cy2) / 2) <= tolerance
                    and (
                        max(0.0, min(sx2, cx2) - max(sx1, cx1)) > 0
                        or abs(cx1 - sx2) <= max(2.0, seed.font_size * 1.5)
                        or abs(sx1 - cx2) <= max(2.0, seed.font_size * 1.5)
                    )
                )
            ruby_aligned = (
                same_direction
                and seed.direction == "horizontal"
                and candidate.font_size < seed.font_size * 0.78
                and abs(cx1 - sx1) <= max(2.0, seed.font_size)
                and cy1 >= sy2 - seed.font_size * 0.2
                and cy1 - sy2 <= seed.font_size * 1.5
            )
            if same_direction and (aligned or ruby_aligned):
                group.append(candidate)
                matched.append(candidate)
        for candidate in matched:
            remaining.remove(candidate)
        lines.append(group)

    def line_key(group: list[ExtractedTextSpan]) -> tuple[float, float]:
        boxes = [_bbox(span) for span in group]
        left = min(box[0] for box in boxes)
        top = max(box[3] for box in boxes)
        direction = group[0].direction
        if direction == "vertical":
            return (-left, -top)
        return (left, -top)

    ordered: list[ExtractedLine] = []
    for group in sorted(lines, key=line_key):
        direction = group[0].direction
        if direction == "vertical":
            group.sort(key=lambda span: -_bbox(span)[3])
        else:
            group.sort(key=lambda span: _bbox(span)[0])
        boxes = [_bbox(span) for span in group]
        ordered.append(
            ExtractedLine(
                text="".join(span.text for span in group),
                spans=group,
                bbox=(
                    min(box[0] for box in boxes),
                    min(box[1] for box in boxes),
                    max(box[2] for box in boxes),
                    max(box[3] for box in boxes),
                ),
                direction=direction,
                confidence=1.0 if len(group) > 1 else 0.85,
            )
        )
    return ordered


def remove_repeated_edge_lines(pages: Sequence[ExtractedPage]) -> None:
    """Remove repeated headers and footers across pages, conservatively."""
    edge_text: list[str] = []
    for page in pages:
        height = float(page.metadata.get("height", 0.0))
        edge_text.extend(
            line.text.strip()
            for line in page.lines
            if line.text.strip()
            and (
                line.bbox[3] >= height * 0.9
                or line.bbox[1] <= height * 0.1
            )
        )
    repeated = {text for text, count in Counter(edge_text).items() if count > 1}
    if not repeated:
        return
    for page in pages:
        height = float(page.metadata.get("height", 0.0))
        page.lines = [
            line
            for line in page.lines
            if not (
                line.text.strip() in repeated
                and (
                    line.bbox[3] >= height * 0.9
                    or line.bbox[1] <= height * 0.1
                )
            )
        ]
        vector_lines = [
            VectorLine(
                float(item["x1"]),
                float(item["y1"]),
                float(item["x2"]),
                float(item["y2"]),
            )
            for item in page.metadata.get("vector_lines", [])
        ]
        page.text = markup_for_lines(page.lines, vector_lines)


def markup_for_lines(
    lines: Sequence[ExtractedLine],
    vector_lines: Sequence[VectorLine] = (),
) -> str:
    """Emit canonical markup only for unambiguous ruby and underline marks."""
    rendered: list[str] = []
    for line in lines:
        spans = list(line.spans)
        consumed: set[int] = set()
        parts: list[str] = []
        for index, span in enumerate(spans):
            if index in consumed:
                continue
            x1, y1, x2, y2 = _bbox(span)
            ruby_index = _ruby_candidate(index, span, spans)
            if ruby_index is not None:
                reading = spans[ruby_index]
                value = f"[{span.text}|{reading.text}]"
                if _has_unambiguous_underline(span, vector_lines):
                    value = f"{{u|{value}}}"
                parts.append(value)
                consumed.add(ruby_index)
            else:
                value = span.text
                if _has_unambiguous_underline(span, vector_lines):
                    value = f"{{u|{value}}}"
                parts.append(value)
        rendered.append("".join(parts))
    return "\n".join(rendered)


def _ruby_candidate(
    index: int,
    base: ExtractedTextSpan,
    spans: Sequence[ExtractedTextSpan],
) -> int | None:
    if base.direction != "horizontal" or base.font_size <= 0:
        return None
    bx1, by1, bx2, by2 = _bbox(base)
    candidates: list[int] = []
    for candidate_index, candidate in enumerate(spans):
        if candidate_index == index or candidate.direction != "horizontal":
            continue
        if candidate.font_size > base.font_size * 0.78:
            continue
        cx1, cy1, cx2, cy2 = _bbox(candidate)
        overlap = max(0.0, min(bx2, cx2) - max(bx1, cx1))
        above = cy1 >= by2 - base.font_size * 0.2
        if overlap > 0 and above and cy1 - by2 <= base.font_size * 1.5:
            candidates.append(candidate_index)
    return candidates[0] if len(candidates) == 1 else None


def _has_unambiguous_underline(
    span: ExtractedTextSpan,
    vector_lines: Sequence[VectorLine],
) -> bool:
    x1, y1, x2, _ = _bbox(span)
    candidates = [
        line
        for line in vector_lines
        if line.horizontal
        and min(line.x1, line.x2) <= x1 + 1
        and max(line.x1, line.x2) >= x2 - 1
        and abs(line.y1 - y1) <= max(2.0, span.font_size * 0.35)
    ]
    return len(candidates) == 1


def extract_page_coordinates(
    page: Any,
    *,
    page_number: int,
    page_width: float,
    page_height: float,
) -> tuple[list[ExtractedTextSpan], list[ExtractedLine], list[VectorLine]]:
    """Use PyPDF visitor callbacks without requiring a new runtime dependency."""
    spans: list[ExtractedTextSpan] = []
    vector_lines: list[VectorLine] = []
    current_move: tuple[float, float] | None = None

    def visitor_text(
        text: str,
        cm: Sequence[float],
        tm: Sequence[float],
        font_dict: Any,
        font_size: float,
    ) -> None:
        span = collect_spans(text, cm, tm, font_size, page_number, page_height)
        if span:
            spans.append(span)

    def visitor_operand(
        operator: bytes,
        operands: Sequence[Any],
    ) -> None:
        nonlocal current_move
        if operator == b"m" and len(operands) >= 2:
            current_move = (float(operands[0]), float(operands[1]))
        elif operator == b"l" and current_move is not None and len(operands) >= 2:
            endpoint = (float(operands[0]), float(operands[1]))
            vector_lines.append(VectorLine(*current_move, *endpoint))
            current_move = endpoint

    page.extract_text(visitor_text=visitor_text, visitor_operand_before=visitor_operand)
    lines = order_lines(spans, page_width=page_width, page_height=page_height)
    return spans, lines, vector_lines
