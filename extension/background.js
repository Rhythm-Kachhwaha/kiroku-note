// --- Global error & unhandled rejection suppression for Chrome extension UI ---
if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("unhandledrejection", (event) => {
    event?.preventDefault?.();
  });
  self.addEventListener("error", (event) => {
    event?.preventDefault?.();
  });
}

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

async function queueAnimeOutboxLocally(item) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return false;
  return withQueueLock(async () => {
    try {
      const data = await chrome.storage.local.get("kiroku_anime_outbox");
      const outbox = Array.isArray(data?.kiroku_anime_outbox) ? data.kiroku_anime_outbox : [];

      // H2: Strip heavy token arrays from queued subtitle payloads to prevent storage bloat
      let normalizedItem = item;
      if (item.type === "subtitles" && item.payload && Array.isArray(item.payload.cues)) {
        normalizedItem = {
          ...item,
          payload: {
            ...item.payload,
            cues: item.payload.cues.map(c => {
              if (!c || typeof c !== "object") return c;
              const { tokens, ...rest } = c;
              return rest;
            })
          }
        };
      }

      // Coalesce position updates for the same episode/series rather than duplicating
      if (normalizedItem.type === "position") {
        const itemHash = normalizedItem.cueHash || normalizedItem.hash || normalizedItem.payload?.cue_hash;
        const existingPosIdx = outbox.findIndex(
          it => it.type === "position" &&
          ((itemHash && (it.cueHash === itemHash || it.hash === itemHash || it.payload?.cue_hash === itemHash)) ||
           (normalizedItem.payload?.series && it.payload?.series === normalizedItem.payload?.series && normalizedItem.payload?.episode_key && it.payload?.episode_key === normalizedItem.payload?.episode_key))
        );
        if (existingPosIdx >= 0) {
          outbox[existingPosIdx].payload = {
            ...outbox[existingPosIdx].payload,
            ...normalizedItem.payload,
            last_position_ms: Math.max(outbox[existingPosIdx].payload?.last_position_ms || 0, normalizedItem.payload?.last_position_ms || 0)
          };
          outbox[existingPosIdx].attempts = 0;
          outbox[existingPosIdx].cloud_acked = false;
          outbox[existingPosIdx].local_acked = false;
          outbox[existingPosIdx].updated_at = Date.now();
          await chrome.storage.local.set({ kiroku_anime_outbox: outbox });
          return true;
        }
      }

      outbox.push({
        id: "ao_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9),
        ...normalizedItem,
        attempts: 0,
        created_at: Date.now()
      });
      await chrome.storage.local.set({ kiroku_anime_outbox: outbox });
      return true;
    } catch (_) {
      return false;
    }
  });
}

let isDrainingAnimeOutbox = false;

