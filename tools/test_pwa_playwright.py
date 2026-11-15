"""
Playwright Web App Verification for Kiroku Note PWA, Icons, TopChrome Auth, and Settings Account Card.
"""
import http.server
import os
import socketserver
import threading
import time
from playwright.sync_api import sync_playwright

PORT = 5178
PUBLIC_DIR = os.path.abspath('public')

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)
    def log_message(self, format, *args):
        pass

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True

def run_test():
    server = ThreadedHTTPServer(('127.0.0.1', PORT), QuietHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    time.sleep(0.5)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            print("[Test 1] Navigating to http://127.0.0.1:5178/ ...")
            page.goto(f"http://127.0.0.1:{PORT}/")
            page.wait_for_load_state("domcontentloaded")

            # Check PWA manifest & icon links in <head>
            manifest_href = page.locator('link[rel="manifest"]').get_attribute('href')
            print(f"  [PASS] Manifest link found: {manifest_href}")
            assert manifest_href == '/manifest.json'

            icon_href = page.locator('link[rel="icon"][sizes="192x192"]').get_attribute('href')
            print(f"  [PASS] 192x192 icon link found: {icon_href}")
            assert icon_href == '/icons/icon-192.png'

            apple_icon = page.locator('link[rel="apple-touch-icon"]').get_attribute('href')
            print(f"  [PASS] Apple touch icon found: {apple_icon}")
            assert apple_icon == '/icons/apple-touch-icon.png'

            # Wait for TopChrome Auth Button
            page.wait_for_selector("#btn-top-chrome-auth", state="visible", timeout=10000)
            auth_btn = page.locator("#btn-top-chrome-auth")
            btn_text = auth_btn.inner_text().strip()
            print(f"  [PASS] TopChrome Auth button visible: '{btn_text}'")
            assert "Sign in" in btn_text

            # Test clicking Sign in navigates to /login.html
            print("[Test 2] Testing Sign In navigation...")
            auth_btn.click()
            page.wait_for_url("**/login.html", timeout=5000)
            print(f"  [PASS] Navigated to login URL: {page.url}")

            # Test login page structure
            brand_title = page.locator(".brand-title").inner_text().strip()
            print(f"  [PASS] Login page title: '{brand_title}'")
            assert "Kiroku" in brand_title

            google_btn = page.locator("a[href='/auth/google']")
            assert google_btn.is_visible(), "Google auth button not found"
            github_btn = page.locator("a[href='/auth/github']")
            assert github_btn.is_visible(), "GitHub auth button not found"
            print("  [PASS] OAuth provider buttons (Google & GitHub) rendered correctly.")

            # Test Settings page has Account Card
            print("[Test 3] Navigating to Settings (#settings)...")
            page.goto(f"http://127.0.0.1:{PORT}/#settings")
            page.wait_for_selector("#settings-account-card", state="visible", timeout=10000)
            account_card = page.locator("#settings-account-card")
            assert account_card.is_visible(), "Settings Account card not visible"

            card_title = page.locator("#settings-account-card .card-title").inner_text().strip()
            print(f"  [PASS] Account card title: '{card_title}'")
            assert "Account" in card_title

            badge_text = page.locator("#settings-account-badge").inner_text().strip().upper()
            print(f"  [PASS] Account badge text: '{badge_text}'")
            assert any(k in badge_text for k in ["GUEST", "CONNECTED", "CHECKING"])

            action_btn = page.locator("#btn-account-action").inner_text().strip().upper()
            print(f"  [PASS] Account action button text: '{action_btn}'")
            assert any(k in action_btn for k in ["SIGN IN", "SIGN OUT"])

            browser.close()
    finally:
        server.shutdown()

    print("\n[SUCCESS] All Playwright PWA tests passed successfully!")

if __name__ == '__main__':
    run_test()
