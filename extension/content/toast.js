/**
 * Kiroku Note - Tactile Floating Notification Toast
 * Renders brief, non-intrusive card mining confirmations with Undo action.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.KirokuToast = exports;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let hostEl = null;
  let shadowRoot = null;
  let toastEl = null;
  let dismissTimer = null;

  function ensureToastContainer() {
    if (typeof document === "undefined") return;
    if (hostEl && document.body?.contains(hostEl)) return;

    hostEl = document.createElement("div");
    hostEl.id = "kiroku-toast-host";
    hostEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      pointer-events: none;
    `;

    try {
      shadowRoot = hostEl.attachShadow({ mode: "open" });
    } catch (_) {
      shadowRoot = hostEl;
    }

    const style = document.createElement("style");
    style.textContent = `
      .toast-wrapper {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 9px 16px;
        background: rgba(24, 24, 27, 0.96);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 3px 3px 0 rgba(0, 0, 0, 0.7);
        color: #F4F4F5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        opacity: 0;
        transform: translateY(12px) scale(0.96);
        transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .toast-wrapper.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .toast-icon {
        width: 16px;
        height: 16px;
        color: #4EBB7B;
        flex-shrink: 0;
      }

      .toast-content {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }

      .toast-term {
        font-weight: 700;
        color: #F4F4F5;
        font-family: "Zen Kaku Gothic New", "Noto Sans JP", sans-serif;
      }

      .toast-reading {
        font-size: 11px;
        color: #A1A1AA;
      }

      .toast-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 5px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: #27272A;
        color: #F4F4F5;
        box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.6);
        cursor: pointer;
        transition: transform 140ms ease, box-shadow 140ms ease;
        user-select: none;
      }

      .toast-btn:hover {
        transform: translate(-1px, -1px);
        box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
        background: #3F3F46;
      }

      .toast-btn:active {
        transform: translate(1px, 1px);
        box-shadow: 0 0 0 transparent;
      }

      .toast-undo {
        color: #F39120;
      }
    `;

    shadowRoot.appendChild(style);

    toastEl = document.createElement("div");
    toastEl.className = "toast-wrapper";
    shadowRoot.appendChild(toastEl);

    document.body.appendChild(hostEl);
  }

  function show({ term, reading = "", message = "", cardId = null, onUndo = null, duration = 3500 }) {
    ensureToastContainer();
    if (!toastEl) return;

    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    const checkSvg = `
      <svg class="toast-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 8.5 6.5 12 13 4"></polyline>
      </svg>
    `;

    let html = checkSvg;
    html += `<div class="toast-content">`;
    if (term) {
      html += `<span class="toast-term">${escapeHtml(term)}</span>`;
      if (reading && reading !== term) {
        html += `<span class="toast-reading">(${escapeHtml(reading)})</span>`;
      }
    }
    if (message) {
      html += `<span>${escapeHtml(message)}</span>`;
    }
    html += `</div>`;

    if (cardId || typeof onUndo === "function") {
      html += `<button type="button" class="toast-btn toast-undo">Undo</button>`;
    }

    toastEl.innerHTML = html;

    const undoBtn = toastEl.querySelector(".toast-undo");
    if (undoBtn) {
      undoBtn.addEventListener("click", async () => {
        hide();
        if (typeof onUndo === "function") {
          onUndo();
        } else if (cardId && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: "DELETE_CARD", cardId }).catch(() => {});
        }
      });
    }

    requestAnimationFrame(() => {
      toastEl?.classList.add("is-visible");
    });

    dismissTimer = setTimeout(() => {
      hide();
    }, duration);
  }

  function hide() {
    if (!toastEl) return;
    toastEl.classList.remove("is-visible");
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return {
    show,
    hide
  };
});

