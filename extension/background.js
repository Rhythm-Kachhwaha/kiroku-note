const CLOUD_WORKER_URL = "https://kiroku-note.rhythmkach.workers.dev";

let isMiningModeEnabled = false;
if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
  chrome.storage.local.get(["kiroku.mining_mode_enabled", "kiroku.mining.enabled"]).then((res) => {
    if (typeof res?.["kiroku.mining_mode_enabled"] === "boolean") {
      isMiningModeEnabled = res["kiroku.mining_mode_enabled"];
    } else if (typeof res?.["kiroku.mining.enabled"] === "boolean") {
      isMiningModeEnabled = res["kiroku.mining.enabled"];
    }
  }).catch(() => {});
}

async function getStoredCloudToken() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  try {
    const data = await chrome.storage.local.get([
      "kiroku_auth_token",
      "kiroku.cloud.auth_token",
      "kiroku_cloud_token",
      "kiroku_auth_session",
      "kiroku.extension.session_token",
      "kiroku.extension.auth_token",
      "kiroku.extension.remembered_token"
    ]);
    if (data.kiroku_auth_token) return data.kiroku_auth_token;
    if (data["kiroku.cloud.auth_token"]) return data["kiroku.cloud.auth_token"];
    if (data["kiroku_cloud_token"]) return data["kiroku_cloud_token"];
    if (data["kiroku.extension.session_token"]) return data["kiroku.extension.session_token"];
    if (data["kiroku.extension.auth_token"]) return data["kiroku.extension.auth_token"];
    if (data["kiroku.extension.remembered_token"]) return data["kiroku.extension.remembered_token"];
    if (data.kiroku_auth_session?.token) return data.kiroku_auth_session.token;
  } catch (_) {}
  return null;
}

let queueLockPromise = Promise.resolve();
function withQueueLock(fn) {
  const next = queueLockPromise.then(fn, fn);
  queueLockPromise = next.catch(() => {});
  return next;
}

async function queueCardLocally(payload) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return false;
  return withQueueLock(async () => {
    try {
      const existing = await chrome.storage.local.get("kiroku_pending_cards");
      const queue = Array.isArray(existing?.kiroku_pending_cards) ? existing.kiroku_pending_cards : [];
      // Protect against silent card loss: do not silently evict unacknowledged cards.
      if (queue.length >= 1000) {
        console.warn("[Background] Pending cards queue is full (1000). Captures paused until sync completes.");
        return false;
      }
      const cardId = payload.id || ("mine_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
      const queueEntryId = "qe_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      queue.push({
        id: cardId,
        queue_entry_id: queueEntryId,
        payload: { ...payload, id: cardId },
        timestamp: Date.now()
      });
      await chrome.storage.local.set({ kiroku_pending_cards: queue });
      return true;
    } catch (_) {
      return false;
    }
  });
}

let isDrainingQueue = false;