async function drainAnimeOutbox() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return 0;
  if (isDrainingAnimeOutbox) return 0;
  isDrainingAnimeOutbox = true;
  let drained = 0;

  try {
    const data = await chrome.storage.local.get("kiroku_anime_outbox");
    const outbox = data?.kiroku_anime_outbox;
    if (!Array.isArray(outbox) || outbox.length === 0) return 0;

    const token = await getStoredCloudToken();
    const isFatal4xx = (res) => res && res.status >= 400 && res.status < 500 && ![401, 403, 408, 429].includes(res.status);
    let authExpired = false;

    const persistItemResult = async (itemId, action, patch = {}) => {
      await withQueueLock(async () => {
        const fresh = await chrome.storage.local.get("kiroku_anime_outbox");
        const currentOutbox = Array.isArray(fresh?.kiroku_anime_outbox) ? fresh.kiroku_anime_outbox : [];
        let updatedOutbox;
        if (action === "remove" || action === "dead_letter") {
          if (action === "dead_letter") {
            const deadItem = currentOutbox.find(it => it.id === itemId);
            if (deadItem) {
              try {
                const deadData = await chrome.storage.local.get("kiroku_dead_letter_anime_outbox");
                const deadList = Array.isArray(deadData?.kiroku_dead_letter_anime_outbox) ? deadData.kiroku_dead_letter_anime_outbox : [];
                deadList.push({ ...deadItem, ...patch, failedAt: Date.now() });
                await chrome.storage.local.set({ kiroku_dead_letter_anime_outbox: deadList.slice(-50) });
              } catch (_) {}
            }
          }
          updatedOutbox = currentOutbox.filter(it => it.id !== itemId);
        } else {
          updatedOutbox = currentOutbox.map(it => (it.id === itemId ? { ...it, ...patch } : it));
        }
        await chrome.storage.local.set({ kiroku_anime_outbox: updatedOutbox });
      });
    };

    for (const item of outbox) {
      if (item.next_retry_at && Date.now() < item.next_retry_at) {
        continue;
      }

      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let localUrl = "";
      let cloudUrl = "";
      let localTimeout = 1500;
      let cloudTimeout = 12000;

      if (item.type === "position") {
        const cueHash = item.cueHash || item.hash || item.payload?.cue_hash;
        localUrl = `http://127.0.0.1:21828/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
        cloudUrl = `${CLOUD_WORKER_URL}/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
      } else if (item.type === "subtitles") {
        localUrl = "http://127.0.0.1:21828/api/link/episodes/sync";
        cloudUrl = `${CLOUD_WORKER_URL}/api/link/episodes/sync`;
        localTimeout = 2500;
        cloudTimeout = 15000;
      } else if (item.type === "session") {
        localUrl = "http://127.0.0.1:21828/api/link/sessions";
        cloudUrl = `${CLOUD_WORKER_URL}/api/link/sessions`;
      } else {
        continue;
      }

      let cloudAcked = Boolean(item.cloud_acked);
      let localAcked = Boolean(item.local_acked);
      let fatalError = null;

      try {
        if (token && !cloudAcked && !authExpired) {
          const cRes = await safeFetch(cloudUrl, { method: "POST", headers, body: JSON.stringify(item.payload) }, cloudTimeout).catch(() => null);
          if (cRes && cRes.ok) {
            const cData = await cRes.json().catch(() => ({}));
            if (cData?.cloud_synced !== false) {
              cloudAcked = true;
            }
          } else if (cRes && (cRes.status === 401 || cRes.status === 403)) {
            authExpired = true;
            chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: false, reason: "expired" }).catch?.(() => {});
          } else if (isFatal4xx(cRes)) {
            fatalError = `HTTP ${cRes.status} from cloud`;
          }
        }

        if (!fatalError && !localAcked) {
          const lRes = await safeFetch(localUrl, { method: "POST", headers, body: JSON.stringify(item.payload) }, localTimeout).catch(() => null);
          if (lRes && lRes.ok) {
            const lData = await lRes.json().catch(() => ({}));
            localAcked = true;
            if (!token || lData?.cloud_synced) {
              cloudAcked = true;
            }
          } else if (isFatal4xx(lRes)) {
            fatalError = `HTTP ${lRes.status} from local`;
          }
        }
      } catch (_) {}

      if (fatalError) {
        await persistItemResult(item.id, "dead_letter", { error: fatalError });
        continue;
      }

      const fullyDone = token ? (cloudAcked && localAcked) : localAcked;
      if (fullyDone) {
        await persistItemResult(item.id, "remove");
        drained++;
      } else if (token && cloudAcked && !localAcked) {
        // Cloud succeeded; keep for local replay up to 5 cycles so cloud-only users don't accumulate forever
        const replayCount = (item.local_replay_attempts || 0) + 1;
        if (replayCount >= 5) {
          await persistItemResult(item.id, "remove");
          drained++;
        } else {
          await persistItemResult(item.id, "update", {
            cloud_acked: true,
            local_replay_attempts: replayCount,
            last_error_at: Date.now()
          });
        }
      } else {
        const nextAttempts = ((item.attempts || item.retries || 0) + 1);
        const backoffMs = Math.min(300000, 2000 * Math.pow(2, Math.min(nextAttempts - 1, 7)));
        await persistItemResult(item.id, "update", {
          attempts: nextAttempts,
          retries: nextAttempts,
          cloud_acked: cloudAcked,
          local_acked: localAcked,
          last_error_at: Date.now(),
          next_retry_at: Date.now() + backoffMs
        });
      }
    }
  } catch (err) {
    console.warn("[Background] drainAnimeOutbox error:", err);
  } finally {
    isDrainingAnimeOutbox = false;
  }
  return drained;
}

