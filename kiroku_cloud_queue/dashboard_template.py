"""
dashboard_template.py -- Self-contained, responsive HTML/CSS/JS template for the Kiroku Cloud Dashboard.

Aesthetics & Rules:
  - Deep obsidian base (#121110) + warm charcoal surfaces (#181715, #211e1b)
  - Signature Kiroku terracotta brand accent (#b84632)
  - Warm amber reading badge (#d4884f)
  - Pure white unified brand heading ("kiroku cloud")
  - Zero OS emojis -- pure vector SVG icons everywhere
  - Interactive Card Hero Inspection Modal matching the Kiroku Extension Side Panel
  - Clean HTML/CSS/JS loaded from dashboard.html (Option C: eliminates backslash escaping traps)
  - Separated views: [Cards], [Queue], [Stats], [Study]
"""
from __future__ import annotations

from pathlib import Path

_HTML_FILE = Path(__file__).parent / "dashboard.html"

# Load dashboard HTML at import time; fallback if missing
if _HTML_FILE.is_file():
    DASHBOARD_HTML = _HTML_FILE.read_text(encoding="utf-8")
else:
    DASHBOARD_HTML = "<!DOCTYPE html><html><body>Dashboard template missing</body></html>"
