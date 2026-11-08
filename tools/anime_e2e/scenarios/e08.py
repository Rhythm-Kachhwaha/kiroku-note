import time
import urllib.request
import json

def run(browser_context, desk_client):
    """
    e08: desk connects AFTER attach -> gets session+cues; desk BEFORE attach -> gets attach.
    """
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    pair_code = "PAIR-E08-CODE"
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

    # Open video page
    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    start = time.time()
    attached = False
    while time.time() - start < 5.0:
        if desk_client.session is not None:
            attached = True
            break
        time.sleep(0.3)

    assert attached, "Desk did not receive video.attach session"