async function getExtensionUniversalDeck() {
  const DECK_CACHE_TTL_MS = 60000;
  let cachedDeck = "";
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(["anki_deck", "vocab.selectedDeck", "anki_deck_fetched_at"]);
      cachedDeck = (stored?.anki_deck || stored?.["vocab.selectedDeck"] || "").trim();
      const fetchedAt = Number(stored?.anki_deck_fetched_at || 0);
      if (cachedDeck && fetchedAt && (Date.now() - fetchedAt) < DECK_CACHE_TTL_MS) {
        return cachedDeck;
      }
    }
  } catch (_) {}

  const token = await getStoredCloudToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  for (const base of ["http://127.0.0.1:21828", CLOUD_WORKER_URL]) {
    if (base === CLOUD_WORKER_URL && !token) continue;
    try {
      const resp = await safeFetch(`${base}/api/learner/settings`, { headers }, 2500);
      if (resp && resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const deck = (data?.preferences?.anki_deck || "").trim();
        if (deck) {
          try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
              await chrome.storage.local.set({ anki_deck: deck, anki_deck_fetched_at: Date.now() });
            }
          } catch (_) {}
          return deck;
        }
      }
    } catch (_) {}
  }
  return cachedDeck;
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
    const attemptsMap = new Map();

    for (const item of queue) {
      let saved = false;
      let fatal4xx = null;
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
        if (localResp.ok) {
          saved = true;
        } else if (localResp.status >= 400 && localResp.status < 500 && localResp.status !== 408 && localResp.status !== 429) {
          fatal4xx = `${localResp.status} from local`;
        }
      } catch (_) {}

      // 2. Try cloud edge if local was offline and token is available
      if (!saved && !fatal4xx && token) {
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
          } else if (cloudResp.status === 401 || cloudResp.status === 403) {
            chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: false, reason: "expired" }).catch?.(() => {});
          } else if (cloudResp.status >= 400 && cloudResp.status < 500 && cloudResp.status !== 408 && cloudResp.status !== 429) {
            fatal4xx = cloudResp.status === 409 ? "409 Conflict: payload mismatch" : `HTTP ${cloudResp.status} from cloud`;
          }
        } catch (_) {}
      }

      if (fatal4xx) {
        ackedItems.add(item);
        if (item.queue_entry_id) ackedEntryIds.add(item.queue_entry_id);
        try {
          const deadData = await chrome.storage.local.get("kiroku_dead_letter_cards");
          const deadList = Array.isArray(deadData?.kiroku_dead_letter_cards) ? deadData.kiroku_dead_letter_cards : [];
          deadList.push({ ...item, error: fatal4xx, failedAt: Date.now() });
          await chrome.storage.local.set({ kiroku_dead_letter_cards: deadList.slice(-50) });
        } catch (_) {}
        continue;
      }

      if (saved) {
        ackedItems.add(item);
        if (item.queue_entry_id) {
          ackedEntryIds.add(item.queue_entry_id);
        }
      } else {
        const nextAttempts = (item.attempts || 0) + 1;
        item.attempts = nextAttempts;
        if (item.queue_entry_id) attemptsMap.set(item.queue_entry_id, nextAttempts);
        if (itemId) attemptsMap.set(itemId, nextAttempts);
        if (nextAttempts >= 10) {
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

    if (ackedItems.size > 0 || attemptsMap.size > 0) {
      await withQueueLock(async () => {
        const latestData = await chrome.storage.local.get("kiroku_pending_cards");
        const latestQueue = Array.isArray(latestData?.kiroku_pending_cards) ? latestData.kiroku_pending_cards : [];
        const updatedQueue = latestQueue
          .filter(it => {
            if (it.queue_entry_id && ackedEntryIds.has(it.queue_entry_id)) return false;
            if (ackedItems.has(it)) return false;
            const itId = it.id || (it.payload && it.payload.id);
            if (itId && [...ackedItems].some(s => (s.id || s.payload?.id) === itId && (!it.queue_entry_id || it.queue_entry_id === s.queue_entry_id))) return false;
            return true;
          })
          .map(it => {
            const itId = it.id || (it.payload && it.payload.id);
            const nextAtt = (it.queue_entry_id && attemptsMap.get(it.queue_entry_id)) || (itId && attemptsMap.get(itId));
            return nextAtt ? { ...it, attempts: nextAtt } : it;
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



function safeFetch(url, options = {}, timeoutMs = 2500) {
  const signal = options.signal || (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : null);
  const fetchOpts = signal ? { ...options, signal } : options;
  return Promise.race([
    fetch(url, fetchOpts),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("FETCH_TIMEOUT")), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    })
  ]);
}

function safeSendTabMessage(tabId, message, options) {
  if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage || !tabId) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const cb = (response) => {
        if (chrome.runtime?.lastError) {
          // Explicitly consume lastError so Chrome does not log unchecked runtime.lastError
          resolve(null);
          return;
        }
        resolve(response);
      };
      if (options) {
        chrome.tabs.sendMessage(tabId, message, options, cb);
      } else {
        chrome.tabs.sendMessage(tabId, message, cb);
      }
    } catch (_) {
      resolve(null);
    }
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const ping = await safeSendTabMessage(tabId, {type: "PING_KIROKU"});
    if (ping?.ok) return;
    const ping2 = await safeSendTabMessage(tabId, {type: "PING_ANKI_MINER"});
    if (ping2?.ok) return;
  } catch (_) {}

  try {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: [
        "content/capture-utils.js",
        "content/hud/hud-popup.js",
        "content/toast.js",
        "content/content.js"
      ]
    });
  } catch (_) {}
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

  // Strict host allowlist and SSRF private IP blocking:
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
            safeSendTabMessage(tab.id, { type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled });
          }
        }

        const tab = await activeTab().catch(() => null);
        if (tab?.id) {
          await ensureContentScript(tab.id);
          await safeSendTabMessage(tab.id, { type: "MINING_MODE_CHANGED", enabled: isMiningModeEnabled });
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
    safeFetch(message.url, {}, 2500)
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

  if (
    message?.type === "LOAD_SUBTITLE_CUES" ||
    message?.type === "CLEAR_SUBTITLES" ||
    message?.type === "SET_SUBTITLE_OFFSET" ||
    message?.type === "SET_SUBTITLE_SIZE" ||
    message?.type === "SET_SUBTITLE_OPACITY" ||
    message?.type === "SET_FURIGANA_MODE" ||
    message?.type === "SET_SUBTITLES_DISPLAY" ||
    message?.type === "SET_SUBTITLE_POSITION" ||
    message?.type === "RESET_SUBTITLE_POSITION" ||
    message?.type === "SELECT_YOUTUBE_TRACK" ||
    message?.type === "UPDATE_ANNOTATED_CUES"
  ) {
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
        } else if (message?.type === "SET_SUBTITLE_SIZE" && message.size) {
          await chrome.storage.local.set({ active_sub_size: message.size }).catch(() => {});
        } else if (message?.type === "SET_SUBTITLE_OPACITY" && message.opacity !== undefined) {
          await chrome.storage.local.set({ subtitle_opacity: message.opacity }).catch(() => {});
        } else if (message?.type === "SET_FURIGANA_MODE" && message.mode) {
          await chrome.storage.local.set({ "kiroku.anime.prefs.furigana": message.mode }).catch(() => {});
        } else if (message?.type === "SET_SUBTITLES_DISPLAY" && typeof message.enabled === "boolean") {
          await chrome.storage.local.set({ subtitles_display_enabled: message.enabled }).catch(() => {});
        } else if (message?.type === "SET_SUBTITLE_POSITION" && message.position) {
          await chrome.storage.local.set({ subtitle_overlay_position: message.position }).catch(() => {});
        } else if (message?.type === "RESET_SUBTITLE_POSITION") {
          await chrome.storage.local.remove("subtitle_overlay_position").catch(() => {});
        }
        const tab = await activeTab();
        if (tab?.id) {
          await ensureVideoMiningScript(tab.id);
          await safeSendTabMessage(tab.id, message);
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
        let res = await safeSendTabMessage(tab.id, { type: "START_OCR_SELECTION" });
        if (!res) {
          await ensureOcrContentScript(tab.id);
          res = await safeSendTabMessage(tab.id, { type: "START_OCR_SELECTION" });
        }
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
          body: JSON.stringify({ image: croppedDataUrl }),
          signal: AbortSignal.timeout(5000)
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
          safeSendTabMessage(sender.tab.id, {
            type: "OCR_RECOGNITION_COMPLETE",
            text: recognizedText,
            rect: message.rect,
            croppedImage: croppedDataUrl
          });
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
  if (message?.type === "ANNOTATE_SUBTITLES_BATCH") {
    (async () => {
      try {
        const cues = Array.isArray(message.cues) ? message.cues.slice(0, 100) : [];
        if (cues.length === 0) {
          sendResponse({ ok: true, cues: [] });
          return;
        }
        const payload = { cues };
        let learnerLevel = message.learnerLevel || null;
        if (!learnerLevel) {
          try {
            const lvlRes = await chrome.storage?.local?.get?.(["learner_jlpt_level", "learner.jlptLevel"]);
            learnerLevel = lvlRes?.learner_jlpt_level || lvlRes?.["learner.jlptLevel"] || null;
          } catch (_) {}
        }
        if (learnerLevel) payload.learner_level = learnerLevel;

        // 1. Try local backend /api/subtitle/annotate
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/subtitle/annotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(2500)
          });
          if (resp.ok) {
            const data = await resp.json();
            sendResponse({ ok: true, cues: data?.cues || [], source: "local" });
            return;
          }
        } catch (_) {}

        // 2. Fallback to Cloud Edge /api/subtitle/annotate
        const token = await getStoredCloudToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const cloudResp = await fetch(`${CLOUD_WORKER_URL}/api/subtitle/annotate`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(25000)
        });
        if (cloudResp.ok) {
          const data = await cloudResp.json();
          sendResponse({ ok: true, cues: data?.cues || [], source: "cloud" });
          return;
        }
        sendResponse({ ok: false, error: `HTTP ${cloudResp.status}` });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Batch annotation failed" });
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
        let learnerLevel = null;
        try {
          const lvlRes = await chrome.storage?.local?.get?.(["learner_jlpt_level", "learner.jlptLevel"]);
          learnerLevel = lvlRes?.learner_jlpt_level || lvlRes?.["learner.jlptLevel"] || null;
        } catch (_) {}
        const reqPayload = {
          cues: [{ start_ms: 0, end_ms: 1000, text }]
        };
        if (learnerLevel) reqPayload.learner_level = learnerLevel;

        // 1. Try local backend /api/subtitle/annotate
        try {
          const resp = await fetch("http://127.0.0.1:21828/api/subtitle/annotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqPayload),
            signal: AbortSignal.timeout(1500)
          });
          if (resp.ok) {
            const data = await resp.json();
            const tokens = data?.cues?.[0]?.tokens || [];
            sendResponse({ ok: true, tokens });
            return;
          }
        } catch (_) {}

        // 2. Try Cloud Edge /api/subtitle/annotate (returns properly merged tokens + JLPT/readings)
        try {
          const token = await getStoredCloudToken();
          const headers = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;
          const cloudAnnotateResp = await fetch(`${CLOUD_WORKER_URL}/api/subtitle/annotate`, {
            method: "POST",
            headers,
            body: JSON.stringify(reqPayload),
            signal: AbortSignal.timeout(15000)
          });
          if (cloudAnnotateResp.ok) {
            const data = await cloudAnnotateResp.json();
            const tokens = data?.cues?.[0]?.tokens || [];
            if (tokens.length > 0) {
              sendResponse({ ok: true, tokens });
              return;
            }
          }
        } catch (_) {}

        // 3. Fallback to local /api/tokenize
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
              pos: Array.isArray(t.part_of_speech) ? t.part_of_speech[0] : "",
              status: "unstyled"
            }));
            sendResponse({ ok: true, tokens });
            return;
          }
        } catch (_) {}

        // 4. Fallback to Cloud Edge /api/tokenize
        try {
          const cloudResp = await fetch(`${CLOUD_WORKER_URL}/api/tokenize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, mode: "C" }),
            signal: AbortSignal.timeout(8000)
          });
          if (cloudResp.ok) {
            const tokData = await cloudResp.json();
            const tokens = (tokData?.tokens || []).map(t => ({
              surface: t.surface,
              lemma: t.dictionary_form || t.normalized || t.surface,
              reading: t.reading || "",
              pos: Array.isArray(t.part_of_speech) ? t.part_of_speech[0] : "",
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
        const targetDeck = (grammar.deck_name && grammar.deck_name.trim()) || (await getExtensionUniversalDeck());
        if (!targetDeck) {
          sendResponse({ ok: false, error: "No universal Anki deck selected in Settings." });
          return;
        }
        const payload = {
          expression: grammar.pattern || "Grammar",
          reading: grammar.level || "",
          meaning: grammar.meaning || "",
          example_sentence: grammar.sentence || "",
          deck_name: targetDeck,
          source_type: "grammar"
        };
        try {
          const resp = await safeFetch("http://127.0.0.1:21828/api/cards/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }, 2500);
          if (resp.ok) {
            const data = await resp.json();
            const token = await getStoredCloudToken();
            if (token) {
              fetch(`${CLOUD_WORKER_URL}/sync/push`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ops: [payload] }),
                signal: AbortSignal.timeout(5000)
              }).catch(() => {});
            }
            sendResponse({ ok: true, data, card_id: data.card_id || data.id });
            return;
          }
        } catch (_) {}
        const token = await getStoredCloudToken();
        if (token) {
          const cloudResp = await safeFetch(`${CLOUD_WORKER_URL}/sync/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ops: [payload] })
          }, 5000).catch(() => null);
          if (cloudResp && cloudResp.ok) {
            sendResponse({ ok: true, data: { status: "cloud_synced" } });
            return;
          }
        }
        await queueCardLocally(payload);
        sendResponse({ ok: true, queued: true });
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
        await safeFetch(`http://127.0.0.1:21828/api/cards/${cardId}`, {
          method: "DELETE"
        }, 2500);
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
        const resp = await safeFetch("http://127.0.0.1:21828/api/word-states/set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expression: word, state: status || "learning" })
        }, 2500);
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
            body: JSON.stringify({ text, auto_save: false }),
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
            body: JSON.stringify({ text, auto_save: false }),
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
        const targetDeck = (card.deck_name && card.deck_name.trim()) || (await getExtensionUniversalDeck());
        if (!targetDeck) {
          sendResponse({ ok: false, error: "No universal Anki deck selected in Settings." });
          return;
        }
        const payload = {
          id: card.id || ("mine_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)),
          expression: card.expression,
          reading: card.reading || "",
          meaning: card.meaning || "",
          deck_name: targetDeck,
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
            if (data.card_id || data.id) payload.id = data.card_id || data.id;
            const token = await getStoredCloudToken();
            if (token) {
              try {
                const cResp = await fetch(`${CLOUD_WORKER_URL}/sync/push`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                  },
                  body: JSON.stringify({ ops: [payload] }),
                  signal: AbortSignal.timeout(5000)
                });
                if (!cResp.ok) {
                  await queueCardLocally(payload);
                }
              } catch (_) {
                await queueCardLocally(payload);
              }
            }
            sendResponse({ ok: true, data, card_id: payload.id, sync_destination: "local" });
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
            if (cloudResp.status === 409) {
              try {
                const deadData = await chrome.storage.local.get("kiroku_dead_letter_cards");
                const deadList = Array.isArray(deadData?.kiroku_dead_letter_cards) ? deadData.kiroku_dead_letter_cards : [];
                deadList.push({ payload, error: "409 Conflict: payload mismatch", failedAt: Date.now() });
                await chrome.storage.local.set({ kiroku_dead_letter_cards: deadList.slice(-50) });
              } catch (_) {}
              sendResponse({ ok: false, conflict: true, error: "409 Conflict: payload mismatch (moved to dead letter queue)", sync_destination: "dead_letter" });
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
        const token = await getStoredCloudToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = "http://127.0.0.1:21828/api/link/sessions";
        let res = null;
        let fromCloud = false;
        try {
          res = await safeFetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          }, 1500);
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            res = await safeFetch(`${CLOUD_WORKER_URL}/api/link/sessions`, {
              method: "POST",
              headers,
              body: JSON.stringify(payload)
            }, 5000);
            if (res && res.ok) fromCloud = true;
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          if (token && !fromCloud && !data.cloud_synced) {
            await queueAnimeOutboxLocally({ type: "session", payload });
          }
          sendResponse({ ok: true, data });
          drainAnimeOutbox().catch(() => {});
          return;
        }
        const queued = await queueAnimeOutboxLocally({ type: "session", payload });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue session offline." });
      } catch (err) {
        const queued = await queueAnimeOutboxLocally({ type: "session", payload: message.payload || {} });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue session offline." });
      }
    })();
    return true;
  }
  if (message?.type === "SEEK_TO") {
    (async () => {
      try {
        const tab = await activeTab();
        if (tab?.id) {
          await safeSendTabMessage(tab.id, message);
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
        const token = await getStoredCloudToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `http://127.0.0.1:21828/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
        let res = null;
        let fromCloud = false;
        try {
          res = await safeFetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(message.payload || {})
          }, 1500);
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            res = await safeFetch(`${CLOUD_WORKER_URL}/api/link/episodes/${encodeURIComponent(cueHash)}/position`, {
              method: "POST",
              headers,
              body: JSON.stringify(message.payload || {})
            }, 5000);
            if (res && res.ok) fromCloud = true;
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          if (token && !fromCloud && !data.cloud_synced) {
            await queueAnimeOutboxLocally({ type: "position", cueHash, payload: message.payload || {} });
          }
          sendResponse({ ok: true, data });
          drainAnimeOutbox().catch(() => {});
          return;
        }
        const queued = await queueAnimeOutboxLocally({ type: "position", cueHash, payload: message.payload || {} });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue position offline." });
      } catch (err) {
        const queued = await queueAnimeOutboxLocally({ type: "position", cueHash: message.cueHash, payload: message.payload || {} });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue position offline." });
      }
    })();
    return true;
  }
  if (message?.type === "EPISODE_SYNC_SUBTITLES") {
    (async () => {
      try {
        const token = await getStoredCloudToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = "http://127.0.0.1:21828/api/link/episodes/sync";
        let res = null;
        let fromCloud = false;
        try {
          res = await safeFetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(message.payload || {})
          }, 2500);
        } catch (_) {}

        if (!res || !res.ok) {
          try {
            res = await safeFetch(`${CLOUD_WORKER_URL}/api/link/episodes/sync`, {
              method: "POST",
              headers,
              body: JSON.stringify(message.payload || {})
            }, 8000);
            if (res && res.ok) fromCloud = true;
          } catch (_) {}
        }

        if (res && res.ok) {
          const data = await res.json();
          if (token && !fromCloud && !data.cloud_synced) {
            await queueAnimeOutboxLocally({ type: "subtitles", payload: message.payload || {} });
            sendResponse({ ok: true, queued: true, message: "Saved locally. Queued for cloud sync." });
            return;
          }
          sendResponse({ ok: true, data });
          drainAnimeOutbox().catch(() => {});
          return;
        }
        const queued = await queueAnimeOutboxLocally({ type: "subtitles", payload: message.payload || {} });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue subtitles offline." });
      } catch (err) {
        const queued = await queueAnimeOutboxLocally({ type: "subtitles", payload: message.payload || {} });
        sendResponse({ ok: queued, queued, message: queued ? "Saved offline. Will sync when online." : "Failed to queue subtitles offline." });
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
        const token = await getStoredCloudToken();
        const headers = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `http://127.0.0.1:21828/api/link/episodes/${encodeURIComponent(cueHash)}`;
        let res = await safeFetch(url, { headers }, 2000).catch(() => null);
        if ((!res || !res.ok) && token) {
          res = await safeFetch(`${CLOUD_WORKER_URL}/api/link/episodes/${encodeURIComponent(cueHash)}`, { headers }, 4000).catch(() => null);
        }
        if (!res || !res.ok) {
          sendResponse({ ok: false, error: res ? `HTTP ${res.status}` : "Kiroku backend offline" });
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
        const res = await safeFetch("http://127.0.0.1:21828/api/health", {}, 1500).catch(() => null);
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
        const state = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "st_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({ "kiroku_oauth_state": state });
        }
        if (typeof chrome !== "undefined" && chrome.identity && chrome.identity.launchWebAuthFlow) {
          const redirectUrl = chrome.identity.getRedirectURL("auth");
          const authUrl = `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
          chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
            if (chrome.runtime.lastError || !responseUrl) {
              const fallbackRedirect = chrome.runtime.getURL("auth.html");
              chrome.tabs.create({ url: `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(fallbackRedirect)}&state=${encodeURIComponent(state)}` });
              sendResponse({ ok: true, fallback: true });
              return;
            }
            try {
              const u = new URL(responseUrl);
              const code = u.searchParams.get("code");
              if (code) {
                const exRes = await fetch(`${CLOUD_WORKER_URL}/auth/exchange`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code, state })
                });
                const exData = await exRes.json();
                if (exData && exData.token) {
                  await chrome.storage.local.set({
                    kiroku_auth_token: exData.token,
                    "kiroku.cloud.auth_token": exData.token,
                    kiroku_cloud_token: exData.token,
                    "kiroku.extension.session_token": exData.token,
                    "kiroku.extension.auth_token": exData.token,
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
        const authUrl = `${CLOUD_WORKER_URL}/auth/${provider}?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(state)}`;
        chrome.tabs.create({ url: authUrl });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }
  if (message?.type === "CLOUD_AUTH_CAPTURED" && message.token) {
    (async () => {
      try {
        await chrome.storage.local.set({
          kiroku_auth_token: message.token,
          "kiroku.cloud.auth_token": message.token,
          kiroku_cloud_token: message.token,
          "kiroku.extension.session_token": message.token,
          "kiroku.extension.auth_token": message.token,
          kiroku_auth_session: message.user || { email: "Learner" }
        });
        chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: true, user: message.user }).catch(() => {});
        sendResponse({ ok: true, stored: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message });
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
  if (message?.type === "VALIDATE_CLOUD_AUTH") {
    (async () => {
      try {
        const token = await getStoredCloudToken();
        if (!token) {
          sendResponse({ ok: true, authenticated: false, user: null });
          return;
        }
        const res = await fetch(`${CLOUD_WORKER_URL}/auth/me`, {
          headers: { "Authorization": `Bearer ${token}` }
        }).catch(() => null);

        if (!res || !res.ok) {
          if (res && (res.status === 401 || res.status === 403)) {
            await chrome.storage?.local?.remove([
              "kiroku_auth_token",
              "kiroku.cloud.auth_token",
              "kiroku_cloud_token",
              "kiroku.extension.session_token",
              "kiroku.extension.auth_token",
              "kiroku_auth_session"
            ]);
            chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: false, user: null }).catch(() => {});
            sendResponse({ ok: true, authenticated: false, user: null, reason: "expired" });
            return;
          }
          const stored = await chrome.storage?.local?.get(["kiroku_auth_session"]);
          sendResponse({ ok: true, authenticated: true, user: stored?.kiroku_auth_session || null, token, offline: true });
          return;
        }

        const data = await res.json();
        const user = data.user || null;
        if (user) {
          await chrome.storage?.local?.set({ "kiroku_auth_session": user });
        }
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
        const res = await safeFetch(url, {}, 1500);
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

  if (message?.target === "background") {
    sendResponse({ ok: false, error: "UNKNOWN_BACKGROUND_MESSAGE", type: message?.type });
    return true;
  }
});

chrome.tabs.onActivated?.addListener?.(activeInfo => {
  if (isMiningModeEnabled && activeInfo?.tabId) {
    ensureContentScript(activeInfo.tabId).then(() => {
      safeSendTabMessage(activeInfo.tabId, {type: "MINING_MODE_CHANGED", enabled: true});
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
        safeSendTabMessage(tabId, {type: "MINING_MODE_CHANGED", enabled: true});
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
      drainAnimeOutbox().catch(() => {});
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
                safeSendTabMessage(tab.id, { type: "SESSION_HEARTBEAT_ALARM" });
              }
            }
          }).catch(() => {});
        }
        if (alarm.name === "kiroku_sync_drain") {
          drainPendingCardsQueue().catch(() => {});
          drainAnimeOutbox().catch(() => {});
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

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if ((message?.type === "KIROKU_AUTH_SUCCESS" || message?.type === "AUTH_TOKEN") && message.token) {
      (async () => {
        try {
          await chrome.storage.local.set({
            kiroku_auth_token: message.token,
            "kiroku.cloud.auth_token": message.token,
            kiroku_cloud_token: message.token,
            "kiroku.extension.session_token": message.token,
            "kiroku.extension.auth_token": message.token,
            kiroku_auth_session: message.user || { email: "Learner" }
          });
          chrome.runtime?.sendMessage?.({ type: "CLOUD_AUTH_CHANGED", authenticated: true, user: message.user }).catch(() => {});
          sendResponse({ ok: true, stored: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message });
        }
      })();
      return true;
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
    queueAnimeOutboxLocally,
    drainAnimeOutbox,
  };
}
