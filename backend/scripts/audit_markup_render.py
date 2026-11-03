"""Read-only audit of stored study markup rendering.

Run from the repository root with the backend package on PYTHONPATH.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from app.api.study.converters import render_markup_html


DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "study.db"
RAW_MARKUP = re.compile(r"\{|\[[^\]]+\|[^\]]+\]")
BLANK_PLACEHOLDER = re.compile(r"＿＿|___|（　）")


def main() -> None:
    connection = sqlite3.connect(f"file:{DATABASE_PATH.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT stem_markup AS markup FROM question_revision
        UNION ALL
        SELECT text_markup AS markup FROM revision_choice
        WHERE text_markup IS NOT NULL
        """
    ).fetchall()

    residual_markup = 0
    unrendered_blanks = 0
    for row in rows:
        markup = row["markup"] or ""
        rendered = render_markup_html(markup)
        if RAW_MARKUP.search(rendered):
            residual_markup += 1
        if BLANK_PLACEHOLDER.search(markup) and "study-target-blank" not in rendered:
            unrendered_blanks += 1

    print(f"items checked: {len(rows)}")
    print(f"rendered items with literal markup: {residual_markup}")
    print(f"placeholder items without blank node: {unrendered_blanks}")


if __name__ == "__main__":
    main()
