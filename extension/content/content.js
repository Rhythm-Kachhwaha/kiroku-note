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
    if (!standalonePopup && typeof HudPopup !== "undefined") {
      standalonePopup = new HudPopup(null, null);
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

  // Lightweight Video Detection
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

    scanAll();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanAll, { once: true });
    }

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

    document.addEventListener("play", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);
    document.addEventListener("playing", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);
    document.addEventListener("loadeddata", (e) => { if (e.target?.tagName?.toLowerCase() === "video") checkAndNotify(e.target); }, true);

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
