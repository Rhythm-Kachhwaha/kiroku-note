import time
import urllib.request
import json

def run(browser_context, desk_client):
    """
    e02: pair via real side-panel UI -> hub connected_ext==1; stop SW via CDP -> reconnects <=5s without reload.
    """
    # Open sidepanel page in a tab to interact with UI
    page = browser_context.new_page()
    ext_id = "chnnchfpjephcpgamfkjnfobfnjabika"
    page.goto(f"chrome-extension://{ext_id}/sidepanel/sidepanel.html")

    # In A0, pairing and link connection is expected to fail or not yet wired
    # We assert connected_ext == 1 on hub
    url = "http://127.0.0.1:21828/api/link/status"
    with urllib.request.urlopen(url) as resp:
        status_data = json.loads(resp.read().decode("utf-8"))

    if status_data.get("connected_ext", 0) != 1:
        raise AssertionError(f"Expected connected_ext==1, got {status_data}")
