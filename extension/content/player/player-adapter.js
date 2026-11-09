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
    }

    static detect(video) {
      return false;
    }

    getCurrentTime() {
      if (!this.video) return 0;
      return typeof this.video.currentTime === "number" ? this.video.currentTime : 0;
    }

    getDuration() {
      if (!this.video) return 0;
      return typeof this.video.duration === "number" && !isNaN(this.video.duration)
        ? this.video.duration
        : 0;
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
      if (typeof timeSeconds !== "number" || isNaN(timeSeconds)) return;
      try {
        this.video.currentTime = Math.max(0, timeSeconds);
      } catch (_) {}
    }

    setPlaybackRate(rate) {
      if (!this.video) return;
      if (typeof rate !== "number" || rate <= 0) return;
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

