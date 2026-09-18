/**
 * Kiroku Note - OCR Region Selection Overlay
 * 
 * Injects a lightweight fullscreen overlay allowing the user to drag a rectangle
 * over Japanese text on any webpage.
 */

(() => {
  // Prevent multiple injections/listeners
  if (typeof window !== "undefined" && window.__kirokuOcrSelectionLoaded) return;
  if (typeof window !== "undefined") {
    window.__kirokuOcrSelectionLoaded = true;
  }

  const OVERLAY_ID = "kiroku-ocr-overlay";
  const SELECTION_BOX_ID = "kiroku-ocr-selection";
  const BANNER_CLASS = "kiroku-ocr-banner";

  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let overlayElement = null;
  let selectionBox = null;

  function getCropper() {
    if (typeof window !== "undefined" && window.KirokuOcrCropper) {
      return window.KirokuOcrCropper;
    }
    if (typeof require !== "undefined") {
      try {
        return require("../lib/ocr-cropper.js");
      } catch (_) {}
    }
    return {
      normalizeSelectionRect: (sx, sy, cx, cy) => ({
        left: Math.min(sx, cx),
        top: Math.min(sy, cy),
        width: Math.abs(cx - sx),
        height: Math.abs(cy - sy),
      }),
      isValidSelection: (rect, minW = 10, minH = 10) =>
        rect && (Number(rect.width) || 0) >= minW && (Number(rect.height) || 0) >= minH,
    };
  }

  function mountOverlay() {
    // Only run in top window frame
    if (typeof window !== "undefined" && window.self !== window.top) return;

    removeOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.zIndex = "2147483647";
    overlay.style.cursor = "crosshair";
    overlay.style.userSelect = "none";
    overlay.style.webkitUserSelect = "none";
    overlay.style.background = "rgba(0, 0, 0, 0.45)";
    overlay.style.display = "block";
    overlay.style.margin = "0";
    overlay.style.padding = "0";
    overlay.style.boxSizing = "border-box";

    // Affordance instructions banner
    const banner = document.createElement("div");
    banner.className = BANNER_CLASS;
    banner.textContent = "Drag rectangle around Japanese text • Esc to cancel";
    banner.style.position = "fixed";
    banner.style.top = "20px";
    banner.style.left = "50%";
    banner.style.transform = "translateX(-50%)";
    banner.style.background = "#18181b";
    banner.style.color = "#f4f4f5";
    banner.style.fontFamily = "system-ui, -apple-system, sans-serif";
    banner.style.fontSize = "13px";
    banner.style.fontWeight = "500";
    banner.style.padding = "8px 16px";
    banner.style.borderRadius = "20px";
    banner.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)";
    banner.style.pointerEvents = "none";
    banner.style.zIndex = "2147483647";
    overlay.appendChild(banner);

    // Selection rectangle
    const box = document.createElement("div");
    box.id = SELECTION_BOX_ID;
    box.style.position = "fixed";
    box.style.display = "none";
    box.style.border = "2px solid #e8654a";
    box.style.background = "rgba(232, 101, 74, 0.12)";
    box.style.boxShadow = "0 0 8px rgba(232, 101, 74, 0.5)";
    box.style.pointerEvents = "none";
    box.style.boxSizing = "border-box";
    box.style.zIndex = "2147483647";
    overlay.appendChild(box);

    overlayElement = overlay;
    selectionBox = box;

    overlay.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);

    const container = document.body || document.documentElement;
    if (container) {
      container.appendChild(overlay);
    }
  }

  function removeOverlay() {
    isSelecting = false;
    if (overlayElement) {
      overlayElement.removeEventListener("mousedown", onMouseDown);
      overlayElement.remove();
      overlayElement = null;
    }
    selectionBox = null;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onMouseDown(e) {
    if (typeof e.button === "number" && e.button !== 0) return; // Left click only
    e.preventDefault?.();
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    if (selectionBox) {
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = "0px";
      selectionBox.style.height = "0px";
      selectionBox.style.display = "block";
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e) {
    if (!isSelecting || !selectionBox) return;
    e.preventDefault();

    const cropper = getCropper();
    const rect = cropper.normalizeSelectionRect(startX, startY, e.clientX, e.clientY);

    selectionBox.style.left = `${rect.left}px`;
    selectionBox.style.top = `${rect.top}px`;
    selectionBox.style.width = `${rect.width}px`;
    selectionBox.style.height = `${rect.height}px`;
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    e.preventDefault();
    isSelecting = false;

    const cropper = getCropper();
    const rect = cropper.normalizeSelectionRect(startX, startY, e.clientX, e.clientY);
    const valid = cropper.isValidSelection(rect, 10, 10);

    removeOverlay();

    if (!valid) {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "OCR_SELECTION_CANCELLED",
          reason: "too_small"
        });
      }
      return;
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "OCR_REGION_SELECTED",
        rect,
        viewport: {
          innerWidth: typeof window !== "undefined" ? window.innerWidth : 1200,
          innerHeight: typeof window !== "undefined" ? window.innerHeight : 800,
        },
        devicePixelRatio: typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1
      });
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      removeOverlay();
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "OCR_SELECTION_CANCELLED",
          reason: "escape"
        });
      }
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "START_OCR_SELECTION") {
        mountOverlay();
        sendResponse?.({ ok: true });
        return true;
      }
      if (message?.type === "CANCEL_OCR_SELECTION") {
        removeOverlay();
        sendResponse?.({ ok: true });
        return true;
      }
    });
  }

  const exportObj = {
    mountOverlay,
    removeOverlay,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportObj;
  }
})();
