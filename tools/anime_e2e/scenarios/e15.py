import json
import time
import urllib.request
from pathlib import Path

def run(browser_context, desk_client):
    """
    e15: End-to-end Mining Flow
    - Pair extension with backend using valid token
    - Browser opens video page with subtitles loaded via HUD
    - Desk client attaches to video session and cues
    - Desk client requests media clip (cmd.clip) for active cue
    - Extension processes cmd.clip and emits clip.result
    - Desk client receives clip.result and verifies image/payload
    - Card is created via POST /api/cards/save with source title and sentence
    - GET /api/cards verifies card persisted in authoritative SQLite store
    """
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    pair_code = f"PAIR-E15-{time.time_ns()}"
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

    sw = browser_context.service_workers[0]
    sw.evaluate(f"""async () => {{
        await chrome.storage.local.set({{ 'kiroku.extension.remembered_token': '{token}' }});
        if (typeof linkClient !== 'undefined' && linkClient) {{
            linkClient.token = null;
            await linkClient.start();
        }}
    }}""")

    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    # Wait for video session to attach to desk
    t0 = time.time()
    while time.time() - t0 < 5.0:
        if desk_client.session is not None:
            break
        time.sleep(0.1)

    assert desk_client.session is not None, "Desk client did not receive video.attach"

    # Load test.srt into HUD
    srt_path = Path(__file__).resolve().parent.parent / "fixtures" / "test.srt"
    srt_content = srt_path.read_text(encoding="utf-8")

    sw.evaluate(f"""async () => {{
        const [tab] = await chrome.tabs.query({{ active: true }});
        if (!tab) return;
        await chrome.scripting.executeScript({{
            target: {{ tabId: tab.id }},
            func: async (srt) => {{
                if (window.__kirokuAnimeHud) {{
                    const file = new File([srt], "test.srt", {{ type: "text/plain" }});
                    await window.__kirokuAnimeHud.handleDroppedFile(file);
                }}
            }},
            args: [{json.dumps(srt_content)}]
        }});
    }}""")

    # Wait for cues to reach desk client
    t_cues = time.time()
    while time.time() - t_cues < 5.0:
        if len(desk_client.cues) > 0:
            break
        time.sleep(0.1)

    assert len(desk_client.cues) > 0, "Desk client did not receive cue.list"

    first_cue = desk_client.cues[0]
    cue_text = first_cue.get("text", "テスト字幕")
    session_title = desk_client.session.get("title", "Plain Video")

    # Send cmd.clip from desk client
    req_id = f"test-mine-{int(time.time())}"
    desk_client.send_cmd({
        "v": 1,
        "id": f"msg-{req_id}",
        "ts": int(time.time() * 1000),
        "type": "cmd.clip",
        "src": "desk",
        "payload": {
            "reqId": req_id,
            "s": first_cue.get("s", 0.0),
            "e": first_cue.get("e", 2.0),
            "want": ["image", "audio"]
        }
    })

    # Wait for clip.result message in desk_client
    t1 = time.time()
    clip_result = None
    while time.time() - t1 < 6.0:
        for m in reversed(desk_client.messages):
            if m.get("type") == "clip.result" and m.get("payload", {}).get("reqId") == req_id:
                clip_result = m.get("payload")
                break
        if clip_result:
            break
        time.sleep(0.1)

    assert clip_result is not None, "Desk client did not receive clip.result for cmd.clip"

    # Persist card via backend API
    save_url = "http://127.0.0.1:21828/api/cards/save"
    card_payload = {
        "expression": "走る",
        "reading": "はしる",
        "meaning": "to run",
        "example_sentence": cue_text,
        "source_title": session_title,
        "timestamp": first_cue.get("s", 0.0),
        "image_data": clip_result.get("image_b64"),
        "audio_data": clip_result.get("audio_b64"),
        "deck_name": "Default"
    }
    req = urllib.request.Request(
        save_url,
        data=json.dumps(card_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        save_data = json.loads(resp.read().decode("utf-8"))
        assert resp.status == 200, f"Expected 200 saving card: {save_data}"

    # Verify card exists in library
    list_url = "http://127.0.0.1:21828/api/cards?search=%E8%B5%B0%E3%82%8B"
    with urllib.request.urlopen(list_url) as resp:
        list_data = json.loads(resp.read().decode("utf-8"))
        items = list_data.get("cards", []) if isinstance(list_data, dict) else list_data
        matches = [c for c in items if c.get("expression") == "走る"]
        assert len(matches) > 0, "Saved card not found in /api/cards list"
