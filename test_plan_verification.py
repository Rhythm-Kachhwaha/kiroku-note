import os
import sys
import time
import asyncio
import json
import subprocess
import urllib.request
from playwright.async_api import async_playwright

def ensure_backend():
    try:
        with urllib.request.urlopen("http://127.0.0.1:21828/api/yomitan/status", timeout=1) as resp:
            return None
    except Exception:
        pass
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", "21828"],
        cwd=os.path.abspath("backend"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    for _ in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:21828/api/yomitan/status", timeout=1) as resp:
                return proc
        except Exception:
            time.sleep(0.2)
    return proc

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-web-security"])
        context = await browser.new_context()
        page = await context.new_page()

        page_errors = []
        console_logs = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        file_url = "file:///" + os.path.abspath("extension/sidepanel/sidepanel.html").replace("\\", "/")
        print(f"Loading {file_url} with live backend on port 21828...")
        await page.goto(file_url)
        await page.wait_for_timeout(800)

        results = {}

        # -------------------------------------------------------------
        # Section 1: Top Header & Navigation Bar
        # -------------------------------------------------------------
        print("\n--- Verifying Section 1: Top Header & Navigation Bar ---")
        
        # 1.1 Brand Wordmark
        wordmark = page.locator(".brand-wordmark")
        wm_text = await wordmark.text_content()
        assert wm_text.strip() == "KIROKU", f"Wordmark text should be KIROKU, got {wm_text}"
        wm_style = await wordmark.evaluate("el => ({ fontSize: getComputedStyle(el).fontSize, fontWeight: getComputedStyle(el).fontWeight, letterSpacing: getComputedStyle(el).letterSpacing })")
        print("Wordmark style:", wm_style)
        assert wm_style["fontSize"] == "12px", f"Expected 12px, got {wm_style['fontSize']}"
        assert int(wm_style["fontWeight"]) >= 600, f"Expected weight >= 600, got {wm_style['fontWeight']}"
        results["1.1_wordmark"] = "PASS"

        # 1.2 Status Indicators
        ind_yomi = page.locator("#indicator-yomitan")
        ind_anki = page.locator("#indicator-anki")
        ind_ocr = page.locator("#indicator-ocr")
        assert await ind_yomi.count() == 1, "indicator-yomitan exists"
        assert await ind_anki.count() == 1, "indicator-anki exists"
        assert await ind_ocr.count() == 1, "indicator-ocr exists"
        print("Status dots classes:", {
            "yomitan": await ind_yomi.get_attribute("class"),
            "anki": await ind_anki.get_attribute("class"),
            "ocr": await ind_ocr.get_attribute("class")
        })
        results["1.2_status_indicators"] = "PASS"

        # 1.3 OCR Capture Control & Alt+O Shortcut
        ocr_btn = page.locator("#ocr-capture-btn")
        assert await ocr_btn.count() == 1, "ocr-capture-btn exists"
        title_attr = await ocr_btn.get_attribute("title")
        assert "Alt+O" in title_attr, f"Title should mention Alt+O, got {title_attr}"
        
        # Press Alt+O and verify status changes to select text
        capture_status = page.locator("#capture-status")
        await page.keyboard.press("Alt+KeyO")
        await page.wait_for_timeout(100)
        status_text = await capture_status.text_content()
        print("Status text after Alt+O:", status_text)
        assert "Select Japanese text" in status_text or "OCR" in status_text, f"Alt+O should trigger OCR mode, got {status_text}"
        results["1.3_ocr_control"] = "PASS"

        # 1.4 Mode Navigation Tabs
        tab_text = page.locator("#tab-btn-text")
        tab_video = page.locator("#tab-btn-video")
        tab_quick = page.locator("#tab-btn-quickadd")
        tab_history = page.locator("#tab-btn-history")

        view_text = page.locator("#text-mining-view")
        view_video = page.locator("#video-mining-view")
        view_quick = page.locator("#quickadd-mining-view")
        view_history = page.locator("#history-section")

        # Initial: Text active
        assert "active" in (await tab_text.get_attribute("class")), "Text tab initially active"
        assert await view_text.is_visible() is True, "Text view initially visible"
        assert await view_video.is_visible() is False, "Video view initially hidden"

        # Switch to Video
        await tab_video.click()
        await page.wait_for_timeout(100)
        assert "active" in (await tab_video.get_attribute("class")), "Video tab active"
        assert await tab_video.get_attribute("aria-selected") == "true"
        assert await view_video.is_visible() is True, "Video view visible"
        assert await view_text.is_visible() is False, "Text view hidden"

        # Switch to QuickAdd
        await tab_quick.click()
        await page.wait_for_timeout(100)
        assert "active" in (await tab_quick.get_attribute("class")), "Quick tab active"
        assert await view_quick.is_visible() is True, "Quick view visible"

        # Switch to History
        await tab_history.click()
        await page.wait_for_timeout(100)
        assert "active" in (await tab_history.get_attribute("class")), "History tab active"
        assert await view_history.is_visible() is True, "History section visible"

        # Switch back to Text
        await tab_text.click()
        await page.wait_for_timeout(100)
        assert "active" in (await tab_text.get_attribute("class")), "Text tab active again"
        assert await view_text.is_visible() is True, "Text view visible again"
        results["1.4_navigation_tabs"] = "PASS"

        # 1.5 Japanese Writing Mode Toggle
        jp_btn = page.locator("#btn-editor-jp-mode")
        assert await jp_btn.get_attribute("aria-pressed") == "false", "JP mode initially false (English)"
        await jp_btn.click()
        await page.wait_for_timeout(100)
        assert await jp_btn.get_attribute("aria-pressed") == "true", "JP mode toggles to true"
        assert "active" in (await jp_btn.get_attribute("class")), "JP mode button has active class"
        await jp_btn.click()
        await page.wait_for_timeout(100)
        assert await jp_btn.get_attribute("aria-pressed") == "false", "JP mode toggles back to false"
        results["1.5_jp_writing_mode"] = "PASS"

        # 1.6 Settings Gear Control
        settings_btn = page.locator("#btn-layout-settings")
        popover = page.locator("#layout-settings-popover")
        assert await popover.is_visible() is False, "Popover initially hidden"
        assert await settings_btn.get_attribute("aria-expanded") == "false"
        await settings_btn.click()
        await page.wait_for_timeout(150)
        assert await popover.is_visible() is True, "Popover visible on click"
        assert await settings_btn.get_attribute("aria-expanded") == "true"

        # Close via Escape
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(150)
        assert await popover.is_visible() is False, "Popover closed via Escape"
        assert await settings_btn.get_attribute("aria-expanded") == "false"

        # Reopen and close via outside click
        await settings_btn.click()
        await page.wait_for_timeout(150)
        assert await popover.is_visible() is True
        await page.locator("body").click(position={"x": 10, "y": 10})
        await page.wait_for_timeout(150)
        assert await popover.is_visible() is False, "Popover closed via outside click"
        results["1.6_settings_control"] = "PASS"

        # 1.7 Header Collapse Toggle
        collapse_btn = page.locator("#btn-nav-collapse-toggle")
        header = page.locator("#panel-header")
        assert "nav-collapsed" not in (await header.get_attribute("class") or "")
        await collapse_btn.click()
        await page.wait_for_timeout(100)
        assert "nav-collapsed" in (await header.get_attribute("class")), "Header has nav-collapsed class"
        assert await collapse_btn.get_attribute("aria-expanded") == "false"
        await collapse_btn.click()
        await page.wait_for_timeout(100)
        assert "nav-collapsed" not in (await header.get_attribute("class")), "Header uncollapsed"
        assert await collapse_btn.get_attribute("aria-expanded") == "true"
        results["1.7_header_collapse"] = "PASS"

        # -------------------------------------------------------------
        # Section 2: Text Mining Mode
        # -------------------------------------------------------------
        print("\n--- Verifying Section 2: Text Mining Mode ---")
        mining_toggle = page.locator("#mining-toggle")
        mode_el = page.locator("#mode")
        session_el = page.locator("#session-count")
        save_badge = page.locator("#save-badge")

        assert await mining_toggle.text_content() == "Start"
        assert await mining_toggle.get_attribute("aria-pressed") == "false"

        await mining_toggle.click()
        await page.wait_for_timeout(100)
        assert await mining_toggle.text_content() == "Stop"
        assert await mining_toggle.get_attribute("aria-pressed") == "true"
        mode_text_on = await mode_el.text_content()
        print("Mode text when ON:", mode_text_on)
        assert "Mining active" in mode_text_on, f"Expected 'Mining active', got {mode_text_on}"

        await mining_toggle.click()
        await page.wait_for_timeout(100)
        assert await mining_toggle.text_content() == "Start"
        assert await mining_toggle.get_attribute("aria-pressed") == "false"
        mode_text_off = await mode_el.text_content()
        print("Mode text when OFF:", mode_text_off)
        assert "Select Japanese text" in mode_text_off, f"Expected 'Select Japanese text...', got {mode_text_off}"
        results["2.1_mining_toggle"] = "PASS"

        # -------------------------------------------------------------
        # Section 3: Video Mining View
        # -------------------------------------------------------------
        print("\n--- Verifying Section 3: Video Mining View ---")
        await tab_video.click()
        await page.wait_for_timeout(100)

        offset_display = page.locator("#offset-display")
        offset_minus = page.locator("#offset-minus-btn")
        offset_plus = page.locator("#offset-plus-btn")
        offset_reset = page.locator("#offset-reset-btn")

        assert await offset_display.is_visible() is True
        initial_offset_text = await offset_display.text_content()
        print("Initial offset:", initial_offset_text)

        await offset_plus.click()
        await page.wait_for_timeout(50)
        plus_text = await offset_display.text_content()
        print("Offset after +100ms:", plus_text)
        assert "100" in plus_text, f"Offset should increase, got {plus_text}"

        await offset_minus.click()
        await page.wait_for_timeout(50)
        minus_text = await offset_display.text_content()
        print("Offset after -100ms:", minus_text)
        assert "0" in minus_text, f"Offset should return to 0, got {minus_text}"

        cue_preview = page.locator("#video-current-cue-preview")
        assert await cue_preview.is_visible() is True
        cue_text = await cue_preview.text_content()
        print("Cue preview text:", cue_text)
        results["3.1_video_controls"] = "PASS"

        # Switch back to text view
        await tab_text.click()
        await page.wait_for_timeout(100)

        # -------------------------------------------------------------
        # Section 4: Quick Add Mode
        # -------------------------------------------------------------
        print("\n--- Verifying Section 4: Quick Add ---")
        await tab_quick.click()
        await page.wait_for_timeout(100)
        quick_input = page.locator("#quickadd-input")
        assert await quick_input.is_visible() is True

        # Test typing
        await quick_input.fill("taberu")
        await page.wait_for_timeout(200)
        # Clear button should be visible
        quick_clear = page.locator("#quickadd-clear-btn")
        assert await quick_clear.is_visible() is True
        await quick_clear.click()
        await page.wait_for_timeout(100)
        assert await quick_input.input_value() == ""
        results["4.1_quick_add_input"] = "PASS"

        await tab_text.click()
        await page.wait_for_timeout(100)

        # -------------------------------------------------------------
        # Section 5: Card Editor & Data Storage (Save Card & Sync Flow)
        # -------------------------------------------------------------
        print("\n--- Verifying Section 5: Card Editor & Data Storage ---")
        field_expr = page.locator("#field-expression")
        field_reading = page.locator("#field-reading")
        field_meaning = page.locator("#field-meaning")
        field_sentence = page.locator("#field-example-sentence")
        deck_select = page.locator("#field-deck-select")
        model_select = page.locator("#field-model-select")
        save_btn = page.locator("#save-card-btn")
        sync_btn = page.locator("#sync-anki-btn")

        assert await field_expr.count() == 1
        assert await field_reading.count() == 1
        assert await field_meaning.count() == 1
        assert await field_sentence.count() == 1
        assert await deck_select.count() == 1
        assert await model_select.count() == 1

        # Check no stray .deck-sep dot element exists between dropdowns
        deck_sep = page.locator(".deck-sep")
        assert await deck_sep.count() == 0, "No stray .deck-sep separator"

        # Check Optional Details toggle (+ / -) and Esc close
        opt_details = page.locator("#optional-details")
        opt_summary = page.locator("#optional-summary-toggle")
        field_hint = page.locator("#field-hint")
        field_tags = page.locator("#field-tags")
        field_notes = page.locator("#field-notes")

        assert await opt_details.count() == 1
        is_open_init = await opt_details.evaluate("el => el.open")
        print("Optional details initial open state:", is_open_init)
        assert is_open_init is False, "Optional details initially closed"

        # Click summary to open
        await opt_summary.click()
        await page.wait_for_timeout(150)
        is_open_after_click = await opt_details.evaluate("el => el.open")
        print("Optional details after click open state:", is_open_after_click)
        assert is_open_after_click is True, "Optional details should be open"
        assert await field_hint.is_visible() is True, "Hint field visible when open"
        assert await field_tags.is_visible() is True, "Tags field visible when open"
        assert await field_notes.is_visible() is True, "Notes field visible when open"

        # Check Esc to close optional fields
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(150)
        is_open_after_esc = await opt_details.evaluate("el => el.open")
        print("Optional details after Escape open state:", is_open_after_esc)
        assert is_open_after_esc is False, "Optional details closed on Escape"

        # Fill card fields and save a card to SQLite
        test_expr = "猫"
        test_reading = "ねこ"
        test_meaning = "cat (test card)"
        await field_expr.fill(test_expr)
        await field_reading.fill(test_reading)
        await field_meaning.fill(test_meaning)
        await page.wait_for_timeout(100)

        # Click Save
        await save_btn.click()
        await page.wait_for_timeout(500)

        # Check save badge
        badge_text = await save_badge.text_content()
        print("Save badge text:", badge_text)
        assert "SAVED" in badge_text or "ALREADY SAVED" in badge_text, f"Expected SAVED badge, got {badge_text}"
        assert await save_badge.is_visible() is True

        # Check session counter updated
        counter_text = await session_el.text_content()
        print("Session counter text:", counter_text)
        assert "today" in counter_text

        results["5.1_card_editor_and_save"] = "PASS"

        # -------------------------------------------------------------
        # Section 6: History & Saved Cards View
        # -------------------------------------------------------------
        print("\n--- Verifying Section 6: History View ---")
        await tab_history.click()
        await page.wait_for_timeout(300)
        search_input = page.locator("#history-search-input")
        deck_filter = page.locator("#history-deck-filter")
        sync_filter = page.locator("#history-sync-filter")
        history_list = page.locator("#history-cards-list")

        assert await search_input.count() == 1
        assert await deck_filter.count() == 1
        assert await sync_filter.count() == 1
        assert await history_list.count() == 1

        # Check that saved card appears in history list
        card_items = history_list.locator(".history-item")
        card_count = await card_items.count()
        print(f"Cards in history: {card_count}")
        assert card_count > 0, "History should contain at least one saved card"

        # Real-time search filter test
        await search_input.fill("zzzznonexistentword")
        await page.wait_for_timeout(350)
        filtered_count = await history_list.locator(".history-item").count()
        print(f"Cards after non-existent search: {filtered_count}")
        assert filtered_count == 0, "Non-existent search should return 0 items"

        await search_input.fill("猫")
        await page.wait_for_timeout(350)
        match_count = await history_list.locator(".history-item").count()
        print(f"Cards after search: {match_count}")
        assert match_count >= 1, "Search for '猫' should match saved card"

        # Click the saved card to reload into editor
        card_btn = history_list.locator(".history-item-card-btn").first
        await card_btn.click()
        await page.wait_for_timeout(300)

        # Switch to text view to verify reloaded
        await tab_text.click()
        await page.wait_for_timeout(100)
        loaded_expr = await field_expr.input_value()
        print("Reloaded card expression in editor:", loaded_expr.encode("ascii", "backslashreplace").decode("ascii"))
        assert loaded_expr == "猫", f"Expected '猫', got '{loaded_expr}'"

        # Now clean up test card in history
        await tab_history.click()
        await page.wait_for_timeout(200)
        delete_btn = history_list.locator(".btn-history-delete").first
        await delete_btn.click()
        await page.wait_for_timeout(100)
        # Second click to confirm deletion (2-click confirmation pattern)
        if await delete_btn.count() > 0:
            await delete_btn.click()
            await page.wait_for_timeout(400)
        print("Card deletion executed.")

        results["6.1_history_library"] = "PASS"

        # Switch back to text
        await tab_text.click()
        await page.wait_for_timeout(100)

        # -------------------------------------------------------------
        # Section 7: Popover Settings & Layout Customization
        # -------------------------------------------------------------
        print("\n--- Verifying Section 7: Popover Settings ---")
        await settings_btn.click()
        await page.wait_for_timeout(150)
        assert await popover.is_visible() is True

        font_select = page.locator("#field-font-select")
        assert await font_select.count() == 1
        font_count = await font_select.locator("option").count()
        print(f"Font options count: {font_count}")
        assert font_count >= 3

        # Change font and verify CSS custom property updates
        await font_select.select_option("Noto Serif JP")
        await page.wait_for_timeout(100)
        font_var = await page.evaluate("() => document.documentElement.style.getPropertyValue('--japanese-font')")
        print("CSS --japanese-font set to:", font_var)
        assert "noto-serif" in font_var.lower() or "serif" in font_var.lower()

        # Check section move up/down buttons
        move_up_btns = page.locator(".btn-move-up")
        move_down_btns = page.locator(".btn-move-down")
        up_count = await move_up_btns.count()
        down_count = await move_down_btns.count()
        print(f"Layout reorder buttons: {up_count} up, {down_count} down")
        assert up_count > 0 and down_count > 0

        # Open Section Layout Order details accordion
        order_summary = page.locator("summary.settings-order-summary")
        if await order_summary.count() > 0:
            await order_summary.click()
            await page.wait_for_timeout(150)

        # Click Move Down on second item
        first_down_btn = move_down_btns.nth(0)
        if await first_down_btn.is_enabled():
            await first_down_btn.click()
            await page.wait_for_timeout(100)

        # Reset layout to default
        reset_layout_btn = page.locator("#btn-reset-layout")
        if await reset_layout_btn.count() > 0:
            await reset_layout_btn.click()
            await page.wait_for_timeout(100)

        # Close popover
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(100)
        assert await popover.is_visible() is False
        results["7.1_settings_popover"] = "PASS"

        # Verify ZERO page errors / uncaught JS exceptions
        print(f"\nPage errors count: {len(page_errors)}")
        if page_errors:
            print("Errors:", page_errors)
        assert len(page_errors) == 0, f"Found unexpected page errors: {page_errors}"

        print("\n=======================================================")
        print(">>> ALL 7 SECTIONS VERIFIED AND PASSED CLEANLY! <<<")
        print(json.dumps(results, indent=2))
        print("=======================================================")
        await browser.close()

if __name__ == "__main__":
    proc = ensure_backend()
    try:
        asyncio.run(run_verification())
    finally:
        if proc:
            proc.terminate()
            proc.wait()
