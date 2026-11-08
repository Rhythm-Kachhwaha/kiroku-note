import time
import urllib.request
import json

def run(browser_context, desk_client):
    """
    e13: Unpaired extension or wrong token: Hub rejection diagnostics
    - GET /api/link/status returns last_reject: { reason, role, origin } (no token leak)
    - extension link client status becomes 'unauthorized'
    """
    sw = None
    for _ in range(30):
        workers = browser_context.service_workers
        if workers:
            sw = workers[0]
            break
        time.sleep(0.2)
    assert sw, "No service worker found"

    # Set bad token in extension storage and restart link client
    sw.evaluate("""async () => {
        await chrome.storage.local.set({ 'kiroku.extension.remembered_token': 'bad-invalid-token-12345' });
        if (typeof linkClient !== 'undefined' && linkClient) {
            linkClient.token = null;
            await linkClient.start();
        }
    }""")

    # Poll hub status for last_reject
    rejected = False
    last_status = None
    start = time.time()
    while time.time() - start < 5.0:
        req = urllib.request.Request("http://127.0.0.1:21828/api/link/status")
        with urllib.request.urlopen(req) as resp:
            last_status = json.loads(resp.read().decode("utf-8"))
            lr = last_status.get("last_reject")
            if lr and lr.get("role") == "ext" and lr.get("reason") == "Unauthorized token or role":
                # Ensure no token leaked in diagnostics
                assert "bad-invalid-token-12345" not in json.dumps(lr), "Token leaked in last_reject diagnostics"
                rejected = True
                break
        time.sleep(0.3)

    assert rejected, f"Hub did not record rejection: {last_status}"

    # Also verify extension link client status
    client_status = sw.evaluate("typeof linkClient !== 'undefined' ? linkClient.status : null")
    assert client_status == "unauthorized", f"Expected client status 'unauthorized', got '{client_status}'"
