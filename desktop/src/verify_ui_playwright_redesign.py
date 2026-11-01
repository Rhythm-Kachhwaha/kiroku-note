"""
Kiroku Note Desktop — Playwright Visual Verification Script for Desktop UI Redesign
Captures comprehensive AFTER screenshots across Home, Vocab, History, Grammar,
Kanji, Test, Study, and Settings views at 1920x1080, 1280x800, and 500x750 viewports.
"""

import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(r"d:\Python\AnkiMiner")
INDEX_PATH = REPO_ROOT / "desktop" / "src" / "index.html"
INDEX_URL = f"file:///{INDEX_PATH.as_posix()}"

OUTPUT_DIRS = [
    Path(r"C:\Users\Rhythm\.gemini\antigravity\brain\bfdd493f-7c8c-45f5-8e0f-300d2075c08c\screenshots\after"),
    Path(r"C:\Users\Rhythm\.gemini\antigravity\brain\3e6847ae-99ec-4090-83ea-5c39f1ae4364\screenshots\after"),
]

for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    ("1920x1080", 1920, 1080),
    ("1280x800", 1280, 800),
    ("500x750", 500, 750),
]

def save_screenshot(page, filename: str):
    for d in OUTPUT_DIRS:
        page.screenshot(path=str(d / filename))
    print(f"  [SAVED] {filename}")

def run_verification():
    print("=" * 60)
    print("Kiroku Note Desktop — Playwright Visual Verification")
    print(f"Loading Index URL: {INDEX_URL}")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--font-render-hinting=none",
            ]
        )

        for vp_name, width, height in VIEWPORTS:
            print(f"\n--- Capturing Viewport {vp_name} ({width}x{height}) ---")
            ctx = browser.new_context(viewport={"width": width, "height": height})
            page = ctx.new_page()

            page.on("pageerror", lambda err: print(f"  [PAGE ERROR] {err}"))
            page.on("console", lambda msg: print(f"  [BROWSER LOG] {msg.text}") if msg.type in ("error", "warning") else None)

            page.goto(INDEX_URL)
            page.wait_for_timeout(1200)

            # 1. Home Screen (Mascot stage, rotating greeting, daily word, action stamps)
            save_screenshot(page, f"home_{vp_name}.png")

            # 2. Vocabulary Screen (Hero, JMdict #000000, card mining form, gap shelf)
            page.locator('#bottom-dock a[data-tab="vocab"]').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"vocab_{vp_name}.png")

            # 3. Vocab History Screen (Inventory metrics, table, bulk action bar)
            page.locator('#btn-vocab-go-history').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"history_{vp_name}.png")

            # 4. Grammar Studio Screen (Sentence input, pitch-black visualizer, rule card, syllabus)
            page.locator('#bottom-dock a[data-tab="grammar"]').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"grammar_{vp_name}.png")

            # 5. Kanji Screen (Duolingo-style mastery squircle grid, stroke canvas, compounds)
            page.locator('#bottom-dock a[data-tab="kanji"]').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"kanji_{vp_name}.png")

            # 6. Test Screen (Serious exam room, scope & format filters, NO mascot)
            page.locator('#bottom-dock a[data-tab="test"]').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"test_{vp_name}.png")

            # 7. Study Practice Screen (Drill setup, tactile choices, instant feedback reveal)
            page.locator('#bottom-dock a[data-tab="study"]').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"study_{vp_name}.png")

            # 8. Settings Screen (Universal level, live Anki target deck selector, doctor)
            page.locator('#btn-chrome-settings').click()
            page.wait_for_timeout(800)
            save_screenshot(page, f"settings_{vp_name}.png")

            ctx.close()

        browser.close()
        print("\nAll 24 redesign screenshots captured successfully across all viewports!")

if __name__ == "__main__":
    run_verification()

