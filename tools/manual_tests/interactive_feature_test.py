import asyncio
import os
import sys
import json

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.async_api import async_playwright

EXT_DIR = os.path.abspath("extension")
SIDEPANEL_URL = f"file:///{EXT_DIR.replace(os.sep, '/')}/sidepanel/sidepanel.html"
BACKEND_URL = "http://127.0.0.1:21828"

async def test_full_interactive_functioning():
    print(">>> Starting Comprehensive Interactive Playwright Suite...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-web-security",
                "--allow-file-access-from-files",
                "--no-sandbox"
            ]
        )
        context = await browser.new_context(viewport={"width": 420, "height": 800})
        page = await context.new_page()

        console_errors = []
        page_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        # Load Side Panel
        print(f"Loading Side Panel from: {SIDEPANEL_URL}")
        await page.goto(SIDEPANEL_URL)
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(1000)

        # -------------------------------------------------------------
        # TEST 1: Undo Delete Toast Workflow (T3-C)
        # -------------------------------------------------------------
        print("\n--- Test 1: Undo Delete Toast Workflow ---")
        # Save a throwaway test card first via backend or identify
        await page.evaluate("""async () => {
            const res = await fetch("http://127.0.0.1:21828/api/cards/save", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    expression: "消去テスト",
                    reading: "しょうきょてすと",
                    meaning: "deletion test card",
                    deck_name: "Default"
                })
            });
            const data = await res.json();
            window._testCardId = data.id;
            await loadHistory();
        }""")
        await page.wait_for_timeout(600)

        # Switch to history tab
        await page.click("#tab-btn-history")
        await page.wait_for_timeout(400)

        # Ensure history is uncollapsed
        await page.evaluate("""() => {
            const c = document.querySelector("#history-content-container");
            if (c) c.hidden = false;
        }""")

        # Find the card delete button for 消去テスト
        del_btn_found = await page.evaluate("""() => {
            const item = document.querySelector(`.history-item[data-card-id="${window._testCardId}"]`);
            if (!item) return false;
            const btn = item.querySelector(".btn-history-delete");
            if (!btn) return false;
            // First click: sets confirm-delete
            btn.click();
            // Second click: triggers soft delete and undo toast
            btn.click();
            return true;
        }""")
        assert del_btn_found, "Could not find delete button for test card"
        await page.wait_for_timeout(300)

        # Verify undo toast is now visible
        toast_visible = await page.is_visible("#undo-toast")
        toast_text = await page.text_content("#undo-toast-message")
        print(f"Undo toast visible: {toast_visible}, text: '{toast_text}'")
        assert toast_visible, "Undo toast must be visible after soft delete"
        assert "消去テスト" in toast_text, f"Toast text should mention card expression, got: {toast_text}"

        # Click Undo button
        print("Clicking Undo...")
        await page.click("#btn-undo-delete")
        await page.wait_for_timeout(500)

        # Toast should now be hidden
        toast_hidden = not await page.is_visible("#undo-toast")
        print(f"Undo toast hidden after clicking Undo: {toast_hidden}")
        assert toast_hidden, "Undo toast must hide after clicking undo"

        # Check card is still in database
        card_still_exists = await page.evaluate("""async () => {
            const res = await fetch(`http://127.0.0.1:21828/api/cards/${window._testCardId}`);
            return res.ok;
        }""")
        print(f"Card still exists in SQLite after Undo: {card_still_exists}")
        assert card_still_exists, "Card should still exist in database after Undo"

        # Now test letting the 5s timer expire to commit deletion
        print("Testing timer-committed deletion...")
        await page.evaluate("""() => {
            const item = document.querySelector(`.history-item[data-card-id="${window._testCardId}"]`);
            const btn = item.querySelector(".btn-history-delete");
            btn.click();
            btn.click();
        }""")
        await page.wait_for_timeout(300)
        assert await page.is_visible("#undo-toast"), "Undo toast must be visible"

        # Wait 5.5 seconds for timer to commit
        print("Waiting 5.5s for delete to commit...")
        await page.wait_for_timeout(5500)

        # Card should now be deleted from database
        card_deleted = await page.evaluate("""async () => {
            const res = await fetch(`http://127.0.0.1:21828/api/cards/${window._testCardId}`);
            return res.status === 404;
        }""")
        print(f"Card confirmed deleted from SQLite after timeout: {card_deleted}")
        assert card_deleted, "Card must be deleted from SQLite after timeout"

        # -------------------------------------------------------------
        # TEST 2: Bulk Operations (T4-A)
        # -------------------------------------------------------------
        print("\n--- Test 2: Bulk Operations (Select, Deck Move, Delete) ---")
        # Create 2 test cards for bulk manipulation
        bulk_ids = await page.evaluate("""async () => {
            const ids = [];
            for (let i = 1; i <= 2; i++) {
                const res = await fetch("http://127.0.0.1:21828/api/cards/save", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        expression: `一括テスト${i}`,
                        reading: `いっかつ${i}`,
                        meaning: `bulk test ${i}`,
                        deck_name: "Default"
                    })
                });
                const data = await res.json();
                ids.push(data.id);
            }
            await loadHistory();
            return ids;
        }""")
        await page.wait_for_timeout(500)
        print(f"Created bulk test cards: {bulk_ids}")

        # Select both cards via checkbox
        await page.evaluate(f"""() => {{
            const ids = {json.dumps(bulk_ids)};
            ids.forEach(id => {{
                const item = document.querySelector(`.history-item[data-card-id="${{id}}"]`);
                if (item) {{
                    const cb = item.querySelector(".history-select-cb");
                    if (cb) {{
                        cb.checked = true;
                        cb.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    }}
                }}
            }});
        }}""")
        await page.wait_for_timeout(300)

        bulk_bar_visible = await page.is_visible("#bulk-action-bar")
        bulk_count_text = await page.text_content("#bulk-selected-count")
        print(f"Bulk action bar visible: {bulk_bar_visible}, text: '{bulk_count_text}'")
        assert bulk_bar_visible, "Bulk action bar must be visible"
        assert "2 selected" in bulk_count_text, f"Expected '2 selected', got '{bulk_count_text}'"

        # Test Bulk Deck Move
        print("Testing Bulk Move to Deck...")
        await page.evaluate("""async () => {
            // Select a deck from bulk-deck-select or call performBulkDeckMove
            await performBulkDeckMove("BulkMinedDeck");
        }""")
        await page.wait_for_timeout(500)

        # Verify cards were moved to "BulkMinedDeck" in backend
        decks_updated = await page.evaluate(f"""async () => {{
            const ids = {json.dumps(bulk_ids)};
            for (const id of ids) {{
                const res = await fetch(`http://127.0.0.1:21828/api/cards/${{id}}`);
                const card = await res.json();
                if (card.deck_name !== "BulkMinedDeck") return false;
            }}
            return true;
        }}""")
        print(f"Cards moved to 'BulkMinedDeck': {decks_updated}")
        assert decks_updated, "Both cards should have deck_name='BulkMinedDeck'"

        # Re-select for bulk delete
        await page.evaluate(f"""() => {{
            const ids = {json.dumps(bulk_ids)};
            ids.forEach(id => {{
                const item = document.querySelector(`.history-item[data-card-id="${{id}}"]`);
                if (item) {{
                    const cb = item.querySelector(".history-select-cb");
                    if (cb) {{
                        cb.checked = true;
                        cb.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    }}
                }}
            }});
        }}""")
        await page.wait_for_timeout(300)

        # Trigger Bulk Delete
        print("Triggering Bulk Delete...")
        await page.evaluate("""async () => {
            await performBulkDelete();
        }""")
        await page.wait_for_timeout(500)

        # Verify bulk deleted cards are gone
        bulk_cards_gone = await page.evaluate(f"""async () => {{
            const ids = {json.dumps(bulk_ids)};
            for (const id of ids) {{
                const res = await fetch(`http://127.0.0.1:21828/api/cards/${{id}}`);
                if (res.status !== 404) return false;
            }}
            return true;
        }}""")
        print(f"Cards deleted in bulk from database: {bulk_cards_gone}")
        assert bulk_cards_gone, "Bulk deleted cards must be removed from SQLite"

        # -------------------------------------------------------------
        # TEST 3: Subtitle In-Track Search & Recent Cues (T4-B, T4-C, T4-F)
        # -------------------------------------------------------------
        print("\n--- Test 3: Video Subtitle Search & Recent Cues ---")
        await page.click("#tab-btn-video")
        await page.wait_for_timeout(300)

        # Inject mock cues into loadedSubtitleCues & recentSubtitleCues
        mock_cues_result = await page.evaluate("""() => {
            const cues = [
                { startMs: 12000, endMs: 14500, text: "私は日本語を勉強しています。" },
                { startMs: 25000, endMs: 28000, text: "今夜の月はとても綺麗ですね。" },
                { startMs: 34000, endMs: 36000, text: "おいしいラーメンを食べに行こう。" }
            ];
            const recent = [
                { startMs: 25000, endMs: 28000, text: "今夜の月はとても綺麗ですね。" },
                { startMs: 12000, endMs: 14500, text: "私は日本語を勉強しています。" }
            ];
            window.setLoadedSubtitleCues(cues);
            window.setRecentSubtitleCues(recent);
            renderRecentCuesList();
            searchSubtitles("ラーメン");
            return {
                recentCount: document.querySelectorAll(".recent-cue-item").length,
                searchResultCount: document.querySelectorAll("#subtitle-search-results li").length
            };
        }""")
        print(f"Subtitle in-track search matches: {mock_cues_result['searchResultCount']}")
        print(f"Recent cues rendered: {mock_cues_result['recentCount']}")
        assert mock_cues_result["searchResultCount"] >= 1, "Should find matching cue for 'ラーメン'"
        assert mock_cues_result["recentCount"] == 2, "Should render 2 recent cues"

        # Test clicking a recent cue word to auto-mine
        print("Testing click on word inside recent cue...")
        clicked_word = await page.evaluate("""async () => {
            const firstWord = document.querySelector(".recent-cue-word");
            if (!firstWord) return null;
            const wordText = firstWord.textContent;
            firstWord.click();
            return wordText;
        }""")
        await page.wait_for_timeout(1000)
        hero_expr = await page.text_content("#expression")
        print(f"Clicked word: '{clicked_word}', Hero expression now: '{hero_expr}'")
        assert hero_expr == clicked_word, f"Hero expression should match clicked word '{clicked_word}', got '{hero_expr}'"

        # -------------------------------------------------------------
        # TEST 4: Furigana Density Settings & Anki Template (T3-H, T3-G)
        # -------------------------------------------------------------
        print("\n--- Test 4: Furigana Density & Settings Popover ---")
        await page.click("#btn-toggle-settings")
        await page.wait_for_timeout(300)
        popover_visible = await page.is_visible("#layout-settings-popover")
        assert popover_visible, "Settings popover must be visible"

        # Change furigana density mode
        await page.select_option("#setting-furigana-mode", "none")
        await page.wait_for_timeout(300)

        # Check that stored template setting was saved
        stored_furigana = await page.evaluate("""() => {
            return currentCardTemplateSettings ? currentCardTemplateSettings.furigana_mode : null;
        }""")
        print(f"Furigana mode in currentCardTemplateSettings: '{stored_furigana}'")
        assert stored_furigana == "none", f"Expected furigana mode 'none', got '{stored_furigana}'"

        # Close settings
        await page.click("#btn-close-settings")
        await page.wait_for_timeout(200)

        # -------------------------------------------------------------
        # TEST 5: History Sorting Dropdown (T2-J)
        # -------------------------------------------------------------
        print("\n--- Test 5: History Sorting ---")
        await page.click("#tab-btn-history")
        await page.wait_for_timeout(300)

        sort_options = await page.evaluate("""() => {
            const sel = document.querySelector("#history-sort-select");
            return Array.from(sel.options).map(o => o.value);
        }""")
        print(f"History sort values: {sort_options}")

        # Switch sort to 'jlpt' and verify no errors
        await page.select_option("#history-sort-select", "jlpt")
        await page.wait_for_timeout(400)
        items_count = await page.evaluate("""() => document.querySelectorAll(".history-item").length""")
        print(f"Cards listed after sorting by JLPT: {items_count}")
        assert items_count > 0, "Cards should still be displayed after sort change"

        # -------------------------------------------------------------
        # TEST 6: Ask Tab Prompt Chips & Char Counter
        # -------------------------------------------------------------
        print("\n--- Test 6: Ask AI Assistant Prompt Chips ---")
        await page.click("#tab-btn-ask")
        await page.wait_for_timeout(300)

        # Click the grammar prompt chip
        await page.evaluate("""() => {
            const chip = document.querySelector('.ask-prompt-chip[data-prompt="Explain grammar"]');
            if (chip) chip.click();
        }""")
        await page.wait_for_timeout(300)

        input_val = await page.input_value("#ask-input")
        char_count = await page.text_content("#ask-char-count")
        print(f"Prompt chip clicked -> Input: '{input_val}', Counter: '{char_count}'")
        assert len(input_val) > 0, "Ask input should be populated after clicking prompt chip"
        assert char_count.endswith("chars"), f"Char counter should end with 'chars', got '{char_count}'"

        # -------------------------------------------------------------
        # Health & Console Audit
        # -------------------------------------------------------------
        print("\n--- Console and Error Audit ---")
        print(f"Page errors ({len(page_errors)}): {page_errors}")
        print(f"Console errors ({len(console_errors)}): {console_errors}")
        assert len(page_errors) == 0, f"Unexpected page errors: {page_errors}"

        await browser.close()

    print("\n=======================================================")
    print(">>> ALL INTERACTIVE WORKFLOW TESTS PASSED PERFECTLY! <<<")
    print("=======================================================\n")

if __name__ == "__main__":
    asyncio.run(test_full_interactive_functioning())
