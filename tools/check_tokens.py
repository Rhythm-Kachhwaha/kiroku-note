#!/usr/bin/env python3
"""
Token Compliance Checker: fails on raw hex outside tokens.css and FINAL-locked blocks.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files and directories to check
CSS_FILES = [
    *(REPO_ROOT / "desktop" / "src" / "ui" / "styles" / "views").glob("*.css"),
    REPO_ROOT / "desktop" / "src" / "ui" / "styles" / "bundle.css",
    REPO_ROOT / "desktop" / "src" / "ui" / "styles" / "tactile.css",
    REPO_ROOT / "desktop" / "src" / "ui" / "styles" / "fonts.css",
    REPO_ROOT / "desktop" / "src" / "ui" / "shell" / "shell.css",
]

HEX_REGEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def strip_css_comments(text: str) -> str:
    """Strip /* ... */ comments from CSS text while preserving line counts."""
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.DOTALL)


def remove_final_blocks(path: Path, text: str) -> str:
    """Remove locked FINAL blocks from check."""
    # (a) Kanji mastery block in views/kanji.css
    if "FINAL:KANJI-MASTERY START" in text and "FINAL:KANJI-MASTERY END" in text:
        start_m = "/* FINAL:KANJI-MASTERY START */"
        end_m = "/* FINAL:KANJI-MASTERY END */"
        s_idx = text.index(start_m)
        e_idx = text.index(end_m) + len(end_m)
        text = text[:s_idx] + ("\n" * text[s_idx:e_idx].count("\n")) + text[e_idx:]

    # (b) Bottom dock block in shell.css
    if "FINAL:BOTTOM-DOCK START" in text and "FINAL:BOTTOM-DOCK END" in text:
        start_m = "/* FINAL:BOTTOM-DOCK START */"
        end_m = "/* FINAL:BOTTOM-DOCK END */"
        s_idx = text.index(start_m)
        e_idx = text.index(end_m) + len(end_m)
        text = text[:s_idx] + ("\n" * text[s_idx:e_idx].count("\n")) + text[e_idx:]

    return text


def check_file(path: Path) -> list[tuple[int, str, str]]:
    """Check a file for unauthorized raw hex codes."""
    if not path.is_file():
        return []

    raw_text = path.read_text(encoding="utf-8")
    cleaned = remove_final_blocks(path, raw_text)
    code_only = strip_css_comments(cleaned)

    violations = []
    lines = code_only.splitlines()
    for line_no, line in enumerate(lines, start=1):
        matches = HEX_REGEX.findall(line)
        for hex_code in matches:
            violations.append((line_no, hex_code, line.strip()))

    return violations


def main() -> int:
    total_violations = 0
    print("Checking CSS tokens compliance...")

    for css_file in sorted(CSS_FILES):
        violations = check_file(css_file)
        if violations:
            rel_path = css_file.relative_to(REPO_ROOT)
            print(f"FAILED: {rel_path} ({len(violations)} raw hex occurrences):")
            for line_no, hex_code, line_text in violations:
                print(f"  line {line_no}: {hex_code} -> {line_text[:80]}")
            total_violations += len(violations)

    # Check JS views for inline hex style strings
    views_dir = REPO_ROOT / "desktop" / "src" / "ui" / "views"
    for js_file in sorted(views_dir.glob("*.js")):
        text = js_file.read_text(encoding="utf-8")
        # Check for inline style strings with hex
        for line_no, line in enumerate(text.splitlines(), start=1):
            if "style=" in line and HEX_REGEX.search(line):
                # Ensure it's not inside FINAL-locked kanji markup
                if "FINAL:KANJI-MASTERY-MARKUP" not in line:
                    rel_path = js_file.relative_to(REPO_ROOT)
                    print(f"FAILED: {rel_path}:{line_no} inline style hex: {line.strip()[:80]}")
                    total_violations += 1

    if total_violations > 0:
        print(f"\ncheck_tokens: FAILED with {total_violations} token violations.")
        return 1

    print("\ncheck_tokens: PASSED (zero raw hex outside tokens.css and FINAL blocks).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
