(() => {
  if (window.__KIROKU_CONTENT_SCRIPT_INITIALIZED__) {
    return;
  }
  window.__KIROKU_CONTENT_SCRIPT_INITIALIZED__ = true;

  let miningMode = false;

  chrome.runtime.sendMessage({type: "GET_MINING_MODE"}).then(res => {
    if (res?.enabled) miningMode = true;
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "PING_KIROKU" || message?.type === "PING_ANKI_MINER") respond({ok: true});
    if (message?.type === "MINING_MODE_CHANGED") {
      miningMode = Boolean(message.enabled);
      respond({ok: true});
    }
  });

  function getCaptureUtils() {
    return typeof KirokuCapture !== "undefined" ? KirokuCapture : AnkiMinerCapture;
  }

  function selectedSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return value.split(/[。！？!?]/u)[0].trim() || value;
  }

  function dispatchGrammarSelection() {
    const captureUtils = getCaptureUtils();
    const text = captureUtils.selectedText(window.getSelection());
    if (!text || !captureUtils.containsJapanese(text)) return;
    chrome.runtime.sendMessage({
      type: "ANALYZE_GRAMMAR_SELECTION",
      sentence: selectedSentence(text),
      selection: text
    }).catch(() => {});
  }

  async function captureSelection() {
    const captureUtils = getCaptureUtils();
    const text = captureUtils.selectedText(window.getSelection());
    if (!text) return;
    if (!miningMode) {
      try {
        const res = await chrome.runtime.sendMessage({type: "GET_MINING_MODE"});
        if (res?.enabled) miningMode = true;
      } catch {}
    }
    if (!miningMode) return;
    if (!captureUtils.containsJapanese(text)) {
      chrome.runtime.sendMessage({
        type: "CAPTURE_DIAGNOSTIC",
        stage: "selection",
        error: "Selected text contains no Japanese characters."
      }).catch(() => {});
      return;
    }
    chrome.runtime.sendMessage(captureUtils.captureMessage(text)).then(result => {
      if (result && result.ok === false) {
        chrome.runtime.sendMessage({
          type: "CAPTURE_DIAGNOSTIC",
          stage: result.stage || "messaging",
          error: result.error || "Capture message failed."
        }).catch(() => {});
      }
    }).catch(error => {
      chrome.runtime.sendMessage({
        type: "CAPTURE_DIAGNOSTIC",
        stage: "messaging",
        error: error.message
      }).catch(() => {});
    });
  }

  document.addEventListener("mouseup", () => { captureSelection(); }, true);
  document.addEventListener("keyup", event => {
    if (event.key === "Shift" || event.key.startsWith("Arrow")) captureSelection();
  }, true);

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key.toLowerCase() === "o" || event.code === "KeyO")) {
        const activeEl = document.activeElement;
        const isEditable = activeEl && (
          activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable
        );
        if (!isEditable) {
          event.preventDefault();
          chrome.runtime.sendMessage({ type: "START_OCR_CAPTURE" }).catch(() => {});
        }
      }
      if (event.altKey && (event.key.toLowerCase() === "g" || event.code === "KeyG")) {
        const activeEl = document.activeElement;
        const isEditable = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);
        if (!isEditable) {
          event.preventDefault();
          dispatchGrammarSelection();
        }
      }
    }, true);
  }

  // Lightweight Video Detection (Slice A3)
  function initVideoDetector() {
    const detectedVideos = typeof WeakSet !== "undefined" ? new WeakSet() : new Set();
    let pollInterval = null;
    let pollCount = 0;

    function walkElements(root, tag, fn) {
      if (!root) return;
      if (root.querySelectorAll) {
        root.querySelectorAll(tag).forEach(fn);
      }
      if (root.querySelectorAll) {
        root.querySelectorAll("*").forEach((el) => {
          if (el.shadowRoot) {
            walkElements(el.shadowRoot, tag, fn);
          }
        });
      }
    }

    function checkAndNotify(video) {
      if (!video) return;
      if (detectedVideos.has(video)) return;
      detectedVideos.add(video);

      try {
        chrome.runtime.sendMessage({ type: "VIDEO_DETECTED" }).catch(() => {});
      } catch (_) {}
    }

    function scanAll() {
      walkElements(document, "video", checkAndNotify);
    }

    // 1. Initial scan
    scanAll();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanAll, { once: true });
    }

    // 2. MutationObserver never disconnects; watches additions and open shadow roots
    if (typeof MutationObserver !== "undefined") {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of (m.addedNodes || [])) {
            if (n && n.nodeType === 1) {
              if ((n.tagName || "").toLowerCase() === "video") {
                checkAndNotify(n);
              } else {
                walkElements(n, "video", checkAndNotify);
              }
            }
          }
        }
      });
      const target = document.body || document.documentElement;
      if (target) {
        obs.observe(target, { childList: true, subtree: true });
      }
    }

    // 3. Capture video playback lifecycle events
    document.addEventListener("play", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);
    document.addEventListener("playing", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);
    document.addEventListener("loadeddata", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);

    // 4. Poll 1s for 30s to catch late loads or shadow DOM attachment
    pollInterval = setInterval(() => {
      pollCount++;
      scanAll();
      if (pollCount >= 30 && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }, 1000);
  }

  try {
    initVideoDetector();
  } catch (_) {}
})();
