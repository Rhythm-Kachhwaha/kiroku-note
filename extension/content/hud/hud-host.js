/**
 * Kiroku Note - Unified Subtitle HUD Host & Video Attachment Manager
 *
 * Responsibilities:
 * - Authoritative in-page subtitle renderer and host for HTML5, YouTube, and Netflix
 * - High-performance requestAnimationFrame cue sync (binary search over sorted cues)
 * - Renders interactive Japanese tokens with cursor:pointer (never cursor:text)
 * - 4 Playback Modes: Always Show, Only Unknown, Blur Until Hover, Auto-Pause
 * - Furigana cycle modes (Hover / Always / Hidden)
 * - Hotkeys: A/D (prev/next cue), R (replay line), B (toggle blur), [/] (offset)
 * - Secondary subtitle support (dual subtitles with optional blur)
 * - Integrated with HudPopup and KirokuToast
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
      this.primaryCueEl = null;
      this.secondaryCueEl = null;
      this.syncBadgeEl = null;
      this.popup = null;

      this.cues = [];
      this.secondaryCues = [];
      this.offsetMs = 0;
      this.episodeKey = "";
      this.adapter = null;

      this.activeCue = null;
      this.activeSecondaryCue = null;
      this.playbackMode = "always"; // 'always' | 'unknown_only' | 'blur_hover' | 'autopause'
      this.furiganaMode = "hover";  // 'hover' | 'always' | 'hidden'
      this.dualSubsEnabled = false;
      this.dualSubsBlur = true;
      this.isVisible = true;

      this._rafId = null;
      this._syncBadgeTimer = null;
      this._lastAutoPausedCue = null;
      this.cleanups = [];

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
      this.hostEl.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483640;
      `;

      try {
        this.shadowRoot = this.hostEl.attachShadow({ mode: "open" });
      } catch (_) {
        this.shadowRoot = this.hostEl;
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
          -webkit-user-select: none;
        }

        .hud-content-container {
          position: relative;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        /* Primary Japanese Subtitle Cue */
        .hud-primary-cue {
          display: none;
          position: absolute;
          bottom: 58px;
          left: 50%;
          transform: translateX(-50%);
          max-width: 90%;
          text-align: center;
          font-family: "Zen Kaku Gothic New", "Noto Sans JP", sans-serif;
          font-size: 26px;
          font-weight: 600;
          line-height: 1.45;
          color: #FFFFFF;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.8), 0 1px 2px #000;
          pointer-events: auto;
          user-select: none;
          z-index: 2147483646;
          transition: filter 180ms ease, opacity 180ms ease;
        }

        .hud-primary-cue.is-blurred {
          filter: blur(6px);
          opacity: 0.65;
        }

        .hud-primary-cue.is-blurred:hover {
          filter: none;
          opacity: 1;
        }

        /* Interactive Subtitle Tokens */
        .hud-token {
          display: inline;
          padding: 0;
          margin: 0;
          border-radius: 3px;
          cursor: pointer !important;
          user-select: none;
          -webkit-user-select: none;
          transition: background-color 140ms ease;
        }

        .hud-token:hover {
          background-color: rgba(255, 255, 255, 0.22);
        }

        .hud-symbol {
          display: inline;
          padding: 0;
          margin: 0;
          cursor: default !important;
          user-select: none;
        }

        .hud-token.mined {
          color: #D4884F;
          text-decoration: underline;
          text-decoration-color: rgba(212, 136, 79, 0.7);
          text-underline-offset: 3px;
        }

        .hud-token.should-know, .hud-token.learning {
          color: #4EBB7B;
          text-decoration: underline;
          text-decoration-color: rgba(78, 187, 123, 0.6);
          text-underline-offset: 3px;
        }

        .hud-token.unknown {
          color: #F39120;
          text-decoration: underline;
          text-decoration-color: rgba(243, 145, 32, 0.6);
          text-underline-offset: 3px;
        }

        /* Furigana Display Modes */
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

        /* Secondary Subtitle Cue (Translations) */
        .hud-secondary-cue {
          display: none;
          position: absolute;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          max-width: 85%;
          font-size: 15px;
          line-height: 1.4;
          color: #E4E4E7;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), 0 2px 6px rgba(0, 0, 0, 0.6);
          pointer-events: auto;
          user-select: text;
          z-index: 2147483645;
          transition: filter 180ms ease, opacity 180ms ease;
        }

        .hud-secondary-cue.is-blurred {
          filter: blur(5px);
          opacity: 0.55;
        }

        .hud-secondary-cue.is-blurred:hover {
          filter: none;
          opacity: 1;
        }

        /* Floating Sync Badge */
        .hud-sync-badge {
          position: absolute;
          top: 24px;
          right: 24px;
          background: rgba(24, 24, 27, 0.92);
          color: #F4F4F5;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
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
      `;
      this.shadowRoot.appendChild(style);

      this.contentContainer = document.createElement("div");
      this.contentContainer.className = "hud-content-container hud-furigana-hover";
      this.shadowRoot.appendChild(this.contentContainer);

      this.primaryCueEl = document.createElement("div");
      this.primaryCueEl.className = "hud-primary-cue";
      this.contentContainer.appendChild(this.primaryCueEl);

      this.secondaryCueEl = document.createElement("div");
      this.secondaryCueEl.className = "hud-secondary-cue is-blurred";
      this.contentContainer.appendChild(this.secondaryCueEl);

      this.syncBadgeEl = document.createElement("div");
      this.syncBadgeEl.className = "hud-sync-badge";
      this.contentContainer.appendChild(this.syncBadgeEl);

      // Initialize Popup inside this host
      if (typeof HudPopup !== "undefined") {
        this.popup = new HudPopup(this, null);
      }

      this.mountToParent();

      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(() => this.updatePosition());
        this.resizeObserver.observe(this.video);
      }

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

      document.addEventListener("fullscreenchange", this._boundFullscreenChange);
      document.addEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      window.addEventListener("pagehide", this._boundPageHide);
      window.addEventListener("resize", this._boundReposition);
      window.addEventListener("yt-navigate-finish", this._boundSpaNavigation);
      window.addEventListener("popstate", this._boundSpaNavigation);
      window.addEventListener("hashchange", this._boundSpaNavigation);
      window.addEventListener("keydown", this._boundKeyDown);

      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this._boundRuntimeMessage);
      }

      this.loadPreferences();
      this.updatePosition();
      this._startRafSync();

      hudHosts.set(this.video, this);
      if (typeof window !== "undefined") {
        window.__kirokuHud = this;
      }
    }

    async loadPreferences() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get("kiroku.extension.prefs");
          const prefs = res?.["kiroku.extension.prefs"];
          if (prefs) {
            if (prefs.furiganaMode) this.setFuriganaMode(prefs.furiganaMode);
            if (prefs.playbackMode) this.setPlaybackMode(prefs.playbackMode);
            if (prefs.dualSubsEnabled !== undefined) this.setDualSubsConfig({ enabled: prefs.dualSubsEnabled });
          }
        }
      } catch (_) {}
    }

    mountToParent() {
      if (!this.video || !this.hostEl) return;
      const parent = this.video.parentElement || document.body;
      if (parent) {
        const containsChild = typeof parent.contains === "function" ? parent.contains(this.hostEl) : false;
        if (!containsChild) {
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

    handleSpaNavigation() {
      const isConnected = this.video?.isConnected ?? (document.body ? document.body.contains(this.video) : false);
      if (!isConnected) {
        this.destroy();
      } else {
        this.mountToParent();
        this.updatePosition();
      }
    }

    updatePosition() {
      if (!this.video || !this.hostEl) return;
      try {
        const vRect = typeof this.video.getBoundingClientRect === "function" ? this.video.getBoundingClientRect() : null;
        if (!vRect) return;

        const parent = this.hostEl.parentElement;
        if (parent && parent !== document.body && parent.getBoundingClientRect) {
          const pRect = parent.getBoundingClientRect();
          this.hostEl.style.top = `${Math.max(0, vRect.top - pRect.top)}px`;
          this.hostEl.style.left = `${Math.max(0, vRect.left - pRect.left)}px`;
          this.hostEl.style.width = `${vRect.width}px`;
          this.hostEl.style.height = `${vRect.height}px`;
        } else {
          this.hostEl.style.top = `${vRect.top + (window.scrollY || 0)}px`;
          this.hostEl.style.left = `${vRect.left + (window.scrollX || 0)}px`;
          this.hostEl.style.width = `${vRect.width}px`;
          this.hostEl.style.height = `${vRect.height}px`;
        }
      } catch (_) {}
    }

    setCues(cues) {
      this.cues = Array.isArray(cues) ? cues.slice().sort((a, b) => this._getCueStart(a) - this._getCueStart(b)) : [];
    }

    setSecondaryCues(cues) {
      this.secondaryCues = Array.isArray(cues) ? cues.slice().sort((a, b) => this._getCueStart(a) - this._getCueStart(b)) : [];
    }

    setOffsetMs(ms) {
      this.offsetMs = Number(ms) || 0;
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

    _getCueStart(c) {
      if (!c) return 0;
      if (typeof c.startTime === "number") return c.startTime;
      if (typeof c.start === "number") return c.start > 10000 ? c.start / 1000 : c.start;
      if (typeof c.startMs === "number") return c.startMs / 1000;
      return 0;
    }

    _getCueEnd(c) {
      if (!c) return 0;
      if (typeof c.endTime === "number") return c.endTime;
      if (typeof c.end === "number") return c.end > 10000 ? c.end / 1000 : c.end;
      if (typeof c.endMs === "number") return c.endMs / 1000;
      return this._getCueStart(c) + 3; // fallback 3s
    }

    _findActiveCue(cues, currentTime) {
      if (!cues || cues.length === 0) return null;
      let low = 0;
      let high = cues.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const cue = cues[mid];
        const start = this._getCueStart(cue);
        const end = this._getCueEnd(cue);
        if (currentTime >= start && currentTime <= end) {
          return cue;
        } else if (currentTime < start) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return null;
    }

    _startRafSync() {
      if (this._rafId || typeof requestAnimationFrame !== "function") return;
      const syncStep = () => {
        this._updateActiveCue();
        if (typeof requestAnimationFrame === "function") {
          this._rafId = requestAnimationFrame(syncStep);
        }
      };
      this._rafId = requestAnimationFrame(syncStep);
    }

    _updateActiveCue() {
      if (!this.video || !this.primaryCueEl) return;

      const currentSec = (this.video.currentTime || 0) + (this.offsetMs / 1000);
      const nextCue = this._findActiveCue(this.cues, currentSec);

      // Handle auto-pause mode
      if (this.playbackMode === "autopause" && this.activeCue && !nextCue && !this.video.paused) {
        if (this._lastAutoPausedCue !== this.activeCue) {
          this._lastAutoPausedCue = this.activeCue;
          this.video.pause();
        }
      }

      if (nextCue !== this.activeCue) {
        this.activeCue = nextCue;
        this.renderPrimaryCue(nextCue);
        if (this.popup) this.popup.setCue(nextCue);

        if (nextCue) {
          chrome.runtime.sendMessage?.({
            type: "HUD_ACTIVE_CUE_CHANGED",
            cue: nextCue
          }).catch?.(() => {});
        }
      }

      if (this.dualSubsEnabled) {
        const nextSecondary = this._findActiveCue(this.secondaryCues, currentSec);
        if (nextSecondary !== this.activeSecondaryCue) {
          this.activeSecondaryCue = nextSecondary;
          this.renderSecondaryCue(nextSecondary);
        }
      }
    }

    renderPrimaryCue(cue) {
      if (!this.primaryCueEl) return;
      if (!cue || !cue.text) {
        this.primaryCueEl.style.display = "none";
        this.primaryCueEl.replaceChildren();
        return;
      }

      // Check playback mode: 'unknown_only'
      if (this.playbackMode === "unknown_only" && Array.isArray(cue.tokens) && cue.tokens.length > 0) {
        const hasUnknown = cue.tokens.some((t) => t.status === "unknown" || t.status === "unstyled");
        if (!hasUnknown) {
          this.primaryCueEl.style.display = "none";
          return;
        }
      }

      this.primaryCueEl.replaceChildren();

      // Render tokens
      const tokens = Array.isArray(cue.tokens) && cue.tokens.length > 0
        ? cue.tokens
        : [{ surface: cue.text, lemma: cue.text, text: cue.text }];

      const symbolRegex = /^[\sー〜～、。！？!?…・…\-,.:;()「」『』【】〔〕]+$/;
      for (const tok of tokens) {
        const text = tok.surface || tok.text || "";
        const span = document.createElement("span");
        if (symbolRegex.test(text)) {
          span.className = "hud-symbol";
          span.textContent = text;
        } else {
          span.className = `hud-token ${tok.status || ""}`.trim();
          span.textContent = text;
          span.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.popup) {
              this.popup.showForToken(tok, span, cue, cue.text);
            }
          });
        }
        this.primaryCueEl.appendChild(span);
      }

      this.primaryCueEl.style.display = "block";

      if (this.playbackMode === "blur_hover") {
        this.primaryCueEl.classList.add("is-blurred");
      } else {
        this.primaryCueEl.classList.remove("is-blurred");
      }
    }

    renderSecondaryCue(cue) {
      if (!this.secondaryCueEl) return;
      if (!this.dualSubsEnabled || !cue || !cue.text) {
        this.secondaryCueEl.style.display = "none";
        this.secondaryCueEl.textContent = "";
        return;
      }
      this.secondaryCueEl.textContent = cue.text.trim();
      this.secondaryCueEl.style.display = "block";
    }

    setPlaybackMode(mode) {
      const valid = ["always", "unknown_only", "blur_hover", "autopause"].includes(mode) ? mode : "always";
      this.playbackMode = valid;
      if (valid === "blur_hover") {
        this.primaryCueEl?.classList.add("is-blurred");
      } else {
        this.primaryCueEl?.classList.remove("is-blurred");
      }
      if (this.activeCue) this.renderPrimaryCue(this.activeCue);
    }

    setAdapter(adapter) {
      this.adapter = adapter || null;
    }

    setFuriganaMode(mode) {
      const valid = ["always", "hidden"].includes(mode) ? mode : "hover";
      this.furiganaMode = valid;
      if (this.contentContainer) {
        this.contentContainer.className = `hud-content-container hud-furigana-${valid}`;
        if (this.contentContainer.classList?.remove) {
          this.contentContainer.classList.remove("hud-furigana-hover", "hud-furigana-always", "hud-furigana-hidden");
          this.contentContainer.classList.add(`hud-furigana-${valid}`);
        }
      }
    }

    setDualSubsConfig({ enabled, blur } = {}) {
      if (enabled !== undefined) this.dualSubsEnabled = Boolean(enabled);
      if (blur !== undefined) {
        this.dualSubsBlur = Boolean(blur);
        if (this.dualSubsBlur) this.secondaryCueEl?.classList?.add?.("is-blurred");
        else this.secondaryCueEl?.classList?.remove?.("is-blurred");
      }
      if (this.activeSecondaryCue) this.renderSecondaryCue(this.activeSecondaryCue);
    }

    showSyncBadge(deltaOrText) {
      if (!this.syncBadgeEl) return;
      const text = typeof deltaOrText === "number" ? `Sync: ${deltaOrText > 0 ? "+" : ""}${deltaOrText}ms` : String(deltaOrText);
      this.syncBadgeEl.textContent = text;
      if (this.syncBadgeEl.classList?.add) {
        this.syncBadgeEl.classList.add("is-visible");
      }
      if (this._syncBadgeTimer) clearTimeout(this._syncBadgeTimer);
      this._syncBadgeTimer = setTimeout(() => {
        this.syncBadgeEl?.classList?.remove?.("is-visible");
      }, 1200);
    }

    seekRelativeCue(direction) {
      if (!this.cues || !this.cues.length) return;
      const currentSec = (this.adapter && typeof this.adapter.getCurrentTime === "function")
        ? this.adapter.getCurrentTime()
        : ((this.video?.currentTime || 0) + (this.offsetMs / 1000));

      if (direction < 0) {
        for (let i = this.cues.length - 1; i >= 0; i--) {
          const cueStart = this._getCueStart(this.cues[i]);
          if (cueStart < currentSec - 0.5) {
            const targetTime = Math.max(0, cueStart - (this.offsetMs / 1000));
            if (this.adapter && typeof this.adapter.seek === "function") {
              this.adapter.seek(targetTime);
            } else if (this.video) {
              this.video.currentTime = targetTime;
            }
            return;
          }
        }
      } else {
        for (let i = 0; i < this.cues.length; i++) {
          const cueStart = this._getCueStart(this.cues[i]);
          if (cueStart > currentSec + 0.2) {
            const targetTime = Math.max(0, cueStart - (this.offsetMs / 1000));
            if (this.adapter && typeof this.adapter.seek === "function") {
              this.adapter.seek(targetTime);
            } else if (this.video) {
              this.video.currentTime = targetTime;
            }
            return;
          }
        }
      }
    }

    replayCurrentCue() {
      if (!this.video || !this.activeCue) return;
      const start = this._getCueStart(this.activeCue);
      this.video.currentTime = Math.max(0, start - (this.offsetMs / 1000));
      this.video.play?.();
    }

    _handleKeyDown(e) {
      if (!e || e.defaultPrevented) return;
      const tag = (e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        this.seekRelativeCue(-1);
      } else if (key === "d") {
        e.preventDefault();
        this.seekRelativeCue(1);
      } else if (key === "r") {
        e.preventDefault();
        this.replayCurrentCue();
      } else if (key === "b") {
        e.preventDefault();
        this.setPlaybackMode(this.playbackMode === "blur_hover" ? "always" : "blur_hover");
        this.showSyncBadge(this.playbackMode === "blur_hover" ? "Blur: On" : "Blur: Off");
      } else if (key === "[" || key === "z") {
        e.preventDefault();
        this.adjustOffset(-100);
      } else if (key === "]" || key === "x") {
        e.preventDefault();
        this.adjustOffset(100);
      }
    }

    _handleRuntimeMessage(msg) {
      if (!msg) return;
      if (msg.type === "SET_FURIGANA_MODE") this.setFuriganaMode(msg.mode);
      if (msg.type === "SET_PLAYBACK_MODE") this.setPlaybackMode(msg.mode);
      if (msg.type === "SET_DUAL_SUBS_CONFIG") this.setDualSubsConfig(msg);
    }

    registerCleanup(fn) {
      if (typeof fn === "function") this.cleanups.push(fn);
    }

    destroy() {
      if (this._rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      for (const fn of this.cleanups) {
        try { fn(); } catch (_) {}
      }
      this.cleanups = [];

      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.intersectionObserver) this.intersectionObserver.disconnect();

      if (typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", this._boundFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", this._boundPageHide);
        window.removeEventListener("resize", this._boundReposition);
        window.removeEventListener("keydown", this._boundKeyDown);
        if (window.__kirokuHud === this) window.__kirokuHud = null;
      }

      if (this.hostEl && this.hostEl.parentElement) {
        this.hostEl.parentElement.removeChild(this.hostEl);
      }
      this.hostEl = null;
      if (this.video) {
        hudHosts.delete(this.video);
        this.video = null;
      }
    }
  }

  function getHudHostForVideo(video) {
    if (!video) return null;
    let host = hudHosts.get(video);
    if (!host) host = new HudHost(video);
    return host;
  }

  return { HudHost, getHudHostForVideo };
});