async function drainPendingCardsQueue() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return 0;
  if (isDrainingQueue) return 0;
  isDrainingQueue = true;

  try {
    const data = await chrome.storage.local.get("kiroku_pending_cards");
    const queue = data?.kiroku_pending_cards;
    if (!Array.isArray(queue) || queue.length === 0) return 0;

    const token = await getStoredCloudToken();
    const ackedEntryIds = new Set();
    const ackedItems = new Set();

    for (const item of queue) {
      let saved = false;
      const itemId = item.id || (item.payload && item.payload.id);
      const cardPayload = item.payload ? { ...item.payload, id: itemId } : { ...item, id: itemId };

      // 1. Try local backend
      try {
        const localResp = await fetch("http://127.0.0.1:21828/api/cards/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cardPayload),
          signal: AbortSignal.timeout(3000)
        });
        if (localResp.ok) saved = true;
      } catch (_) {}

      // 2. Try cloud edge if local was offline and token is available
      if (!saved && token) {
        try {
          const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          };
          const cloudResp = await fetch(`${CLOUD_WORKER_URL}/sync/push`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ops: [cardPayload] }),
            signal: AbortSignal.timeout(5000)
          });
          if (cloudResp.ok) {
            const resData = await cloudResp.json().catch(() => ({}));
            if (resData.status === "ok" || (resData.pushed && resData.pushed > 0)) {
              saved = true;
            }
          } else if (cloudResp.status === 409) {
            // 409 Conflict: payload mismatch on cloud edge. Dead-letter to prevent infinite retry loops.
            ackedItems.add(item);
            if (item.queue_entry_id) {
              ackedEntryIds.add(item.queue_entry_id);
            }
            try {
              const deadData = await chrome.storage.local.get("kiroku_dead_letter_cards");
              const deadList = Array.isArray(deadData?.kiroku_dead_letter_cards) ? deadData.kiroku_dead_letter_cards : [];
              deadList.push({ ...item, error: "409 Conflict: payload mismatch", failedAt: Date.now() });
              await chrome.storage.local.set({ kiroku_dead_letter_cards: deadList.slice(-50) });
            } catch (_) {}
            continue;
          }
        } catch (_) {}
      }

      if (saved) {
        ackedItems.add(item);
        if (item.queue_entry_id) {
          ackedEntryIds.add(item.queue_entry_id);
        }
      } else {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts >= 10) {
          // Max attempts reached; move to dead-letter queue
          ackedItems.add(item);
          if (item.queue_entry_id) {
            ackedEntryIds.add(item.queue_entry_id);
          }
          try {
            const deadData = await chrome.storage.local.get("kiroku_dead_letter_cards");
            const deadList = Array.isArray(deadData?.kiroku_dead_letter_cards) ? deadData.kiroku_dead_letter_cards : [];
            deadList.push({ ...item, error: "Max sync attempts (10) exceeded", failedAt: Date.now() });
            await chrome.storage.local.set({ kiroku_dead_letter_cards: deadList.slice(-50) });
          } catch (_) {}
        }
      }
    }

    if (ackedItems.size > 0) {
      await withQueueLock(async () => {
        const latestData = await chrome.storage.local.get("kiroku_pending_cards");
        const latestQueue = Array.isArray(latestData?.kiroku_pending_cards) ? latestData.kiroku_pending_cards : [];
        const updatedQueue = latestQueue.filter(it => {
          if (it.queue_entry_id && ackedEntryIds.has(it.queue_entry_id)) return false;
          if (ackedItems.has(it)) return false;
          const itId = it.id || (it.payload && it.payload.id);
          if (itId && [...ackedItems].some(s => (s.id || s.payload?.id) === itId && (!it.queue_entry_id || it.queue_entry_id === s.queue_entry_id))) return false;
          return true;
        });
        await chrome.storage.local.set({ kiroku_pending_cards: updatedQueue });
      });
    }

    return ackedItems.size;
  } catch (_) {
    return 0;
  } finally {
    isDrainingQueue = false;
  }
}



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
      files: [
        "content/capture-utils.js",
        "content/hud/hud-popup.js",
        "content/toast.js",
        "content/content.js"
      ]
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

const VIDEO_MINING_SCRIPTS = [
  "lib/kiroku-api.js",
  "content/player/player-adapter.js",
  "content/player/html5-adapter.js",
  "content/player/youtube-player.js",
  "content/player/netflix-player.js",
  "content/hud/hud-state.js",
  "content/hud/hud-host.js",
  "content/hud/hud-popup.js",
  "content/hud/hud-sentence.js",
  "lib/subtitle-parser.js",
  "lib/title-parser.js",
  "lib/episode-store.js",
  "lib/subtitle-provider.js",
  "lib/jimaku-provider.js",
  "lib/image-cropper.js",
  "link/clip.js",
  "content/anime-hud.js",
  "sidepanel/anime/session.js",
  "content/video-mining/controller.js",
  "content/video-mining.js"
];

const injectedVideoFrames = new Map(); // tabId -> Set<frameId | "all">
const inflightVideoInjections = new Map(); // key -> Promise

function clearTabVideoInjectionState(tabId) {
  if (typeof tabId !== "number") return;
  injectedVideoFrames.delete(tabId);
  for (const key of Array.from(inflightVideoInjections.keys())) {
    if (key.startsWith(`${tabId}:`)) {
      inflightVideoInjections.delete(key);
    }
  }
}

async function ensureVideoMiningScript(tabId, targetFrameId = null) {
  if (!tabId || tabId < 0) return;
  const frameKey = typeof targetFrameId === "number" ? targetFrameId : "all";
  let tabSet = injectedVideoFrames.get(tabId);
  if (tabSet && (tabSet.has("all") || tabSet.has(frameKey))) {
    return;
  }

  const inflightKey = `${tabId}:${frameKey}`;
  if (inflightVideoInjections.has(inflightKey)) {
    return inflightVideoInjections.get(inflightKey);
  }

  const run = (async () => {
    try {
      if (typeof targetFrameId === "number") {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [targetFrameId] },
          files: VIDEO_MINING_SCRIPTS
        });
      } else {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: VIDEO_MINING_SCRIPTS
        });
      }
      if (!injectedVideoFrames.has(tabId)) {
        injectedVideoFrames.set(tabId, new Set());
      }
      injectedVideoFrames.get(tabId).add(frameKey);
    } catch (err) {
      console.warn("[Background] ensureVideoMiningScript injection failed:", err);
      if (typeof chrome !== "undefined" && chrome.storage?.session) {
        chrome.storage.session.set({
          kiroku_inject_error: {
            tabId,
            targetFrameId,
            message: err?.message || String(err),
            timestamp: Date.now()
          }
        }).catch(() => {});
      }
    } finally {
      inflightVideoInjections.delete(inflightKey);
    }
  })();

  inflightVideoInjections.set(inflightKey, run);
  return run;
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

  // Strict host allowlist (Finding S4): Only jimaku.cc and verified jimaku subdomains
  if (host !== "jimaku.cc" && !host.endsWith(".jimaku.cc")) {
    return false;
  }

  return true;
}

