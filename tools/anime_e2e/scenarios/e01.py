import time

def run(browser_context, desk_client):
    """
    e01: SW has chrome.storage and chrome.alarms.
    Connect to background service worker via CDP and assert typeof chrome.storage and chrome.alarms.
    """
    # Wait for service worker
    sw = None
    for _ in range(30):
        workers = browser_context.service_workers
        if workers:
            sw = workers[0]
            break
        time.sleep(0.2)

    if not sw:
        raise AssertionError("No extension service worker found")

    res = sw.evaluate("({ storage: typeof chrome.storage, alarms: typeof chrome.alarms })")
    storage_type = res.get("storage")
    alarms_type = res.get("alarms")

    assert storage_type == "object", f"Expected chrome.storage to be 'object', got: {storage_type}"
    assert alarms_type == "object", f"Expected chrome.alarms to be 'object', got: {alarms_type}"
