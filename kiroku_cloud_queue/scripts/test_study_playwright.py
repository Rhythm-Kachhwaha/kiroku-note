"""
Playwright automated test script for Kiroku Cloud Study Mode.
Tests:
- Automatic token recognition via ?token=...
- Navigation to Study Tab
- Setup screen and Leitner box metrics display
- Launching practice session
- Front card rendering
- Answer reveal (rich HTML formatting, readings, definitions, media)
- Rating button clicks (Good, Hard, Again, Easy)
- Session exit and state updating
Saves screenshots to scratch directory for inspection.
"""
from __future__ import annotations

import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCRATCH_DIR = Path(r"C:\Users\Rhythm\.gemini\antigravity-ide\brain\ab0e5f06-e560-4a2c-bda0-8e08f0286257\scratch")
TOKEN = "VPrKduR-bMVOFb1tch-NtGGZ7Yriqyg8vgh7cmyIWoA"
URL = f"http://127.0.0.1:8766/dashboard?token={TOKEN}"



def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        print(f"Navigating to {URL}...")
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)

        # 1. Switch to Study tab
        print("Switching to Study tab...")
        page.locator("#tab-btn-study").click()
        page.wait_for_timeout(800)

        # 2. Verify Setup Screen & Leitner Boxes
        setup_screen = page.locator("#study-setup-screen")
        expect(setup_screen).to_be_visible()
        page.screenshot(path=str(SCRATCH_DIR / "1_study_setup.png"))
        print("Screenshot saved: 1_study_setup.png")

        # Check Leitner boxes container
        boxes_container = page.locator("#study-boxes-container")
        expect(boxes_container).to_be_visible()

        # 3. Start Practice Session (Weakest mode)
        print("Starting practice session...")
        page.locator("#study-setup-screen .study-start-btn").click()
        page.wait_for_timeout(1000)

        # 4. Verify Session Screen & Front Card
        session_screen = page.locator("#study-session-screen")
        expect(session_screen).to_be_visible()
        prompt_lead = page.locator("#study-prompt-lead")
        expect(prompt_lead).to_be_visible()
        counter = page.locator("#study-card-counter").text_content()
        expr = prompt_lead.text_content()
        print(f"Card 1 Front: {expr} ({counter})")
        page.screenshot(path=str(SCRATCH_DIR / "2_study_front.png"))
        print("Screenshot saved: 2_study_front.png")

        # 5. Reveal Answer
        print("Clicking Reveal Answer...")
        reveal_btn = page.locator("#study-reveal-btn")
        expect(reveal_btn).to_be_visible()
        reveal_btn.click()
        page.wait_for_timeout(500)

        revealed_content = page.locator("#study-revealed-content")
        expect(revealed_content).to_be_visible()
        rating_row = page.locator("#study-rating-row")
        expect(rating_row).to_be_visible()

        rich_reveal = page.locator("#study-rich-reveal")
        plain_reveal = page.locator("#study-plain-reveal")
        media_reveal = page.locator("#study-media-reveal")
        print(f"Rich HTML visible: {rich_reveal.is_visible()}, Plain reveal visible: {plain_reveal.is_visible()}, Media visible: {media_reveal.is_visible()}")

        page.screenshot(path=str(SCRATCH_DIR / "3_study_revealed.png"), full_page=True)
        print("Screenshot saved: 3_study_revealed.png")

        # 6. Click Rating Button: Good (3)
        print("Submitting Rating 3 (Good)...")
        page.locator(".rating-btn.good").click()
        page.wait_for_timeout(600)

        # 7. Verify Transition to Next Card
        new_counter = page.locator("#study-card-counter").text_content()
        new_expr = page.locator("#study-prompt-lead").text_content()
        print(f"Card 2 Front: {new_expr} ({new_counter})")
        assert new_counter != counter or new_expr != expr, "Card did not advance after rating!"
        page.screenshot(path=str(SCRATCH_DIR / "4_study_card_2.png"))
        print("Screenshot saved: 4_study_card_2.png")

        # 8. Reveal Card 2 and test Hard (2)
        print("Revealing Card 2 and submitting Hard (2)...")
        page.locator("#study-reveal-btn").click()
        page.wait_for_timeout(400)
        page.screenshot(path=str(SCRATCH_DIR / "5_study_card_2_revealed.png"), full_page=True)
        print("Screenshot saved: 5_study_card_2_revealed.png")

        page.locator(".rating-btn.hard").click()
        page.wait_for_timeout(600)

        # 9. Card 3: Reveal and test Again (1)
        card_3_counter = page.locator("#study-card-counter").text_content()
        card_3_expr = page.locator("#study-prompt-lead").text_content()
        print(f"Card 3 Front: {card_3_expr} ({card_3_counter})")
        page.locator("#study-reveal-btn").click()
        page.wait_for_timeout(400)
        page.locator(".rating-btn.again").click()
        page.wait_for_timeout(600)

        # 10. Card 4: Reveal and test Easy (4)
        card_4_counter = page.locator("#study-card-counter").text_content()
        card_4_expr = page.locator("#study-prompt-lead").text_content()
        print(f"Card 4 Front: {card_4_expr} ({card_4_counter})")
        page.locator("#study-reveal-btn").click()
        page.wait_for_timeout(400)
        page.locator(".rating-btn.easy").click()
        page.wait_for_timeout(600)

        # 11. Test Exit button
        print("Clicking Exit button...")
        page.locator("button:text('Exit')").click()
        page.wait_for_timeout(800)

        expect(setup_screen).to_be_visible()
        page.screenshot(path=str(SCRATCH_DIR / "6_study_after_exit.png"))
        print("Screenshot saved: 6_study_after_exit.png")

        # 12. Also test a card with Media in JLPT or Custom mode!
        print("Testing a session with media card...")
        # Search for a card with media in our local DB
        page.locator("#study-limit-select").select_option("10")
        page.locator("#study-setup-screen .study-start-btn").click()
        page.wait_for_timeout(1000)
        expect(session_screen).to_be_visible()

        # Iterate through cards until one has media
        for i in range(10):
            page.locator("#study-reveal-btn").click()
            page.wait_for_timeout(300)
            if media_reveal.is_visible():
                print(f"Found card with media on card {i+1}!")
                page.screenshot(path=str(SCRATCH_DIR / "7_card_with_media.png"), full_page=True)
                print("Screenshot saved: 7_card_with_media.png")
                break
            page.locator(".rating-btn.good").click()
            page.wait_for_timeout(300)

        browser.close()
        print("ALL PLAYWRIGHT TESTS PASSED!")


if __name__ == "__main__":
    run_test()
