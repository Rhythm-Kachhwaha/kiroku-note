import subprocess
import time
import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parents[2]
EXT_DIR = str((ROOT_DIR / "extension").resolve())
SUB_PATH = Path(r"C:\Users\Rhythm\Downloads\subs\KirokuSubtitles_[Frained] けいおん! 01 [retimed].ass")
ARTIFACT_DIR = Path(r"C:\Users\Rhythm\.gemini\antigravity\brain\6c3ec4cf-09d0-48aa-9de8-b64b7bb4ed05")

import sys
sys.path.insert(0, str(ROOT_DIR / "tools" / "anime_e2e"))
from fixture_server import FixtureServer

def run():
    print("=== Launching Kiroku Desktop & Playwright E2E Suite ===")

    # 1. Start fixture server for anime video playback
    server = FixtureServer(port=8989)
    server.start()
    print("[1] Fixture server running on 127.0.0.1:8989")

    # 2. Launch Desktop Electron (Desktop spawns its own backend supervisor)
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    electron_exe = str(ROOT_DIR / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe")
    desktop_app = str(ROOT_DIR / "desktop")
    
    electron_proc = subprocess.Popen([
        electron_exe,
        desktop_app,
        "--remote-debugging-port=9333"
    ], env=env)
    print(f"[2] Electron launched (PID {electron_proc.pid}), waiting for backend supervisor...")
    
    # Wait for backend on port 21828 to become healthy
    import urllib.request
    backend_ready = False
    for i in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:21828/api/link/status", timeout=1) as resp:
                if resp.status == 200:
                    backend_ready = True
                    print(f"[3] Backend online and ready after {i*0.5:.1f}s!")
                    break
        except Exception:
            time.sleep(0.5)
    assert backend_ready, "Backend failed to start under Electron supervisor"

    # 3. Connect Playwright
    with sync_playwright() as p:
        desk_browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
        desk_page = desk_browser.contexts[0].pages[0]
        print("[4] Connected to Desktop Electron window:", desk_page.title())

        # Navigate Desktop to Anime tab via bottom dock
        nav_info = desk_page.evaluate("""() => {
            const dockBtn = document.querySelector('[data-tab="anime"]');
            if (dockBtn) {
                dockBtn.click();
                return { clicked: true };
            }
            if (window.app && window.app.navigate) {
                window.app.navigate('anime');
                return { navigatedApp: true };
            }
            location.hash = '#anime';
            return { hashSet: true };
        }""")
        print("  Navigated Desktop to Anime view:", nav_info)
        time.sleep(2)

        # 4. Launch Browser with Extension
        import shutil
        temp_profile = ROOT_DIR / "tools" / "anime_e2e" / "out" / "real_e2e_profile"
        shutil.rmtree(temp_profile, ignore_errors=True)
        temp_profile.mkdir(parents=True, exist_ok=True)

        args = [
            f"--disable-extensions-except={EXT_DIR}",
            f"--load-extension={EXT_DIR}",
            "--no-sandbox",
            "--autoplay-policy=no-user-gesture-required",
        ]
        browser_ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(temp_profile),
            headless=False,
            args=args,
            ignore_default_args=["--disable-extensions"]
        )

        # Wait for service worker
        sw = None
        for _ in range(30):
            workers = browser_ctx.service_workers
            if workers:
                sw = workers[0]
                break
            time.sleep(0.2)
        assert sw, "Extension service worker failed to start"
        print("[5] Extension service worker active")

        # 5. Obtain pairing code directly from Desktop IPC
        pair_data = desk_page.evaluate("""async () => {
            if (window.desktopAPI && window.desktopAPI.extensionPairing) {
                return await window.desktopAPI.extensionPairing.create();
            }
            return null;
        }""")
        print("[6] Desktop generated pairing code:", pair_data)
        assert pair_data and pair_data.get("code"), f"Failed to generate pairing code from Desktop: {pair_data}"
        pair_code = pair_data["code"]

        redeem_req = urllib.request.Request(
            "http://127.0.0.1:21828/api/auth/extension-pairings/redeem",
            data=json.dumps({"code": pair_code}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Origin": "chrome-extension://chnnchfpjephcpgamfkjnfobfnjabika"}
        )
        with urllib.request.urlopen(redeem_req) as resp:
            redeemed_token = json.loads(resp.read().decode("utf-8"))["token"]
            print("[6b] Redeemed pairing token:", redeemed_token[:10], "...")

        # Save token into extension storage and connect link client
        sw.evaluate(f"""async () => {{
            await chrome.storage.local.set({{ 'kiroku.extension.remembered_token': '{redeemed_token}' }});
            if (typeof linkClient !== 'undefined' && linkClient) {{
                linkClient.token = null;
                await linkClient.start();
            }}
        }}""")
        time.sleep(1)

        # 6. Navigate browser to anime episode page
        browser_page = browser_ctx.new_page()
        print("[7] Navigating browser to anime streaming page http://127.0.0.1:8989/anime.html...")
        browser_page.goto("http://127.0.0.1:8989/anime.html", wait_until="domcontentloaded")
        time.sleep(3)
        browser_page.evaluate("""() => {
            const v = document.getElementById('player-video');
            if (v) {
                v.muted = true;
                v.play().catch(() => {});
            }
        }""")
        time.sleep(2)

        # 7. Ingest subtitle file via HUD handleDroppedFile
        print("[8] Ingesting K-ON! ASS Subtitle file...")
        assert SUB_PATH.exists(), f"Subtitle file missing at {SUB_PATH}"
        sub_content = SUB_PATH.read_text(encoding="utf-8")

        load_res = sw.evaluate(f"""async () => {{
            const [tab] = await chrome.tabs.query({{ active: true }});
            if (!tab) return {{ error: "No active tab" }};
            const results = await chrome.scripting.executeScript({{
                target: {{ tabId: tab.id }},
                func: async (assText, filename) => {{
                    const hasHud = Boolean(window.__kirokuAnimeHud);
                    let count = 0;
                    let err = null;
                    if (window.__kirokuAnimeHud) {{
                        try {{
                            const file = new File([assText], filename, {{ type: "text/plain" }});
                            await window.__kirokuAnimeHud.handleDroppedFile(file);
                            count = window.__kirokuAnimeHud.subStatus.count;
                        }} catch (e) {{
                            err = String(e);
                        }}
                    }}
                    return {{ hasHud, count, err, name: filename }};
                }},
                args: [{json.dumps(sub_content)}, {json.dumps(SUB_PATH.name)}]
            }});
            return results?.[0]?.result;
        }}""")
        print("  Subtitle load result:", load_res)
        assert load_res and load_res.get("count") == 397

        # 8. Advance video to 22.0s (Cue 1: "お姉ちゃん そろそろ起きないと…")
        print("\n[9] Seeking video to 22.0s...")
        sw.evaluate(f"""async () => {{
            const [tab] = await chrome.tabs.query({{ active: true }});
            await chrome.scripting.executeScript({{
                target: {{ tabId: tab.id }},
                func: () => {{
                    const b = window.__kirokuLinkBridge;
                    const v = document.getElementById('player-video');
                    if (v) {{
                        v.pause();
                        v.setAttribute('data-current-time', '22.0');
                        v.dispatchEvent(new Event('timeupdate'));
                        v.dispatchEvent(new Event('seeked'));
                    }}
                    if (b) {{
                        b._emitVideoState();
                    }}
                }}
            }});
        }}""")
        time.sleep(2)

        # Verify overlay text in browser
        overlay_text = browser_page.evaluate("""() => {
            const el = document.getElementById('ankiminer-video-subtitle');
            return el ? el.textContent.trim() : null;
        }""")
        print("  Browser subtitle text at 22.0s:", overlay_text)
        assert "そろそろ起きないと" in (overlay_text or "")

        # Capture Screenshot 1: Browser Extension Subtitles Working
        ss1_path = ARTIFACT_DIR / "browser_extension_anime_subtitles.png"
        browser_page.screenshot(path=str(ss1_path))
        print(f"[10] Saved Screenshot 1: {ss1_path}")

        # 9. Verify Kiroku Desktop Anime Tab
        time.sleep(3)
        desk_state = desk_page.evaluate("""() => {
            const cueTextEl = document.getElementById('anime-cue-text');
            const titleEl = document.getElementById('anime-active-title');
            const timeEl = document.getElementById('anime-time-indicator');
            const transcript = document.querySelectorAll('.anime-transcript-row, .cue-list-item');
            const stepper = document.querySelector('.anime-connection-stepper-card');
            return {
                cueText: cueTextEl ? cueTextEl.textContent.trim() : null,
                title: titleEl ? titleEl.textContent.trim() : null,
                time: timeEl ? timeEl.textContent.trim() : null,
                transcriptCount: transcript.length,
                stepperExists: Boolean(stepper)
            };
        }""")
        print("[11] Desktop Anime Tab State:", json.dumps(desk_state, indent=2))
        assert "K-ON!" in (desk_state["title"] or ""), f"Expected K-ON! in title, got {desk_state['title']}"
        assert "そろそろ起きないと" in (desk_state["cueText"] or ""), f"Expected active cue in Desktop, got {desk_state['cueText']}"

        # Capture Screenshot 2: Kiroku Desktop Anime Tab
        ss2_path = ARTIFACT_DIR / "kiroku_desktop_anime_companion.png"
        desk_page.screenshot(path=str(ss2_path))
        print(f"[12] Saved Screenshot 2: {ss2_path}")

        browser_ctx.close()
        desk_browser.close()

    electron_proc.terminate()
    server.stop()
    print("\n>>> ALL PLAYWRIGHT CHECKS PASSED AND SCREENSHOTS GENERATED! <<<")

if __name__ == "__main__":
    run()
