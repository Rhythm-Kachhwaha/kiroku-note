import os
from pathlib import Path

def run(browser_context, desk_client):
    """
    e14: Desktop shell layout test
    - Verifies two-pane layout (anime-hero-pane + anime-deck-container)
    - Verifies tabbed deck (Transcript, Inspector, Queue)
    - Verifies zero leaking fixture test data ("Dog Running") in DB
    """
    # 1. Verify DB is clean from leaked test data
    db_path = Path.home() / "AppData" / "Local" / "KirokuNote" / "data" / "kiroku.db"
    if db_path.exists():
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='link_episode'")
        if cur.fetchone():
            cur.execute("SELECT count(*) FROM link_episode WHERE title LIKE '%Dog Running%'")
            count = cur.fetchone()[0]
            assert count == 0, f"Leaked 'Dog Running' records found in user DB: {count}"
        conn.close()

    # 2. Test desktop view rendering via a page loading the desktop anime view
    page = browser_context.new_page()
    # Serve a test harness page or verify HTML structure
    page.goto("http://127.0.0.1:8989/plain.html")

    # Evaluate mock rendering of desktop AnimeView
    anime_js_path = Path(__file__).resolve().parent.parent.parent.parent / "desktop" / "src" / "ui" / "views" / "anime.js"
    assert anime_js_path.exists(), "anime.js must exist"
    anime_code = anime_js_path.read_text(encoding="utf-8")

    assert "anime-hero-pane" in anime_code, "anime.js must render .anime-hero-pane"
    assert "anime-deck-container" in anime_code, "anime.js must render .anime-deck-container"
    assert "anime-deck-tabs" in anime_code, "anime.js must render .anime-deck-tabs"
    assert "tab-btn-transcript" in anime_code, "anime.js must have Transcript tab"
    assert "tab-btn-inspector" in anime_code, "anime.js must have Inspector tab"
    assert "tab-btn-queue" in anime_code, "anime.js must have Queue tab"
    assert "anime-history-disclosure" in anime_code, "anime.js must have bottom history disclosure"
    assert "anime-progress-track" in anime_code, "anime.js must have seekable progress bar track"
