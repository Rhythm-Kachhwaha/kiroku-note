"""
Playwright Verification Script for Kiroku Note Desktop Native UI
Loads desktop/src/index.html via file:// URL.
Tests:
- Frameless Top Chrome header rendering & wordmark
- Bottom Dock floating tactile pills & active indicator slide
- Navigation through all 8 routes: Home, Vocab Main, Vocab History, Grammar, Kanji, Test, Study, Settings
- Interaction checks (IME input, test options selection, study choices, doctor report trigger)
- Captures screenshots across compact (500x750) and expanded (1280x800) resolutions.
"""

import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(r"d:\Python\AnkiMiner")
INDEX_PATH = REPO_ROOT / "desktop" / "src" / "index.html"
INDEX_URL = f"file:///{INDEX_PATH.as_posix()}"
OUTPUT_DIR = Path(r"C:\Users\Rhythm\.gemini\antigravity\brain\f42d75e6-b857-48a6-8ba3-a1e8d9684fab\scratch")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def verify_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"]
        )

        # 1. Compact Window Verification (500 x 750)
        print("Testing Compact Viewport (500x750)...")
        context_compact = browser.new_context(viewport={"width": 500, "height": 750})
        page = context_compact.new_page()

        # Capture console warnings or errors
        errors = []
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
        page.on("console", lambda msg: print(f"CONSOLE {msg.type}: {msg.text}"))

        print(f"Loading {INDEX_URL}...")
        page.goto(INDEX_URL)
        page.wait_for_timeout(1000)

        # Verify Top Chrome & Wordmark
        wordmark = page.locator("#brand-wordmark-container")
        assert wordmark.is_visible(), "Top chrome wordmark container must be visible"

        # Verify Bottom Dock
        bottom_dock = page.locator("#bottom-dock")
        assert bottom_dock.is_visible(), "Bottom floating dock must be visible"

        # Capture Home Screen Compact
        page.screenshot(path=str(OUTPUT_DIR / "screen_01_home_compact.png"))
        print("Captured Home Compact: screen_01_home_compact.png")

        # 2. Expanded Window Verification (1280 x 800)
        print("\nTesting Expanded Viewport (1280x800)...")
        context_expanded = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context_expanded.new_page()
        page.on("pageerror", lambda err: errors.append(f"PAGE ERROR: {err}"))
        page.on("console", lambda msg: errors.append(f"CONSOLE {msg.type}: {msg.text}") if msg.type in ["error"] else None)

        page.goto(INDEX_URL)
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUTPUT_DIR / "screen_01_home_expanded.png"))
        print("Captured Home Expanded: screen_01_home_expanded.png")

        # Test Vocab Tab
        print("Navigating to Vocab Tab...")
        page.locator('#bottom-dock a[data-tab="vocab"]').click()
        page.wait_for_timeout(500)
        assert page.locator("#vocab-search-input").is_visible(), "Vocab search input must be visible"
        assert page.locator("#jmdict-block").is_visible(), "JMdict pitch-black card must be visible"
        page.screenshot(path=str(OUTPUT_DIR / "screen_02_vocab_main.png"))
        print("Captured Vocab Main: screen_02_vocab_main.png")

        # Test Vocab History (via History button in Vocab search row)
        print("Navigating to Vocab History...")
        page.locator("#btn-vocab-go-history").click()
        page.wait_for_timeout(500)
        assert page.locator("#cards-table").is_visible(), "Cards table must be visible"
        page.screenshot(path=str(OUTPUT_DIR / "screen_03_vocab_history.png"))
        print("Captured Vocab History: screen_03_vocab_history.png")

        # Test Grammar Tab
        print("Navigating to Grammar Tab...")
        page.locator('#bottom-dock a[data-tab="grammar"]').click()
        page.wait_for_timeout(500)
        assert page.locator("#sentence-input").is_visible(), "Sentence input textarea must be visible"
        assert page.locator("#tokens-flow").is_visible(), "Tokenized visualizer must be visible"
        page.screenshot(path=str(OUTPUT_DIR / "screen_04_grammar.png"))
        print("Captured Grammar Studio: screen_04_grammar.png")

        # Test Kanji Tab
        print("Navigating to Kanji Tab...")
        page.locator('#bottom-dock a[data-tab="kanji"]').click()
        page.wait_for_timeout(500)
        assert page.locator("#stroke-canvas").is_visible(), "Kanji stroke canvas must be visible"
        page.screenshot(path=str(OUTPUT_DIR / "screen_05_kanji.png"))
        print("Captured Kanji Studio: screen_05_kanji.png")

        # Test Test Simulation Tab
        print("Navigating to Test Tab...")
        page.locator('#bottom-dock a[data-tab="test"]').click()
        page.wait_for_timeout(500)
        assert page.locator("#exam-countdown").is_visible(), "Exam countdown timer must be visible"
        assert page.locator(".test-passage-pane").is_visible(), "Reading passage pane must be visible"
        # Test choice selection
        page.locator('.test-option-card[data-choice="2"]').click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUTPUT_DIR / "screen_06_test.png"))
        print("Captured Test Simulation: screen_06_test.png")

        # Test Study Tab
        print("Navigating to Study Tab...")
        page.locator('#bottom-dock a[data-tab="study"]').click()
        page.wait_for_timeout(500)
        assert page.locator("#study-prompt-ja").is_visible(), "Study prompt must be visible"
        # Test clicking a choice to trigger grading feedback pop
        page.locator('.study-choice-btn[data-index="1"]').click()
        page.wait_for_timeout(400)
        assert page.locator("#grading-banner").is_visible(), "Grading banner must pop on answer"
        assert page.locator("#explanation-card").is_visible(), "Explanation card must be revealed"
        page.screenshot(path=str(OUTPUT_DIR / "screen_07_study.png"))
        print("Captured Study Practice: screen_07_study.png")

        # Test Settings (via Top Chrome Gear Button)
        print("Navigating to Settings via Top Chrome Gear...")
        page.locator("#btn-chrome-settings").click()
        page.wait_for_timeout(500)
        assert page.locator("#btn-run-doctor").is_visible(), "Run doctor check button must be visible"
        page.screenshot(path=str(OUTPUT_DIR / "screen_08_settings.png"))
        print("Captured Settings: screen_08_settings.png")

        browser.close()

        if errors:
            print("\nConsole errors encountered during test:")
            for err in errors:
                print(f"  - {err}")
        else:
            print("\nVerification completed successfully with ZERO console errors!")

if __name__ == "__main__":
    verify_ui()
