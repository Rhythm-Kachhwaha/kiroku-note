(() => {
  if (window.__KIROKU_CONTENT_SCRIPT_INITIALIZED__) {
    return;
  }
  window.__KIROKU_CONTENT_SCRIPT_INITIALIZED__ = true;

  let miningMode = true; // In-page mining active by default
  let standalonePopup = null;
  let lastHoverScanTime = 0;
  let lastScannedText = "";

  // Query mining mode from background/storage
  chrome.runtime.sendMessage({ type: "GET_MINING_MODE" }).then((res) => {
    if (res && res.enabled !== undefined) miningMode = Boolean(res.enabled);
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "PING_KIROKU" || message?.type === "PING_ANKI_MINER") respond({ ok: true });
    if (message?.type === "MINING_MODE_CHANGED") {
      miningMode = Boolean(message.enabled);
      respond({ ok: true });
    }
    if (message?.type === "OCR_RECOGNITION_COMPLETE") {
      handleOcrRecognitionComplete(message);
      respond({ ok: true });
    }
  });

  function getPopup() {
    if (typeof window !== "undefined" && window.__kirokuVideoMiningPoc?.hudPopup) {
      return window.__kirokuVideoMiningPoc.hudPopup;
    }
    if (typeof window !== "undefined" && window.__kirokuUnifiedPopup) {
      return window.__kirokuUnifiedPopup;
    }
    if (!standalonePopup && typeof HudPopup !== "undefined") {
      standalonePopup = new HudPopup(null, null);
      if (typeof window !== "undefined") {
        window.__kirokuUnifiedPopup = standalonePopup;
      }
    }
    return standalonePopup;
  }

  function getCaptureUtils() {
    return typeof KirokuCapture !== "undefined" ? KirokuCapture : AnkiMinerCapture;
  }

  function selectedSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return value.split(/[。！？!?\n]/u)[0].trim() || value;
  }

  function isEditableElement(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable || el.closest?.("[contenteditable='true']");
  }

  // --- 1. Selection-based In-Page Trigger ---
  function captureSelection() {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    if (!text) return;

    const captureUtils = getCaptureUtils();
    if (!captureUtils.containsJapanese(text)) return;

    if (isEditableElement(document.activeElement)) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const popup = getPopup();
      if (popup && rect) {
        const sentence = selectedSentence(text);
        popup.showAtPoint(rect.left + rect.width / 2, rect.top, {
          surface: text,
          lemma: text,
          text: text
        }, sentence);
      }
    } catch (_) {}

    // Also inform background/sidepanel if listeners exist
    chrome.runtime.sendMessage(captureUtils.captureMessage(text)).catch(() => {});
  }

  // --- 2. Shift + Hover Word Scanner (Yomitan/Migaku Style) ---
  function handleShiftHoverScan(e) {
    if (!e.shiftKey) return;
    if (isEditableElement(e.target)) return;

    const now = Date.now();
    if (now - lastHoverScanTime < 120) return; // Throttled to ~8fps for fluid responsiveness
    lastHoverScanTime = now;

    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) return;

    const node = range.startContainer;
    const text = node.nodeValue || "";
    const offset = range.startOffset;

    const JAPANESE_CHAR = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    if (!JAPANESE_CHAR.test(text[offset] || "")) return;

    // Scan backwards and forwards to find token chunk
    let start = offset;
    while (start > 0 && JAPANESE_CHAR.test(text[start - 1])) {
      start--;
    }
    let end = offset;
    while (end < text.length && JAPANESE_CHAR.test(text[end])) {
      end++;
    }

    const tokenText = text.substring(start, Math.min(start + 8, end)).trim();
    if (!tokenText || tokenText === lastScannedText) return;
    lastScannedText = tokenText;

    const popup = getPopup();
    if (popup) {
      // Find sentence context around hovered node
      const parentSentence = selectedSentence(node.parentElement?.innerText || text);
      popup.showAtPoint(e.clientX, e.clientY - 10, {
        surface: tokenText,
        lemma: tokenText,
        text: tokenText
      }, parentSentence);
    }
  }

  // --- 3. OCR Recognition Result Display ---
  function handleOcrRecognitionComplete(message) {
    const text = (message.text || "").trim();
    if (!text) return;

    const rect = message.rect || { left: window.innerWidth / 2 - 100, top: 120, width: 200, height: 40 };
    const popup = getPopup();
    if (popup) {
      popup.showAtPoint(
        (rect.left || rect.x || 0) + (rect.width || 100) / 2,
        (rect.top || rect.y || 0) + (rect.height || 30),
        { surface: text, lemma: text, text: text },
        text
      );
    }
  }

  document.addEventListener("mouseup", (event) => {
    // If user clicked or selected inside video subtitle overlay or popup, let the overlay handler manage it
    if (typeof event.composedPath === "function") {
      const path = event.composedPath();
      const isVideoSubOrPopup = path.some((el) => {
        if (!el || typeof el.getAttribute !== "function") return false;
        const id = el.id || "";
        const cls = el.className || "";
        return id === "ankiminer-video-overlay-container" ||
               id === "ankiminer-video-subtitle-box" ||
               id === "ankiminer-video-subtitle" ||
               id === "kiroku-standalone-popup-host" ||
               (typeof cls === "string" && (cls.includes("kiroku-hud-popup") || cls.includes("ankiminer-video")));
      });
      if (isVideoSubOrPopup) return;
    }

    const popup = getPopup();
    if (popup && popup.hostEl && typeof event.composedPath === "function") {
      const path = event.composedPath();
      if (path.includes(popup.hostEl) || (popup.popupEl && path.includes(popup.popupEl))) {
        return;
      }
    }
    setTimeout(() => captureSelection(), 10);
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift" || event.key.startsWith("Arrow")) {
      captureSelection();
    }
  }, true);

  document.addEventListener("mousemove", handleShiftHoverScan, { passive: true });

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", (event) => {
      // Alt+O: Trigger OCR Selection Overlay
      if (event.altKey && (event.key.toLowerCase() === "o" || event.code === "KeyO")) {
        if (!isEditableElement(document.activeElement)) {
          event.preventDefault();
          chrome.runtime.sendMessage({ type: "START_OCR_CAPTURE" }).catch(() => {});
        }
      }
      // Alt+G: Grammar selection analysis
      if (event.altKey && (event.key.toLowerCase() === "g" || event.code === "KeyG")) {
        if (!isEditableElement(document.activeElement)) {
          event.preventDefault();
          const captureUtils = getCaptureUtils();
          const text = captureUtils.selectedText(window.getSelection());
          if (text) {
            const popup = getPopup();
            if (popup) {
              popup.showAtPoint(window.innerWidth / 2, 100, { surface: text, text }, selectedSentence(text));
              popup.switchTab("grammar");
            }
          }
        }
      }
    }, true);
  }

  // Lightweight Video Detection (O(1) tag lookup, debounced, zero full-DOM '*' walks)
  function initVideoDetector() {
    let notifiedThisFrame = false;
    let scanTimer = null;
    let obs = null;

    function notifyOnce() {
      if (notifiedThisFrame) return;
      notifiedThisFrame = true;
      if (obs) {
        try { obs.disconnect(); } catch (_) {}
        obs = null;
      }
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      try {
        chrome.runtime.sendMessage({ type: "VIDEO_DETECTED" }).catch(() => {});
      } catch (_) {}
    }

    function hasVisibleOrActiveVideo() {
      if (typeof document === "undefined") return false;
      const videos = document.getElementsByTagName ? document.getElementsByTagName("video") : [];
      if (videos && videos.length > 0) {
        return true;
      }
      return false;
    }

    function scanLightDom() {
      if (notifiedThisFrame) return;
      if (hasVisibleOrActiveVideo()) {
        notifyOnce();
      }
    }

    function scheduleScan() {
      if (notifiedThisFrame || scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scanLightDom();
      }, 250);
    }

    scanLightDom();

    if (!notifiedThisFrame && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanLightDom, { once: true });
    }

    if (!notifiedThisFrame && typeof MutationObserver !== "undefined") {
      obs = new MutationObserver((mutations) => {
        if (notifiedThisFrame) return;
        for (const m of mutations) {
          const added = m.addedNodes;
          if (!added || added.length === 0) continue;
          for (let i = 0; i < added.length; i++) {
            const n = added[i];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === "VIDEO" || (typeof n.getElementsByTagName === "function" && n.getElementsByTagName("video").length > 0)) {
              notifyOnce();
              return;
            }
          }
        }
      });
      const target = document.body || document.documentElement;
      if (target) {
        obs.observe(target, { childList: true, subtree: true });
      }
    }

    const onVideoEvent = (e) => {
      if (notifiedThisFrame) return;
      if (e.target && e.target.tagName === "VIDEO") {
        notifyOnce();
      }
    };
    document.addEventListener("play", onVideoEvent, true);
    document.addEventListener("playing", onVideoEvent, true);
    document.addEventListener("loadeddata", onVideoEvent, true);

    // One-time delayed fallback check for late-mounted players (no continuous interval)
    if (!notifiedThisFrame) {
      scheduleScan();
    }
  }

  try {
    initVideoDetector();
  } catch (_) {}
})();
