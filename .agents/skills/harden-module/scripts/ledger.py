"""Shared helpers for reading/writing the hardening ledger (markdown tables).
Table cells must not contain the pipe character; use '/' instead.
"""
import re
from pathlib import Path


def ledger_path(root, module):
    return Path(root) / "docs" / "hardening" / f"{module}.md"


def contract_path(root, module):
    return Path(root) / "docs" / "contracts" / f"{module}.md"


def load(path):
    return Path(path).read_text(encoding="utf-8").splitlines()


def save(path, lines):
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def header_get(lines, key):
    for l in lines:
        if l.startswith("## "):
            break
        m = re.match(rf"^{re.escape(key)}:\s*(.*)$", l)
        if m:
            return m.group(1).strip()
    return None


def header_set(lines, key, value):
    for i, l in enumerate(lines):
        if l.startswith("## "):
            break
        if re.match(rf"^{re.escape(key)}:", l):
            lines[i] = f"{key}: {value}"
            return
    idx = next((i for i, l in enumerate(lines) if l.startswith("## ")), len(lines))
    lines.insert(idx, f"{key}: {value}")


def section_range(lines, title):
    start = None
    for i, l in enumerate(lines):
        if re.match(rf"^##\s+{re.escape(title)}\b", l):
            start = i
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    return start, end


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def table(lines, title):
    """Return (columns, rows). Each row is a dict plus '_i' (line index)."""
    r = section_range(lines, title)
    if not r:
        return [], []
    cols, rows = [], []
    for i in range(r[0] + 1, r[1]):
        if not lines[i].strip().startswith("|"):
            continue
        cells = _cells(lines[i])
        if not cols:
            cols = cells
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c) and any(cells):
            continue
        row = dict(zip(cols, cells + [""] * (len(cols) - len(cells))))
        row["_i"] = i
        rows.append(row)
    return cols, rows


def write_row(lines, cols, row):
    lines[row["_i"]] = "| " + " | ".join(row.get(c, "") for c in cols) + " |"


def append_row(lines, title, values):
    r = section_range(lines, title)
    if not r:
        raise ValueError(f"section '{title}' not found")
    cols, rows = table(lines, title)
    last = rows[-1]["_i"] if rows else max(
        (i for i in range(r[0] + 1, r[1]) if lines[i].strip().startswith("|")),
        default=r[0])
    lines.insert(last + 1, "| " + " | ".join(str(values.get(c, "")) for c in cols) + " |")


def norm(text):
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", (text or "").lower())).strip()


def find_duplicate_scenario(lines, behaviour, root_cause):
    """Return the first scenario row whose observable behaviour and root cause
    normalise to the same strings, or None."""
    _, rows = table(lines, "Scenarios")
    nb = norm(behaviour)
    nr = norm(root_cause)
    for row in rows:
        if norm(row.get("Scenario", "")) == nb:
            return row
        if nr and norm(row.get("Root cause", "")) == nr:
            return row
    return None

