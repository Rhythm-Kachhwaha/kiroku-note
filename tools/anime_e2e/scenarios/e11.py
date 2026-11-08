import time

def run(browser_context, desk_client):
    """
    e11: HUD in fullscreen
    - Opens video page
    - Simulates entering fullscreen on video container
    - Asserts HUD host is reparented to the fullscreenElement
    - Tweaks offset via HUD controls
    - Simulates exiting fullscreen and asserts host restored to original parent
    """
    page = browser_context.new_page()
    page.goto("http://127.0.0.1:8989/plain.html")

    # Wait for HUD to initialize
    page.wait_for_selector("#kiroku-anime-hud-host", timeout=5000)

    sw = browser_context.service_workers[0]
    res = sw.evaluate("""async () => {
        const [tab] = await chrome.tabs.query({ active: true });
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const vid = document.getElementById("player");
                const host = document.getElementById("kiroku-anime-hud-host");
                const origParent = host.parentElement;

                // Simulate container entering fullscreen
                const container = vid.parentElement;
                Object.defineProperty(document, "fullscreenElement", {
                    value: container,
                    configurable: true
                });
                document.dispatchEvent(new Event("fullscreenchange"));

                const reparented = (host.parentElement === container);

                // Adjust offset using AnimeHud method
                if (window.__kirokuAnimeHud) {
                    window.__kirokuAnimeHud.setSubStatus({ offsetMs: 100 });
                }

                const offsetMs = window.__kirokuAnimeHud ? window.__kirokuAnimeHud.subStatus.offsetMs : 0;

                // Simulate exiting fullscreen
                Object.defineProperty(document, "fullscreenElement", {
                    value: null,
                    configurable: true
                });
                document.dispatchEvent(new Event("fullscreenchange"));

                const restored = (host.parentElement === origParent);

                return { reparented, offsetMs, restored };
            }
        });
        return results?.[0]?.result;
    }""")

    assert res["reparented"], "HUD host did not reparent to fullscreen element"
    assert res["offsetMs"] == 100, f"Offset was not updated, got {res['offsetMs']}"
    assert res["restored"], "HUD host did not restore to original parent upon fullscreen exit"
