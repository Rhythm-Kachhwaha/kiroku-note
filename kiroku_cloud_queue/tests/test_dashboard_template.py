"""
test_dashboard_template.py -- Automated validation of dashboard.html and dashboard_template.py.
Verifies script syntax validity via `node --check`, strict zero-emoji compliance,
tab structure integrity, and secure HTML escaping.
"""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
import tempfile

import pytest

from dashboard_template import DASHBOARD_HTML


# Regex range for emojis (standard Unicode Emoji blocks)
EMOJI_PATTERN = re.compile(
    r"[\U0001F600-\U0001F64F"  # Emoticons
    r"\U0001F300-\U0001F5FF"  # Misc Symbols & Pictographs
    r"\U0001F680-\U0001F6FF"  # Transport & Map Symbols
    r"\U0001F700-\U0001F77F"  # Alchemical Symbols
    r"\U0001F780-\U0001F7FF"  # Geometric Shapes Extended
    r"\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
    r"\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
    r"\U0001FA00-\U0001FA6F"  # Chess Symbols
    r"\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
    r"\U00002702-\U000027B0"  # Dingbats
    r"\U0001F1E6-\U0001F1FF]" # Flags
)


def test_dashboard_html_loads_from_file():
    assert DASHBOARD_HTML is not None
    assert len(DASHBOARD_HTML) > 5000
    assert "<!DOCTYPE html>" in DASHBOARD_HTML
    assert "kiroku cloud" in DASHBOARD_HTML


def test_zero_emojis_in_dashboard():
    """Ensure strictly zero OS emojis exist in the dashboard HTML, CSS, or JS."""
    matches = EMOJI_PATTERN.findall(DASHBOARD_HTML)
    assert matches == [], f"Found forbidden emoji characters in dashboard: {matches}"


def test_required_tabs_and_view_panels_exist():
    """Ensure all four view tabs and matching panels exist."""
    assert 'id="tab-btn-cards"' in DASHBOARD_HTML
    assert 'id="tab-btn-queue"' in DASHBOARD_HTML
    assert 'id="tab-btn-stats"' in DASHBOARD_HTML
    assert 'id="tab-btn-study"' in DASHBOARD_HTML

    assert 'id="view-cards"' in DASHBOARD_HTML
    assert 'id="view-queue"' in DASHBOARD_HTML
    assert 'id="view-stats"' in DASHBOARD_HTML
    assert 'id="view-study"' in DASHBOARD_HTML


def test_cards_tab_controls_and_containers_exist():
    """Ensure Cards browser search, chips, list, and pagination controls exist."""
    assert 'id="cards-search"' in DASHBOARD_HTML
    assert 'id="difficulty-chips"' in DASHBOARD_HTML
    assert 'id="mirrored-card-list"' in DASHBOARD_HTML
    assert 'id="cards-load-more-btn"' in DASHBOARD_HTML
    assert 'id="cards-freshness-bar"' in DASHBOARD_HTML
    assert 'id="hero-modal"' in DASHBOARD_HTML


def test_scripts_pass_node_check():
    """Extract every <script> block and validate syntax using node --check."""
    scripts = re.findall(r"<script[^>]*>(.*?)</script>", DASHBOARD_HTML, flags=re.DOTALL | re.IGNORECASE)
    assert len(scripts) >= 1, "Expected at least one <script> block in dashboard"

    for idx, script_content in enumerate(scripts):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(script_content)
            temp_path = f.name

        try:
            res = subprocess.run(
                ["node", "--check", temp_path],
                capture_output=True,
                text=True,
                timeout=10,
            )
            assert res.returncode == 0, f"Script block {idx} syntax error:\n{res.stderr}"
        finally:
            Path(temp_path).unlink(missing_ok=True)


def test_escape_html_present_and_used_in_script():
    """Ensure escapeHtml is defined and card text insertions use it."""
    assert "function escapeHtml(str)" in DASHBOARD_HTML
    assert "escapeHtml(card.expression)" in DASHBOARD_HTML
    assert "escapeHtml(card.meaning)" in DASHBOARD_HTML


def test_start_study_session_awaits_json():
    """Ensure startStudySession parses JSON response into data before accessing data.cards."""
    match = re.search(r"async function startStudySession\(\) \{(.*?)\n    function ", DASHBOARD_HTML, re.DOTALL)
    assert match is not None
    body = match.group(1)
    assert "const data = await resp.json();" in body


def test_quick_add_elements_and_wanakana_present():
    """Ensure Quick Add view panel, mode toggles, draft inputs, and WanaKana are present."""
    assert 'id="view-quickadd"' in DASHBOARD_HTML
    assert 'id="tab-btn-quickadd"' in DASHBOARD_HTML
    assert 'id="qa-mode-kana"' in DASHBOARD_HTML
    assert 'id="qa-mode-english"' in DASHBOARD_HTML
    assert 'id="quickadd-input"' in DASHBOARD_HTML
    assert 'id="quickadd-clear-btn"' in DASHBOARD_HTML
    assert 'id="quickadd-suggestions"' in DASHBOARD_HTML
    assert 'id="qa-expression"' in DASHBOARD_HTML
    assert 'id="qa-reading"' in DASHBOARD_HTML
    assert 'id="qa-meaning"' in DASHBOARD_HTML
    assert 'id="qa-submit-btn"' in DASHBOARD_HTML
    # Check WanaKana offline bundled
    assert 'wanakana' in DASHBOARD_HTML
    assert 'wanakana.bind' in DASHBOARD_HTML
    assert 'wanakana.unbind' in DASHBOARD_HTML


def test_desktop_sidebar_and_mobile_bottom_nav_present():
    """Ensure desktop sidebar and mobile bottom nav exist in dashboard markup."""
    assert 'class="app-sidebar"' in DASHBOARD_HTML
    assert 'class="mobile-bottom-nav"' in DASHBOARD_HTML
    assert 'class="mobile-header"' in DASHBOARD_HTML
    assert 'id="mob-tab-btn-cards"' in DASHBOARD_HTML
    assert 'id="mob-tab-btn-quickadd"' in DASHBOARD_HTML


def test_mobile_card_row_media_query_present():
    """Ensure responsive CSS exists to prevent kanji truncation on mobile."""
    assert '@media (max-width: 640px)' in DASHBOARD_HTML
    assert '.row-header' in DASHBOARD_HTML
    assert 'white-space: normal;' in DASHBOARD_HTML
    assert 'word-break: break-all;' in DASHBOARD_HTML


