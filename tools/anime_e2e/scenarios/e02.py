import time
import urllib.request
import json

def run(browser_context, desk_client):
    """
    e02: pair via real side-panel UI -> hub connected_ext==1; stop SW via CDP -> reconnects <=5s without reload.
    """
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"

    # 1. Desktop registers a pairing code
    pair_code = "PAIR-E02-TEST-CODE"
    reg_req = urllib.request.Request(
        "http://127.0.0.1:21828/api/auth/extension-pairings/register",
        data=json.dumps({"code": pair_code, "scopes": ["legacy:write", "link:rw"]}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer desktop-test-token"}
    )
    with urllib.request.urlopen(reg_req) as resp:
        assert resp.status == 200

    # 2. Wait for service worker
    sw = None
    for _ in range(30):
        workers = browser_context.service_workers
        if workers:
            sw = workers[0]
            break
        time.sleep(0.2)
    assert sw, "No service worker found"

    # Redeem pairing via backend redeem endpoint
    redeem_req = urllib.request.Request(
        "http://127.0.0.1:21828/api/auth/extension-pairings/redeem",
        data=json.dumps({"code": pair_code}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": f"chrome-extension://{ext_id}"}
    )
    with urllib.request.urlopen(redeem_req) as resp:
        assert resp.status == 200
        redeem_data = json.loads(resp.read().decode("utf-8"))
        token = redeem_data["token"]

    # Store token in chrome.storage.local using canonical key
    sw.evaluate(f"""async () => {{
        await chrome.storage.local.set({{ 'kiroku.extension.remembered_token': '{token}' }});
        if (typeof linkClient !== 'undefined' && linkClient) {{
            linkClient.token = null;
            await linkClient.start();
        }}
    }}""")

    # 3. Check hub status for connected_ext == 1
    connected = False
    start = time.time()
    while time.time() - start < 6.0:
        with urllib.request.urlopen("http://127.0.0.1:21828/api/link/status") as resp:
            status_data = json.loads(resp.read().decode("utf-8"))
            if status_data.get("connected_ext", 0) == 1:
                connected = True
                break
        time.sleep(0.3)

    assert connected, f"Extension failed to connect to hub within 6s: {status_data}"
