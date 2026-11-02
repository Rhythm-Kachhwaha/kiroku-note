import os
import sys
import time
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ARTIFACT_DIR = r"C:\Users\Rhythm\.gemini\antigravity\brain\287559e0-7f77-4ebd-b786-997e18cdf862"
DESKTOP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "desktop"))
PORT = 8089

class DesktopHTTPHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DESKTOP_DIR, **kwargs)

    def guess_type(self, path):
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".riv"):
            return "application/octet-stream"
        if path.endswith(".js"):
            return "application/javascript"
        if path.endswith(".css"):
            return "text/css"
        if path.endswith(".svg"):
            return "image/svg+xml"
        return super().guess_type(path)

    def log_message(self, format, *args):
        # Silent logger
        pass

def run():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), DesktopHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"HTTP Server started at http://127.0.0.1:{PORT} serving {DESKTOP_DIR}")

    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 500, "height": 750},
            device_scale_factor=1.0
        )
        page = context.new_page()
        page.on("console", lambda msg: print(f"[Console] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: print(f"[PageError] {err}"))
        page.on("requestfailed", lambda req: print(f"[ReqFailed] {req.url}: {req.failure}"))
        page.on("response", lambda resp: print(f"[Resp] {resp.status}: {resp.url}") if not resp.url.endswith('.svg') else None)

        # Enable debug flag before any script runs
        page.add_init_script("window.__KIROKU_PERF_DEBUG__ = true;")

        print("--- SCENARIO 1: COLD START ---")
        t0 = time.time()
        page.goto(f"http://127.0.0.1:{PORT}/src/index.html?perf=1", wait_until="domcontentloaded")
        
        # Measure stage bounding box at mount
        stage_box_mount = page.evaluate("""() => {
            const el = document.getElementById('mascot-stage');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        }""")

        # Wait for mascot first frame drawn or canvas opacity 1
        page.wait_for_function("""() => {
            const canvas = document.querySelector('.rive-mascot-canvas');
            const fallback = document.getElementById('mascot-svg');
            const opacity = canvas ? window.getComputedStyle(canvas).opacity : null;
            return opacity === '1' || (fallback && window.getComputedStyle(fallback).display !== 'none');
        }""", timeout=15000)

        # Measure stage bounding box after load
        stage_box_loaded = page.evaluate("""() => {
            const el = document.getElementById('mascot-stage');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        }""")

        cold_marks = page.evaluate("""() => {
            const entries = performance.getEntriesByType('mark');
            const res = {};
            for (const e of entries) {
                res[e.name] = e.startTime;
            }
            return res;
        }""")

        canvas_info = page.evaluate("""() => {
            const canvas = document.querySelector('.rive-mascot-canvas');
            return {
                width: canvas ? canvas.width : null,
                height: canvas ? canvas.height : null,
                clientWidth: canvas ? canvas.clientWidth : null,
                clientHeight: canvas ? canvas.clientHeight : null,
                dpr: window.devicePixelRatio
            };
        }""")

        results["cold_start"] = {
            "marks": cold_marks,
            "stage_mount": stage_box_mount,
            "stage_loaded": stage_box_loaded,
            "canvas": canvas_info
        }

        # Check speech bubble visibility
        bubble_visible = page.evaluate("""() => {
            const b = document.getElementById('home-speech-bubble');
            return b && window.getComputedStyle(b).opacity === '1';
        }""")
        results["bubble_visible"] = bubble_visible

        # Viewport 1 Screenshot: Default Rest
        page.wait_for_timeout(3000)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_default_rest.png"))
        
        # Mascot close up
        mascot_el = page.locator("#mascot-stage")
        if mascot_el.count() > 0:
            mascot_el.screenshot(path=os.path.join(ARTIFACT_DIR, "cat_mascot_default.png"))

        # Hover Vocab Card and capture mid-draw
        print("Hovering Vocab Card on default viewport...")
        page.hover("#launcher-card-vocab")
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_default_hover_draw.png"))

        # Unhover and wait for ease out / completion to rest
        page.mouse.move(0, 0)
        page.wait_for_timeout(2500)

        print("--- SCENARIO 2: REFRESH ---")
        page.evaluate("performance.clearMarks();")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("""() => {
            const canvas = document.querySelector('.rive-mascot-canvas');
            return canvas && window.getComputedStyle(canvas).opacity === '1';
        }""", timeout=10000)

        refresh_marks = page.evaluate("""() => {
            const entries = performance.getEntriesByType('mark');
            const res = {};
            for (const e of entries) {
                res[e.name] = e.startTime;
            }
            return res;
        }""")
        results["refresh"] = {"marks": refresh_marks}

        print("--- SCENARIO 3: RETURN TO HOME ---")
        # Navigate to vocab
        page.evaluate("window.router.navigateToTab('vocab');")
        page.wait_for_timeout(300)

        # Clear marks and return to home
        page.evaluate("performance.clearMarks();")
        page.evaluate("performance.mark('mount:start');")
        page.evaluate("window.router.navigateToTab('home');")
        page.wait_for_function("""() => {
            const canvas = document.querySelector('.rive-mascot-canvas');
            return canvas && window.getComputedStyle(canvas).opacity === '1';
        }""", timeout=10000)

        return_marks = page.evaluate("""() => {
            const entries = performance.getEntriesByType('mark');
            const res = {};
            for (const e of entries) {
                res[e.name] = e.startTime;
            }
            return res;
        }""")
        results["return_to_home"] = {"marks": return_marks}

        # Verify no instance leak across repeated navigations
        for i in range(5):
            page.evaluate("window.router.navigateToTab('vocab');")
            page.wait_for_timeout(100)
            page.evaluate("window.router.navigateToTab('home');")
            page.wait_for_timeout(100)

        canvases_count = page.evaluate("document.querySelectorAll('.rive-mascot-canvas').length")
        results["mascot_canvases_count"] = canvases_count

        print("--- SCENARIO 4: MAXIMIZED VIEWPORT (1280x800) ---")
        page.set_viewport_size({"width": 1280, "height": 800})
        page.mouse.move(100, 100)
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_maximized_rest.png"))
        
        if mascot_el.count() > 0:
            mascot_el.screenshot(path=os.path.join(ARTIFACT_DIR, "cat_mascot_maximized.png"))

        page.hover("#launcher-card-kanji")
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_maximized_hover_draw.png"))
        page.mouse.move(0, 0)
        page.wait_for_timeout(2000)

        print("--- SCENARIO 5: NARROW VIEWPORT (400x700) ---")
        page.set_viewport_size({"width": 400, "height": 700})
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_narrow_rest.png"))

        page.hover("#launcher-card-vocab")
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(ARTIFACT_DIR, "home_narrow_hover_draw.png"))
        page.mouse.move(0, 0)
        page.wait_for_timeout(1000)

        browser.close()

    server.shutdown()
    print("Verification completed successfully. Results:")
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    run()
