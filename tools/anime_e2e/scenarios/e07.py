import time

def run(browser_context, desk_client):
    """
    e07: SPA swap to new video element.
    """
    sw = browser_context.service_workers[0]
    sw.evaluate("globalThis._e07Relays = []; chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'LINK_RELAY_OUT') globalThis._e07Relays.push(m); });")

    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/spa.html")
    time.sleep(1.0)

    # Click next episode button
    page.click("#next-ep-btn")

    start = time.time()
    attached = False
    while time.time() - start < 3.0:
        relays = sw.evaluate("globalThis._e07Relays || []")
        attaches = [r for r in relays if r.get("linkType") == "video.attach"]
        # After click, video element was replaced so a new attach occurs
        if len(attaches) >= 2:
            attached = True
            break
        time.sleep(0.2)

    assert attached, f"Expected second video.attach on SPA swap, got {attaches}"