// --- Chrome runtime listeners ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SET_MINING_MODE") {
    (async () => {
      try {
        isMiningModeEnabled = Boolean(message.enabled);
        await chrome.storage?.local?.set?.({
          "kiroku.mining_mode_enabled": isMiningModeEnabled,
          "kiroku.mining.enabled": isMiningModeEnabled
        }).catch(() => {});
        const tabs = await chrome.tabs.query({}).catch(() => []);
        for (const tab of tabs) {
          if (tab?.id && tab?.url && !tab.url.startsWith("chrome://")) {
            chrome.tabs.sendMessage(tab.id, { type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled }).catch(() => {});
          }
        }

        const tab = await activeTab().catch(() => null);
        if (tab?.id) {
          await ensureContentScript(tab.id);
          await chrome.tabs.sendMessage(tab.id, { type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled }).catch(() => {});
        }
        sendResponse({ ok: true, stage: "content-script" });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
  if (message?.type === "GET_MINING_MODE") {
    chrome.storage?.local?.get?.(["kiroku.mining_mode_enabled", "kiroku.mining.enabled"]).then?.((res) => {
      const enabled = typeof res?.["kiroku.mining_mode_enabled"] === "boolean"
        ? res["kiroku.mining_mode_enabled"]
        : (typeof res?.["kiroku.mining.enabled"] === "boolean" ? res["kiroku.mining.enabled"] : isMiningModeEnabled);
      sendResponse({ ok: true, enabled });
    }).catch(() => {
      sendResponse({ ok: true, enabled: isMiningModeEnabled });
    });
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
    const parsedTarget = new URL(targetUrl);
    const isTargetJimaku = (parsedTarget.hostname.toLowerCase() === "jimaku.cc" || parsedTarget.hostname.toLowerCase().endsWith(".jimaku.cc"));

    const headers = {
      "Accept": "application/json, text/plain, text/vtt, text/x-ssa, */*"
    };
    if (message.apiKey && isTargetJimaku) {
      headers["Authorization"] = message.apiKey;
    }

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 10000);

    fetch(targetUrl, {
      method: "GET", // S4: Force GET-only downloads
      headers,
      signal: abortCtrl.signal,
      redirect: "follow"
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          const status = res.status;
          if (status === 401) throw new Error("UNAUTHORIZED: Invalid Jimaku API key");
          if (status === 429) throw new Error("RATE_LIMITED: Jimaku API rate limit reached");
          throw new Error(`HTTP ${status}: ${res.statusText}`);
        }
        // E5: Cap response size to 10MB
        const cl = parseInt(res.headers.get("content-length") || "0", 10);
        if (cl > 10485760) {
          throw new Error("RESPONSE_TOO_LARGE: Subtitle response exceeds 10MB limit");
        }

        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          return { ok: true, data: json, isJson: true };
        } else {
          const text = await res.text();
          if (text.length > 10485760) {
            throw new Error("RESPONSE_TOO_LARGE: Subtitle content exceeds 10MB limit");
          }
          return { ok: true, text, isJson: false };
        }
      })
      .then(data => sendResponse(data))
      .catch(err => {
        clearTimeout(timeoutId);
        sendResponse({ ok: false, error: err.name === "AbortError" ? "TIMEOUT: Subtitle request timed out after 10s" : err.message });
      });
    return true;
  }

  if (message?.type === "JIMAKU_SEARCH") {
    const query = typeof message.query === "string" ? message.query.trim() : "";
    if (!query) {
      sendResponse({ ok: false, error: "MISSING_QUERY", message: "Search query is required" });
      return true;
    }
    const searchUrl = `/api/entries/search?query=${encodeURIComponent(query)}`;
    if (!isAllowedJimakuUrl(searchUrl)) {
      sendResponse({ ok: false, error: "INVALID_URL", message: "Search URL not allowed" });
      return true;
    }
    const targetUrl = new URL(searchUrl, "https://jimaku.cc").toString();
    const headers = {
      "Accept": "application/json"
    };
    if (message.apiKey) {
      headers["Authorization"] = message.apiKey;
    }
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 10000);
    fetch(targetUrl, { method: "GET", headers, signal: abortCtrl.signal })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          const status = res.status;
          if (status === 401) throw new Error("UNAUTHORIZED: Invalid Jimaku API key");
          if (status === 429) throw new Error("RATE_LIMITED: Jimaku API rate limit reached");
          throw new Error(`HTTP ${status}: ${res.statusText}`);
        }
        const json = await res.json();
        return { ok: true, entries: Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []) };
      })
      .then(data => sendResponse(data))
      .catch(err => {
        clearTimeout(timeoutId);
        sendResponse({ ok: false, error: err.name === "AbortError" ? "TIMEOUT: Search timed out after 10s" : err.message });
      });
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

  if (message?.type === "ANALYZE_GRAMMAR_SELECTION") {
    if (!message.__forwarded) {
      chrome.runtime.sendMessage({ ...message, __forwarded: true }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "VIDEO_DETECTED") {
    const tabId = sender?.tab?.id;
    if (tabId) {
      ensureVideoMiningScript(tabId, sender?.frameId);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "GET_TAB_INFO") {
    const tab = sender?.tab;
    sendResponse({
      ok: true,
      url: tab?.url || "",
      title: tab?.title || ""
    });
    return;
  }

  if (message?.type === "ENSURE_VIDEO_MINING") {
    (async () => {
      try {
        const tab = await activeTab();
        if (tab?.id) {
          await ensureVideoMiningScript(tab.id);
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === "LOAD_SUBTITLE_CUES" || message?.type === "CLEAR_SUBTITLES" || message?.type === "SET_SUBTITLE_OFFSET" || message?.type === "SELECT_YOUTUBE_TRACK" || message?.type === "UPDATE_ANNOTATED_CUES") {
    (async () => {
      try {
        if (message?.type === "LOAD_SUBTITLE_CUES" && Array.isArray(message.cues)) {
          await chrome.storage.local.set({
            active_subtitle_cues: message.cues,
            active_subtitle_filename: message.filename || ""
          }).catch(() => {});
        } else if (message?.type === "UPDATE_ANNOTATED_CUES" && Array.isArray(message.cues)) {
          await chrome.storage.local.set({
            active_subtitle_cues: message.cues
          }).catch(() => {});
        } else if (message?.type === "CLEAR_SUBTITLES") {
          await chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]).catch(() => {});
        }
        const tab = await activeTab();
        if (tab?.id) {
          await ensureVideoMiningScript(tab.id);
          await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
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
    (async () => {
      try {
        const windowId = sender?.tab?.windowId;
        const capturePromise = (typeof windowId === "number")
          ? chrome.tabs.captureVisibleTab(windowId, { format: "png" })
          : chrome.tabs.captureVisibleTab({ format: "png" });

        const dataUrl = await capturePromise;

        // Crop image using OffscreenCanvas
        let croppedDataUrl = null;
        try {
          const resp = await fetch(dataUrl);
          const blob = await resp.blob();
          const bitmap = await createImageBitmap(blob);

          const scaleX = bitmap.width / (message.viewport?.innerWidth || 1);
          const scaleY = bitmap.height / (message.viewport?.innerHeight || 1);

          const cropX = Math.max(0, Math.round((message.rect.left ?? message.rect.x ?? 0) * scaleX));
          const cropY = Math.max(0, Math.round((message.rect.top ?? message.rect.y ?? 0) * scaleY));
          const cropW = Math.min(bitmap.width - cropX, Math.round((message.rect.width || 10) * scaleX));
          const cropH = Math.min(bitmap.height - cropY, Math.round((message.rect.height || 10) * scaleY));

          if (cropW > 0 && cropH > 0) {
            const canvas = new OffscreenCanvas(cropW, cropH);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
            const buffer = await croppedBlob.arrayBuffer();
            let binary = "";
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            croppedDataUrl = "data:image/png;base64," + btoa(binary);
          }
        } catch (cropErr) {
          console.warn("[Background] Offscreen crop failed, using full frame:", cropErr);
          croppedDataUrl = dataUrl;
        }

        // Call OCR Backend
        const ocrResp = await fetch("http://127.0.0.1:21828/api/ocr/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: croppedDataUrl })
        });

        if (!ocrResp.ok) {
          const errData = await ocrResp.json().catch(() => ({}));
          sendResponse({ ok: false, error: errData.detail || "OCR recognition failed" });
          return;
        }

        const ocrResult = await ocrResp.json();
        const recognizedText = (ocrResult.text || "").trim();

        // Deliver recognized text to in-page content script so popup appears directly on the image/bubble!
        if (sender?.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "OCR_RECOGNITION_COMPLETE",
            text: recognizedText,
            rect: message.rect,
            croppedImage: croppedDataUrl
          }).catch(() => {});
        }

        // Also broadcast to sidepanel if open
        chrome.runtime.sendMessage({
          type: "PROCESS_OCR_CROP",
          dataUrl,
          rect: message.rect,
          viewport: message.viewport,
          recognizedText
        }).catch(() => {});

        sendResponse({ ok: true, text: recognizedText });
      } catch (err) {
        console.error("[AnkiMiner Background] OCR error:", err);
        sendResponse({ ok: false, error: err?.message || "OCR failed" });
      }
    })();
    return true;
  }
  if (message?.type === "OCR_SELECTION_CANCELLED") {
    chrome.runtime.sendMessage({
      type: "OCR_SELECTION_CANCELLED",
      reason: message.reason || "user"
    }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "GRAMMAR_ANALYZE") {
    (async () => {
      try {
        const sentence = String(message.sentence || "").trim();
        if (!sentence) {
          sendResponse({ ok: false, error: "Empty sentence" });
          return;
        }

        // 1. Try local backend
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/grammar/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sentence,
              show_basic_particles: true,
              show_below_level: true
            }),
            signal: AbortSignal.timeout(1500)
          });
          if (resp.ok) {
            const data = await resp.json();
            sendResponse({ ok: true, data, source: "local" });
            return;
          }
        } catch (_) {}

        // 2. Cloud Edge grammar analyzer fallback (queries Neon grammar_points catalog, no login needed)
        try {
          const cloudResp = await fetch(`${CLOUD_WORKER_URL}/api/grammar/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sentence,
              show_basic_particles: true,
              show_below_level: true
            }),
            signal: AbortSignal.timeout(4000)
          });
          if (cloudResp.ok) {
            const data = await cloudResp.json();
            sendResponse({ ok: true, data, source: "cloud" });
            return;
          }
        } catch (_) {}

        sendResponse({ ok: false, error: "Grammar analysis failed" });
      } catch (_) {
        sendResponse({ ok: false, error: "Backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "TOKENIZE_SENTENCE") {
    (async () => {
      try {
        const text = String(message.text || "").trim();
        if (!text) {
          sendResponse({ ok: true, tokens: [] });
          return;
        }
        // 1. Try local backend /api/subtitle/annotate
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/subtitle/annotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cues: [{ start_ms: 0, end_ms: 1000, text }]
            }),
            signal: AbortSignal.timeout(1500)
          });
          if (resp.ok) {
            const data = await resp.json();
            const tokens = data?.cues?.[0]?.tokens || [];
            sendResponse({ ok: true, tokens });
            return;
          }
        } catch (_) {}

        // 2. Fallback to local /api/tokenize
        try {
          const tokResp = await fetch("http://127.0.0.1:21828/api/tokenize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, mode: "C" }),
            signal: AbortSignal.timeout(1500)
          });
          if (tokResp.ok) {
            const tokData = await tokResp.json();
            const tokens = (tokData?.tokens || []).map(t => ({
              surface: t.surface,
              lemma: t.dictionary_form || t.normalized || t.surface,
              reading: t.reading || "",
              status: "unstyled"
            }));
            sendResponse({ ok: true, tokens });
            return;
          }
        } catch (_) {}

        // 3. Fallback to Cloud Edge /api/tokenize
        try {
          const cloudResp = await fetch(`${CLOUD_WORKER_URL}/api/tokenize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, mode: "C" }),
            signal: AbortSignal.timeout(3000)
          });
          if (cloudResp.ok) {
            const tokData = await cloudResp.json();
            const tokens = (tokData?.tokens || []).map(t => ({
              surface: t.surface,
              lemma: t.dictionary_form || t.normalized || t.surface,
              reading: t.reading || "",
              status: "unstyled"
            }));
            sendResponse({ ok: true, tokens });
            return;
          }
        } catch (_) {}

        sendResponse({ ok: false, error: "Tokenization failed" });
      } catch (_) {
        sendResponse({ ok: false, error: "Backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "GRAMMAR_MINE") {
    (async () => {
      try {
        const grammar = message.grammar || {};
        const payload = {
          expression: grammar.pattern || "Grammar",
          reading: grammar.level || "",
          meaning: grammar.meaning || "",
          example_sentence: grammar.sentence || "",
          deck_name: "Default",
          source_type: "grammar"
        };
        const resp = await fetch("http://127.0.0.1:21828/api/cards/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          sendResponse({ ok: false, error: "Failed to save grammar card" });
          return;
        }
        const data = await resp.json();
        sendResponse({ ok: true, data, card_id: data.card_id || data.id });
      } catch (_) {
        sendResponse({ ok: false, error: "Backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "DELETE_CARD") {
    (async () => {
      try {
        const cardId = message.cardId;
        if (!cardId) {
          sendResponse({ ok: false });
          return;
        }
        await fetch(`http://127.0.0.1:21828/api/cards/${cardId}`, {
          method: "DELETE"
        });
        sendResponse({ ok: true });
      } catch (_) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (message?.type === "SET_WORD_STATUS") {
    (async () => {
      try {
        const { word, status } = message;
        if (!word) {
          sendResponse({ ok: false });
          return;
        }
        const resp = await fetch("http://127.0.0.1:21828/api/word-states/set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word, status })
        });
        const data = await resp.json().catch(() => ({}));
        sendResponse({ ok: resp.ok, data });
      } catch (_) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (message?.type === "HUD_LOOKUP") {
    (async () => {
      try {
        const text = String(message.text || "").trim();
        if (!text) {
          sendResponse({ ok: false, error: "Empty lookup term" });
          return;
        }
        // 1. Try local backend first
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, deck_name: "Default", auto_save: false }),
            signal: AbortSignal.timeout(1500)
          });
          if (resp.ok) {
            const data = await resp.json();
            sendResponse({ ok: true, data, source: "local" });
            return;
          }
        } catch (_) {}

        // 2. Cloud Edge dictionary fallback (no login required)
        const token = await getStoredCloudToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // 2a. Try Cloud /api/capture first (rich enrichment from Neon catalog)
        try {
          const captureResp = await fetch(`${CLOUD_WORKER_URL}/api/capture`, {
            method: "POST",
            headers,
            body: JSON.stringify({ text, deck_name: "Default", auto_save: false }),
            signal: AbortSignal.timeout(4000)
          });
          if (captureResp.ok) {
            const data = await captureResp.json();
            if (data && (data.meaning || (Array.isArray(data.entries) && data.entries.length > 0))) {
              sendResponse({ ok: true, data, source: "cloud" });
              return;
            }
          }
        } catch (_) {}

        // 2b. Fallback to Cloud /api/dictionary/lookup (Neon terms & kanji table)
        try {
          const cloudResp = await fetch(`${CLOUD_WORKER_URL}/api/dictionary/lookup?term=${encodeURIComponent(text)}`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(4000)
          });
          if (cloudResp.ok) {
            const data = await cloudResp.json();
            sendResponse({ ok: true, data, source: "cloud" });
            return;
          }
        } catch (_) {}

        sendResponse({ ok: false, error: "Kiroku backend offline and cloud unavailable" });
      } catch (err) {
        sendResponse({ ok: false, error: "Lookup failed" });
      }
    })();
    return true;
  }
  if (message?.type === "QUEUE_CARD") {
    (async () => {
      try {
        const ok = await queueCardLocally(message.card || message.payload || {});
        sendResponse({ ok });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "HUD_MINE") {
    (async () => {
      try {
        const card = message.card || {};
        if (!card.expression) {
          sendResponse({ ok: false, error: "Expression is required" });
          return;
        }
        const payload = {
          expression: card.expression,
          reading: card.reading || "",
          meaning: card.meaning || "",
          deck_name: card.deck_name || "Default",
          model_name: card.model_name || "",
          example_sentence: card.example_sentence || "",
          example_translation: card.example_translation || "",
          image: card.image || "",
          audio: card.audio || "",
          source_type: card.source_type || "video",
          source_url: card.source_url || "",
          tags: card.tags || "",
          hint: card.hint || "",
          notes: card.notes || ""
        };
        // 1. Try local backend
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/cards/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(3000)
          });
          if (resp.ok) {
            const data = await resp.json();
            const token = await getStoredCloudToken();
            if (token) {
              fetch(`${CLOUD_WORKER_URL}/sync/push`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ ops: [payload] }),
                signal: AbortSignal.timeout(5000)
              }).catch(() => {});
            }
            sendResponse({ ok: true, data, card_id: data.card_id || data.id, sync_destination: "local" });
            return;
          }
        } catch (_) {}

        // 2. Fallback to Cloudflare Worker
        const token = await getStoredCloudToken();
        if (token) {
          try {
            const cloudResp = await fetch(`${CLOUD_WORKER_URL}/sync/push`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
              },
              body: JSON.stringify({ ops: [payload] }),
              signal: AbortSignal.timeout(5000)
            });
            if (cloudResp.ok) {
              const cloudData = await cloudResp.json();
              sendResponse({ ok: true, data: cloudData, card_id: cloudData.ids?.[0] || cloudData.id, sync_destination: "cloud" });
              return;
            }
          } catch (_) {}
        }

        // 3. Fallback to Offline Local Queue
        const queued = await queueCardLocally(payload);
        if (queued) {
          sendResponse({ ok: true, queued: true, card_id: "queued_" + Date.now(), sync_destination: "queued", message: "Saved offline. Will sync when online." });
        } else {
          sendResponse({ ok: false, error: "Failed to save card (local, cloud and queue unavailable)" });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Mine failed" });
      }
    })();
    return true;
  }
  if (message?.type === "DRAIN_PENDING_QUEUE") {
    (async () => {
      const syncedCount = await drainPendingCardsQueue();
      sendResponse({ ok: true, syncedCount });
    })();
    return true;
  }
  if (message?.type === "OPEN_DICTIONARY") {
    (async () => {
      try {
        const term = (message.term || "").trim();
        if (term && chrome.storage?.local?.set) {
          await chrome.storage.local.set({
            "kiroku.last_captured_word": {
              text: term,
              sentence: message.sentence || "",
              timestamp: Date.now()
            }
          }).catch(() => {});
        }
        const windowId = sender?.tab?.windowId;
        if (windowId && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId }).catch(() => {});
        } else if (chrome.sidePanel?.open) {
          const [currentWin] = await chrome.windows.getAll({ populate: false }).catch(() => []);
          if (currentWin?.id) {
            await chrome.sidePanel.open({ windowId: currentWin.id }).catch(() => {});
          }
        }
        if (term) {
          chrome.runtime.sendMessage({
            type: "JAPANESE_TEXT_CAPTURED",
            text: term,
            contextSentence: message.sentence || ""
          }).catch(() => {});
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "SP_OPEN_GRAMMAR" || message?.type === "SP_SCROLL_TRANSCRIPT") {
    (async () => {
      try {
        const windowId = sender?.tab?.windowId;
        if (windowId && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId }).catch(() => {});
        }
        chrome.runtime.sendMessage(message).catch(() => {});
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "SESSION_LOG_COUNTERS") {
    (async () => {
      try {
        const payload = message.payload || {};
        const url = "http://127.0.0.1:21828/api/link/sessions";
        let res = null;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            const token = await getStoredCloudToken();
            const headers = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            res = await fetch(`${CLOUD_WORKER_URL}/api/link/sessions`, {
              method: "POST",
              headers,
              body: JSON.stringify(payload)
            });
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          sendResponse({ ok: true, data });
          return;
        }
        sendResponse({ ok: false, error: "Backend and cloud unavailable" });
      } catch (err) {
        sendResponse({ ok: false, error: "Backend unavailable" });
      }
    })();
    return true;
  }
  if (message?.type === "SEEK_TO") {
    (async () => {
      try {
        const tab = await activeTab();
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }
  if (message?.type === "EPISODE_SAVE_POSITION") {
    (async () => {
      try {
        const cueHash = message.cueHash;
        if (!cueHash) {
          sendResponse({ ok: false, error: "Missing cueHash" });
          return;
        }
        const url = `http://127.0.0.1:21828/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
        let res = null;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message.payload || {})
          });
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            const token = await getStoredCloudToken();
            const headers = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            res = await fetch(`${CLOUD_WORKER_URL}/api/link/episodes/${encodeURIComponent(cueHash)}/position`, {
              method: "POST",
              headers,
              body: JSON.stringify(message.payload || {})
            });
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          sendResponse({ ok: true, data });
          return;
        }
        sendResponse({ ok: false, error: "Position save failed" });
      } catch (err) {
        sendResponse({ ok: false, error: "Backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "EPISODE_SYNC_SUBTITLES") {
    (async () => {
      try {
        const url = "http://127.0.0.1:21828/api/link/episodes/sync";
        let res = null;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message.payload || {})
          });
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            const token = await getStoredCloudToken();
            const headers = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            res = await fetch(`${CLOUD_WORKER_URL}/api/link/episodes/sync`, {
              method: "POST",
              headers,
              body: JSON.stringify(message.payload || {})
            });
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          sendResponse({ ok: true, data });
          return;
        }
        sendResponse({ ok: false, error: "Sync failed" });
      } catch (err) {
        sendResponse({ ok: false, error: "Backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "EPISODE_GET_STATUS") {
    (async () => {
      try {
        const cueHash = message.cueHash;
        if (!cueHash) {
          sendResponse({ ok: false, error: "Missing cueHash" });
          return;
        }
        const url = `http://127.0.0.1:21828/api/link/episodes/${encodeURIComponent(cueHash)}`;
        const res = await fetch(url);
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: "Kiroku backend offline" });
      }
    })();
    return true;
  }
  if (message?.type === "GET_LINK_STATUS") {
    (async () => {
      try {
        const res = await fetch("http://127.0.0.1:21828/health", { signal: AbortSignal.timeout(1500) }).catch(() => null);
        const isConnected = res && res.ok;
        sendResponse({ ok: true, status: isConnected ? "connected" : "disconnected" });
      } catch (_) {
        sendResponse({ ok: true, status: "disconnected" });
      }
    })();
    return true;
  }
  if (message?.type === "CLOUD_LOGIN_GOOGLE" || message?.type === "CLOUD_LOGIN_GITHUB") {
    (async () => {
      try {
        const provider = message.type === "CLOUD_LOGIN_GITHUB" ? "github" : "google";
        if (typeof chrome !== "undefined" && chrome.identity && chrome.identity.launchWebAuthFlow) {
          const redirectUrl = chrome.identity.getRedirectURL("auth");
          const authUrl = `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(redirectUrl)}`;
          chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
            if (chrome.runtime.lastError || !responseUrl) {
              const fallbackRedirect = chrome.runtime.getURL("auth.html");
              chrome.tabs.create({ url: `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(fallbackRedirect)}` });
              sendResponse({ ok: false, error: chrome.runtime.lastError?.message });
              return;
            }
            try {
              const u = new URL(responseUrl);
              const code = u.searchParams.get("code");
              if (code) {
                const exRes = await fetch(`${CLOUD_WORKER_URL}/auth/exchange`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code })
                });
                const exData = await exRes.json();
                if (exData && exData.token) {
                  await chrome.storage.local.set({
                    kiroku_auth_token: exData.token,
                    "kiroku.cloud.auth_token": exData.token,
                    kiroku_cloud_token: exData.token,
                    kiroku_auth_session: exData.user || { name: exData.name, email: exData.email }
                  });
                  chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: true, user: exData.user }).catch(() => {});
                  sendResponse({ ok: true, token: exData.token });
                  return;
                }
              }
            } catch (exErr) {
              console.warn('[Extension] Auth flow exchange error:', exErr);
            }
            sendResponse({ ok: true });
          });
          return;
        }

        const redirectUrl = chrome.runtime.getURL("auth.html");
        const authUrl = `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(redirectUrl)}`;
        chrome.tabs.create({ url: authUrl });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "CLOUD_LOGOUT") {
    (async () => {
      try {
        const token = await getStoredCloudToken();
        if (token) {
          fetch(`${CLOUD_WORKER_URL}/auth/logout`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` }
          }).catch(() => {});
        }
        await chrome.storage?.local?.remove([
          "kiroku_auth_token",
          "kiroku.cloud.auth_token",
          "kiroku_cloud_token",
          "kiroku.extension.session_token",
          "kiroku.extension.auth_token",
          "kiroku_auth_session"
        ]);
        chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: false, user: null }).catch(() => {});
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "GET_CLOUD_AUTH_STATUS") {
    (async () => {
      try {
        const token = await getStoredCloudToken();
        if (!token) {
          sendResponse({ ok: true, authenticated: false, user: null });
          return;
        }
        const stored = await chrome.storage?.local?.get(["kiroku_auth_session"]);
        const user = stored?.kiroku_auth_session || null;
        sendResponse({ ok: true, authenticated: true, user, token });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "SESSION_GET_RECENT") {
    (async () => {
      try {
        const limit = message.limit || 10;
        const url = `http://127.0.0.1:21828/api/link/sessions?limit=${limit}`;
        const res = await fetch(url);
        if (!res.ok) {
          sendResponse({ ok: false, error: `HTTP ${res.status}` });
          return;
        }
        const data = await res.json();
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: "Kiroku backend offline" });
      }
    })();
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
  if (changeInfo.status === "loading") {
    clearTabVideoInjectionState(tabId);
  }
  if (changeInfo.status === "complete" && tab?.url && !tab.url.startsWith("chrome://")) {
    if (isMiningModeEnabled) {
      ensureContentScript(tabId).then(() => {
        chrome.tabs.sendMessage(tabId, {type: "MINING_MODE_CHANGED", enabled: true}).catch(() => {});
      }).catch(() => {});
    }
  }
});

if (typeof chrome !== "undefined") {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  if (chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
    });
  }
  if (chrome.runtime?.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      drainPendingCardsQueue().catch(() => {});
    });
  }

  // 60-second heartbeat alarm for session logging & retries
  if (chrome.alarms?.create) {
    try {
      chrome.alarms.create("kiroku_session_heartbeat", { periodInMinutes: 1 });
      chrome.alarms.create("kiroku_sync_drain", { periodInMinutes: 15 });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === "kiroku_session_heartbeat") {
          chrome.runtime.sendMessage({ type: "SESSION_HEARTBEAT_ALARM" }).catch(() => {});
          chrome.tabs.query({}).then(tabs => {
            for (const tab of tabs) {
              if (tab?.id && tab?.url && !tab.url.startsWith("chrome://")) {
                chrome.tabs.sendMessage(tab.id, { type: "SESSION_HEARTBEAT_ALARM" }).catch(() => {});
              }
            }
          }).catch(() => {});
        }
        if (alarm.name === "kiroku_sync_drain") {
          drainPendingCardsQueue().catch(() => {});
        }
      });
    } catch (_) {}
  }

  // Flush sessions on tab close
  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      clearTabVideoInjectionState(tabId);
      chrome.runtime.sendMessage({ type: "TAB_CLOSED", tabId }).catch(() => {});
    });
  }
}

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
    ensureVideoMiningScript,
    VIDEO_MINING_SCRIPTS,
    CLOUD_WORKER_URL,
    getStoredCloudToken,
    queueCardLocally,
    drainPendingCardsQueue,
  };
}
