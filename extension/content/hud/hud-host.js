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
      this._boundReposition = this.updatePosition.bind(this);
      this._boundFullscreenChange = this.handleFullscreenChange.bind(this);
      this._boundPageHide = this.destroy.bind(this);
      this._boundSpaNavigation = this.handleSpaNavigation.bind(this);

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
      `;
      this.shadowRoot.appendChild(style);

      this.contentContainer = document.createElement("div");
      this.contentContainer.className = "hud-content-container";
      this.shadowRoot.appendChild(this.contentContainer);

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
        if (window.__kirokuHud === this) {
          window.__kirokuHud = null;
        }
      }

      if (this.hostEl && this.hostEl.parentElement) {
        this.hostEl.parentElement.removeChild(this.hostEl);
      }
      this.hostEl = null;
      this.shadowRoot = null;
      this.contentContainer = null;
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
