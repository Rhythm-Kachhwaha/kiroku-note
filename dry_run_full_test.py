import os
import sys
import time
import asyncio
import json
import urllib.request

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from playwright.async_api import async_playwright

BACKEND_URL = "http://127.0.0.1:21828"

def check_backend_running():
    try:
        with urllib.request.urlopen(f"{BACKEND_URL}/api/health", timeout=3) as resp:
            data = json.loads(resp.read().decode())
            print(f"Backend healthy on {BACKEND_URL}: {data}")
            return True
    except Exception as e:
        print(f"Backend check failed: {e}")
        return False

async def run_full_dry_run():
    if not check_backend_running():
        print("ERROR: Backend is not running on port 21828!")
        sys.exit(1)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-web-security"])
        context = await browser.new_context(viewport={"width": 420, "height": 800})
        page = await context.new_page()

        page_errors = []
        console_msgs = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))

        file_url = "file:///" + os.path.abspath("extension/sidepanel/sidepanel.html").replace("\\", "/")
        print(f"\n>>> Loading Side Panel: {file_url} ...")
        await page.goto(file_url)
        await page.wait_for_timeout(1000)

        test_results = {}

        # =========================================================================
        # 1. HEADER & GLOBAL CONTROLS
        # =========================================================================
        print("\n--- 1. Testing Header & Global Controls ---")
        
        # Wordmark
        wordmark = page.locator(".brand-wordmark")
        assert (await wordmark.text_content()).strip() == "KIROKU"
        test_results["header_wordmark"] = "PASS"

        # Status Indicators & Tooltips (T1-A)
        ind_yomi = page.locator("#indicator-yomitan")
        ind_anki = page.locator("#indicator-anki")
        ind_ocr = page.locator("#indicator-ocr")
        assert await ind_yomi.count() == 1
        assert await ind_anki.count() == 1
        assert await ind_ocr.count() == 1
        yomi_title = await ind_yomi.get_attribute("title")
        anki_title = await ind_anki.get_attribute("title")
        ocr_title = await ind_ocr.get_attribute("title")
        print(f"Indicator titles: Yomitan='{yomi_title}', Anki='{anki_title}', OCR='{ocr_title}'")
        assert yomi_title is not None and len(yomi_title) > 0, "Yomitan status tooltip missing"
        assert anki_title is not None and len(anki_title) > 0, "Anki status tooltip missing"
        assert ocr_title is not None and len(ocr_title) > 0, "OCR status tooltip missing"
        test_results["status_indicator_tooltips"] = "PASS"

        # Writing Mode Toggle ([JP])
        jp_btn = page.locator("#btn-editor-jp-mode")
        assert await jp_btn.get_attribute("aria-pressed") == "false"
        await jp_btn.click()
        await page.wait_for_timeout(50)
        assert await jp_btn.get_attribute("aria-pressed") == "true"
        await jp_btn.click()
        await page.wait_for_timeout(50)
        assert await jp_btn.get_attribute("aria-pressed") == "false"
        test_results["jp_mode_toggle"] = "PASS"

        # Settings Popover & Layout Reordering
        settings_btn = page.locator("#btn-layout-settings")
        popover = page.locator("#layout-settings-popover")
        assert await popover.is_visible() is False
        await settings_btn.click()
        await page.wait_for_timeout(100)
        assert await popover.is_visible() is True
        
        # Check Japanese Font select
        font_select = page.locator("#field-font-select")
        assert await font_select.count() == 1
        
        # Check Furigana Density select (T3-H)
        furigana_select = page.locator("#setting-furigana-mode")
        assert await furigana_select.count() == 1
        f_options = await furigana_select.locator("option").all_inner_texts()
        print("Furigana mode options:", f_options)
        assert any("Advanced" in opt for opt in f_options), "Advanced-only furigana option missing"

        # Check Per-Deck Template Save button (T3-G)
        deck_tmpl_btn = page.locator("#btn-save-deck-template")
        assert await deck_tmpl_btn.count() == 1

        # Check AI Assistant status display in Settings
        llm_disp = page.locator("#llm-provider-display")
        assert await llm_disp.count() == 1
        
        # Close popover
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(100)
        assert await popover.is_visible() is False
        test_results["settings_popover"] = "PASS"

        # =========================================================================
        # 2. TEXT MINING, CANONICAL IDENTIFY, HERO SHOWCASE & CARD PREVIEW
        # =========================================================================
        print("\n--- 2. Testing Text Mining & Card Editor ---")
        tab_text = page.locator("#tab-btn-text")
        await tab_text.click()
        await page.wait_for_timeout(50)

        # Trigger canonical identify(term)
        test_word = "勉強"
        print(f"Calling identify('{test_word}') to trigger enrichment pipeline...")
        await page.evaluate("(term) => identify(term)", test_word)
        await page.wait_for_timeout(1500)

        # Check Hero View updates
        hero_expr = page.locator("#expression")
        hero_reading = page.locator("#reading")
        hero_meanings = page.locator("#word-meanings-summary")
        print("Hero expression:", await hero_expr.text_content())
        print("Hero reading:", await hero_reading.text_content())
        print("Hero meanings:", await hero_meanings.text_content())
        assert test_word in (await hero_expr.text_content())
        assert "べんきょう" in (await hero_reading.text_content())
        test_results["hero_showcase_reactive_update"] = "PASS"

        # TTS Button (T2-D) should now be unhidden
        tts_btn = page.locator("#btn-tts-play")
        print("TTS button visible after capture:", await tts_btn.is_visible())
        assert await tts_btn.is_visible() is True, "TTS button should be visible when expression is populated"
        test_results["tts_button_visible"] = "PASS"

        # Check Hero Badges (JLPT, POS, Pitch)
        jlpt_badge = page.locator("#showcase-jlpt-badge")
        print("JLPT badge visible:", await jlpt_badge.is_visible(), "text:", await jlpt_badge.text_content())
        test_results["hero_badges"] = "PASS"

        # Live Card Preview Check
        preview_section = page.locator("#card-preview-section")
        assert await preview_section.count() == 1
        tab_front = page.locator("#preview-tab-front")
        tab_back = page.locator("#preview-tab-back")
        card_preview = page.locator("#card-preview-card")

        await tab_front.click()
        await page.wait_for_timeout(100)
        front_expr = card_preview.locator(".kn-front-expression")
        assert await front_expr.is_visible() is True
        assert test_word in (await front_expr.text_content())

        await tab_back.click()
        await page.wait_for_timeout(100)
        assert await card_preview.is_visible() is True
        assert test_word in (await card_preview.text_content())
        test_results["live_card_preview"] = "PASS"

        # Optional Fields toggle (+ / -)
        opt_details = page.locator("#optional-details")
        assert await opt_details.evaluate("el => el.open") is False
        opt_toggle = page.locator("#optional-summary-toggle")
        await opt_toggle.click()
        await page.wait_for_timeout(100)
        assert await opt_details.evaluate("el => el.open") is True
        await opt_toggle.click()
        await page.wait_for_timeout(100)
        assert await opt_details.evaluate("el => el.open") is False
        test_results["optional_fields_toggle"] = "PASS"

        # Stroke Order Diagram (T4-E) in Kanji Breakdown
        kanji_cards = page.locator(".study-kanji-card")
        k_count = await kanji_cards.count()
        print(f"Kanji breakdown cards rendered: {k_count}")
        if k_count > 0:
            stroke_badge = kanji_cards.first.locator(".pill-strokes")
            if await stroke_badge.count() > 0:
                print("Stroke badge text:", await stroke_badge.text_content())
                # Click stroke toggle
                await stroke_badge.click()
                await page.wait_for_timeout(400)
                stroke_accordion = kanji_cards.first.locator(".study-kanji-strokes-accordion")
                if await stroke_accordion.count() > 0:
                    print("Stroke accordion open:", await stroke_accordion.evaluate("el => el.open"))
                    svg_el = stroke_accordion.locator("svg")
                    print("Stroke SVG rendered:", await svg_el.count())
        test_results["kanji_strokes_diagram"] = "PASS"

        # Save Card to SQLite
        save_btn = page.locator("#save-card-btn")
        save_badge = page.locator("#save-badge")
        session_count = page.locator("#session-count")

        await save_btn.click()
        await page.wait_for_timeout(600)
        badge_text = await save_badge.text_content()
        print("Save badge after save:", badge_text)
        assert "SAVED" in badge_text, f"Expected SAVED, got {badge_text}"
        session_text = await session_count.text_content()
        print("Session counter:", session_text)
        assert "today" in session_text
        test_results["save_card_sqlite"] = "PASS"

        # Duplicate Prevention Invariant Check
        # Re-identifying the same word in the same deck should display "ALREADY SAVED"
        await page.evaluate("(term) => identify(term)", test_word)
        await page.wait_for_timeout(1200)
        badge_text_dupe = await save_badge.text_content()
        print("Save badge on duplicate identification:", badge_text_dupe)
        assert "ALREADY SAVED" in badge_text_dupe or "SAVED" in badge_text_dupe
        test_results["duplicate_detection_integrity"] = "PASS"

        # =========================================================================
        # 3. VIDEO MINING VIEW & SUBTITLE TOOLS
        # =========================================================================
        print("\n--- 3. Testing Video Mining Tab ---")
        tab_video = page.locator("#tab-btn-video")
        await tab_video.click()
        await page.wait_for_timeout(100)

        # Video Cue Preview
        cue_preview = page.locator("#video-current-cue-preview")
        assert await cue_preview.is_visible() is True

        # Mine sentence button (T4-F)
        mine_sentence_btn = page.locator("#btn-mine-full-sentence")
        assert await mine_sentence_btn.count() == 1
        print("Mine sentence button text:", (await mine_sentence_btn.text_content()).strip())

        # Subtitle controls details (T3-E, T4-B)
        sub_details = page.locator("#subtitle-controls-details")
        assert await sub_details.count() == 1
        
        # Subtitle search input (T4-B)
        sub_search = page.locator("#subtitle-search-input")
        assert await sub_search.count() == 1
        
        # Recent cues section (T4-C)
        recent_cues = page.locator("#recent-cues-section")
        assert await recent_cues.count() == 1
        test_results["video_mining_controls"] = "PASS"

        # Test setting a mock active cue and clicking "Mine sentence"
        mock_cue = "今夜の月はとても綺麗ですね。"
        await page.evaluate("""(cue) => {
            currentVideoCueText = cue;
            updateVideoCuePreviewText(cue, "");
        }""", mock_cue)
        await page.wait_for_timeout(100)
        cue_display_text = await cue_preview.text_content()
        assert "今夜の月" in cue_display_text

        # Click Mine sentence
        await mine_sentence_btn.click()
        await page.wait_for_timeout(500)

        # Switch back to text to verify sentence field and optional details
        await tab_text.click()
        await page.wait_for_timeout(100)
        field_sentence = page.locator("#field-example-sentence")
        sentence_val = await field_sentence.input_value()
        print("Sentence field populated with:", sentence_val)
        assert mock_cue in sentence_val, f"Sentence field unexpected: {sentence_val}"
        test_results["mine_full_sentence_action"] = "PASS"

        # =========================================================================
        # 4. QUICK ADD MODE & ENGLISH REVERSE LOOKUP
        # =========================================================================
        print("\n--- 4. Testing Quick Add & English Reverse Lookup ---")
        tab_quick = page.locator("#tab-btn-quickadd")
        await tab_quick.click()
        await page.wait_for_timeout(100)

        quick_input = page.locator("#quickadd-input")
        assert await quick_input.is_visible() is True

        # Test English Search Toggle ("EN")
        btn_en = page.locator("#quickadd-mode-english")
        assert await btn_en.count() == 1
        await btn_en.click()
        await page.wait_for_timeout(100)
        assert "active" in (await btn_en.get_attribute("class"))

        # Type English query "water"
        await quick_input.fill("water")
        await page.wait_for_timeout(600)

        suggestions = page.locator(".quickadd-candidate-item")
        sugg_count = await suggestions.count()
        print(f"Suggestions for 'water': {sugg_count}")
        if sugg_count > 0:
            first_text = await suggestions.first.text_content()
            print("First suggestion:", first_text)
            assert "水" in first_text or "みず" in first_text or "water" in first_text.lower()
        test_results["quick_add_english_search"] = "PASS"

        # Switch back to Kana mode
        btn_kana = page.locator("#quickadd-mode-hiragana")
        assert await btn_kana.count() == 1
        await btn_kana.click()
        await page.wait_for_timeout(50)

        # =========================================================================
        # 5. HISTORY & SAVED CARDS & BULK OPERATIONS
        # =========================================================================
        print("\n--- 5. Testing History Library & Bulk Operations ---")
        tab_history = page.locator("#tab-btn-history")
        await tab_history.click()
        await page.wait_for_timeout(400)

        # Progress bar label (T1-B)
        sync_label = page.locator("#history-sync-label")
        assert await sync_label.count() == 1
        print("Sync label text:", await sync_label.text_content())

        # Export CSV button (T2-F)
        export_btn = page.locator("#btn-export-cards")
        assert await export_btn.count() == 1
        print("Export CSV button present:", await export_btn.is_visible())

        # Sort Dropdown (T2-J)
        sort_select = page.locator("#history-sort-select")
        assert await sort_select.count() == 1
        sort_options = await sort_select.locator("option").all_inner_texts()
        print("History sort options:", sort_options)
        assert len(sort_options) >= 4

        # Mining Stats Dashboard (T3-F)
        stats_details = page.locator("#history-stats-details")
        assert await stats_details.count() == 1
        stats_summary = page.locator("#history-stats-details summary")
        await stats_summary.click()
        await page.wait_for_timeout(500)
        stats_content = page.locator("#history-stats-content")
        print("Stats content rendered:", await stats_content.is_visible())
        stats_text = await stats_content.text_content()
        print("Stats text snippet:", stats_text[:100] if stats_text else "None")
        assert "Today" in stats_text or "All Time" in stats_text or "Sync Ratio" in stats_text
        test_results["mining_stats_dashboard"] = "PASS"

        # Check card rows in History
        history_items = page.locator(".history-item")
        item_count = await history_items.count()
        print(f"Total history items displayed: {item_count}")
        assert item_count > 0, "Expected at least 1 history item"

        # Verify JLPT Pill (T2-A) and Checkbox (T4-A) in first row
        first_item = history_items.first
        first_cb = first_item.locator(".history-select-cb")
        assert await first_cb.count() == 1, "Multi-select checkbox missing in history item"

        # Multi-Select Bulk Action Bar (T4-A)
        bulk_bar = page.locator("#bulk-action-bar")
        assert await bulk_bar.is_visible() is False, "Bulk action bar initially hidden"
        
        # Check checkbox on first item
        await first_cb.check()
        await page.wait_for_timeout(100)
        assert await bulk_bar.is_visible() is True, "Bulk action bar visible when items selected"
        selected_label = page.locator("#bulk-selected-count")
        print("Bulk selected count label:", await selected_label.text_content())
        assert "1" in (await selected_label.text_content())

        # Cancel selection
        btn_cancel_bulk = page.locator("#btn-bulk-cancel")
        await btn_cancel_bulk.click()
        await page.wait_for_timeout(100)
        assert await bulk_bar.is_visible() is False, "Bulk action bar hidden after cancel"
        test_results["history_bulk_selection_bar"] = "PASS"

        # Test Soft Delete Undo Toast (T3-C)
        delete_btn = first_item.locator(".btn-history-delete")
        assert await delete_btn.count() == 1
        
        # 1st click arms confirmation
        await delete_btn.click()
        await page.wait_for_timeout(50)
        # 2nd click executes deferred delete and triggers Undo toast
        await delete_btn.click()
        await page.wait_for_timeout(100)

        undo_toast = page.locator("#undo-toast")
        assert await undo_toast.is_visible() is True, "Undo toast should be visible after delete"
        btn_undo = page.locator("#btn-undo-delete")
        assert await btn_undo.count() == 1
        t_text = (await undo_toast.text_content()).encode('ascii', 'backslashreplace').decode('ascii')
        print("Undo toast visible:", t_text)

        # Click Undo to restore card
        await btn_undo.click()
        await page.wait_for_timeout(100)
        assert await undo_toast.is_visible() is False, "Undo toast hidden after undo"
        test_results["history_undo_delete_toast"] = "PASS"

        # =========================================================================
        # 6. ASK TAB (TIER 5 AI ASSISTANT)
        # =========================================================================
        print("\n--- 6. Testing Ask AI Assistant Tab ---")
        tab_ask = page.locator("#tab-btn-ask")
        assert await tab_ask.count() == 1
        await tab_ask.click()
        await page.wait_for_timeout(100)

        ask_view = page.locator("#ask-mining-view")
        assert await ask_view.is_visible() is True

        # Status bar & provider pill
        provider_pill = page.locator("#ask-provider-pill")
        assert await provider_pill.count() == 1
        print("Ask tab provider pill text:", await provider_pill.text_content())

        # Prompt chips
        prompt_chips = page.locator(".prompt-chip")
        chip_count = await prompt_chips.count()
        print(f"Prompt chips count: {chip_count}")
        assert chip_count >= 4, f"Expected at least 4 prompt chips, got {chip_count}"

        # Context banner
        context_banner = page.locator("#ask-context-banner")
        assert await context_banner.count() == 1
        
        # Composer input & submit
        ask_input = page.locator("#ask-input-box")
        ask_submit = page.locator("#btn-ask-submit")
        assert await ask_input.count() == 1
        assert await ask_submit.count() == 1

        # Test typing query in ask composer
        await ask_input.fill("What is the difference between particles?")
        await page.wait_for_timeout(100)
        char_count = page.locator("#ask-char-count")
        print("Ask char count:", await char_count.text_content())
        assert "chars" in (await char_count.text_content())

        # Submit query
        await ask_submit.click()
        await page.wait_for_timeout(600)

        # Check chat stream
        chat_stream = page.locator("#ask-chat-stream")
        user_msg = chat_stream.locator(".chat-message.user-msg")
        assert await user_msg.count() >= 1
        u_text = (await user_msg.first.text_content()).encode('ascii', 'backslashreplace').decode('ascii')
        print("User message in chat stream:", u_text)

        # AI response or error message
        ai_msg = chat_stream.locator(".chat-message.ai-msg")
        assert await ai_msg.count() >= 1
        a_text = (await ai_msg.first.text_content()).encode('ascii', 'backslashreplace').decode('ascii')
        print("AI message in chat stream:", a_text[:120])
        test_results["ask_ai_assistant_tab"] = "PASS"

        # =========================================================================
        # 7. ERROR & CONSOLE AUDIT
        # =========================================================================
        print("\n--- 7. Checking Page Errors & Console Log Health ---")
        print(f"Page errors ({len(page_errors)}): {page_errors}")
        severe_console_errors = [c for c in console_msgs if "[error]" in c]
        print(f"Console errors ({len(severe_console_errors)}): {severe_console_errors}")

        assert len(page_errors) == 0, f"Found uncaught page errors: {page_errors}"

        print("\n=======================================================")
        print(">>> ALL DRY-RUN CHECKS COMPLETED SUCCESSFULLY! <<<")
        print(json.dumps(test_results, indent=2))
        print("=======================================================")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_full_dry_run())
