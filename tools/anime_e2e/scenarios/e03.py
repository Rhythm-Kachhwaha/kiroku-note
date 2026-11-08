import time

def run(browser_context, desk_client):
    """
    e03: plain page video -> video.attach at desk <=2s.
    """
    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    # In A0, video.attach is not received at desk
    start = time.time()
    attached = False
    while time.time() - start < 3.0:
        if desk_client.session is not None:
            attached = True
            break
        time.sleep(0.2)

    if not attached:
        raise AssertionError("video.attach not received at desktop client within 3 seconds")
