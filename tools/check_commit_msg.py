#!/usr/bin/env python3
"""Validates commit messages against Kiroku Note repository standards.

Expected format:
  type(scope): summary [N<n>]
  or
  type(scope): summary [K<n>]

Where summary is <= 60 characters.
"""
import re
import sys
from pathlib import Path

PATTERN = re.compile(
    r"^(feat|fix|chore|docs|style|refactor|perf|test|build|ci)\([a-zA-Z0-9_\-\+/]+\):\s+(.+?)\s+\[(N|K)\d+\]$"
)


def validate_commit_message(msg: str) -> tuple[bool, str]:
    if not msg or not msg.strip():
        return False, "Commit message cannot be empty."

    first_line = msg.strip().splitlines()[0]
    m = PATTERN.match(first_line)
    if not m:
        return (
            False,
            f"Invalid format: '{first_line}'. Expected 'type(scope): summary [N<n>]' with allowed types (feat|fix|chore|docs|style|refactor|perf|test|build|ci).",
        )

    summary = m.group(2)
    if len(summary) > 60:
        return False, f"Summary is {len(summary)} characters (must be <= 60 characters)."

    return True, "Valid commit message."


def main():
    if len(sys.argv) < 2:
        print("Usage: check_commit_msg.py <commit-msg-file | \"commit message string\">")
        sys.exit(1)

    arg = sys.argv[1]
    msg_path = Path(arg)
    if msg_path.exists() and msg_path.is_file():
        msg = msg_path.read_text(encoding="utf-8")
    else:
        msg = arg

    valid, reason = validate_commit_message(msg)
    if not valid:
        print(f"ERROR: {reason}")
        sys.exit(1)

    print(f"OK: {reason}")
    sys.exit(0)


if __name__ == "__main__":
    main()
