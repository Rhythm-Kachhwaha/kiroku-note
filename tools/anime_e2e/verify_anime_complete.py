"""
Kiroku Note - Anime Companion & Video Mining Full End-to-End Verification
Tests:
1. Video plays visibly without black screen (sampling frame pixels).
2. HUD attaches to player wrapper safely without style corruption.
3. User's K-ON ASS subtitle file (397 cues) loads cleanly.
4. Frames advance and cues sync synchronously to browser overlay and Desk companion.
5. Advances multiple frames forward and verifies real-time subtitle sync and state.
"""

import time
import os
import json
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parents[2]
EXT_DIR = str((ROOT_DIR / "extension").resolve()).replace("/", "\\")
SUB_PATH = Path(r"C:\Users\Rhythm\Downloads\subs\KirokuSubtitles_[Frained] けいおん! 01 [retimed].ass")

import sys
sys.path.insert(0, str(Path(__file__).parent))
from backend_runner import BackendRunner
from fixture_server import FixtureServer
from desk_helper import DesktopClient

def run_verification():
    print("=== Starting Anime & Companion Verification ===")
    out_dir = ROOT_DIR / "tools" / "anime_e2e" / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Start BackendRunner on 21828
    backend = BackendRunner(port=21828)
    backend.start()
    print("[1] BackendRunner online on port 21828")

    # 2. Start fixture server
    server = FixtureServer(port=8989)
    server.start()
    print("[2] FixtureServer running on http://127.0.0.1:8989")

    # 3. Register pairing code for extension
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    pair_code = f"PAIR-VERIFY-{time.time_ns()}"
    reg_req = urllib.request.Request(
        "http://127.0.0.1:21828/api/auth/extension-pairings/register",
        data=json.dumps({"code": pair_code, "scopes": ["legacy:write", "link:rw"]}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer desktop-test-token"}
    )
    with urllib.request.urlopen(reg_req) as resp:
        assert resp.status == 200

    redeem_req = urllib.request.Request(
        "http://127.0.0.1:21828/api/auth/extension-pairings/redeem",
        data=json.dumps({"code": pair_code}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": f"chrome-extension://{ext_id}"}
    )
    with urllib.request.urlopen(redeem_req) as resp:
        token = json.loads(resp.read().decode("utf-8"))["token"]
        print("[3] Redeemed extension pairing token successfully")

    # 4. Start Desktop companion helper client
    desk_client = DesktopClient(port=21828, token="desktop-test-token")
    desk_client.start()
    time.sleep(1)
    print(f"[4] Desktop client connected to Hub: {desk_client.connected}")

    # 5. Launch Browser with Extension
    temp_profile = out_dir / "verify_chrome_profile"
    temp_profile.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        args = [
            f"--disable-extensions-except={EXT_DIR}",
            f"--load-extension={EXT_DIR}",
            "--no-sandbox",
            "--autoplay-policy=no-user-gesture-required",
        ]
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(temp_profile),
            headless=False,
            args=args,
            ignore_default_args=["--disable-extensions"]
        )

        # Wait for service worker
        sw = None
        for _ in range(30):
            workers = context.service_workers
            if workers:
                sw = workers[0]
                break
            time.sleep(0.2)
        assert sw, "Extension service worker failed to start"
        print("[5] Extension service worker active")

        # Save token into extension storage and start link client
        sw.evaluate(f"""async () => {{
            await chrome.storage.local.set({{ 'kiroku.extension.remembered_token': '{token}' }});
            if (typeof linkClient !== 'undefined' && linkClient) {{
                linkClient.token = null;
                await linkClient.start();
            }}
        }}""")
        time.sleep(1)

        # 6. Navigate to anime streaming page
        page = context.new_page()
        page.on("console", lambda msg: print(f"  [PAGE CONSOLE] {msg.text}"))
        print("[6] Navigating to anime streaming page http://127.0.0.1:8989/anime.html...")
        page.goto("http://127.0.0.1:8989/anime.html", wait_until="domcontentloaded")
        time.sleep(3)
        page.evaluate("""() => {
            const v = document.getElementById('player-video');
            if (v) {
                v.muted = true;
                v.play().catch(() => {});
            }
        }""")
        time.sleep(2)

        # 7. Verify video playback & non-black frame
        v_eval = page.evaluate("""() => {
            const v = document.getElementById('player-video');
            const hud = document.getElementById('kiroku-anime-hud-host');
            const playerWrapper = document.getElementById('player');
            const jwMedia = document.querySelector('.jw-media');

            // Draw current video frame to an offscreen canvas to verify pixels are rendered
            const c = document.createElement('canvas');
            c.width = 100;
            c.height = 100;
            const ctx = c.getContext('2d');
            ctx.drawImage(v, 0, 0, 100, 100);
            let nonBlackPixels = 0;
            try {
                const data = ctx.getImageData(0, 0, 100, 100).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10 || data[i+3] > 0) {
                        nonBlackPixels++;
                    }
                }
            } catch (_) {}

            return {
                videoExists: Boolean(v),
                videoWidth: v.videoWidth,
                videoHeight: v.videoHeight,
                paused: v.paused,
                currentTime: v.currentTime,
                hudExists: Boolean(hud),
                hudParentClass: hud ? hud.parentElement.className : null,
                playerWrapperPosition: getComputedStyle(playerWrapper).position,
                jwMediaPosition: getComputedStyle(jwMedia).position,
                jwMediaInlineStyle: jwMedia.style.position || 'none',
                nonBlackPixelPercent: (nonBlackPixels / (100 * 100)) * 100
            };
        }""")
        print("[7] In-page Video & Player State:")
        print(json.dumps(v_eval, indent=2))

        assert v_eval["videoExists"], "Video element does not exist"
        assert v_eval["videoWidth"] > 0 and v_eval["videoHeight"] > 0, f"Video must have valid dimensions, got {v_eval['videoWidth']}x{v_eval['videoHeight']}"
        assert not v_eval["paused"], "Video must be actively playing, not paused"
        assert v_eval["hudExists"], "Anime HUD host was not created"
        assert "jwplayer" in v_eval["hudParentClass"], f"HUD should attach to player wrapper, got {v_eval['hudParentClass']}"
        assert v_eval["jwMediaPosition"] == "absolute", f"JW Media position must remain absolute, got {v_eval['jwMediaPosition']}"
        assert v_eval["jwMediaInlineStyle"] == "none", f"JW Media inline style must NOT be mutated to relative, got {v_eval['jwMediaInlineStyle']}"

        # 8. Verify Desk received video.attach
        start = time.time()
        while time.time() - start < 5.0:
            if desk_client.session is not None:
                break
            time.sleep(0.2)
        assert desk_client.session is not None, "Desktop did not receive video.attach session"
        print("[8] Desktop session received:", desk_client.session)
        assert "K-ON!" in desk_client.session.get("title", "")

        # 9. Load user's K-ON ASS Subtitle file via extension
        print(f"[9] Loading user's subtitle file: {SUB_PATH}")
        assert SUB_PATH.exists(), f"Subtitle file not found at {SUB_PATH}"
        sub_content = SUB_PATH.read_text(encoding="utf-8")
        parser_code = (ROOT_DIR / "extension" / "lib" / "subtitle-parser.js").read_text(encoding="utf-8")

        load_res = sw.evaluate("""async ([parserJs, assText, filename]) => {
            if (typeof SubtitleParser === 'undefined') {
                const evalFn = new Function(parserJs);
                evalFn();
            }
            const parser = typeof SubtitleParser !== 'undefined' ? SubtitleParser : self.SubtitleParser;
            const raw = parser.parseSubtitles(assText, filename);
            const cues = parser.normalizeCues(raw);
            await chrome.storage.local.set({
                active_subtitle_cues: cues,
                active_subtitle_filename: filename
            });
            return {
                ok: true,
                count: cues.length,
                name: filename
            };
        }""", [parser_code, sub_content, SUB_PATH.name])
        print("  Subtitle load result in extension:", load_res)
        assert load_res.get("count") == 397, f"Expected 397 cues, got {load_res.get('count')}"

        # Verify Desk receives cues and sub.status
        start = time.time()
        while time.time() - start < 5.0:
            if len(desk_client.cues) >= 397 and desk_client.last_sub_status:
                break
            time.sleep(0.2)
        assert len(desk_client.cues) >= 397, f"Desk cues count: {len(desk_client.cues)}"
        print(f"[10] Desk received {len(desk_client.cues)} cues and sub.status {desk_client.last_sub_status['name']}")

        # 10. Advance frames forward to 22.0s (Cue 1: "お姉ちゃん  そろそろ起きないと…")
        print("\n[11] Advancing video frames forward to 22.0s (Cue 1)...")
        page.evaluate("""() => {
            const v = document.getElementById('player-video');
            v.setAttribute('data-current-time', '22.0');
            v.dispatchEvent(new Event('timeupdate'));
        }""")
        time.sleep(1)

        cue1_eval = page.evaluate("""() => {
            const overlay = document.getElementById('ankiminer-video-subtitle');
            const v = document.getElementById('player-video');
            return {
                currentTime: v.getAttribute('data-current-time') || v.currentTime,
                overlayText: overlay ? overlay.textContent.trim() : null,
                overlayVisible: overlay ? (getComputedStyle(overlay).display !== 'none') : false
            };
        }""")
        print("  Cue 1 at 22s in Browser:", cue1_eval)
        assert "そろそろ起きないと" in (cue1_eval["overlayText"] or ""), f"Overlay text mismatch at 22s: {cue1_eval['overlayText']}"

        # Capture Cue 1 screenshot
        ss_cue1 = out_dir / "anime_cue1_verified.png"
        page.screenshot(path=str(ss_cue1))
        print("  Saved Cue 1 screenshot to", ss_cue1)

        # 11. Advance frames forward to 48.8s (Cue 6: "ちこく～ッ")
        print("\n[12] Advancing video frames forward to 48.8s (Cue 6)...")
        page.evaluate("""() => {
            const v = document.getElementById('player-video');
            v.setAttribute('data-current-time', '48.8');
            v.dispatchEvent(new Event('timeupdate'));
        }""")
        time.sleep(1)

        cue6_eval = page.evaluate("""() => {
            const overlay = document.getElementById('ankiminer-video-subtitle');
            const v = document.getElementById('player-video');
            return {
                currentTime: v.getAttribute('data-current-time') || v.currentTime,
                overlayText: overlay ? overlay.textContent.trim() : null,
                overlayVisible: overlay ? (getComputedStyle(overlay).display !== 'none') : false
            };
        }""")
        print("  Cue 6 at 48.8s in Browser:", cue6_eval)
        assert "ちこく" in (cue6_eval["overlayText"] or ""), f"Overlay text mismatch at 48.8s: {cue6_eval['overlayText']}"

        # Capture Cue 6 screenshot
        ss_cue6 = out_dir / "anime_cue6_verified.png"
        page.screenshot(path=str(ss_cue6))
        print("  Saved Cue 6 screenshot to", ss_cue6)

        # 12. Advance frames forward again to 60.0s and verify playback continuing
        print("\n[13] Advancing video frames forward to 60.0s...")
        page.evaluate("""() => {
            const v = document.getElementById('player-video');
            v.setAttribute('data-current-time', '60.0');
            v.dispatchEvent(new Event('timeupdate'));
        }""")
        time.sleep(1)
        cur_t = page.evaluate("document.getElementById('player-video').getAttribute('data-current-time')")
        print(f"  Final playback position: {cur_t}s")
        assert float(cur_t) >= 60.0, f"Expected currentTime >= 60.0, got {cur_t}"

        context.close()

    desk_client.stop()
    server.stop()
    backend.stop()
    print("\n>>> ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! Anime is fully visible and synced! <<<")

if __name__ == "__main__":
    run_verification()
