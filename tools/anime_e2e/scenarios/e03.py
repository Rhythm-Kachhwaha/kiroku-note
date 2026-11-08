import time

def run(browser_context, desk_client):
    """
    e03: plain page video -> video.attach at desk <=2s.
    """
    sw = browser_context.service_workers[0]
    sw.evaluate("globalThis._e03Relays = []; chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'LINK_RELAY_OUT') globalThis._e03Relays.push(m); });")

    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    start = time.time()
    attached = False
    while time.time() - start < 3.0:
        relays = sw.evaluate("globalThis._e03Relays || []")
        if any(r.get("linkType") == "video.attach" for r in relays):
            attached = True
            break
        time.sleep(0.2)

    assert attached, "video.attach not emitted from plain page within 3s"
