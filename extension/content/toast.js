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
        padding: 10px 14px;
        background-color: #1C1B19;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
        background-size: 20px 20px;
        border: 2.5px solid #000000;
        outline: 1px solid #32302C;
        outline-offset: -3.5px;
        border-radius: 2px;
        box-shadow: 5px 5px 0 #000000;
        color: #F0ECE3;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12.5px;
        font-weight: 700;
        opacity: 0;
        transform: translateY(12px);
        transition: opacity 160ms ease, transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .toast-wrapper.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .toast-icon {
        width: 18px;
        height: 18px;
        padding: 2px;
        background: #4EBB7B;
        color: #0B0A09;
        border: 1.5px solid #000000;
        flex-shrink: 0;
      }

      .toast-content {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }

      .toast-term {
        font-weight: 900;
        color: #D94B38;
        font-family: "Zen Kaku Gothic New", "Noto Sans JP", sans-serif;
      }

      .toast-reading {
        font-size: 11px;
        font-weight: 700;
        color: #C9C3B8;
      }

      .toast-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        border-radius: 2px;
        border: 2px solid #000000;
        background: #262522;
        color: #F0ECE3;
        box-shadow: 3px 3px 0 #000000;
        cursor: pointer;
        transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, color 140ms ease, border-color 140ms ease;
        user-select: none;
      }

      .toast-btn:hover {
        transform: translate(-2px, -2px);
        box-shadow: 5px 5px 0 #000000;
        background: #D94B38;
        color: #F0ECE3;
      }

      .toast-btn:active {
        transform: translate(2px, 2px);
        box-shadow: 1px 1px 0 #000000;
      }

      .toast-undo {
        color: #F0ECE3;
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

