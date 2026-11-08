import time
import urllib.request
import json

def run(browser_context, desk_client):
    """
    e12: close tab / navigate away -> desk session cleared <=2s.
    """
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    pair_code = "PAIR-E12-CODE"
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

    # Wait for attach
    start = time.time()
    while time.time() - start < 5.0:
        if desk_client.session is not None:
            break
        time.sleep(0.3)
    assert desk_client.session is not None, "Video not attached"

    # Close the tab
    page.close()

    # Assert session is cleared
    start = time.time()
    cleared = False
    while time.time() - start < 4.0:
        if desk_client.session is None:
            cleared = True
            break
        time.sleep(0.3)

    assert cleared, "Desk session was not cleared after closing the tab"
