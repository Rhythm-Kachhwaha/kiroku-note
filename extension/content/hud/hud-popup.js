/**
 * Kiroku Note - HUD Word Popup & Mine Action
 *
 * Responsibilities:
 * - Word popup displayed above/below subtitle token
 * - Word, reading, meaning, JLPT level, vocab status
 * - Quick Mine button triggering HUD_MINE
 * - LRU lookup cache
 * - Recomputes placement on resize/fullscreen
 * - Closes on Esc / outside click / cue change
 * - Stops event propagation to prevent video play/pause toggle
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HudPopup = exports.HudPopup;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class SimpleLRU {
    constructor(limit = 200) {
      this.limit = limit;
      this.map = new Map();
    }
    get(key) {
      if (!this.map.has(key)) return null;
      const val = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, val);
      return val;
    }
    set(key, val) {
      if (this.map.has(key)) this.map.delete(key);
      else if (this.map.size >= this.limit) {
        const first = this.map.keys().next().value;
        this.map.delete(first);
      }
      this.map.set(key, val);
    }
  }

  const lookupCache = new SimpleLRU(200);

  class HudPopup {
    constructor(hudHost) {
      this.hudHost = hudHost;
      this.popupEl = null;
      this.currentTargetToken = null;
      this.currentTargetSpan = null;
      this.activeCue = null;
      this.isOpen = false;
      this.isMining = false;
      this._boundDocKeyDown = this._onDocKeyDown.bind(this);
      this._boundDocClick = this._onDocClick.bind(this);
      this._boundReposition = this.reposition.bind(this);

      this.init();
    }

    init() {
      if (typeof document === "undefined") return;

      this.popupEl = document.createElement("div");
      this.popupEl.className = "kiroku-hud-popup";
      this.popupEl.style.cssText = `
        position: absolute;
        display: none;
        flex-direction: column;
        gap: 8px;
        min-width: 220px;
        max-width: 320px;
        padding: 12px 14px;
        background: rgba(24, 24, 27, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        pointer-events: auto;
        box-sizing: border-box;
      `;

      // Stop propagation of clicks/pointer events inside popup so video player never receives toggles
      const stopEvent = (e) => {
        if (e && typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      };
      this.popupEl.addEventListener("pointerdown", stopEvent);
      this.popupEl.addEventListener("mousedown", stopEvent);
      this.popupEl.addEventListener("click", stopEvent);
      this.popupEl.addEventListener("dblclick", stopEvent);

      if (this.hudHost?.contentContainer) {
        this.hudHost.contentContainer.appendChild(this.popupEl);
      }

      document.addEventListener("keydown", this._boundDocKeyDown, true);
      document.addEventListener("pointerdown", this._boundDocClick, true);
      window.addEventListener("resize", this._boundReposition);

      if (this.hudHost) {
        this.hudHost.registerCleanup(() => this.destroy());
      }
    }

    _onDocKeyDown(e) {
      if (!this.isOpen) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    }

    _onDocClick(e) {
      if (!this.isOpen || !this.popupEl) return;
      if (this.currentTargetSpan && this.currentTargetSpan.contains(e.target)) return;
      if (this.popupEl.contains(e.target)) return;
      this.close();
    }

    async showForToken(token, targetSpan, cue = null) {
      if (!token || !targetSpan) return;
      this.currentTargetToken = token;
      this.currentTargetSpan = targetSpan;
      this.activeCue = cue;
      this.isOpen = true;

      const surface = token.surface || token.text || "";
      const lemma = token.lemma || surface;
      const reading = token.reading || "";
      const status = token.status || "unstyled";

      this.popupEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <div style="font-size:16px; font-weight:700; color:#f4f4f5;">${escapeHtml(surface)}</div>
            ${reading && reading !== surface ? `<div style="font-size:12px; color:#a1a1aa;">${escapeHtml(reading)}</div>` : ""}
          </div>
          <span style="font-size:11px; padding:2px 6px; border-radius:4px; background:${status === "mined" ? "rgba(212,136,79,0.25)" : "rgba(255,255,255,0.1)"}; color:${status === "mined" ? "#d4884f" : "#a1a1aa"};">
            ${status === "mined" ? "Mined" : (token.jlpt_level || "JLPT")}
          </span>
        </div>
        <div class="hud-popup-meaning" style="font-size:12px; line-height:1.4; color:#d4d4d8; max-height:80px; overflow-y:auto;">
          Looking up…
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <button class="hud-popup-mine-btn" style="
            display:inline-flex; align-items:center; gap:6px;
            padding:5px 12px; background:#d4884f; color:#18181b;
            border:none; border-radius:6px; font-size:12px; font-weight:600;
            cursor:pointer;
          ">
            ${status === "mined" ? "Already Mined" : "Mine Word"}
          </button>
          <span class="hud-popup-status" style="font-size:11px; color:#a1a1aa;"></span>
        </div>
      `;

      this.popupEl.style.display = "flex";
      this.reposition();

      const mineBtn = this.popupEl.querySelector(".hud-popup-mine-btn");
      if (mineBtn) {
        if (status === "mined") {
          mineBtn.disabled = true;
          mineBtn.style.opacity = "0.7";
          mineBtn.style.cursor = "default";
        } else {
          mineBtn.addEventListener("click", () => this.mineCurrentWord());
        }
      }

      // Fetch lookup details via cache or runtime message
      const cacheKey = lemma || surface;
      const cached = lookupCache.get(cacheKey);
      if (cached) {
        this._renderMeaning(cached);
      } else {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            const resp = await chrome.runtime.sendMessage({
              type: "HUD_LOOKUP",
              text: lemma || surface
            });
            if (resp && resp.ok && resp.data) {
              lookupCache.set(cacheKey, resp.data);
              this._renderMeaning(resp.data);
            } else if (resp && resp.error) {
              this._renderMeaningError(resp.error);
            }
          }
        } catch (_) {
          this._renderMeaningError("Kiroku backend offline");
        }
      }
    }

    _renderMeaning(data) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      const gloss = data.glossary || data.meaning || (Array.isArray(data.entries) ? data.entries[0]?.glossary?.join?.("; ") : "") || "No definition found.";
      meaningEl.textContent = gloss;
      this.reposition();
    }

    _renderMeaningError(errText) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      meaningEl.innerHTML = `<span style="color:#f87171;">${escapeHtml(errText || "Lookup failed")}</span>`;
      this.reposition();
    }

    async mineCurrentWord() {
      if (!this.currentTargetToken || this.isMining) return;
      const mineBtn = this.popupEl?.querySelector(".hud-popup-mine-btn");
      const statusEl = this.popupEl?.querySelector(".hud-popup-status");
      if (mineBtn) {
        mineBtn.disabled = true;
        mineBtn.textContent = "Mining…";
      }
      this.isMining = true;

      const surface = this.currentTargetToken.surface || this.currentTargetToken.text || "";
      const lemma = this.currentTargetToken.lemma || surface;
      const reading = this.currentTargetToken.reading || "";
      const sentence = this.activeCue?.text || "";

      try {
        let resp = null;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          resp = await chrome.runtime.sendMessage({
            type: "HUD_MINE",
            card: {
              expression: lemma || surface,
              reading: reading,
              example_sentence: sentence,
              source_type: "video"
            }
          });
        }

        if (resp && resp.ok) {
          if (mineBtn) {
            mineBtn.textContent = "Mined!";
            mineBtn.style.background = "#22c55e";
          }
          if (statusEl) statusEl.textContent = "Saved";
          this.currentTargetToken.status = "mined";

          // Turn token span orange in place without cue re-render
          if (this.currentTargetSpan) {
            this.currentTargetSpan.classList.add("mined");
            this.currentTargetSpan.style.color = "#d4884f";
            this.currentTargetSpan.style.textDecoration = "underline";
            this.currentTargetSpan.style.textDecorationColor = "rgba(212, 136, 79, 0.45)";
          }
        } else {
          const errMsg = resp?.error || "Kiroku backend offline";
          if (mineBtn) {
            mineBtn.disabled = false;
            mineBtn.textContent = "Mine Word";
          }
          if (statusEl) {
            statusEl.textContent = errMsg;
            statusEl.style.color = "#f87171";
          }
        }
      } catch (err) {
        if (mineBtn) {
          mineBtn.disabled = false;
          mineBtn.textContent = "Mine Word";
        }
        if (statusEl) {
          statusEl.textContent = "Kiroku backend offline";
          statusEl.style.color = "#f87171";
        }
      } finally {
        this.isMining = false;
      }
    }

    reposition() {
      if (!this.isOpen || !this.popupEl || !this.currentTargetSpan) return;
      try {
        const targetRect = this.currentTargetSpan.getBoundingClientRect();
        const hostRect = this.hudHost?.hostEl
          ? this.hudHost.hostEl.getBoundingClientRect()
          : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

        const popupWidth = this.popupEl.offsetWidth || 240;
        const popupHeight = this.popupEl.offsetHeight || 130;

        let left = (targetRect.left - hostRect.left) + (targetRect.width / 2) - (popupWidth / 2);
        // Above token by default
        let top = (targetRect.top - hostRect.top) - popupHeight - 8;

        // Flip below if not enough room above
        if (top < 8) {
          top = (targetRect.bottom - hostRect.top) + 8;
        }

        // Clamp horizontally inside video container
        const maxLeft = Math.max(0, hostRect.width - popupWidth - 10);
        left = Math.max(10, Math.min(maxLeft, left));

        this.popupEl.style.left = `${Math.round(left)}px`;
        this.popupEl.style.top = `${Math.round(top)}px`;
      } catch (_) {}
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (this.popupEl) {
        this.popupEl.style.display = "none";
      }
      this.currentTargetToken = null;
      this.currentTargetSpan = null;
    }

    destroy() {
      this.close();
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", this._boundDocKeyDown, true);
        document.removeEventListener("pointerdown", this._boundDocClick, true);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", this._boundReposition);
      }
      if (this.popupEl && this.popupEl.parentElement) {
        this.popupEl.parentElement.removeChild(this.popupEl);
      }
      this.popupEl = null;
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

  return { HudPopup, lookupCache };
});
