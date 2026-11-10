/**
 * Kiroku Note - YouTube Player Adapter
 */

(function (root, factory) {
  const exports = factory(
    typeof require === "function" ? require("./player-adapter.js") : { PlayerAdapter: root.PlayerAdapter, defaultPlayerRegistry: root.defaultPlayerRegistry }
  );
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.YouTubePlayerAdapter = exports.YouTubePlayerAdapter;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (base) {
  "use strict";

  const PlayerAdapter = base.PlayerAdapter;

  class YouTubePlayerAdapter extends PlayerAdapter {
    static detect(video) {
      if (typeof location !== "undefined" && location.hostname && location.hostname.includes("youtube.com")) {
        return Boolean(video);
      }
      return Boolean(video && (video.closest?.(".html5-video-player") || video.classList?.contains("html5-main-video")));
    }

    _getYtPlayer() {
      if (typeof document !== "undefined") {
        return document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
      }
      return null;
    }

    getCurrentTime() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.getCurrentTime === "function") {
        try {
          const t = yt.getCurrentTime();
          if (typeof t === "number" && !isNaN(t) && isFinite(t)) return Math.max(0, t);
        } catch (_) {}
      }
      return super.getCurrentTime();
    }

    getDuration() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.getDuration === "function") {
        try {
          const d = yt.getDuration();
          if (typeof d === "number" && !isNaN(d) && isFinite(d)) return Math.max(0, d);
        } catch (_) {}
      }
      return super.getDuration();
    }

    isPaused() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.getPlayerState === "function") {
        try {
          const state = yt.getPlayerState();
          if (state === 1) return false; // playing
          if (state === 2) return true;  // paused
        } catch (_) {}
      }
      return super.isPaused();
    }

    play() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.playVideo === "function") {
        try {
          yt.playVideo();
          return;
        } catch (_) {}
      }
      super.play();
    }

    pause() {
      const yt = this._getYtPlayer();
      if (yt && typeof yt.pauseVideo === "function") {
        try {
          yt.pauseVideo();
          return;
        } catch (_) {}
      }
      super.pause();
    }

    seek(timeSeconds) {
      if (typeof timeSeconds !== "number" || isNaN(timeSeconds) || !isFinite(timeSeconds)) return;
      const safeTime = Math.max(0, timeSeconds);
      const yt = this._getYtPlayer();
      if (yt && typeof yt.seekTo === "function") {
        try {
          yt.seekTo(safeTime, true);
          return;
        } catch (_) {}
      }
      super.seek(safeTime);
    }

    setPlaybackRate(rate) {
      if (typeof rate !== "number" || isNaN(rate) || !isFinite(rate) || rate <= 0) return;
      const yt = this._getYtPlayer();
      if (yt && typeof yt.setPlaybackRate === "function") {
        try {
          yt.setPlaybackRate(rate);
          return;
        } catch (_) {}
      }
      super.setPlaybackRate(rate);
    }

    getCapabilities() {
      return {
        seek: true,
        playbackRate: true,
        captureFrame: true,
        dualSubtitles: true
      };
    }
  }

  if (base.defaultPlayerRegistry) {
    base.defaultPlayerRegistry.register(YouTubePlayerAdapter);
  }

  return { YouTubePlayerAdapter };
});

