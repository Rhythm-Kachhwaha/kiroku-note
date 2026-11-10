/**
 * Kiroku Note - Player Adapter Base Interface & Registry
 * 
 * Provides unified playback control, timing, and capabilities across:
 * - HTML5 video elements (generic)
 * - YouTube player
 * - Netflix player
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.PlayerAdapter = exports.PlayerAdapter;
    root.PlayerAdapterRegistry = exports.PlayerAdapterRegistry;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class PlayerAdapter {
    constructor(video) {
      this.video = video || null;
      this._destroyed = false;
      this._listeners = new Map();

      this._boundVideoPlay = () => this._emit("play");
      this._boundVideoPause = () => this._emit("pause");
      this._boundVideoTimeUpdate = () => this._emit("timeupdate", this.getCurrentTime());
      this._boundVideoSeeked = () => this._emit("seeked", this.getCurrentTime());
      this._boundVideoRateChange = () => this._emit("ratechange", this.video?.playbackRate);

      if (this.video && typeof this.video.addEventListener === "function") {
        this.video.addEventListener("play", this._boundVideoPlay);
        this.video.addEventListener("pause", this._boundVideoPause);
        this.video.addEventListener("timeupdate", this._boundVideoTimeUpdate);
        this.video.addEventListener("seeked", this._boundVideoSeeked);
        this.video.addEventListener("ratechange", this._boundVideoRateChange);
      }
    }

    on(event, handler) {
      if (typeof handler !== "function") return () => {};
      if (!this._listeners.has(event)) {
        this._listeners.set(event, new Set());
      }
      this._listeners.get(event).add(handler);
      return () => this.off(event, handler);
    }

    off(event, handler) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(handler);
      }
    }

    _emit(event, ...args) {
      if (this._destroyed) return;
      const handlers = this._listeners.get(event);
      if (handlers) {
        for (const fn of handlers) {
          try { fn(...args); } catch (_) {}
        }
      }
    }

    static detect(video) {
      return false;
    }

    getCurrentTime() {
      if (!this.video) return 0;
      const t = this.video.currentTime;
      return typeof t === "number" && !isNaN(t) && isFinite(t) ? Math.max(0, t) : 0;
    }

    getDuration() {
      if (!this.video) return 0;
      const d = this.video.duration;
      return typeof d === "number" && !isNaN(d) && isFinite(d) ? Math.max(0, d) : 0;
    }

    isPaused() {
      if (!this.video) return true;
      return Boolean(this.video.paused);
    }

    play() {
      if (this.video && typeof this.video.play === "function") {
        try {
          const res = this.video.play();
          if (res && typeof res.catch === "function") res.catch(() => {});
        } catch (_) {}
      }
    }

    pause() {
      if (this.video && typeof this.video.pause === "function") {
        try {
          this.video.pause();
        } catch (_) {}
      }
    }

    seek(timeSeconds) {
      if (!this.video) return;
      if (typeof timeSeconds !== "number" || isNaN(timeSeconds) || !isFinite(timeSeconds)) return;
      try {
        let safeTime = Math.max(0, timeSeconds);
        const duration = this.getDuration();
        if (duration > 0 && safeTime > duration) {
          safeTime = duration;
        }
        this.video.currentTime = safeTime;
      } catch (_) {}
    }

    setPlaybackRate(rate) {
      if (!this.video) return;
      if (typeof rate !== "number" || isNaN(rate) || !isFinite(rate) || rate <= 0) return;
      try {
        this.video.playbackRate = rate;
      } catch (_) {}
    }

    getCapabilities() {
      return {
        seek: true,
        playbackRate: true,
        captureFrame: true,
        dualSubtitles: false
      };
    }

    captureFrame() {
      if (!this.video) return null;
      try {
        const width = this.video.videoWidth || this.video.clientWidth || 640;
        const height = this.video.videoHeight || this.video.clientHeight || 360;
        if (width <= 0 || height <= 0) return null;

        const canvas = typeof document !== "undefined" && typeof document.createElement === "function"
          ? document.createElement("canvas")
          : null;
        if (!canvas) return null;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(this.video, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", 0.85);
      } catch (_) {
        return null;
      }
    }

    destroy() {
      this._destroyed = true;
      if (this.video && typeof this.video.removeEventListener === "function") {
        this.video.removeEventListener("play", this._boundVideoPlay);
        this.video.removeEventListener("pause", this._boundVideoPause);
        this.video.removeEventListener("timeupdate", this._boundVideoTimeUpdate);
        this.video.removeEventListener("seeked", this._boundVideoSeeked);
        this.video.removeEventListener("ratechange", this._boundVideoRateChange);
      }
      this._listeners.clear();
      this.video = null;
    }
  }

  class PlayerAdapterRegistry {
    constructor() {
      this.adapters = [];
    }

    register(AdapterClass) {
      if (AdapterClass && !this.adapters.includes(AdapterClass)) {
        this.adapters.unshift(AdapterClass); // Priority to custom adapters over fallback
      }
    }

    resolve(video) {
      for (const AdapterClass of this.adapters) {
        try {
          if (typeof AdapterClass.detect === "function" && AdapterClass.detect(video)) {
            return new AdapterClass(video);
          }
        } catch (_) {}
      }
      return new PlayerAdapter(video);
    }
  }

  const defaultRegistry = new PlayerAdapterRegistry();

  return {
    PlayerAdapter,
    PlayerAdapterRegistry,
    defaultPlayerRegistry: defaultRegistry
  };
});

