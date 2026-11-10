/**
 * Kiroku Note - HUD Shadow DOM Host & Video Attachment Manager
 *
 * Responsibilities:
 * - One shadow host per video element via WeakMap + window.__kirokuHud
 * - Positioned by ResizeObserver / IntersectionObserver
 * - Tracks largest visible video element
 * - Re-parents into document.fullscreenElement when entering fullscreen
 * - SPA MutationObserver to track DOM removals
 * - registerCleanup & full teardown on video removal / pagehide
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HudHost = exports.HudHost;
    root.getHudHostForVideo = exports.getHudHostForVideo;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const hudHosts = new WeakMap();

  class HudHost {
    constructor(video) {
      if (!video) throw new Error("HudHost requires a target video element.");
      this.video = video;
      this.hostEl = null;
      this.shadowRoot = null;
      this.contentContainer = null;
      this.cleanups = [];
      this.resizeObserver = null;
      this.intersectionObserver = null;
      this.mutationObserver = null;
      this.isVisible = true;

      this.adapter = null;
      this.cues = [];
      this.secondaryCues = [];
      this.offsetMs = 0;
      this.episodeKey = "";
      this.furiganaMode = "hover";
      this.dualSubsEnabled = false;
      this.dualSubsBlur = true;
      this.syncBadgeEl = null;
      this.secondaryCueEl = null;
      this.activeSecondaryCue = null;
      this._syncBadgeTimer = null;

      this._boundReposition = this.updatePosition.bind(this);
      this._boundFullscreenChange = this.handleFullscreenChange.bind(this);
      this._boundPageHide = this.destroy.bind(this);
      this._boundSpaNavigation = this.handleSpaNavigation.bind(this);
      this._boundKeyDown = this._handleKeyDown.bind(this);
      this._boundRuntimeMessage = this._handleRuntimeMessage.bind(this);

      this.init();
    }

    init() {
      if (typeof document === "undefined") return;

      this.hostEl = document.createElement("div");
      this.hostEl.className = "kiroku-hud-host";
      this.hostEl.style.position = "absolute";
      this.hostEl.style.top = "0";
      this.hostEl.style.left = "0";
      this.hostEl.style.width = "100%";
      this.hostEl.style.height = "100%";
      this.hostEl.style.pointerEvents = "none";
      this.hostEl.style.zIndex = "2147483640";

      try {
        this.shadowRoot = this.hostEl.attachShadow({ mode: "open" });
      } catch (_) {
        this.shadowRoot = this.hostEl; // fallback for non-shadow environments
      }

      const style = document.createElement("style");
      style.textContent = `
        :host {
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          user-select: none;
        }
        .hud-content-container {
          position: relative;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        /* Furigana Mode Styles */
        .hud-furigana-hover ruby rt {
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .hud-furigana-hover ruby:hover rt,
        .hud-furigana-hover ruby rt:hover {
          opacity: 1;
        }
        .hud-furigana-always ruby rt {
          opacity: 1;
        }
        .hud-furigana-hidden ruby rt {
          display: none !important;
        }
        /* Floating Sync Badge */
        .hud-sync-badge {
          position: absolute;
          top: 24px;
          right: 24px;
          background: rgba(24, 24, 27, 0.9);
          color: #f4f4f5;
          font-size: 13px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          pointer-events: none;
          opacity: 0;
          transform: translateY(-4px);
          transition: opacity 0.2s ease, transform 0.2s ease;
          z-index: 2147483647;
        }
        .hud-sync-badge.is-visible {
          opacity: 1;
          transform: translateY(0);
        }
        /* Secondary Subtitle Cue */
        .hud-secondary-cue {
          display: none;
          position: absolute;
          bottom: 42px;
          left: 50%;
          transform: translateX(-50%);
          max-width: 85%;
          font-size: 15px;
          line-height: 1.4;
          color: #e4e4e7;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), 0 2px 6px rgba(0, 0, 0, 0.6);
          pointer-events: auto;
          user-select: text;
          z-index: 2147483645;
        }
        .hud-secondary-cue.is-blurred {
          filter: blur(5px);
          opacity: 0.6;
          transition: filter 0.2s ease, opacity 0.2s ease;
        }
        .hud-secondary-cue.is-blurred:hover {
          filter: none;
          opacity: 1;
        }
      `;
      this.shadowRoot.appendChild(style);

      this.contentContainer = document.createElement("div");
      this.contentContainer.className = "hud-content-container hud-furigana-hover";
      this.shadowRoot.appendChild(this.contentContainer);

      this.syncBadgeEl = document.createElement("div");
      this.syncBadgeEl.className = "hud-sync-badge";
      this.contentContainer.appendChild(this.syncBadgeEl);

      this.secondaryCueEl = document.createElement("div");
      this.secondaryCueEl.className = "hud-secondary-cue is-blurred";
      this.contentContainer.appendChild(this.secondaryCueEl);

      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(["kiroku.anime.prefs.furigana", "kiroku.anime.prefs.dualSubsEnabled", "kiroku.anime.prefs.dualSubsBlur"], (res) => {
          if (res) {
            if (res["kiroku.anime.prefs.furigana"]) {
              this.setFuriganaMode(res["kiroku.anime.prefs.furigana"]);
            }
            if (res["kiroku.anime.prefs.dualSubsEnabled"] !== undefined) {
              this.dualSubsEnabled = Boolean(res["kiroku.anime.prefs.dualSubsEnabled"]);
            }
            if (res["kiroku.anime.prefs.dualSubsBlur"] !== undefined) {
              this.dualSubsBlur = Boolean(res["kiroku.anime.prefs.dualSubsBlur"]);
              if (this.secondaryCueEl) {
                if (this.dualSubsBlur) {
                  this.secondaryCueEl.classList?.add("is-blurred");
                } else {
                  this.secondaryCueEl.classList?.remove("is-blurred");
                }
              }
            }
          }
        });
      }

      this.mountToParent();

      // ResizeObserver
      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(() => this.updatePosition());
        this.resizeObserver.observe(this.video);
      }

      // IntersectionObserver
      if (typeof IntersectionObserver === "function") {
        this.intersectionObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            this.isVisible = entry.isIntersecting;
            if (this.hostEl) {
              this.hostEl.style.display = this.isVisible ? "block" : "none";
            }
          }
        }, { threshold: 0.1 });
        this.intersectionObserver.observe(this.video);
      }

      // DOM MutationObserver to detect video removal (supports shadow roots and standard DOM)
      if (typeof MutationObserver === "function" && document.body) {
        this.mutationObserver = new MutationObserver(() => {
          const isConnected = this.video?.isConnected ?? (document.body ? document.body.contains(this.video) : false);
          if (!isConnected) {
            this.destroy();
          }
        });
        this.mutationObserver.observe(document.body, { childList: true, subtree: true });
      }

      document.addEventListener("fullscreenchange", this._boundFullscreenChange);
      document.addEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      window.addEventListener("pagehide", this._boundPageHide);
      window.addEventListener("resize", this._boundReposition);

      // Listen to SPA navigation events (YouTube yt-navigate-finish, popstate, hashchange)
      window.addEventListener("yt-navigate-finish", this._boundSpaNavigation);
      window.addEventListener("popstate", this._boundSpaNavigation);
      window.addEventListener("hashchange", this._boundSpaNavigation);

      // Keyboard navigation & timing offset hotkeys
      window.addEventListener("keydown", this._boundKeyDown);

      // Runtime message listener for furigana and dual subtitles
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this._boundRuntimeMessage);
      }

      this.updatePosition();
      hudHosts.set(this.video, this);
      if (typeof window !== "undefined") {
        window.__kirokuHud = this;
      }
    }

    handleSpaNavigation() {
      const isConnected = this.video?.isConnected ?? (document.body ? document.body.contains(this.video) : false);
      if (!isConnected) {
        this.destroy();
      } else {
        this.mountToParent();
        this.updatePosition();
      }
    }

    mountToParent() {
      if (!this.video || !this.hostEl) return;
      const parent = this.video.parentElement || document.body;
      if (parent) {
        const containsChild = typeof parent.contains === "function"
          ? parent.contains(this.hostEl)
          : Array.isArray(parent.children) && parent.children.includes(this.hostEl);
        if (!containsChild && typeof parent.appendChild === "function") {
          // Ensure parent has relative/absolute position
          if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
            const comp = window.getComputedStyle(parent);
            if (comp?.position === "static" && parent.style) {
              parent.style.position = "relative";
            }
          }
          parent.appendChild(this.hostEl);
        }
      }
    }

    handleFullscreenChange() {
      if (typeof document === "undefined") return;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl && this.hostEl) {
        // Video element itself cannot render child HTML elements; mount to parent if fsEl is the video
        if (fsEl !== this.video && fsEl.contains(this.video)) {
          fsEl.appendChild(this.hostEl);
        } else {
          this.mountToParent();
        }
      } else {
        this.mountToParent();
      }
      this.updatePosition();
    }

    updatePosition() {
      if (!this.video || !this.hostEl) return;
      try {
        const vRect = typeof this.video.getBoundingClientRect === "function"
          ? this.video.getBoundingClientRect()
          : null;
        if (!vRect) return;

        const parent = this.hostEl.parentElement;
        if (parent && parent !== document.body && parent.getBoundingClientRect) {
          const pRect = parent.getBoundingClientRect();
          this.hostEl.style.top = `${Math.max(0, vRect.top - pRect.top)}px`;
          this.hostEl.style.left = `${Math.max(0, vRect.left - pRect.left)}px`;
          this.hostEl.style.width = `${vRect.width}px`;
          this.hostEl.style.height = `${vRect.height}px`;
        } else {
          this.hostEl.style.top = `${vRect.top + (typeof window !== "undefined" ? window.scrollY || 0 : 0)}px`;
          this.hostEl.style.left = `${vRect.left + (typeof window !== "undefined" ? window.scrollX || 0 : 0)}px`;
          this.hostEl.style.width = `${vRect.width}px`;
          this.hostEl.style.height = `${vRect.height}px`;
        }
      } catch (_) {}
    }

    setAdapter(adapter) {
      this.adapter = adapter || null;
    }

    setCues(cues) {
      this.cues = Array.isArray(cues) ? cues : [];
    }

    setSecondaryCues(cues) {
      this.secondaryCues = Array.isArray(cues) ? cues : [];
    }

    setOffsetMs(ms) {
      this.offsetMs = Number(ms) || 0;
    }

    setEpisodeKey(key) {
      this.episodeKey = String(key || "");
    }

    showSyncBadge(deltaOrText) {
      if (!this.syncBadgeEl) return;
      let text = "";
      if (typeof deltaOrText === "number") {
        text = `Sync: ${deltaOrText > 0 ? "+" : ""}${deltaOrText}ms`;
      } else {
        text = String(deltaOrText || "");
      }
      this.syncBadgeEl.textContent = text;
      if (this.syncBadgeEl.classList) {
        this.syncBadgeEl.classList.add("is-visible");
      }
      this.syncBadgeEl.style.opacity = "1";
      this.syncBadgeEl.style.transform = "translateY(0)";

      if (this._syncBadgeTimer) clearTimeout(this._syncBadgeTimer);
      this._syncBadgeTimer = setTimeout(() => {
        if (this.syncBadgeEl) {
          if (this.syncBadgeEl.classList) {
            this.syncBadgeEl.classList.remove("is-visible");
          }
          this.syncBadgeEl.style.opacity = "0";
          this.syncBadgeEl.style.transform = "translateY(-4px)";
        }
      }, 1200);
    }

    adjustOffset(deltaMs) {
      if (typeof deltaMs !== "number" || isNaN(deltaMs)) return;
      this.offsetMs = (this.offsetMs || 0) + deltaMs;
      this.showSyncBadge(deltaMs);

      if (this.episodeKey) {
        try {
          const Store = typeof EpisodeStore !== "undefined"
            ? EpisodeStore
            : (typeof defaultEpisodeStore !== "undefined" ? defaultEpisodeStore : null);
          if (Store && typeof Store.updateEpisodeState === "function") {
            Store.updateEpisodeState(this.episodeKey, { offsetMs: this.offsetMs });
          }
        } catch (_) {}
      }

      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "KIROKU_OFFSET_UPDATED",
            offsetMs: this.offsetMs,
            episodeKey: this.episodeKey
          }).catch(() => {});
        }
      } catch (_) {}
    }

    seekRelativeCue(direction) {
      if (!this.adapter) return;
      const caps = typeof this.adapter.getCapabilities === "function" ? this.adapter.getCapabilities() : null;
      if (caps && caps.seek === false) return;
      if (!Array.isArray(this.cues) || this.cues.length === 0) return;

      const currentSec = typeof this.adapter.getCurrentTime === "function"
        ? this.adapter.getCurrentTime()
        : (this.video?.currentTime || 0);
      const offsetSec = (this.offsetMs || 0) / 1000;

      const getCueStart = (c) => {
        if (!c) return 0;
        if (typeof c.startTime === "number") return c.startTime;
        if (typeof c.start === "number") return c.start > 10000 ? c.start / 1000 : c.start;
        if (typeof c.startMs === "number") return c.startMs / 1000;
        if (typeof c.s === "number") return c.s;
        return 0;
      };

      if (direction < 0) {
        let targetCue = null;
        for (let i = this.cues.length - 1; i >= 0; i--) {
          const cue = this.cues[i];
          const cueStart = getCueStart(cue) + offsetSec;
          if (cueStart < currentSec - 0.5) {
            targetCue = cue;
            break;
          }
        }
        if (!targetCue && this.cues.length > 0) {
          targetCue = this.cues[0];
        }
        if (targetCue && typeof this.adapter.seek === "function") {
          const targetTime = Math.max(0, getCueStart(targetCue) + offsetSec);
          this.adapter.seek(targetTime);
        }
      } else if (direction > 0) {
        let targetCue = null;
        for (let i = 0; i < this.cues.length; i++) {
          const cue = this.cues[i];
          const cueStart = getCueStart(cue) + offsetSec;
          if (cueStart > currentSec + 0.1) {
            targetCue = cue;
            break;
          }
        }
        if (targetCue && typeof this.adapter.seek === "function") {
          const targetTime = Math.max(0, getCueStart(targetCue) + offsetSec);
          this.adapter.seek(targetTime);
        }
      }
    }

    _handleKeyDown(e) {
      if (!e || e.defaultPrevented) return;
      const target = e.target;
      if (target) {
        const tag = (target.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        if (target.getAttribute && target.getAttribute("contenteditable") === "true") return;
      }
      if (typeof document !== "undefined") {
        const modal = document.querySelector?.(".modal, .dialog, [role='dialog']:not([hidden]), dialog[open]");
        if (modal && (!modal.hasAttribute || !modal.hasAttribute("hidden"))) {
          return;
        }
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key;
      if (key === "[" || key === "z" || key === "Z") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        this.adjustOffset(-100);
      } else if (key === "]" || key === "x" || key === "X") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        this.adjustOffset(100);
      } else if (key === "a" || key === "A") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        this.seekRelativeCue(-1);
      } else if (key === "d" || key === "D") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        this.seekRelativeCue(1);
      }
    }

    setFuriganaMode(mode) {
      const valid = mode === "always" || mode === "hidden" ? mode : "hover";
      this.furiganaMode = valid;
      const target = this.contentContainer || this.hostEl;
      if (target) {
        if (target.classList) {
          target.classList.remove("hud-furigana-hover", "hud-furigana-always", "hud-furigana-hidden");
          target.classList.add(`hud-furigana-${valid}`);
        } else {
          target.className = `${(target.className || "").replace(/hud-furigana-\w+/g, "")} hud-furigana-${valid}`.trim();
        }
      }
    }

    setDualSubsConfig({ enabled, blur } = {}) {
      if (enabled !== undefined) this.dualSubsEnabled = Boolean(enabled);
      if (blur !== undefined) this.dualSubsBlur = Boolean(blur);
      if (this.secondaryCueEl) {
        if (this.dualSubsBlur) {
          if (this.secondaryCueEl.classList) this.secondaryCueEl.classList.add("is-blurred");
        } else {
          if (this.secondaryCueEl.classList) this.secondaryCueEl.classList.remove("is-blurred");
        }
      }
      if (this.activeSecondaryCue) {
        this.renderSecondaryCue(this.activeSecondaryCue);
      }
    }

    renderSecondaryCue(cue) {
      this.activeSecondaryCue = cue || null;
      if (!this.secondaryCueEl) return;
      if (!this.dualSubsEnabled || !cue || !cue.text || !cue.text.trim()) {
        this.secondaryCueEl.style.display = "none";
        this.secondaryCueEl.textContent = "";
        return;
      }
      this.secondaryCueEl.textContent = cue.text.trim();
      this.secondaryCueEl.style.display = "block";
      if (this.dualSubsBlur) {
        if (this.secondaryCueEl.classList) this.secondaryCueEl.classList.add("is-blurred");
      } else {
        if (this.secondaryCueEl.classList) this.secondaryCueEl.classList.remove("is-blurred");
      }
    }

    _handleRuntimeMessage(msg) {
      if (!msg) return;
      if (msg.type === "KIROKU_FURIGANA_MODE_CHANGED" && msg.mode) {
        this.setFuriganaMode(msg.mode);
      } else if (msg.type === "KIROKU_DUAL_SUBS_CONFIG" || msg.type === "KIROKU_DUAL_SUBS_PREFS_CHANGED") {
        this.setDualSubsConfig({ enabled: msg.enabled, blur: msg.blur });
      }
    }

    registerCleanup(fn) {
      if (typeof fn === "function") {
        this.cleanups.push(fn);
      }
    }

    destroy() {
      for (const fn of this.cleanups) {
        try { fn(); } catch (_) {}
      }
      this.cleanups = [];

      if (this._syncBadgeTimer) {
        clearTimeout(this._syncBadgeTimer);
        this._syncBadgeTimer = null;
      }

      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
        this.intersectionObserver = null;
      }
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      if (typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", this._boundFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", this._boundPageHide);
        window.removeEventListener("resize", this._boundReposition);
        window.removeEventListener("yt-navigate-finish", this._boundSpaNavigation);
        window.removeEventListener("popstate", this._boundSpaNavigation);
        window.removeEventListener("hashchange", this._boundSpaNavigation);
        window.removeEventListener("keydown", this._boundKeyDown);
        if (window.__kirokuHud === this) {
          window.__kirokuHud = null;
        }
      }

      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        try {
          chrome.runtime.onMessage.removeListener(this._boundRuntimeMessage);
        } catch (_) {}
      }

      if (this.hostEl && this.hostEl.parentElement) {
        this.hostEl.parentElement.removeChild(this.hostEl);
      }
      this.hostEl = null;
      this.shadowRoot = null;
      this.contentContainer = null;
      this.syncBadgeEl = null;
      this.secondaryCueEl = null;
      this.activeSecondaryCue = null;
      this.cues = [];
      this.secondaryCues = [];
      this.adapter = null;
      if (this.video) {
        hudHosts.delete(this.video);
        this.video = null;
      }
    }
  }

  function getHudHostForVideo(video) {
    if (!video) return null;
    let host = hudHosts.get(video);
    if (!host) {
      host = new HudHost(video);
    }
    return host;
  }

  return {
    HudHost,
    getHudHostForVideo
  };
});
