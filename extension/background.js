let isMiningModeEnabled = false;



async function activeTab() {
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {type: "PING_KIROKU"}).catch(() => chrome.tabs.sendMessage(tabId, {type: "PING_ANKI_MINER"}));
  } catch {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ["content/capture-utils.js", "content/content.js"]
    });
  }
}

async function ensureOcrContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["lib/ocr-cropper.js", "content/ocr-selection.js"]
    });
  } catch (_) {}
}

async function handleUserInitiatedCapture(tab) {
  let targetTab = tab;
  if (!targetTab?.id) {
    targetTab = await activeTab().catch(() => null);
  }
  if (!targetTab?.id) return;
  if (targetTab.windowId && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: targetTab.windowId }).catch(() => {});
  } else if (chrome.sidePanel?.open) {
    try {
      chrome.windows?.getCurrent((win) => {
        if (win?.id) {
          chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
        }
      });
    } catch (_) {}
  }
  isMiningModeEnabled = true;
}

/**
 * Validate that a URL is an allowed YouTube/Google CDN timedtext origin.
 *
 * Rules:
 *  - Must be parseable by the URL constructor (rejects malformed strings).
 *  - Must use https: (YouTube timedtext is always HTTPS).
 *  - Hostname must end with one of the approved suffixes, separated by a
 *    dot boundary so "evil-youtube.com" is never accepted.
 *  - Explicitly rejects localhost, loopback, and private-range IP addresses.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedTimedtextUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false; // malformed URL
  }

  // Only HTTPS is valid for YouTube CDN resources
  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();

  // Reject loopback and private addresses
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host)
  ) {
    return false;
  }

  // Approved suffix list — each entry is either an exact hostname or a
  // suffix that must be preceded by a dot (preventing evil-youtube.com).
  const ALLOWED_SUFFIXES = [
    "youtube.com",
    "googlevideo.com",
    "ytimg.com",
    "googleapis.com",
    "google.com",
  ];

  return ALLOWED_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith("." + suffix)
  );
}

/**
 * Validates URLs used for Jimaku API and subtitle file downloads.
 * Only HTTPS requests targeting jimaku.cc under /api/ are permitted.
/**
 * Safely validate external subtitle download / Jimaku API URLs.
 * Rejects localhost, loopback, and private IP addresses (SSRF protection).
 * Accepts legitimate HTTPS URLs from jimaku.cc, *.jimaku.cc, and public HTTPS CDN/storage URLs.
 * Resolves relative URLs against https://jimaku.cc.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedJimakuUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  let parsed;
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      parsed = new URL(trimmed);
    } else if (trimmed.startsWith("/") || /^(api|files|entries|subtitles)\//i.test(trimmed)) {
      parsed = new URL(trimmed, "https://jimaku.cc");
    } else {
      return false;
    }
  } catch (_) {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host)
  ) {
    return false;
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SET_MINING_MODE") {
    isMiningModeEnabled = Boolean(message.enabled);
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab?.id && tab?.url && !tab.url.startsWith("chrome://")) {
          chrome.tabs.sendMessage(tab.id, {type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled}).catch(() => {});
        }
      }
    }).catch(() => {});

    activeTab().then(async tab => {
      if (tab?.id) {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, {type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled}).catch(() => {});

      }
    }).catch(() => {});

    sendResponse({ok: true, stage: "content-script"});
    return true;
  }
  if (message?.type === "GET_MINING_MODE") {
    sendResponse({ok: true, enabled: isMiningModeEnabled});
    return true;
  }
  if (message?.type === "FETCH_YOUTUBE_TIMEDTEXT") {
    if (!isAllowedTimedtextUrl(message.url)) {
      sendResponse({ok: false, error: "URL not allowed"});
      return true;
    }
    fetch(message.url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.text();
      })
      .then(text => sendResponse({ok: true, text}))
      .catch(err => sendResponse({ok: false, error: err.message}));
    return true;
  }
  if (message?.type === "FETCH_JIMAKU_API") {
    if (!isAllowedJimakuUrl(message.url)) {
      sendResponse({ ok: false, error: "INVALID_URL", message: "URL not allowed" });
      return true;
    }
    const targetUrl = new URL(message.url, "https://jimaku.cc").toString();
    const headers = {
      "Accept": "application/json, text/plain, text/vtt, text/x-ssa, */*"
    };
    if (message.apiKey) {
      headers["Authorization"] = message.apiKey;
    }
    fetch(targetUrl, {
      method: message.method || "GET",
      headers
    })
      .then(async (res) => {
        if (!res.ok) {
          const status = res.status;
          if (status === 401) throw new Error("UNAUTHORIZED: Invalid Jimaku API key");
          if (status === 429) throw new Error("RATE_LIMITED: Jimaku API rate limit reached");
          throw new Error(`HTTP ${status}: ${res.statusText}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          return { ok: true, data: json, isJson: true };
        } else {
          const text = await res.text();
          return { ok: true, text, isJson: false };
        }
      })
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message?.type === "CAPTURE_VIDEO_FRAME") {
    const windowId = sender?.tab?.windowId;
    const captureOptions = {
      format: message.format || "jpeg",
      quality: typeof message.quality === "number" ? message.quality : 95
    };
    const capturePromise = (typeof windowId === "number")
      ? chrome.tabs.captureVisibleTab(windowId, captureOptions)
      : chrome.tabs.captureVisibleTab(captureOptions);

    capturePromise
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(err => {
        console.error("[AnkiMiner Background] captureVisibleTab failed:", err);
        sendResponse({ ok: false, error: err?.message || "Failed to capture visible tab" });
      });
    return true;
  }

  if (message?.type === "LOAD_SUBTITLE_CUES" || message?.type === "CLEAR_SUBTITLES" || message?.type === "SET_SUBTITLE_OFFSET" || message?.type === "SELECT_YOUTUBE_TRACK") {
    if (message?.type === "LOAD_SUBTITLE_CUES" && Array.isArray(message.cues)) {
      try {
        chrome.storage.local.set({
          active_subtitle_cues: message.cues,
          active_subtitle_filename: message.filename || ""
        });
      } catch (_) {}
    } else if (message?.type === "CLEAR_SUBTITLES") {
      try {
        chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]);
      } catch (_) {}
    }
    activeTab().then(tab => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }).catch(() => {});
    sendResponse({ok: true});
    return true;
  }
  if (message?.type === "START_OCR_CAPTURE") {
    (async () => {
      try {
        const tab = await activeTab();
        if (!tab?.id) {
          sendResponse({ ok: false, error: "NO_ACTIVE_TAB", message: "No active browser tab found" });
          return;
        }
        if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://") || tab.url?.startsWith("brave://")) {
          sendResponse({ ok: false, error: "RESTRICTED_PAGE", message: "Cannot capture OCR on browser internal pages" });
          return;
        }

        await ensureOcrContentScript(tab.id);
        const res = await chrome.tabs.sendMessage(tab.id, { type: "START_OCR_SELECTION" }).catch(async () => {
          await ensureOcrContentScript(tab.id);
          return await chrome.tabs.sendMessage(tab.id, { type: "START_OCR_SELECTION" });
        });
        sendResponse(res || { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "FAILED_TO_START_OCR" });
      }
    })();
    return true;
  }
  if (message?.type === "OCR_REGION_SELECTED") {
    const windowId = sender?.tab?.windowId;
    const capturePromise = (typeof windowId === "number")
      ? chrome.tabs.captureVisibleTab(windowId, { format: "png" })
      : chrome.tabs.captureVisibleTab({ format: "png" });

    capturePromise
      .then(async (dataUrl) => {
        const payload = {
          type: "PROCESS_OCR_CROP",
          dataUrl,
          rect: message.rect,
          viewport: message.viewport,
          devicePixelRatio: message.devicePixelRatio || 1
        };
        chrome.runtime.sendMessage(payload).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.error("[AnkiMiner Background] OCR captureVisibleTab failed:", err);
        sendResponse({ ok: false, error: err?.message || "Failed to capture screenshot for OCR" });
      });
    return true;
  }
  if (message?.type === "OCR_SELECTION_CANCELLED") {
    chrome.runtime.sendMessage({
      type: "OCR_SELECTION_CANCELLED",
      reason: message.reason || "user"
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});

chrome.tabs.onActivated?.addListener?.(activeInfo => {
  if (isMiningModeEnabled && activeInfo?.tabId) {
    ensureContentScript(activeInfo.tabId).then(() => {
      chrome.tabs.sendMessage(activeInfo.tabId, {type: "MINING_MODE_CHANGED", enabled: true}).catch(() => {});
    }).catch(() => {});
  }
});

chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  if (isMiningModeEnabled && changeInfo.status === "complete" && tab?.url && !tab.url.startsWith("chrome://")) {
    ensureContentScript(tabId).then(() => {
      chrome.tabs.sendMessage(tabId, {type: "MINING_MODE_CHANGED", enabled: true}).catch(() => {});
    }).catch(() => {});
  }
});

if (typeof chrome !== "undefined" && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(handleUserInitiatedCapture);
}

if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "open-side-panel") {
      return handleUserInitiatedCapture(tab);
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isAllowedTimedtextUrl,
    isAllowedJimakuUrl,
    handleUserInitiatedCapture,
  };
}

