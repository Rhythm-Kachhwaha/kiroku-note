import time
import urllib.request
import json
from pathlib import Path

def run(browser_context, desk_client):
    """
    e10: SRT load via in-page HUD
    - Pairs extension -> navigates to plain video page
    - Simulates dropping test.srt onto HUD / calling handleDroppedFile
    - Verifies desk_client receives cue.list + sub.status
    """
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    pair_code = f"PAIR-E10-{time.time_ns()}"

    # 1. Register pairing
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

    # 2. Open page
    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    # Wait for video attach
    start = time.time()
    while time.time() - start < 5.0:
        if desk_client.session is not None:
            break
        time.sleep(0.2)
    assert desk_client.session is not None, "Video attach session not received"

    # 3. Read test.srt content
    srt_path = Path(__file__).resolve().parent.parent / "fixtures" / "test.srt"
    srt_content = srt_path.read_text(encoding="utf-8")

    # 4. Inject test.srt via HUD handleDroppedFile in extension context
    desk_client.last_sub_status = None
    desk_client.cues = []

    res = sw.evaluate(f"""async () => {{
        const [tab] = await chrome.tabs.query({{ active: true }});
        if (!tab) return {{ error: "No active tab" }};
        const results = await chrome.scripting.executeScript({{
            target: {{ tabId: tab.id }},
            func: async (srt) => {{
                const hasHud = Boolean(window.__kirokuAnimeHud);
                const hasBridge = Boolean(window.__kirokuLinkBridge);
                let count = 0;
                let err = null;
                if (window.__kirokuAnimeHud) {{
                    try {{
                        const file = new File([srt], "test.srt", {{ type: "text/plain" }});
                        await window.__kirokuAnimeHud.handleDroppedFile(file);
                        count = window.__kirokuAnimeHud.subStatus.count;
                    }} catch (e) {{
                        err = String(e);
                    }}
                }}
                return {{ hasHud, hasBridge, count, err }};
            }},
            args: [{json.dumps(srt_content)}]
        }});
        return results?.[0]?.result;
    }}""")
    assert res and res.get("count") == 2, f"Failed to drop file in HUD: {res}"

    # 5. Verify desk receives cues and sub.status
    received_cues = False
    received_status = False
    start = time.time()
    while time.time() - start < 5.0:
        if len(desk_client.cues) >= 2:
            received_cues = True
        if desk_client.last_sub_status and desk_client.last_sub_status.get("name") == "test.srt":
            received_status = True
        if received_cues and received_status:
            break
        time.sleep(0.2)

    assert received_cues, f"Desk did not receive parsed cues: {desk_client.cues}"
    assert received_status, f"Desk did not receive sub.status: {desk_client.last_sub_status}"
    assert desk_client.last_sub_status["count"] == 2
    assert desk_client.last_sub_status["source"] == "file"
